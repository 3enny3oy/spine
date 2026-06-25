# Cafe Scenario Spec

This document describes the intended model for the cafe scenario used by the visualizer and SPINE integration demos.

For the longer-term visualizer direction beyond the cafe itself, see [`simulation-blueprints.md`](./simulation-blueprints.md).

The key shift is this:

- The cafe is not one long customer flow.
- The cafe is a set of concurrent workers repeatedly selecting the next actionable unit of work.
- Customer progress emerges from those worker loops, local state, and downstream capacity.

## Goals

The scenario should create realistic, changing operating conditions that exercise SPINE features:

- concurrent publishers and subscribers
- bounded queues and overflow behavior
- backpressure between adjacent parts of the system
- address-based routing across several domains
- observable state transitions and causation chains
- service-like coordination points such as table allocation and payment handling
- traffic bursts, starvation risks, and recovery

## Core Model

The simulation contains:

- `1` concierge
- `2` waiters
- `1` chef
- a finite table pool
- a finite front-door queue
- customers whose needs change over time

Each worker runs an independent loop.

Each loop:

1. inspects the work that is relevant to that worker
2. filters to items that are currently actionable
3. scores or orders them by urgency
4. selects one work type to perform next
5. processes one or more eligible units of that same work type
6. emits state changes and new downstream work
7. repeats

This is a worker arbitration model, not a linear pipeline model.

## Worker Rules

### Concierge

The concierge is responsible for front-door intake only.

The concierge loop handles:

- greeting the next queued party
- rejecting arrivals when the queue is full
- admitting parties into the seating process when they become eligible

Constraints:

- the concierge works on one party at a time
- the concierge does not seat tables directly unless that is explicitly modeled as part of intake
- the concierge only creates or advances front-of-house work

Typical outputs:

- customer arrived
- customer queued
- customer rejected
- customer greeted
- seating need raised

### Waiters

Waiters are section-based workers, not a shared anonymous pool.

Each waiter owns a designated set of tables. For example:

- `waiter-1`: tables `01` to `05`
- `waiter-2`: tables `06` to `10`

Each waiter continuously scans only:

- customers seated at that waiter's tables
- work items attached to those tables or customers
- ready dishes destined for that waiter's tables

Waiter responsibilities include:

- seating newly admitted parties at free tables in that waiter's section
- delivering menus
- taking orders
- sending orders to the kitchen
- collecting ready dishes
- serving dishes
- checking for finished diners
- presenting bills
- taking payment
- clearing the table or signaling turnover

Waiter constraints:

- a waiter can only perform one work type at a time
- a waiter may batch multiple units of that same work type in one pass
- a waiter cannot take work for tables outside their section
- a waiter should not start work that cannot advance because the downstream stage is full or unavailable

Examples:

- a waiter may deliver menus to several assigned tables in one pass
- a waiter may collect several ready dishes in one pass if they all belong to that waiter's tables
- a waiter should not take another order if the kitchen intake for that class of ticket is blocked

### Chef

The chef is a worker loop over kitchen tickets, not a per-order timer with no contention.

Chef responsibilities include:

- accepting tickets the kitchen can admit
- choosing which dish type to work on next
- batching tickets of the same dish type when appropriate
- advancing accepted tickets through prep to ready

Chef constraints:

- the chef can only work on one dish type at a time
- the chef may prepare multiple tickets of that same dish type concurrently
- tickets that are admitted but not selected remain queued and grow in urgency

This gives the kitchen its own local scheduling behavior instead of acting like an instant black box after order placement.

## Customer Model

Customers are not modeled as a single fixed sequence. They are modeled as stateful parties that accumulate needs.

A customer may have one or more active needs such as:

- needs greeting
- needs seating
- needs menu
- ready to order
- waiting for food
- dish ready for pickup
- eating
- needs bill
- ready to pay
- complete and ready to depart

Some needs are mutually exclusive. Some are produced by timers. Some are produced by worker actions. Some are blocked until downstream capacity exists.

The important unit is not "customer in stage 4". The important unit is "customer at table X currently has need Y, and that need has waited Z milliseconds."

## Urgency Model

Each active need accumulates urgency over time.

Urgency should be used to decide which actionable need a worker handles next.

Urgency should not be a single hard-coded global priority list. It should be a score composed from:

- wait duration
- base importance of the need
- whether the need is blocking table turnover
- whether the need is blocking revenue realization
- whether the need is causing food quality risk
- whether the need has exceeded a patience threshold or SLA

Reasonable examples:

- ready dishes waiting at the pass escalate quickly
- bill requests escalate quickly once eating is complete
- menu delivery escalates more slowly
- seating urgency rises when the queue is long and tables are free

This keeps the simulation dynamic without turning it into a simple FIFO.

## Actionability and Backpressure

A need may be urgent but still not actionable.

A worker should only select work when the downstream system has room for it.

Examples:

- a party cannot be seated if there is no free table
- an order should not be taken if kitchen intake is at capacity
- a ready dish cannot be served until a waiter for that table is available
- payment collection may wait on a payment service or billing path

This is where SPINE becomes more interesting than a pure state machine:

- blocked work remains visible
- urgency continues to rise while blocked
- queue depth and overflow rules matter
- a release of capacity can trigger a burst of follow-on activity

## Batching

Batching is a first-class behavior in this scenario.

Workers choose a work type first, then may process multiple eligible items of that type in one pass.

Examples:

- a waiter makes one "menu run" to several tables
- a waiter makes one "serve run" carrying several ready dishes
- the chef batches several tickets of the same dish type

Batching is useful because it creates:

- fan-out from one worker decision
- bursts of related publications
- tradeoffs between fairness and throughput

## Ownership and Locality

The scenario should preserve local ownership where possible.

Examples:

- table state belongs to a specific table
- waiter responsibility belongs to a table section
- kitchen responsibility belongs to admitted tickets
- billing responsibility belongs to the table or party

This makes addresses and subscriptions more meaningful because work can be observed by domain and by locality.

## Suggested Event Families

The exact address set can evolve, but the model should distinguish between:

- facts about customer state
- facts about table state
- facts about worker decisions
- facts about work-item lifecycle
- facts about kitchen ticket lifecycle
- facts about billing and payment lifecycle

One workable shape is:

- `cafe/customers/{customer_id}/*`
- `cafe/tables/{table_id}/*`
- `cafe/workers/{role}/{worker_id}/*`
- `cafe/work/{work_item_id}/*`
- `cafe/kitchen/tickets/{ticket_id}/*`
- `cafe/billing/{table_id}/*`

Useful events include:

- need raised
- need blocked
- work claimed
- work batched
- work completed
- worker mode changed
- ticket admitted
- ticket deferred
- ticket ready
- payment authorized
- table cleared

This separation lets the visualizer show both domain flow and operational flow.

## Scenarios Worth Exercising

The cafe should be able to produce situations such as:

- front-door bursts that overflow the queue
- free tables existing while waiter capacity prevents fast seating
- diners ready to order while kitchen intake is blocked
- chef batching a popular dish while other tickets age
- several ready dishes appearing at once and competing with bill requests
- bill delays reducing tips
- table turnover becoming the limiting factor
- uneven waiter load because one section gets the busier tables

These are the kinds of situations that show off routing, bounded delivery, and observability.

## Success Criteria

The scenario is behaving as intended when:

- different worker loops make progress independently
- customer journeys diverge based on timing and contention
- urgency meaningfully changes what workers do next
- downstream capacity can block otherwise valid work
- one worker decision can emit several related signals
- queue depth, overflow, and lag are visible in the UI
- the system can enter and recover from temporary congestion

## Difference From The Current Visualizer Simulation

The current implementation is a useful first demo, but it is simpler than this target model.

Today it does the following:

- uses one shared pending waiter task list for both waiters
- assigns work from a central dispatcher rather than waiter-owned loops
- uses a fixed waiter task priority order
- models the kitchen as per-order timers rather than a chef scheduler
- auto-completes payment immediately after bill presentation
- does not model waiter sections or table ownership
- does not model batching by work type

That implementation is fine as a stepping stone, but the target spec should move toward independent worker loops with local scheduling and visible backpressure.

## Implementation Direction

If this is taken forward, the next version should likely move to:

1. explicit work-item records rather than implicit stage transitions
2. waiter-owned table sections
3. per-worker loops and mode selection
4. urgency scoring instead of a single global fixed priority list
5. chef-managed kitchen admission and batching
6. billing and payment as real work rather than an automatic timer tail

That would better match the intended scenario and create richer SPINE traffic.
