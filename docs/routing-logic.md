# SPINE Routing and Delivery Logic

This document describes how an address moves through the current MVP implementation.

## Address and Expression Forms

- Concrete addresses are slash-separated paths such as `documents/abc/blocks/42/changed`
- Expressions may contain:
  - literal segments
  - dynamic variables like `{document_id}`
  - single-segment wildcards `*`
  - a final recursive wildcard `**`

## Publish Path

```mermaid
sequenceDiagram
    participant App as Host application
    participant Bus as SignalBus
    participant Addr as Address parser
    participant Match as Matcher
    participant Queue as Subscription queue
    participant Worker as Subscription worker
    participant Handler as User handler

    App->>Bus: publish(address, payload)
    Bus->>Addr: parse and canonicalise address
    Addr-->>Bus: canonical Address
    Bus->>Match: compare against registered expressions
    Match-->>Bus: matching subscriptions + specificity
    Bus->>Queue: enqueue delivery for each match
    Queue-->>Worker: queued delivery item
    Worker->>Handler: invoke async handler
    Handler-->>Worker: result
```

## Matching Rules

The matcher works segment-by-segment:

1. Literal segments must match exactly.
2. Dynamic segments capture one address segment under the variable name.
3. `*` matches one segment without capture.
4. `**` matches the remaining segments and must be the final expression segment.

If an address does not match an expression, that subscriber is never notified.

```mermaid
flowchart TD
    Start["address + expression"]
    Lit["literal segment match"]
    Dyn["capture dynamic segment"]
    Wild["match one segment"]
    Rec["consume remaining segments"]
    OK["match result"]
    No["no match"]

    Start --> Lit
    Lit -->|mismatch| No
    Lit -->|match| Dyn
    Dyn -->|missing segment| No
    Dyn --> Wild
    Wild -->|missing segment| No
    Wild --> Rec
    Rec --> OK
```

## Specificity Ordering

When more than one expression matches the same address, the bus sorts by specificity:

1. More literal segments first
2. More dynamic segments next
3. Fewer `*` wildcards next
4. Fewer recursive wildcards next
5. Shorter recursive matches next
6. Registration order as the final tiebreaker

This gives deterministic routing and service resolution.

```mermaid
flowchart LR
    A["Exact literal"] --> B["Dynamic variables"]
    B --> C["* wildcard"]
    C --> D["** recursive wildcard"]
    D --> E["Registration order"]
```

## Delivery Logic

The current MVP delivery path is:

1. Parse and canonicalise the address
2. Generate the signal schema from the payload type
3. Resolve matching subscriptions
4. Enqueue delivery on each matched subscription queue
5. Let the subscription worker invoke the handler

Queue overflow is handled by the configured overflow policy. The current implementation supports bounded queues and a reject-on-overflow default.

## Service Lookup

Service resolution reuses the same matcher:

```mermaid
flowchart TD
    Lookup["resolve_service(address)"]
    Parse["parse concrete address"]
    Scan["match registered services"]
    Sort["sort by specificity"]
    Check{"resolution mode"}
    One["ExactOne"]
    First["FirstBySpecificity"]
    All["AllMatches"]
    Result["resolved service(s)"]
    Err["ambiguous / not found / type mismatch"]

    Lookup --> Parse --> Scan --> Sort --> Check
    Check --> One --> Result
    Check --> First --> Result
    Check --> All --> Result
    Scan -->|none| Err
```

## Implementation Notes

- Handlers run on worker threads, so a slow handler does not block the publish path.
- Handler panic is isolated to that worker thread.
- The bus does not expose payloads to non-matching subscribers.
- Expression configuration can be registered separately and used as a default when subscribing with default delivery options.

