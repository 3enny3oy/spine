# Embedded Signal Address Bus - Specification

## 1. Purpose

Build a Rust-based embedded signal address bus.

The component provides private, high-volume, low-latency, in-process routing of signals and service lookups through a dynamic URL-style address space.

The bus is intentionally minimal. It provides:

- URL-style address parsing and matching
- Dynamic address variables
- Publish/subscribe routing
- Schema-aware subscriptions
- Configurable delivery behaviour per address expression
- Service registration and lookup through the same address space
- Safe bounded delivery mechanics

The bus must not become an application framework, distributed message broker, security policy engine, workflow engine, agent runtime, or network transport.

The host application decides what the addresses mean.

---

## 2. One-Sentence Definition

A Rust-based embedded signal address bus that provides private, high-volume, low-latency, schema-aware publish/subscribe routing and service-location over dynamic URL-style address expressions, with delivery behaviour configurable per expression and all higher-level semantics left to the host application.

---

## 3. Core Principles

### 3.1 Private by Default

The bus is embedded inside the host process.

By default:

- No network transport
- No IPC
- No external broker
- No persistence
- No global broadcast
- No ambient listener
- No automatic payload logging
- No cross-application visibility
- No external service discovery

The only default delivery path is:

```text
publisher → embedded bus → matching subscribers
```

### 3.2 Selective Delivery Only

Only matching subscribers receive notification.

The bus must not deliver every signal to every subscriber and rely on subscribers to filter locally.

Correct model:

```text
publish(address, payload)
→ route inside bus
→ match registered subscriptions
→ validate schema and delivery policy
→ notify only matching subscribers
```

Incorrect model:

```text
publish(payload)
→ notify all listeners
→ each listener filters locally
```

The incorrect model is prohibited.

### 3.3 Application-Agnostic

The bus must not contain hard-coded concepts such as:

- Users
- Roles
- Permissions
- Capabilities
- Tenants
- Agents
- Workflows
- Documents
- UI state
- Business rules
- Security policy
- Authentication
- Authorization

Those concepts may be implemented by the host application using the bus primitives.

### 3.4 Address-Aware, Not Domain-Aware

The core abstraction is:

```text
address → expression match → variable capture → route or resolve
```

The bus understands address syntax and matching rules only.

It does not understand the semantic meaning of the address.

### 3.5 Secure Mechanics by Default

“Secure by default” means the core mechanics are safe and bounded by default.

The core should provide:

- Private in-process operation
- Explicit subscription registration
- Explicit service registration
- No accidental external exposure
- No payload exposure to non-matching subscribers
- Bounded queues
- Bounded retries
- Bounded payload options
- Explicit delivery policy
- Deterministic service resolution
- Metadata-only tracing by default

The core should not attempt to implement a full application security model.

### 3.6 High Volume, Low Latency

The bus should be suitable for frequent internal application signals.

Implementation should prefer:

- Precompiled subscription expressions
- Efficient route indexes
- Minimal allocation on hot paths
- Avoiding serialization unless needed
- Avoiding global locks on publish paths where practical
- Bounded async queues
- Efficient fan-out
- Optional zero-copy or reference-counted payload delivery where safe
- Deterministic routing behaviour

### 3.7 Minimal Core, Extensible Edge

The core crate should remain small and strict.

Advanced functionality should be implemented as optional modules, feature flags, or separate crates.

Out of core scope:

- Network transport
- IPC transport
- Durable event sourcing
- Distributed routing
- Authentication
- Authorization
- Workflow engines
- Domain policy
- Cross-process service discovery
- Untrusted plugin sandboxing
- Database persistence

The core should be designed so those can be built around it without changing core routing semantics.

---

## 4. Terminology

### Address

A concrete URL-style path used when publishing or resolving something.

Example:

```text
documents/abc/blocks/42/changed
```

### Address Expression

A pattern used by subscriptions or service registrations.

Example:

```text
documents/{document_id}/blocks/{block_id}/changed
```

### Segment

A single component of an address separated by `/`.

Example:

```text
documents
abc
blocks
42
changed
```

### Dynamic Segment

A named variable in an expression.

Example:

```text
{document_id}
```

### Wildcard Segment

A segment that matches one segment.

Example:

```text
*
```

### Recursive Wildcard

A segment that matches zero or more remaining segments.

Example:

```text
**
```

### Signal

A published message containing:

- Address
- Payload or payload reference
- Metadata
- Delivery kind/options

### Subscription

A registration containing:

- Address expression
- Expected payload schema
- Handler
- Delivery options
- Lifecycle options

### Service Registration

A service, handler, provider, factory, or resource registered against an address or address expression.

### Service Lookup

Resolution of a registered service/provider by address or expression.

---

## 5. Address Grammar

### 5.1 Allowed Address Form

Addresses are slash-separated paths.

Examples:

```text
users/123/permissions/edit
documents/abc/blocks/42/changed
jobs/job-001/status
services/search/default
```

The grammar should be deliberately small.

Recommended valid address segment characters:

```text
A-Z
a-z
0-9
-
_
.
~
```

Optional support may be added for percent-encoding, but if supported, canonicalisation must be strict.

### 5.2 Invalid Address Forms

Reject:

```text
/users/123
users/123/
users//123
users/../admin
users/%2e%2e/admin
users/{id}
users/*
users/**
```

Concrete addresses must not contain expression syntax.

### 5.3 Expression Form

Expressions may contain:

```text
literal
{name}
*
**
```

Examples:

```text
users/{user_id}/permissions/{permission_id}
documents/{document_id}/blocks/*/changed
documents/{document_id}/**
services/{service_type}/{service_name}
```

### 5.4 Expression Rules

Rules:

- `{name}` matches exactly one segment and captures it.
- `*` matches exactly one segment and does not capture.
- `**` matches zero or more segments.
- `**` may only appear as the final segment unless a future explicit design supports more complex recursive matching.
- Duplicate dynamic variable names in a single expression are invalid unless equality matching is deliberately implemented.
- Empty segments are invalid.
- Expressions must be canonicalised at registration time.
- Invalid expressions fail at registration time, not publish time.

### 5.5 Canonicalisation

The bus must canonicalise addresses and expressions before storage or matching.

Canonicalisation should ensure:

- No leading slash
- No trailing slash
- No empty segments
- No traversal-like segments
- Percent-decoding rules are deterministic if percent-encoding is supported
- Equivalent inputs produce exactly one canonical representation

If canonicalisation fails, reject the address or expression.

---

## 6. Match Semantics

### 6.1 Match Output

A successful match returns:

```rust
Match {
    expression: AddressExpression,
    address: Address,
    params: Params,
    specificity: Specificity,
}
```

Example:

Expression:

```text
documents/{document_id}/blocks/{block_id}/changed
```

Address:

```text
documents/abc/blocks/42/changed
```

Captured params:

```text
document_id = abc
block_id = 42
```

### 6.2 Specificity Ranking

When multiple expressions match, the bus must produce deterministic ordering.

Specificity should rank from most specific to least specific:

1. Exact literal match
2. More literal segments
3. Dynamic segments
4. Single-segment wildcards
5. Recursive wildcard
6. Shorter recursive match
7. Registration order as final deterministic tiebreaker

Example ordering:

```text
documents/abc/blocks/42/changed
documents/{document_id}/blocks/{block_id}/changed
documents/{document_id}/blocks/*/changed
documents/{document_id}/**
**
```

### 6.3 Ambiguity

Ambiguous service lookup should not silently pick a random result.

Service lookup must support explicit resolution modes:

```rust
ResolutionMode::ExactOne
ResolutionMode::FirstBySpecificity
ResolutionMode::AllMatches
```

Default should be `ExactOne` for service lookup.

If more than one result matches under `ExactOne`, return an ambiguity error.

---

## 7. Signal Model

### 7.1 Signal Envelope

The conceptual signal envelope:

```rust
pub struct Signal<T> {
    pub id: SignalId,
    pub address: Address,
    pub kind: SignalKind,
    pub payload: Payload<T>,
    pub metadata: SignalMetadata,
}
```

### 7.2 Signal Kind

The bus should support generic kinds without imposing application meaning:

```rust
pub enum SignalKind {
    Event,
    Command,
    State,
    Notice,
    Custom(String),
}
```

These labels are mechanical and descriptive only.

The bus does not enforce domain semantics for them.

### 7.3 Metadata

Recommended metadata:

```rust
pub struct SignalMetadata {
    pub timestamp: Timestamp,
    pub source: Option<SourceId>,
    pub correlation_id: Option<CorrelationId>,
    pub causation_id: Option<SignalId>,
    pub trace_id: Option<TraceId>,
    pub priority: Priority,
    pub ttl: Option<Duration>,
    pub schema_id: Option<SchemaId>,
    pub content_type: Option<ContentType>,
}
```

Metadata should be lightweight and optional.

### 7.4 Payload Forms

The bus should support two payload strategies:

```rust
Payload::Inline(T)
Payload::Reference(PayloadRef)
Payload::Empty
```

Inline payload delivery is for small, safe, frequent payloads.

Reference delivery supports notify-then-fetch patterns where the payload is large, expensive, sensitive, or controlled by the host application.

The core does not implement fetching. It only carries references.

---

## 8. Schema-Aware Subscriptions

### 8.1 Subscription Schema Declaration

Each subscription must declare the expected payload schema.

This can be represented using one or more mechanisms:

- Rust type identity
- Trait-based schema descriptor
- `serde` descriptor
- JSON Schema via optional feature
- Application-defined schema ID

The core must not impose one global schema language.

### 8.2 Schema Validation

The bus must prevent obvious type mismatches where the type system can enforce this.

For dynamic payloads, schema checks should occur before handler invocation.

On schema mismatch:

- Do not invoke the handler.
- Return or record a delivery error according to the delivery policy.
- Do not attempt unsafe coercion.

### 8.3 Schema Versioning

The schema descriptor should support version identity.

Example:

```rust
SchemaId("document.block.changed.v1")
SchemaId("document.block.changed.v2")
```

The bus does not manage schema migration, but it should preserve schema metadata.

---

## 9. Publish/Subscribe API

### 9.1 Core API Sketch

```rust
let bus = SignalBus::new();

let subscription = bus.subscribe(
    "documents/{document_id}/blocks/{block_id}/changed",
    Schema::of::<BlockChanged>(),
    DeliveryOptions::default(),
    |ctx: DeliveryContext, signal: Signal<BlockChanged>| async move {
        let document_id = ctx.param("document_id")?;
        let block_id = ctx.param("block_id")?;
        Ok(())
    }
)?;

bus.publish(
    "documents/abc/blocks/42/changed",
    BlockChanged { /* ... */ },
)?;
```

### 9.2 Publishing

Publishing should:

1. Canonicalise address.
2. Validate payload metadata/schema if applicable.
3. Resolve matching subscriptions.
4. Apply per-expression delivery configuration.
5. Enqueue or deliver according to policy.
6. Return publish result.

### 9.3 Publish Result

```rust
pub struct PublishResult {
    pub signal_id: SignalId,
    pub matched_subscribers: usize,
    pub accepted_deliveries: usize,
    pub rejected_deliveries: usize,
    pub errors: Vec<PublishError>,
}
```

### 9.4 Subscription Lifecycle

Subscriptions should be explicitly disposable.

```rust
let handle = bus.subscribe(...)?;
handle.unsubscribe();
```

Dropping the handle may also unsubscribe, but explicit lifecycle control must be supported.

### 9.5 No Catch-All by Default

The bus should not register a catch-all subscriber by default.

If catch-all patterns such as `**` are allowed, they must be explicit and may be disabled by configuration.

---

## 10. Delivery Options

Delivery behaviour must be configurable per address expression.

### 10.1 Delivery Mode

Supported delivery modes:

```rust
pub enum DeliveryMode {
    FireAndForget,
    AckNack,
    Optimistic,
    RequestReply,
    NotifyOnly,
    NotifyThenFetch,
}
```

Minimum viable implementation may start with:

- `FireAndForget`
- `AckNack`
- `NotifyOnly`
- `NotifyThenFetch`

### 10.2 Payload Strategy

```rust
pub enum PayloadStrategy {
    SendPayload,
    NotifyOnly,
    NotifyThenFetch,
}
```

### 10.3 Retry Policy

```rust
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub backoff: BackoffKind,
    pub jitter: bool,
}
```

Defaults:

```text
max_attempts = 0
```

No infinite retries.

### 10.4 Timeout Policy

```rust
pub struct TimeoutPolicy {
    pub handler_timeout: Option<Duration>,
    pub delivery_deadline: Option<Duration>,
}
```

### 10.5 Rate Policy

```rust
pub struct RatePolicy {
    pub max_per_second: Option<u64>,
    pub burst: Option<u64>,
}
```

### 10.6 Debounce and Throttle

```rust
pub struct TimingPolicy {
    pub debounce: Option<Duration>,
    pub throttle: Option<Duration>,
}
```

### 10.7 Conflation Policy

```rust
pub enum ConflationPolicy {
    None,
    DropDuplicateAddress,
    DropDuplicatePayloadHash,
    KeepLatestByAddress,
    KeepLatestByKey(String),
    BatchWithin(Duration),
}
```

Default:

```rust
ConflationPolicy::None
```

True events should not be conflated unless explicitly configured.

### 10.8 Queue Policy

```rust
pub struct QueuePolicy {
    pub max_depth: usize,
    pub overflow: OverflowPolicy,
}
```

```rust
pub enum OverflowPolicy {
    Backpressure,
    DropNewest,
    DropOldest,
    Conflate,
    RejectPublish,
}
```

Default should be bounded.

Recommended default:

```text
max_depth = 1024
overflow = RejectPublish
```

### 10.9 Payload Limits

```rust
pub struct PayloadLimits {
    pub max_inline_bytes: Option<usize>,
    pub max_depth: Option<usize>,
}
```

The core may only be able to estimate size for certain payload types. Where it cannot enforce size directly, it should expose hooks for host-level enforcement.

### 10.10 Full Delivery Options Object

```rust
pub struct DeliveryOptions {
    pub mode: DeliveryMode,
    pub payload_strategy: PayloadStrategy,
    pub retry: RetryPolicy,
    pub timeout: TimeoutPolicy,
    pub rate: RatePolicy,
    pub timing: TimingPolicy,
    pub conflation: ConflationPolicy,
    pub queue: QueuePolicy,
    pub payload_limits: PayloadLimits,
}
```

---

## 11. Per-Expression Configuration

Delivery configuration may be attached to:

- A subscription
- An address expression
- A bus-level default

Resolution order:

1. Explicit subscription delivery options
2. Registered expression policy
3. Bus default options

Example:

```rust
bus.configure_expression(
    "documents/{document_id}/blocks/{block_id}/changed",
    DeliveryOptions {
        mode: DeliveryMode::FireAndForget,
        conflation: ConflationPolicy::KeepLatestByAddress,
        timing: TimingPolicy {
            debounce: Some(Duration::from_millis(50)),
            throttle: None,
        },
        ..Default::default()
    }
)?;
```

Expression configuration should use the same expression parser and canonicalisation rules as subscriptions.

---

## 12. Service Locator

### 12.1 Purpose

The bus should support service registration and lookup through the same URL-style address space.

Examples:

```text
services/search/default
services/storage/local
handlers/documents/block/change
providers/rendering/markdown
```

The bus does not know what these services mean.

### 12.2 Service Registration

```rust
bus.register_service(
    "services/search/default",
    Arc::new(SearchServiceImpl::new()),
)?;
```

### 12.3 Service Lookup

```rust
let search = bus.resolve_service::<dyn SearchService>(
    "services/search/default",
    ResolutionMode::ExactOne,
)?;
```

### 12.4 Dynamic Service Expressions

The implementation may support service registrations against expressions:

```text
services/parser/{format}
```

Lookup may capture parameters and pass them to a factory/provider.

### 12.5 Deterministic Resolution

Service resolution must be deterministic.

If multiple services match, the selected resolution mode must decide behaviour.

Default: fail on ambiguity.

### 12.6 Service Override Rules

The bus must not silently allow accidental shadowing.

If a service is registered at an already-occupied exact address:

- Return an error by default.
- Allow override only with explicit override options.

```rust
ServiceRegistrationOptions {
    allow_override: false,
}
```

---

## 13. Boundedness and Backpressure

The bus must avoid unbounded growth.

Every internal queue must have a maximum size.

Required bounded items:

- Per-subscription queue
- Global pending delivery queue, if any
- Retry queue
- Conflation map
- Batch buffer
- In-flight delivery count
- Payload size where enforceable
- Handler timeout where applicable

The default behaviour on overflow should be safe and explicit.

Recommended default:

```text
RejectPublish
```

For high-frequency state-like signals, applications can opt into:

```text
DropOldest
KeepLatestByAddress
Conflate
BatchWithin
```

---

## 14. Handler Execution

### 14.1 Do Not Hold Router Locks While Invoking Handlers

The bus must not hold route registry locks while executing subscriber handlers.

Publish path:

```text
resolve matching subscribers
copy/retain handler references
release routing locks
deliver/invoke handlers
```

### 14.2 Panic Isolation

A panic in one handler must not crash the bus or prevent unrelated handlers from receiving future signals.

Behaviour:

- Catch unwind where appropriate.
- Mark delivery as failed.
- Apply retry/failure policy.
- Continue delivering to other subscribers.

### 14.3 Slow Handler Isolation

Slow handlers must not block the entire bus.

Use per-subscriber queues or an executor model that isolates slow subscribers.

### 14.4 Ordering

Ordering should be explicit.

At minimum, support:

```rust
OrderingPolicy::None
OrderingPolicy::PerSubscription
OrderingPolicy::PerAddress
OrderingPolicy::PerKey(String)
```

Default recommendation:

```rust
OrderingPolicy::PerSubscription
```

Do not globally serialize all bus traffic.

---

## 15. Notify-Then-Fetch

### 15.1 Purpose

Notify-then-fetch supports cases where payloads are:

- Large
- Expensive
- Sensitive
- Externally stored
- Subject to application-specific access control
- Better represented by a reference

### 15.2 Core Behaviour

The core carries a reference only.

```rust
Payload::Reference(PayloadRef {
    uri: "app://payloads/abc123",
    content_type: Some("application/json"),
    schema_id: Some("document.snapshot.v1"),
})
```

The core does not fetch the payload.

The host application or subscriber resolves the reference.

### 15.3 Stampede Protection

The bus should support optional delivery options that reduce fetch stampedes:

- Debounce
- Conflation
- Rate limits
- Batch notifications
- Keep latest only

---

## 16. Observability

### 16.1 Metadata-Only by Default

Tracing and logging must not include payloads by default.

Allowed by default:

- Signal ID
- Address, optionally redacted
- Matching expression
- Subscriber ID
- Timing
- Delivery result
- Error class
- Retry count

Payload capture must be explicit opt-in.

### 16.2 Address Redaction

The bus should support address redaction/masking hooks.

Example:

```text
users/123/permissions/edit
```

may be logged as:

```text
users/{user_id}/permissions/{permission_id}
```

or:

```text
users/*/permissions/*
```

### 16.3 Metrics

Recommended metrics:

- Signals published
- Signals matched
- Signals delivered
- Delivery failures
- Handler timeouts
- Queue depth
- Dropped signals
- Conflated signals
- Retry count
- Average routing latency
- Average delivery latency

Metrics should be optional and lightweight.

---

## 17. Error Handling

### 17.1 Error Types

Recommended error categories:

```rust
AddressParseError
ExpressionParseError
SchemaMismatchError
DeliveryError
HandlerError
TimeoutError
RetryExhaustedError
QueueOverflowError
ServiceNotFoundError
ServiceAmbiguousError
ServiceTypeMismatchError
RegistrationConflictError
ConfigurationError
```

### 17.2 Fail Closed

On invalid address, invalid expression, schema mismatch, ambiguous service lookup, or unsafe configuration:

- Return an error.
- Do not guess.
- Do not silently widen delivery.
- Do not deliver to non-matching subscribers.

---

## 18. Safety and Threat Model

### 18.1 Lowest-Risk Intended Core

The primary intended implementation is:

```text
in-process only
typed Rust payloads
bounded queues
no persistence by default
no network by default
no plugins by default
no payload logging by default
```

### 18.2 Main Attack Vectors to Guard Against

The implementation must explicitly guard against:

- Global broadcast leakage
- Over-broad wildcard subscriptions
- Address parser confusion
- Address canonicalisation bypass
- Subscription expression ambiguity
- Payload schema mismatch
- Oversized payloads
- Slow subscriber blockage
- Unbounded queues
- Retry storms
- Ack/nack loops
- Conflation dropping important events
- Service shadowing
- Ambiguous service resolution
- Payload leakage through logs
- Recursive publish loops
- Handler panic propagation

### 18.3 Recursive Publish Protection

A handler may publish another signal.

This is allowed, but the bus should track causation depth.

Configurable guard:

```rust
pub struct RecursionPolicy {
    pub max_causation_depth: usize,
    pub on_exceeded: RecursionOverflowPolicy,
}
```

Default:

```text
max_causation_depth = 32
on_exceeded = RejectPublish
```

### 18.4 No Unsafe Hot Path Unless Justified

Avoid `unsafe` in core routing and delivery.

If `unsafe` is required for performance, it must be:

- Isolated
- Documented
- Tested
- Feature-gated where possible
- Justified by benchmark evidence

---

## 19. Crate Structure

Recommended workspace:

```text
signal-address-bus/
  Cargo.toml
  crates/
    signal-address-core/
    signal-address-router/
    signal-address-schema/
    signal-address-service/
    signal-address-runtime/
    signal-address-test/
  examples/
  benches/
  fuzz/
```

### 19.1 `signal-address-core`

Contains:

- Address types
- Expression types
- Signal envelope
- Metadata
- Delivery options
- Error types
- Public traits

### 19.2 `signal-address-router`

Contains:

- Address parser
- Expression parser
- Canonicalisation
- Matcher
- Specificity ranking
- Route index

### 19.3 `signal-address-schema`

Contains:

- Schema traits
- Type descriptors
- Optional JSON Schema support
- Schema mismatch errors

### 19.4 `signal-address-service`

Contains:

- Service registry
- Provider registration
- Lookup modes
- Type-safe service resolution

### 19.5 `signal-address-runtime`

Contains:

- Bus implementation
- Publish/subscribe runtime
- Queues
- Delivery engine
- Retry/debounce/conflation logic
- Handler lifecycle

### 19.6 `signal-address-test`

Contains:

- Test utilities
- Fake subscribers
- Deterministic scheduler helpers
- Load test harness

---

## 20. Feature Flags

Recommended feature flags:

```toml
[features]
default = ["std", "async"]

std = []
async = []
serde = ["dep:serde"]
json-schema = ["serde"]
tracing = ["dep:tracing"]
metrics = []
parking-lot = ["dep:parking_lot"]
arc-swap = ["dep:arc-swap"]
```

Do not include network, IPC, or persistence in default features.

Optional future extension crates can provide:

```text
signal-address-ipc
signal-address-persist
signal-address-wasm
signal-address-network
```

These must not be part of the core default crate.

---

## 21. Example Rust API

### 21.1 Define Payload

```rust
#[derive(Clone, Debug)]
struct BlockChanged {
    block_id: String,
    revision: u64,
}
```

### 21.2 Create Bus

```rust
let bus = SignalBus::builder()
    .default_queue_depth(1024)
    .allow_catch_all(false)
    .build();
```

### 21.3 Subscribe

```rust
let sub = bus.subscribe(
    "documents/{document_id}/blocks/{block_id}/changed",
    Schema::of::<BlockChanged>(),
    DeliveryOptions {
        mode: DeliveryMode::FireAndForget,
        conflation: ConflationPolicy::KeepLatestByAddress,
        timing: TimingPolicy {
            debounce: Some(Duration::from_millis(25)),
            throttle: None,
        },
        ..DeliveryOptions::default()
    },
    |ctx, signal: Signal<BlockChanged>| async move {
        let document_id = ctx.param("document_id")?;
        let block_id = ctx.param("block_id")?;
        Ok(())
    },
)?;
```

### 21.4 Publish

```rust
let result = bus.publish(
    "documents/doc-1/blocks/block-9/changed",
    BlockChanged {
        block_id: "block-9".into(),
        revision: 42,
    },
)?;
```

### 21.5 Register Service

```rust
bus.register_service(
    "services/search/default",
    Arc::new(SearchService::new()),
)?;
```

### 21.6 Resolve Service

```rust
let search = bus.resolve_service::<SearchService>(
    "services/search/default",
    ResolutionMode::ExactOne,
)?;
```

---

## 22. Performance Requirements

### 22.1 Hot Path Expectations

The publish hot path should:

- Avoid address parsing allocations where possible.
- Use precompiled expression matchers.
- Avoid scanning all subscriptions for common cases.
- Avoid serializing payloads.
- Avoid invoking handlers while holding registry locks.
- Avoid unbounded fan-out work where possible.
- Support fast no-match publishing.

### 22.2 Benchmarks

Provide benchmarks for:

- Address parsing
- Expression parsing
- Exact match route
- Dynamic variable match
- Single wildcard match
- Recursive wildcard match
- 1 subscriber
- 10 subscribers
- 1,000 subscribers
- 100,000 registered expressions
- No-match publish
- High-frequency conflated publish
- Large payload reference publish
- Service exact lookup
- Service ambiguous lookup

### 22.3 Performance Targets

Initial targets, subject to benchmark refinement:

```text
Exact route lookup: sub-microsecond to low microsecond range
Dynamic route lookup: low microsecond range
No-match publish: low microsecond range
No allocation on already-parsed address hot path where practical
```

Do not compromise correctness or safety for premature optimisation.

---

## 23. Testing Requirements

### 23.1 Unit Tests

Required areas:

- Address parsing
- Address canonicalisation
- Expression parsing
- Dynamic variable capture
- Wildcard matching
- Recursive wildcard matching
- Specificity ranking
- Invalid address rejection
- Invalid expression rejection
- Subscription lifecycle
- Publish with no subscribers
- Publish with exact subscriber
- Publish with wildcard subscriber
- Schema mismatch
- Queue overflow
- Retry exhaustion
- Handler timeout
- Panic isolation
- Conflation behaviour
- Debounce behaviour
- Service registration
- Service lookup
- Ambiguous service lookup
- Service override rejection

### 23.2 Property Tests

Use property testing for:

- Parser round-trip
- Canonicalisation idempotence
- Match determinism
- Specificity ordering
- No delivery to non-matching subscribers
- No panic on arbitrary valid/invalid address inputs

### 23.3 Fuzz Tests

Fuzz:

- Address parser
- Expression parser
- Matcher
- Percent-decoding/canonicalisation if supported
- Schema descriptor parsing if applicable

### 23.4 Concurrency Tests

Test:

- Concurrent publish
- Concurrent subscribe/unsubscribe
- Concurrent service register/resolve
- Handler publishes new signal
- Handler panics
- Slow subscriber with fast subscriber
- Queue overflow under load
- Retry storm prevention

### 23.5 Security Regression Tests

Must include regression tests for:

- Catch-all disabled by default
- Non-matching subscriber receives nothing
- Debug subscriber receives no payload unless explicitly configured
- Invalid traversal-like addresses are rejected
- Oversized payloads are rejected where enforceable
- Infinite retry config is rejected
- Ambiguous service lookup fails closed
- Duplicate exact service registration fails by default
- Recursive publish depth limit is enforced

---

## 24. Documentation Requirements

Provide:

- `README.md`
- `SPEC.md`
- API docs
- Address grammar documentation
- Delivery options documentation
- Service locator documentation
- Threat model documentation
- Examples
- Benchmark instructions

The README must clearly state:

```text
This is an embedded in-process signal address bus.
It is not a distributed message broker.
It is not a network transport.
It is not a security policy engine.
It is not a workflow engine.
```

---

## 25. Non-Goals

The following are explicitly not part of the core build:

- Kafka-like distributed messaging
- MQTT-like broker behaviour
- HTTP routing
- Network pub/sub
- Cross-process event propagation
- Durable event sourcing
- Database-backed message persistence
- Plugin sandboxing
- Authentication
- Authorization
- User/role/capability policy
- Workflow orchestration
- Agent orchestration
- UI framework integration
- Application-specific domain modelling

These may be built around the bus by a host application or extension crate.

---

## 26. MVP Scope

The first implementation should include:

### Must Have

- Address parser
- Expression parser
- Canonicalisation
- Dynamic variable matching
- `*` wildcard
- Final-position `**` wildcard
- Specificity ranking
- Subscribe/unsubscribe
- Publish
- Selective delivery only
- Typed payload subscription
- Basic schema descriptor
- Fire-and-forget delivery
- Notify-only delivery
- Notify-then-fetch envelope support
- Bounded per-subscriber queues
- Queue overflow policy
- Handler timeout
- Panic isolation
- Service registration
- Exact service lookup
- Ambiguous lookup error
- Duplicate service registration rejection
- Metadata-only tracing hooks
- Unit tests
- Property tests for parser/matcher
- Basic benchmarks

### Should Have

- Ack/nack delivery
- Retry policy
- Debounce
- Throttle
- Conflation
- Rate limiting
- Recursive publish depth guard
- Address redaction hooks
- Metrics hooks
- JSON Schema feature flag

### Could Have Later

- Persistence adapter
- IPC adapter
- WASM/plugin scoped handles
- Network adapter
- Durable replay
- Dead-letter handling
- Advanced route trie optimisations
- `no_std` support

---

## 27. Implementation Order

Recommended sequence:

1. Define core types and errors.
2. Implement address parser and canonicaliser.
3. Implement expression parser.
4. Implement matcher and param capture.
5. Implement specificity ranking.
6. Implement route registry.
7. Implement subscription registration and lifecycle.
8. Implement simple publish with selective delivery.
9. Add typed payload handling.
10. Add schema descriptors.
11. Add bounded queues.
12. Add delivery options skeleton.
13. Add timeout and panic isolation.
14. Add notify-only and notify-then-fetch.
15. Add service registry and exact lookup.
16. Add ambiguity detection.
17. Add retry/debounce/conflation.
18. Add tracing/metrics hooks.
19. Add property/fuzz tests.
20. Add benchmarks.
21. Harden defaults and document threat model.

---

## 28. Acceptance Criteria

The implementation is acceptable when:

- A signal is only delivered to matching subscribers.
- Non-matching subscribers cannot observe payloads.
- Invalid addresses and expressions are rejected.
- Matching is deterministic.
- Captured variables are correct.
- Service lookup is deterministic.
- Ambiguous service lookup fails closed by default.
- Queues are bounded.
- Retries are bounded.
- Handler panic does not crash the bus.
- Slow subscribers do not block unrelated subscribers.
- Payload logging is off by default.
- No network, IPC, persistence, or external broadcast exists in the default core.
- Benchmarks exist for the hot path.
- Parser and matcher are covered by property tests.
- Threat model is documented.
- The README clearly communicates the non-goals.

---

## 29. Design Summary

The ideal implementation is a strict, private, embedded router.

It should be powerful enough to serve as an internal application coordination substrate, but small enough that it does not become a framework.

The core should do this:

```text
parse address
parse expression
match expression
capture variables
route signal
validate schema
apply delivery mechanics
invoke matching subscribers
resolve registered services
```

The core should not do this:

```text
decide application permissions
broadcast externally
persist by default
open a socket
act as a broker
implement workflows
interpret business meaning
authenticate users
authorise actions
```

The bus is the addressable nervous system of the host application, not the application itself.
