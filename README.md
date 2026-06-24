# SPINE

SPINE is an embedded in-process signal address bus for Rust. It routes typed signals and service lookups through URL-style address expressions with dynamic variables, wildcard matching, bounded delivery, and deterministic service resolution.

This is an embedded in-process signal address bus.
It is not a distributed message broker.
It is not a network transport.
It is not a security policy engine.
It is not a workflow engine.

## What it provides

- Address parsing and canonicalisation
- Expression parsing with `{name}`, `*`, and final `**`
- Deterministic match ordering
- Typed publish/subscribe delivery
- Bounded per-subscriber queues
- Queue overflow policy
- Handler timeout and panic isolation
- Service registration and lookup over the same address space
- Minimal metadata, schema, and delivery policy types

## Quick Example

```rust
use spine::*;
use std::sync::Arc;

#[derive(Clone, Debug)]
struct BlockChanged {
    block_id: String,
    revision: u64,
}

let bus = SignalBus::builder()
    .default_queue_depth(1024)
    .allow_catch_all(false)
    .build();

let _sub = bus.subscribe::<BlockChanged, _, _>(
    "documents/{document_id}/blocks/{block_id}/changed",
    Schema::of::<BlockChanged>(),
    DeliveryOptions::default(),
    |ctx, signal| async move {
        let _document_id = ctx.param("document_id").unwrap();
        let _block_id = ctx.param("block_id").unwrap();
        let _payload = signal.payload;
        Ok(())
    },
)?;

let _result = bus.publish(
    "documents/doc-1/blocks/block-9/changed",
    BlockChanged {
        block_id: "block-9".into(),
        revision: 42,
    },
)?;

bus.register_service("services/search/default", Arc::new(String::from("search")))?;
let resolved = bus.resolve_service::<String>("services/search/default", ResolutionMode::ExactOne)?;
assert_eq!(resolved.as_str(), "search");
```

## Development

- `cargo test`
- `cargo fmt`
- `cargo bench`

The test suite covers parsing, matching, specificity ordering, selective delivery, queue overflow, panic isolation, recursive publish guard behavior, and service lookup.

## Documentation

- [Architecture](docs/architecture.md)
- [Routing Logic](docs/routing-logic.md)
- [Specification](SPEC.md)
