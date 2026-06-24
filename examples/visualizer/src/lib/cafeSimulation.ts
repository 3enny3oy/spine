import {
  CAFE_NODE_IDS,
  DEFAULT_CAFE_METRICS,
  DEFAULT_CAFE_QUEUE_SNAPSHOT,
  type CafeDishConfig,
  type CafeMetrics,
  type CafeQueueSnapshot,
  type CafeScenarioConfig,
} from "./scenarios";

type WaiterTaskType = "seat" | "menu" | "order" | "serve" | "bill";
type CustomerStatus =
  | "queued"
  | "greeted"
  | "seated"
  | "deciding"
  | "ready-to-order"
  | "waiting-food"
  | "ready-to-serve"
  | "eating"
  | "waiting-bill"
  | "paid"
  | "departed"
  | "turned-away";

interface CustomerRecord {
  id: string;
  partySize: number;
  status: CustomerStatus;
  queuedAtMs: number;
  greetedAtMs?: number;
  tableId?: string;
  waiterId?: string;
  menuDeliveredAtMs?: number;
  dish?: CafeDishConfig;
  orderId?: string;
  billRequestedAtMs?: number;
  billWaitMs?: number;
  paidAmount?: number;
  tipAmount?: number;
}

interface WaiterTask {
  type: WaiterTaskType;
  customerId: string;
  createdAtMs: number;
}

interface WaiterState {
  id: string;
  busy: boolean;
}

interface TableState {
  id: string;
  customerId: string | null;
}

interface SimulationState {
  running: boolean;
  started: boolean;
  customerSeq: number;
  nextTimerId: number;
  timers: Map<number, ScheduledTask>;
  customers: Map<string, CustomerRecord>;
  queue: string[];
  waiters: WaiterState[];
  tables: TableState[];
  pendingTasks: WaiterTask[];
  conciergeBusy: boolean;
}

interface ScheduledTask {
  id: number;
  callback: () => void;
  dueAtMs: number;
  remainingMs: number;
  timeoutId: number | null;
}

interface CafeSimulationCallbacks {
  getConfig: () => CafeScenarioConfig;
  getSpeedMultiplier: () => number;
  onMetrics: (metrics: CafeMetrics) => void;
  onQueues: (queues: CafeQueueSnapshot) => void;
  publish: (nodeId: string, address: string, payload: unknown) => Promise<void> | void;
}

export interface CafeSimulationController {
  start: () => void;
  stop: () => void;
  reset: () => void;
  isRunning: () => boolean;
}

const TASK_PRIORITY: Record<WaiterTaskType, number> = {
  bill: 0,
  serve: 1,
  order: 2,
  seat: 3,
  menu: 4,
};

export function createCafeSimulation(callbacks: CafeSimulationCallbacks): CafeSimulationController {
  let state = createState();

  function start() {
    if (state.running) {
      return;
    }
    state.running = true;
    if (!state.started) {
      state.started = true;
      scheduleNextArrival();
    } else {
      resumeTimers();
    }
    maybeProcessConcierge();
    maybeDispatchWaiters();
    updateMetrics();
  }

  function stop() {
    state.running = false;
    pauseTimers();
  }

  function reset() {
    stop();
    state = createState();
    updateMetrics();
  }

  function createState(): SimulationState {
      return {
        running: false,
        started: false,
        customerSeq: 0,
        nextTimerId: 1,
        timers: new Map<number, ScheduledTask>(),
        customers: new Map(),
        queue: [],
      waiters: [
        { id: "waiter-1", busy: false },
        { id: "waiter-2", busy: false },
      ],
      tables: Array.from({ length: 10 }, (_, index) => ({
        id: `table-${String(index + 1).padStart(2, "0")}`,
        customerId: null,
      })),
      pendingTasks: [],
      conciergeBusy: false,
    };
  }

  function clearTimers() {
    for (const task of state.timers.values()) {
      if (task.timeoutId !== null) {
        window.clearTimeout(task.timeoutId);
      }
    }
    state.timers.clear();
  }

  function pauseTimers() {
    const currentTime = now();
    for (const task of state.timers.values()) {
      if (task.timeoutId !== null) {
        window.clearTimeout(task.timeoutId);
        task.timeoutId = null;
        task.remainingMs = Math.max(0, task.dueAtMs - currentTime);
      }
    }
  }

  function resumeTimers() {
    for (const task of state.timers.values()) {
      if (task.timeoutId === null) {
        armTimer(task, task.remainingMs);
      }
    }
  }

  function currentSpeedMultiplier() {
    return Math.max(0.1, callbacks.getSpeedMultiplier());
  }

  function scaledDelay(delayMs: number) {
    return Math.max(20, Math.round(delayMs / currentSpeedMultiplier()));
  }

  function armTimer(task: ScheduledTask, delayMs: number) {
    task.remainingMs = delayMs;
    task.dueAtMs = now() + delayMs;
    task.timeoutId = window.setTimeout(() => {
      task.timeoutId = null;
      state.timers.delete(task.id);
      if (state.running) {
        task.callback();
      }
    }, delayMs);
  }

  function schedule(delayMs: number, action: () => void) {
    if (!state.running) {
      return;
    }
    const task: ScheduledTask = {
      id: state.nextTimerId++,
      callback: action,
      dueAtMs: 0,
      remainingMs: 0,
      timeoutId: null,
    };
    state.timers.set(task.id, task);
    armTimer(task, scaledDelay(delayMs));
  }

  function publish(nodeId: string, address: string, payload: unknown) {
    void Promise.resolve(callbacks.publish(nodeId, address, payload));
  }

  function now() {
    return Date.now();
  }

  function currentConfig() {
    return callbacks.getConfig();
  }

  function randomBetween(min: number, max: number) {
    if (max <= min) {
      return min;
    }
    return Math.round(min + Math.random() * (max - min));
  }

  function randomDish() {
    const dishes = currentConfig().dishes;
    return dishes[Math.floor(Math.random() * dishes.length)] ?? dishes[0];
  }

  function firstFreeTable() {
    return state.tables.find((table) => table.customerId === null) ?? null;
  }

  function queueFrontWaitingForGreeting() {
    return state.queue
      .map((customerId) => state.customers.get(customerId))
      .find((customer): customer is CustomerRecord => Boolean(customer && customer.status === "queued")) ?? null;
  }

  function queueFrontReadyToSeat() {
    return state.queue
      .map((customerId) => state.customers.get(customerId))
      .find((customer): customer is CustomerRecord => Boolean(customer && customer.status === "greeted")) ?? null;
  }

  function scheduleNextArrival() {
    const config = currentConfig();
    schedule(randomBetween(config.arrivalMinMs, config.arrivalMaxMs), handleArrival);
  }

  function handleArrival() {
    const config = currentConfig();
    state.customerSeq += 1;
    const customerId = `customer-${String(state.customerSeq).padStart(3, "0")}`;
    const customer: CustomerRecord = {
      id: customerId,
      partySize: 1 + Math.floor(Math.random() * 3),
      status: "queued",
      queuedAtMs: now(),
    };

    publish(CAFE_NODE_IDS.arrivals, `cafe/customers/${customerId}/arrived`, {
      customerId,
      partySize: customer.partySize,
      arrivedAtMs: customer.queuedAtMs,
    });

    if (state.queue.length >= config.queueCapacity) {
      customer.status = "turned-away";
      state.customers.set(customerId, customer);
      publish(CAFE_NODE_IDS.queue, `cafe/queue/front/${customerId}/rejected`, {
        customerId,
        queueDepth: state.queue.length,
        queueCapacity: config.queueCapacity,
      });
      updateMetrics();
      scheduleNextArrival();
      return;
    }

    state.customers.set(customerId, customer);
    state.queue.push(customerId);
    publish(CAFE_NODE_IDS.queue, `cafe/queue/front/${customerId}/queued`, {
      customerId,
      queueDepth: state.queue.length,
      queueCapacity: config.queueCapacity,
    });

    maybeProcessConcierge();
    maybeDispatchWaiters();
    updateMetrics();
    scheduleNextArrival();
  }

  function maybeProcessConcierge() {
    if (!state.running || state.conciergeBusy) {
      return;
    }
    const customer = queueFrontWaitingForGreeting();
    if (!customer) {
      return;
    }
    state.conciergeBusy = true;
    schedule(currentConfig().greetingMs, () => {
      const nextCustomer = state.customers.get(customer.id);
      if (!nextCustomer || nextCustomer.status !== "queued") {
        state.conciergeBusy = false;
        maybeProcessConcierge();
        return;
      }
      nextCustomer.status = "greeted";
      nextCustomer.greetedAtMs = now();
      publish(CAFE_NODE_IDS.concierge, `cafe/queue/front/${customer.id}/greeted`, {
        customerId: customer.id,
        greetedAtMs: nextCustomer.greetedAtMs,
      });
      requestWaiterTask("seat", customer.id);
      state.conciergeBusy = false;
      maybeProcessConcierge();
      maybeDispatchWaiters();
      updateMetrics();
    });
  }

  function requestWaiterTask(type: WaiterTaskType, customerId: string) {
    if (
      state.pendingTasks.some((task) => task.type === type && task.customerId === customerId)
    ) {
      return;
    }
    const customer = state.customers.get(customerId);
    if (!customer) {
      return;
    }
    state.pendingTasks.push({ type, customerId, createdAtMs: now() });
    publish(CAFE_NODE_IDS.waiterRouter, `cafe/service/request/${type}`, {
      requestType: type,
      customerId,
      tableId: customer.tableId ?? null,
    });
  }

  function maybeDispatchWaiters() {
    if (!state.running) {
      return;
    }
    state.pendingTasks.sort((left, right) => {
      const priorityDelta = TASK_PRIORITY[left.type] - TASK_PRIORITY[right.type];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.createdAtMs - right.createdAtMs;
    });

    for (const waiter of state.waiters) {
      if (waiter.busy) {
        continue;
      }
      const taskIndex = state.pendingTasks.findIndex((task) => canRunTask(task));
      if (taskIndex === -1) {
        continue;
      }
      const [task] = state.pendingTasks.splice(taskIndex, 1);
      waiter.busy = true;
      schedule(durationForTask(task.type), () => {
        completeWaiterTask(waiter.id, task);
        waiter.busy = false;
        maybeDispatchWaiters();
      });
    }
  }

  function canRunTask(task: WaiterTask): boolean {
    const customer = state.customers.get(task.customerId);
    if (!customer) {
      return false;
    }
    switch (task.type) {
      case "seat":
        return customer.status === "greeted" && firstFreeTable() !== null;
      case "menu":
        return customer.status === "seated" && Boolean(customer.tableId);
      case "order":
        return customer.status === "ready-to-order" && Boolean(customer.orderId && customer.dish);
      case "serve":
        return customer.status === "ready-to-serve" && Boolean(customer.tableId && customer.orderId && customer.dish);
      case "bill":
        return customer.status === "waiting-bill" && Boolean(customer.tableId && customer.dish);
    }
  }

  function durationForTask(type: WaiterTaskType) {
    const config = currentConfig();
    switch (type) {
      case "seat":
        return config.seatingMs;
      case "menu":
        return config.menuMs;
      case "order":
        return config.orderMs;
      case "serve":
        return config.serveMs;
      case "bill":
        return config.billMs;
    }
  }

  function completeWaiterTask(waiterId: string, task: WaiterTask) {
    const customer = state.customers.get(task.customerId);
    if (!customer) {
      return;
    }

    if (task.type === "seat") {
      const table = firstFreeTable();
      if (!table) {
        requestWaiterTask("seat", customer.id);
        return;
      }
      table.customerId = customer.id;
      customer.status = "seated";
      customer.tableId = table.id;
      customer.waiterId = waiterId;
      state.queue = state.queue.filter((queuedId) => queuedId !== customer.id);
      publish(CAFE_NODE_IDS.seating, `cafe/tables/${table.id}/seated`, {
        tableId: table.id,
        customerId: customer.id,
        waiterId,
      });
      requestWaiterTask("menu", customer.id);
      updateMetrics();
      return;
    }

    if (task.type === "menu") {
      customer.status = "deciding";
      customer.menuDeliveredAtMs = now();
      publish(CAFE_NODE_IDS.menu, `cafe/tables/${customer.tableId}/menu-delivered`, {
        tableId: customer.tableId,
        customerId: customer.id,
        dishes: currentConfig().dishes.map((dish) => ({
          id: dish.id,
          name: dish.name,
          price: dish.price,
          prepMs: dish.prepMs,
        })),
        waiterId,
      });
      schedule(randomBetween(currentConfig().decisionMinMs, currentConfig().decisionMaxMs), () => {
        const decidingCustomer = state.customers.get(customer.id);
        if (!decidingCustomer || decidingCustomer.status !== "deciding") {
          return;
        }
        const dish = randomDish();
        decidingCustomer.dish = dish;
        decidingCustomer.orderId = `order-${customer.id}`;
        decidingCustomer.status = "ready-to-order";
        publish(CAFE_NODE_IDS.diner, `cafe/orders/${decidingCustomer.orderId}/requested`, {
          orderId: decidingCustomer.orderId,
          customerId: decidingCustomer.id,
          tableId: decidingCustomer.tableId,
          dishId: dish.id,
          dishName: dish.name,
        });
        requestWaiterTask("order", decidingCustomer.id);
        maybeDispatchWaiters();
        updateMetrics();
      });
      updateMetrics();
      return;
    }

    if (task.type === "order") {
      if (!customer.dish || !customer.orderId) {
        return;
      }
      customer.status = "waiting-food";
      publish(CAFE_NODE_IDS.order, `cafe/orders/${customer.orderId}/placed`, {
        orderId: customer.orderId,
        customerId: customer.id,
        tableId: customer.tableId,
        dishId: customer.dish.id,
        dishName: customer.dish.name,
        price: customer.dish.price,
        waiterId,
      });
      startKitchenPipeline(customer.id);
      updateMetrics();
      return;
    }

    if (task.type === "serve") {
      customer.status = "eating";
      publish(CAFE_NODE_IDS.service, `cafe/tables/${customer.tableId}/served`, {
        tableId: customer.tableId,
        customerId: customer.id,
        orderId: customer.orderId,
        dishId: customer.dish?.id,
        waiterId,
      });
      schedule(randomBetween(currentConfig().eatMinMs, currentConfig().eatMaxMs), () => {
        const eatingCustomer = state.customers.get(customer.id);
        if (!eatingCustomer || eatingCustomer.status !== "eating") {
          return;
        }
        eatingCustomer.status = "waiting-bill";
        eatingCustomer.billRequestedAtMs = now();
        publish(CAFE_NODE_IDS.diner, `cafe/billing/${eatingCustomer.tableId}/requested`, {
          customerId: eatingCustomer.id,
          tableId: eatingCustomer.tableId,
          orderId: eatingCustomer.orderId,
        });
        requestWaiterTask("bill", eatingCustomer.id);
        maybeDispatchWaiters();
        updateMetrics();
      });
      updateMetrics();
      return;
    }

    const waitedMs = Math.max(0, now() - (customer.billRequestedAtMs ?? now()));
    const subtotal = customer.dish?.price ?? 0;
    const tipAmount =
      waitedMs <= currentConfig().billPatienceMs
        ? roundMoney(Math.max(currentConfig().tipFlat, subtotal * currentConfig().tipPercent))
        : 0;
    customer.billWaitMs = waitedMs;
    customer.tipAmount = tipAmount;
    customer.paidAmount = roundMoney(subtotal + tipAmount);
    publish(CAFE_NODE_IDS.billing, `cafe/billing/${customer.tableId}/presented`, {
      customerId: customer.id,
      tableId: customer.tableId,
      subtotal,
      billWaitMs: waitedMs,
      waiterId,
    });
    schedule(500, () => completePayment(customer.id));
    updateMetrics();
  }

  function startKitchenPipeline(customerId: string) {
    const customer = state.customers.get(customerId);
    if (!customer?.orderId || !customer.dish) {
      return;
    }
    publish(CAFE_NODE_IDS.kitchen, `cafe/kitchen/orders/${customer.orderId}/accepted`, {
      orderId: customer.orderId,
      dishId: customer.dish.id,
      tableId: customer.tableId,
    });
    publish(CAFE_NODE_IDS.kitchen, `cafe/kitchen/orders/${customer.orderId}/prepping`, {
      orderId: customer.orderId,
      dishId: customer.dish.id,
      prepMs: customer.dish.prepMs,
    });
    schedule(customer.dish.prepMs, () => {
      const nextCustomer = state.customers.get(customerId);
      if (!nextCustomer || nextCustomer.status !== "waiting-food" || !nextCustomer.orderId || !nextCustomer.dish) {
        return;
      }
      nextCustomer.status = "ready-to-serve";
      publish(CAFE_NODE_IDS.kitchen, `cafe/kitchen/orders/${nextCustomer.orderId}/ready`, {
        orderId: nextCustomer.orderId,
        tableId: nextCustomer.tableId,
        dishId: nextCustomer.dish.id,
      });
      requestWaiterTask("serve", customerId);
      maybeDispatchWaiters();
      updateMetrics();
    });
  }

  function completePayment(customerId: string) {
    const customer = state.customers.get(customerId);
    if (!customer || customer.status !== "waiting-bill") {
      return;
    }
    customer.status = "paid";
    publish(CAFE_NODE_IDS.billing, `cafe/billing/${customer.tableId}/payment-submitted`, {
      customerId: customer.id,
      tableId: customer.tableId,
      subtotal: customer.dish?.price ?? 0,
      tip: customer.tipAmount ?? 0,
      total: customer.paidAmount ?? 0,
    });

    const table = state.tables.find((entry) => entry.id === customer.tableId);
    if (table) {
      table.customerId = null;
    }
    publish(CAFE_NODE_IDS.turnover, `cafe/tables/${customer.tableId}/cleared`, {
      tableId: customer.tableId,
      customerId: customer.id,
      readyForNextParty: true,
    });
    customer.status = "departed";
    publish(CAFE_NODE_IDS.departures, `cafe/customers/${customer.id}/departed`, {
      customerId: customer.id,
      tableId: customer.tableId,
      total: customer.paidAmount ?? 0,
      tip: customer.tipAmount ?? 0,
    });
    maybeDispatchWaiters();
    maybeProcessConcierge();
    const nextQueued = queueFrontReadyToSeat();
    if (nextQueued) {
      requestWaiterTask("seat", nextQueued.id);
    }
    updateMetrics();
  }

  function updateMetrics() {
    const values = Array.from(state.customers.values());
    callbacks.onMetrics({
      customersSeen: values.length,
      queued: values.filter((customer) => customer.status === "queued" || customer.status === "greeted").length,
      seated: values.filter((customer) =>
        customer.status !== "queued" &&
        customer.status !== "greeted" &&
        customer.status !== "turned-away" &&
        customer.status !== "departed"
      ).length,
      activeTables: state.tables.filter((table) => table.customerId !== null).length,
      openOrders: values.filter((customer) =>
        customer.status === "waiting-food" ||
        customer.status === "ready-to-serve"
      ).length,
      completedVisits: values.filter((customer) => customer.status === "departed").length,
      turnedAway: values.filter((customer) => customer.status === "turned-away").length,
      revenue: roundMoney(
        values.reduce((sum, customer) => sum + (customer.status === "departed" ? customer.dish?.price ?? 0 : 0), 0),
      ),
      tips: roundMoney(
        values.reduce((sum, customer) => sum + (customer.status === "departed" ? customer.tipAmount ?? 0 : 0), 0),
      ),
    });
    callbacks.onQueues({
      queueCustomers: state.queue,
      pendingWaiterTasks: state.pendingTasks.map((task) => `${task.type}: ${task.customerId}`),
      readyOrders: values
        .filter((customer) => customer.status === "ready-to-order")
        .map((customer) => `${customer.orderId ?? customer.id} @ ${customer.tableId ?? "?"}`),
      kitchenTickets: values
        .filter((customer) => customer.status === "waiting-food" || customer.status === "ready-to-serve")
        .map((customer) => `${customer.orderId ?? customer.id} · ${customer.dish?.name ?? "dish"}`),
      waitingBills: values
        .filter((customer) => customer.status === "waiting-bill")
        .map((customer) => `${customer.tableId ?? "table"} · ${customer.id}`),
      activeTables: state.tables
        .filter((table) => table.customerId !== null)
        .map((table) => `${table.id}: ${table.customerId}`),
    });
  }

  updateMetrics();

  return { start, stop, reset, isRunning: () => state.running };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function resetCafeMetrics() {
  return { ...DEFAULT_CAFE_METRICS };
}

export function resetCafeQueues() {
  return { ...DEFAULT_CAFE_QUEUE_SNAPSHOT };
}
