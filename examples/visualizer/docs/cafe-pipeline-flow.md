# Cafe Pipeline Flow

This diagram matches the current runtime node and edge definition in [`../scenarios/cafe-pipeline.json`](../scenarios/cafe-pipeline.json).

```mermaid
flowchart LR
  subgraph FD["Front Door Queue"]
    arrivals["Arrival feed"]
    frontDoor["Front door intake"]
    queueManager["Queue manager"]
    queueRules["Queue rules"]
  end

  subgraph DS["Dispatch And Shared Services"]
    concierge["Concierge"]
    waiterRouter["Work request bus"]
    requestStream["Work request stream"]
    menuCatalog["Menu catalog"]
    customerTimers["Customer timers"]
    waiterPool["Waiter sections"]
  end

  subgraph TI["Table Intake"]
    seatRun["Seat run"]
    tableSections["Table sections"]
  end

  subgraph WSL["Waiter Service Loop"]
    menuRun["Menu run"]
    orderRun["Order run"]
    serveRun["Serve run"]
    billingRun["Bill / payment run"]
    orderStream["Order stream"]
    billingState["Billing / payment"]
  end

  subgraph KIT["Kitchen"]
    chefLoop["Chef loop"]
    kitchenTickets["Kitchen tickets"]
  end

  subgraph ET["Exit And Turnover"]
    turnover["Table turnover"]
    departures["Customer departure"]
  end

  arrivals --> frontDoor
  frontDoor --> queueManager
  queueManager --> queueRules
  queueRules --> concierge
  concierge --> waiterRouter
  waiterRouter --> requestStream
  requestStream --> waiterPool

  waiterPool --> seatRun
  waiterPool --> menuRun
  waiterPool --> orderRun
  waiterPool --> serveRun
  waiterPool --> billingRun

  seatRun --> tableSections
  tableSections --> waiterRouter
  tableSections --> menuRun

  menuRun --> menuCatalog
  menuCatalog --> customerTimers
  customerTimers --> orderRun
  customerTimers --> billingRun

  orderRun --> orderStream
  orderStream --> chefLoop
  chefLoop --> kitchenTickets
  kitchenTickets --> waiterRouter
  kitchenTickets --> serveRun

  billingRun --> billingState
  billingState --> waiterRouter
  billingState --> turnover

  turnover --> tableSections
  turnover --> departures
```

## Node Mapping

| Mermaid | Scenario node id |
| --- | --- |
| `arrivals` | `publisher-arrivals` |
| `frontDoor` | `subscriber-front-door` |
| `queueManager` | `publisher-queue` |
| `queueRules` | `subscriber-queue` |
| `concierge` | `publisher-concierge` |
| `waiterRouter` | `publisher-waiter-router` |
| `requestStream` | `subscriber-router` |
| `menuCatalog` | `service-menu-catalog` |
| `customerTimers` | `publisher-diner` |
| `waiterPool` | `service-waiter-pool` |
| `seatRun` | `publisher-seating` |
| `tableSections` | `subscriber-tables` |
| `menuRun` | `publisher-menu` |
| `orderRun` | `publisher-order` |
| `serveRun` | `publisher-service` |
| `billingRun` | `publisher-billing` |
| `orderStream` | `subscriber-orders` |
| `chefLoop` | `publisher-kitchen` |
| `kitchenTickets` | `subscriber-kitchen` |
| `billingState` | `subscriber-billing` |
| `turnover` | `publisher-turnover` |
| `departures` | `publisher-departures` |
