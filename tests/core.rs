use spine::*;
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

fn wait_for<T>(rx: &mpsc::Receiver<T>, ms: u64) -> Option<T> {
    rx.recv_timeout(Duration::from_millis(ms)).ok()
}

fn make_bus() -> SignalBus {
    SignalBus::builder()
        .allow_catch_all(false)
        .default_queue_depth(8)
        .build()
}

#[test]
fn parses_and_canonicalizes_addresses() {
    let address = Address::parse("users/123/permissions/edit").unwrap();
    assert_eq!(address.as_str(), "users/123/permissions/edit");
    assert_eq!(address.to_string(), "users/123/permissions/edit");
    let roundtrip = Address::parse(address.as_str()).unwrap();
    assert_eq!(roundtrip.as_str(), address.as_str());
}

#[test]
fn rejects_invalid_addresses() {
    for input in [
        "/users/123",
        "users/123/",
        "users//123",
        "users/../admin",
        "users/%2e%2e/admin",
        "users/{id}",
        "users/*",
        "users/**",
    ] {
        assert!(
            Address::parse(input).is_err(),
            "expected rejection for {input}"
        );
    }
}

#[test]
fn parses_expressions_and_captures_variables() {
    let expr = AddressExpression::parse("documents/{document_id}/blocks/{block_id}/changed", false)
        .unwrap();
    let addr = Address::parse("documents/abc/blocks/42/changed").unwrap();
    let matched = expr.match_address(&addr, 7).expect("match");
    assert_eq!(matched.params.get("document_id"), Some("abc"));
    assert_eq!(matched.params.get("block_id"), Some("42"));
    assert_eq!(matched.specificity.literal_segments, 3);
    assert_eq!(matched.specificity.dynamic_segments, 2);
}

#[test]
fn recursive_wildcard_matches_when_enabled() {
    let expr = AddressExpression::parse("documents/{document_id}/**", true).unwrap();
    let addr = Address::parse("documents/abc/blocks/42/changed").unwrap();
    let matched = expr.match_address(&addr, 1).expect("match");
    assert_eq!(matched.params.get("document_id"), Some("abc"));
    assert_eq!(matched.specificity.recursive_segments, 1);
    assert_eq!(matched.specificity.recursive_consumed, 3);
}

#[test]
fn catch_all_is_disabled_by_default() {
    let bus = make_bus();
    let result = bus.subscribe::<u64, _, _>(
        "**",
        Schema::of::<u64>(),
        DeliveryOptions::default(),
        |_ctx, _signal| async move { Ok(()) },
    );
    assert!(result.is_err());
}

#[test]
fn specificity_orders_most_specific_first() {
    let addr = Address::parse("documents/abc/blocks/42/changed").unwrap();
    let mut matches = vec![
        AddressExpression::parse("documents/{document_id}/blocks/{block_id}/changed", false)
            .unwrap()
            .match_address(&addr, 1)
            .unwrap(),
        AddressExpression::parse("documents/{document_id}/blocks/*/changed", false)
            .unwrap()
            .match_address(&addr, 2)
            .unwrap(),
        AddressExpression::parse("documents/{document_id}/**", true)
            .unwrap()
            .match_address(&addr, 3)
            .unwrap(),
        AddressExpression::parse("**", true)
            .unwrap()
            .match_address(&addr, 4)
            .unwrap(),
        AddressExpression::parse("documents/abc/blocks/42/changed", false)
            .unwrap()
            .match_address(&addr, 0)
            .unwrap(),
    ];
    matches.sort_by(|a, b| b.specificity.cmp(&a.specificity));
    let ordered: Vec<_> = matches
        .iter()
        .map(|m| m.expression.as_str().to_string())
        .collect();
    assert_eq!(
        ordered,
        vec![
            "documents/abc/blocks/42/changed",
            "documents/{document_id}/blocks/{block_id}/changed",
            "documents/{document_id}/blocks/*/changed",
            "documents/{document_id}/**",
            "**",
        ]
    );
}

#[test]
fn publish_delivers_only_to_matching_subscribers() {
    let bus = make_bus();
    let (tx, rx) = mpsc::channel();
    let _sub = bus
        .subscribe::<String, _, _>(
            "documents/{document_id}/blocks/{block_id}/changed",
            Schema::of::<String>(),
            DeliveryOptions::default(),
            move |ctx, signal| {
                let tx = tx.clone();
                async move {
                    if let Payload::Inline(payload) = signal.payload {
                        tx.send((
                            ctx.param("document_id").unwrap().to_string(),
                            ctx.param("block_id").unwrap().to_string(),
                            payload,
                        ))
                        .unwrap();
                    }
                    Ok(())
                }
            },
        )
        .unwrap();

    let result = bus
        .publish("documents/abc/blocks/42/changed", "hello".to_string())
        .unwrap();
    assert_eq!(result.matched_subscribers, 1);
    assert_eq!(result.accepted_deliveries, 1);

    let delivered = wait_for(&rx, 500).expect("delivery");
    assert_eq!(
        delivered,
        ("abc".to_string(), "42".to_string(), "hello".to_string())
    );
}

#[test]
fn non_matching_subscriber_receives_nothing() {
    let bus = make_bus();
    let (tx, rx) = mpsc::channel();
    let _sub = bus
        .subscribe::<String, _, _>(
            "documents/{document_id}/blocks/{block_id}/changed",
            Schema::of::<String>(),
            DeliveryOptions::default(),
            move |_ctx, _signal| {
                let tx = tx.clone();
                async move {
                    let _ = tx.send(());
                    Ok(())
                }
            },
        )
        .unwrap();

    bus.publish("documents/abc/blocks/42/renamed", "hello".to_string())
        .unwrap();
    assert!(wait_for(&rx, 150).is_none());
}

#[test]
fn queue_overflow_is_bounded_and_rejects_publish() {
    let bus = SignalBus::builder().default_queue_depth(1).build();
    let (started_tx, started_rx) = mpsc::channel::<()>();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let release_for_handler = release.clone();

    let _sub = bus
        .subscribe::<String, _, _>(
            "jobs/{job_id}/status",
            Schema::of::<String>(),
            DeliveryOptions {
                queue: QueuePolicy {
                    max_depth: 1,
                    overflow: OverflowPolicy::RejectPublish,
                },
                ..DeliveryOptions::default()
            },
            move |_ctx, _signal| {
                let started_tx = started_tx.clone();
                let release = release_for_handler.clone();
                async move {
                    started_tx.send(()).unwrap();
                    let (lock, cvar) = &*release;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = cvar.wait(released).unwrap();
                    }
                    Ok(())
                }
            },
        )
        .unwrap();

    bus.publish("jobs/job-1/status", "queued".to_string())
        .unwrap();
    started_rx.recv_timeout(Duration::from_millis(500)).unwrap();
    let second = bus
        .publish("jobs/job-1/status", "running".to_string())
        .unwrap();
    assert_eq!(second.rejected_deliveries, 1);
    assert!(!second.errors.is_empty());
    let (lock, cvar) = &*release;
    *lock.lock().unwrap() = true;
    cvar.notify_all();
}

#[test]
fn handler_panic_isolated_from_other_subscribers() {
    let bus = make_bus();
    let (tx, rx) = mpsc::channel();

    let _panic_sub = bus
        .subscribe::<String, _, _>(
            "events/{name}",
            Schema::of::<String>(),
            DeliveryOptions::default(),
            move |_ctx, _signal| async move {
                panic!("boom");
                #[allow(unreachable_code)]
                Ok(())
            },
        )
        .unwrap();

    let _ok_sub = bus
        .subscribe::<String, _, _>(
            "events/{name}",
            Schema::of::<String>(),
            DeliveryOptions::default(),
            move |ctx, signal| {
                let tx = tx.clone();
                async move {
                    if let Payload::Inline(payload) = signal.payload {
                        tx.send((ctx.param("name").unwrap().to_string(), payload))
                            .unwrap();
                    }
                    Ok(())
                }
            },
        )
        .unwrap();

    bus.publish("events/demo", "payload".to_string()).unwrap();
    let delivered = wait_for(&rx, 500).expect("delivery from healthy handler");
    assert_eq!(delivered, ("demo".to_string(), "payload".to_string()));
}

#[test]
fn service_registration_and_resolution_work() {
    let bus = make_bus();
    bus.register_service("services/search/default", Arc::new(String::from("search")))
        .unwrap();
    let resolved = bus
        .resolve_service::<String>("services/search/default", ResolutionMode::ExactOne)
        .unwrap();
    assert_eq!(resolved.as_str(), "search");
}

#[test]
fn ambiguous_service_lookup_fails_closed() {
    let bus = make_bus();
    bus.register_service("services/search/default", Arc::new(String::from("exact")))
        .unwrap();
    bus.register_service(
        "services/search/{variant}",
        Arc::new(String::from("dynamic")),
    )
    .unwrap();
    let err = bus.resolve_service::<String>("services/search/default", ResolutionMode::ExactOne);
    assert!(err.is_err());
}

#[test]
fn duplicate_service_registration_is_rejected() {
    let bus = make_bus();
    bus.register_service("services/search/default", Arc::new(String::from("a")))
        .unwrap();
    assert!(bus
        .register_service("services/search/default", Arc::new(String::from("b")))
        .is_err());
}

#[test]
fn recursive_publish_depth_limit_is_enforced() {
    let bus = SignalBus::builder()
        .allow_catch_all(false)
        .default_queue_depth(8)
        .recursion_policy(RecursionPolicy {
            max_causation_depth: 1,
            on_exceeded: RecursionOverflowPolicy::RejectPublish,
        })
        .build();
    let (tx, rx) = mpsc::channel();
    let inner = bus.clone();
    let _sub = bus
        .subscribe::<String, _, _>(
            "loops/{id}",
            Schema::of::<String>(),
            DeliveryOptions::default(),
            move |ctx, signal| {
                let inner = inner.clone();
                let tx = tx.clone();
                async move {
                    if let Payload::Inline(payload) = signal.payload {
                        let nested =
                            inner.publish(format!("loops/{}", ctx.param("id").unwrap()), payload);
                        tx.send(nested.is_err()).unwrap();
                    }
                    Ok(())
                }
            },
        )
        .unwrap();

    bus.publish("loops/1", "payload".to_string()).unwrap();
    assert_eq!(wait_for(&rx, 500), Some(true));
}

#[test]
fn parser_round_trip_property() {
    let mut state = 0x1234_5678_9abc_def0u64;
    for _ in 0..100 {
        state ^= state << 7;
        state ^= state >> 9;
        state ^= state << 8;
        let segment_count = (state as usize % 4) + 1;
        let mut segments = Vec::new();
        for i in 0..segment_count {
            let value = ((state >> (i * 8)) & 0xff) as u8;
            let segment = format!("s{:02x}", value);
            segments.push(segment);
        }
        let address = segments.join("/");
        let parsed = Address::parse(&address).unwrap();
        assert_eq!(parsed.as_str(), address);
        let reparsed = Address::parse(parsed.as_str()).unwrap();
        assert_eq!(reparsed.as_str(), parsed.as_str());
    }
}
