# Simulation Blueprints

This document proposes a primitive-based simulation layer for the visualizer.

The goal is to move from scenario-specific demo graphs toward reusable building blocks that can compose many kinds of simulations while still using SPINE as the transport and observation layer.

## Problem

The current visualizer model is still largely scenario-shaped:

- nodes are named after cafe roles or stages
- scenario JSON directly describes one specific flow
- runtime logic contains reusable ideas, but the graph model does not

That works for a single demo, but it does not scale well to:

- multiple domains
- user-authored simulations
- reusable templates
- composition of small behaviors into larger systems

The target model is closer to Unreal Blueprints:

- primitive nodes define reusable behavior
- blueprints compose primitives into a domain model
- scenarios are instances of blueprints with specific configuration

## Design Goals

- keep SPINE generic and domain-agnostic
- make simulation graphs composable from a small primitive set
- allow one blueprint system to express cafe, warehouse, clinic, factory, or game-AI scenarios
- preserve visual graph authoring as the main way to build simulations
- separate transport concerns from simulation concerns
- support both low-level nodes and higher-level composite nodes later

## Layer Model

The system should be separated into three layers.

### 1. SPINE Transport Layer

This layer remains generic.

Responsibilities:

- publish and subscribe
- addresses and expression matching
- delivery policy
- service resolution
- queue overflow behavior
- tracing and observability

This layer should not know about customers, waiters, dishes, tickets, or any other domain concept.

### 2. Simulation Primitive Layer

This layer provides reusable simulation building blocks.

Responsibilities:

- create or mutate simulation state
- generate work
- schedule timers
- claim and execute work
- model capacity and resources
- compute urgency and gating

This is the new abstraction layer missing from the current scenario model.

### 3. Blueprint Layer

This layer defines domain-specific compositions of primitives.

Examples:

- cafe
- warehouse
- clinic
- airport gate operations
- NPC task system

Blueprints should contain no hard-coded runtime logic beyond configuration of primitives and their connections.

## Core Concepts

### Primitive

A primitive is a reusable node type with well-defined behavior and configuration.

Examples:

- `source`
- `queue`
- `worker`
- `timer`
- `store`
- `resource_pool`
- `router`
- `scheduler`
- `transform`
- `observer`

### Blueprint

A blueprint is a saved graph of primitive instances and their edges.

It describes:

- which primitive instances exist
- how they are configured
- how they are wired together
- what SPINE addresses they emit and observe

### Scenario Instance

A scenario instance is a blueprint plus runtime parameters.

Examples:

- speed multiplier
- arrival rate
- table count
- staffing count
- random seed
- patience thresholds

This lets one blueprint produce many operating conditions.

### Composite Node

A composite node is a named cluster of primitive nodes exposed as one reusable authoring unit.

This should come later, after the primitive layer is stable.

Examples:

- `front_door`
- `waiter_section`
- `kitchen_station`
- `billing_desk`

These are analogous to collapsed graphs or macros.

## Primitive Catalog

The initial primitive catalog should stay small.

### `source`

Generates new signals or entities.

Use cases:

- arrivals
- periodic events
- bursts
- scripted triggers

### `store`

Owns entity state.

Use cases:

- customers
- tables
- workers
- orders
- tickets

Responsibilities:

- persist entity records
- expose filtered views
- apply updates

### `queue`

Represents bounded backlog.

Use cases:

- front door line
- ticket backlog
- payment backlog

Responsibilities:

- enqueue and dequeue
- overflow handling
- queue metrics

### `worker`

Claims and executes work items.

Use cases:

- concierge
- waiter
- chef
- picker
- nurse

Responsibilities:

- scan eligible work
- apply gating rules
- choose work by urgency or policy
- optionally batch compatible work
- emit claim, start, complete, and blocked events

### `timer`

Produces delayed transitions.

Use cases:

- customer deciding
- eating duration
- patience thresholds
- cooldowns

### `resource_pool`

Represents finite capacity.

Use cases:

- tables
- burners
- payment terminals
- staff sections

Responsibilities:

- allocate
- release
- report available capacity

### `router`

Maps or fans out simulation events.

Use cases:

- route work by section
- route by entity ID
- fan out observer events

### `scheduler`

Provides prioritization or batching policy.

Use cases:

- urgency scoring
- fairness strategy
- batch-by-key selection

This can later be folded into `worker` or kept separate depending on implementation pressure.

### `transform`

Converts one event shape into another.

Use cases:

- derive work items from customer state
- normalize payloads
- enrich with metadata

### `observer`

Collects metrics and traces.

Use cases:

- queue cards
- worker dashboards
- throughput counters
- lag displays

## Primitive vs SPINE Node Kind

The existing visualizer node kinds are:

- `publisher`
- `subscriber`
- `service`
- `config`

Those should remain as transport/runtime mechanics.

They should not be the main simulation abstraction.

The new simulation-facing model should add a semantic layer on top:

- `primitiveType`
- `instanceName`
- `config`
- `ports`
- `bindings`

That gives each node two identities:

- transport identity
- simulation identity

Example:

- transport kind: `publisher`
- primitive type: `worker`
- instance name: `waiter-section-a`

## Proposed Scenario Schema

The current schema is too narrow:

- `ScenarioDefinition`
- `nodes`
- `edges`
- optional `cafeConfig`

The target schema should look more like this.

```json
{
  "id": "cafe-blueprint",
  "title": "Cafe Worker System",
  "description": "Concurrent worker-loop simulation built from primitives.",
  "supportsSimulation": true,
  "simulationKind": "blueprint",
  "blueprint": {
    "primitiveSchemaVersion": 1,
    "instanceConfig": {
      "seed": 42,
      "speedMultiplier": 1.0
    },
    "globals": {
      "theme": "operations"
    },
    "nodes": [],
    "edges": []
  }
}
```

## Proposed Primitive Node Shape

Each node instance should contain:

- stable graph identity
- visual metadata
- primitive metadata
- config
- optional SPINE bindings

Suggested shape:

```json
{
  "id": "worker-waiter-a",
  "kind": "service",
  "primitiveType": "worker",
  "instanceName": "waiter-section-a",
  "position": { "x": 1600, "y": 360 },
  "title": "Waiter A",
  "note": "Owns tables 01-05.",
  "config": {
    "workerRole": "waiter",
    "selectionPolicy": "urgency",
    "batchPolicy": {
      "mode": "same_work_type",
      "maxBatchSize": 4
    },
    "ownership": {
      "tableIds": ["table-01", "table-02", "table-03", "table-04", "table-05"]
    },
    "durations": {
      "menu": 500,
      "order": 800,
      "serve": 650,
      "bill": 700,
      "payment": 525
    }
  },
  "bindings": {
    "publishes": [
      "cafe/service/request/*",
      "cafe/tables/{table_id}/*",
      "cafe/billing/{table_id}/*"
    ],
    "subscribes": [
      "cafe/work/{work_item_id}/*",
      "cafe/tables/{table_id}/*",
      "cafe/kitchen/orders/{order_id}/*"
    ]
  },
  "ports": {
    "inputs": ["work", "table-state", "kitchen-ready"],
    "outputs": ["table-events", "billing-events", "work-claims"]
  }
}
```

## Proposed Edge Shape

Edges should also gain semantic meaning beyond source and target IDs.

Suggested shape:

```json
{
  "id": "kitchen-to-waiter-work",
  "source": "store-kitchen-tickets",
  "target": "worker-waiter-a",
  "channel": "ready-dish",
  "semantics": {
    "kind": "work_feed",
    "filter": {
      "tableSection": "a"
    }
  }
}
```

This makes the graph authoring model less dependent on implied behavior.

## Primitive Config Shapes

The first implementation does not need a full schema registry, but it should still define clear config shapes per primitive.

### `source`

```json
{
  "mode": "random_interval",
  "entityType": "customer",
  "intervalMs": { "min": 1200, "max": 2600 },
  "payloadTemplate": {
    "partySize": { "randomInt": [1, 3] }
  }
}
```

### `queue`

```json
{
  "capacity": 12,
  "overflow": "reject",
  "ordering": "fifo"
}
```

### `worker`

```json
{
  "workerRole": "chef",
  "selectionPolicy": "urgency",
  "batchPolicy": {
    "mode": "by_key",
    "key": "dishId",
    "maxBatchSize": 8
  },
  "capacity": 1
}
```

### `timer`

```json
{
  "mode": "random_range",
  "durationMs": { "min": 5000, "max": 9000 },
  "onExpire": "raise_work"
}
```

### `resource_pool`

```json
{
  "resourceType": "table",
  "count": 10,
  "partitionBy": "section"
}
```

### `store`

```json
{
  "entityType": "kitchen_ticket",
  "keyField": "ticketId",
  "indexes": ["status", "dishId", "tableId"]
}
```

## Cafe Blueprint Example

The cafe should eventually be expressible using only primitives.

A minimal cafe blueprint would include:

- `source`: arrival generator
- `queue`: front door queue
- `worker`: concierge
- `store`: customers
- `store`: tables
- `resource_pool`: table capacity
- `worker`: waiter section A
- `worker`: waiter section B
- `store`: kitchen tickets
- `worker`: chef
- `timer`: deciding timer
- `timer`: eating timer
- `observer`: dashboard

The important point is that none of these are cafe-specific node types.

## Addressing Model

SPINE addresses should remain explicit, but they should be derived from primitive behavior rather than from scenario naming alone.

Suggested families:

- `sim/entities/{entity_type}/{entity_id}/*`
- `sim/work/{work_item_id}/*`
- `sim/resources/{resource_type}/{resource_id}/*`
- `sim/workers/{worker_id}/*`
- `sim/timers/{timer_id}/*`
- `sim/metrics/*`

Domain-specific aliases can still exist:

- `cafe/customers/{customer_id}/*`
- `cafe/tables/{table_id}/*`
- `cafe/kitchen/orders/{order_id}/*`

But the primitive layer should not require a cafe namespace to function.

## Authoring Model

The visualizer should eventually support:

1. choose primitive type
2. place node
3. configure behavior
4. wire semantic edges
5. preview SPINE bindings
6. run scenario instance

The current node inspector can evolve toward this model by:

- adding `primitiveType`
- adding primitive-specific config editors
- separating display title from primitive identity

## Migration Plan

The safest migration path is incremental.

### Phase 1

Add semantic metadata without changing runtime structure.

Changes:

- add `primitiveType` to node data
- add `instanceName`
- keep current `kind`
- keep current scenario JSON functional

### Phase 2

Introduce blueprint schema alongside the current scenario schema.

Changes:

- add optional `blueprint` block
- keep current `nodes` and `edges` for backward compatibility
- add conversion helpers from current scenario JSON to blueprint-flavored metadata

### Phase 3

Move simulation runtime to consume primitive configs.

Changes:

- worker runtime driven by `worker` primitive config
- kitchen runtime driven by `worker` plus `store`
- queue runtime driven by `queue`

### Phase 4

Add composite nodes.

Changes:

- `waiter_section`
- `front_door`
- `kitchen_station`
- `billing_desk`

These should compile down to primitive graphs.

## What This Means For The Current Cafe Example

The current cafe work already points in this direction:

- explicit work items
- waiter sections
- chef batching
- explicit kitchen tickets
- explicit billing and payment work

What is still missing is for the graph/data model to encode those as reusable primitives rather than only as one scenario's nodes.

## Recommended Next Steps

1. Extend the scenario/node types with `primitiveType`, `instanceName`, and `config`.
2. Define the first primitive config interfaces in TypeScript for `source`, `queue`, `worker`, `timer`, `store`, and `resource_pool`.
3. Annotate the current cafe scenario with those primitive identities without changing runtime behavior yet.
4. Update the inspector UI to edit primitive config when present.
5. Add a second non-cafe blueprint to prove the model is generic.

## Guiding Rule

Scenarios compose primitives.

Primitives do not know about cafes.
