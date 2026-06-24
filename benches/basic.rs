use spine::*;
use std::sync::Arc;
use std::time::Instant;

fn time_it(label: &str, mut f: impl FnMut()) {
    let start = Instant::now();
    f();
    let elapsed = start.elapsed();
    println!("{label}: {:?}", elapsed);
}

fn main() {
    time_it("address_parse", || {
        for _ in 0..10_000 {
            let _ = Address::parse("documents/abc/blocks/42/changed").unwrap();
        }
    });

    time_it("expression_parse", || {
        for _ in 0..10_000 {
            let _ = AddressExpression::parse(
                "documents/{document_id}/blocks/{block_id}/changed",
                false,
            )
            .unwrap();
        }
    });

    let bus = SignalBus::new();
    bus.subscribe::<u64, _, _>(
        "documents/{document_id}/blocks/{block_id}/changed",
        Schema::of::<u64>(),
        DeliveryOptions::default(),
        |_ctx, _signal| async move { Ok(()) },
    )
    .unwrap();

    time_it("publish", || {
        for _ in 0..10_000 {
            let _ = bus
                .publish("documents/abc/blocks/42/changed", 7u64)
                .unwrap();
        }
    });

    let service = Arc::new(String::from("search"));
    bus.register_service("services/search/default", service)
        .unwrap();
    time_it("service_resolve", || {
        for _ in 0..10_000 {
            let _ = bus
                .resolve_service::<String>("services/search/default", ResolutionMode::ExactOne)
                .unwrap();
        }
    });
}
