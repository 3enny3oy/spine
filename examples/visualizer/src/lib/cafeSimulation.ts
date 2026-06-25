import {
  DEFAULT_CAFE_METRICS,
  DEFAULT_CAFE_QUEUE_SNAPSHOT,
  type CafeDishConfig,
  type CafeMetrics,
  type CafeQueueSnapshot,
  type CafeScenarioConfig,
  type CafeSimulationRuntime,
} from "./scenarios";
import { selectWorkerBatch } from "./simulationPrimitives";
import {
  claimSimulationWorkItems,
  createSimulationEntityStore,
  createSimulationWorkStore,
  findSimulationEntity,
  getSimulationEntity,
  listSimulationEntities,
  removeSimulationEntity,
  reopenSimulationWorkItem,
  type SimulationEntityStore,
  type SimulationWorkItem,
  type SimulationWorkStore,
  upsertSimulationEntity,
} from "./simulationStores";
import {
  createSimulationQueue,
  enqueueSimulationQueue,
  getSimulationQueueSize,
  listSimulationQueue,
  removeFromSimulationQueue,
  type SimulationQueue,
} from "./simulationQueues";

type WaiterTaskType = "seat" | "menu" | "order" | "serve" | "bill" | "payment";
type KitchenTicketStatus = "queued" | "prepping" | "ready";
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
  | "ready-to-pay"
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

interface WorkItem extends SimulationWorkItem<WaiterTaskType, string, string> {}

interface KitchenTicket {
  id: string;
  customerId: string;
  orderId: string;
  tableId: string | null;
  dish: CafeDishConfig;
  createdAtMs: number;
  status: KitchenTicketStatus;
  batchId?: string | null;
  startedPrepAtMs?: number;
  readyAtMs?: number;
}

interface WaiterState {
  id: string;
  tableIds: string[];
  busy: boolean;
  currentWorkItemIds: string[];
  currentWorkType: WaiterTaskType | null;
  lastFairnessKey: string | null;
}

interface ChefState {
  busy: boolean;
  currentDishId: string | null;
  currentBatchId: string | null;
  currentTicketIds: string[];
  currentBatchDueAtMs: number | null;
  lastFairnessKey: string | null;
}

interface TableState {
  id: string;
  waiterId: string;
  customerId: string | null;
}

interface SimulationState {
  running: boolean;
  started: boolean;
  customerSeq: number;
  nextTimerId: number;
  nextWorkItemSeq: number;
  nextKitchenBatchSeq: number;
  timers: Map<number, ScheduledTask>;
  customers: SimulationEntityStore<CustomerRecord>;
  queue: SimulationQueue<string>;
  waiters: WaiterState[];
  chef: ChefState;
  tables: SimulationEntityStore<TableState>;
  workItems: SimulationWorkStore<WorkItem>;
  kitchenTickets: SimulationEntityStore<KitchenTicket>;
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
  getRuntime: () => CafeSimulationRuntime;
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

const WORK_TYPE_BASE_SCORE: Record<WaiterTaskType, number> = {
  bill: 120,
  payment: 140,
  serve: 100,
  order: 80,
  seat: 60,
  menu: 40,
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
    maybeProcessChef();
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
    const waiters: WaiterState[] = currentRuntime().waiters.map((waiter) => ({
      id: waiter.id,
      tableIds: [...waiter.tableIds],
      busy: false,
      currentWorkItemIds: [],
      currentWorkType: null,
      lastFairnessKey: null,
    }));

    return {
      running: false,
      started: false,
      customerSeq: 0,
      nextTimerId: 1,
      nextWorkItemSeq: 1,
      nextKitchenBatchSeq: 1,
      timers: new Map<number, ScheduledTask>(),
      customers: createSimulationEntityStore<CustomerRecord>(),
      queue: createSimulationQueue<string>(),
      waiters,
      chef: {
        busy: false,
        currentDishId: null,
        currentBatchId: null,
        currentTicketIds: [],
        currentBatchDueAtMs: null,
        lastFairnessKey: null,
      },
      tables: buildTableStore(waiters),
      workItems: createSimulationWorkStore<WorkItem>(),
      kitchenTickets: createSimulationEntityStore<KitchenTicket>(),
      conciergeBusy: false,
    };
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

  function currentRuntime() {
    return callbacks.getRuntime();
  }

  function buildTableStore(waiters: WaiterState[]) {
    const tables = createSimulationEntityStore<TableState>();
    for (const waiter of waiters) {
      for (const tableId of waiter.tableIds) {
        upsertSimulationEntity(tables, {
          id: tableId,
          waiterId: waiter.id,
          customerId: null,
        });
      }
    }
    return tables;
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

  function tableById(tableId: string) {
    return getSimulationEntity(state.tables, tableId);
  }

  function firstFreeTableForWaiter(waiterId: string) {
    return (
      findSimulationEntity(
        state.tables,
        (table) => table.waiterId === waiterId && table.customerId === null,
      ) ?? null
    );
  }

  function kitchenTicketForCustomer(customerId: string) {
    return findSimulationEntity(state.kitchenTickets, (ticket) => ticket.customerId === customerId);
  }

  function queueFrontWaitingForGreeting() {
    return listSimulationQueue(state.queue)
      .map((customerId) => getSimulationEntity(state.customers, customerId))
      .find((customer): customer is CustomerRecord => Boolean(customer && customer.status === "queued")) ?? null;
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

    publish(currentRuntime().publishNodes.arrivals, `cafe/customers/${customerId}/arrived`, {
      customerId,
      partySize: customer.partySize,
      arrivedAtMs: customer.queuedAtMs,
    });

    if (getSimulationQueueSize(state.queue) >= config.queueCapacity) {
      customer.status = "turned-away";
      upsertSimulationEntity(state.customers, customer);
      publish(currentRuntime().publishNodes.queue, `cafe/queue/front/${customerId}/rejected`, {
        customerId,
        queueDepth: getSimulationQueueSize(state.queue),
        queueCapacity: config.queueCapacity,
      });
      updateMetrics();
      scheduleNextArrival();
      return;
    }

    upsertSimulationEntity(state.customers, customer);
    enqueueSimulationQueue(state.queue, customerId);
    publish(currentRuntime().publishNodes.queue, `cafe/queue/front/${customerId}/queued`, {
      customerId,
      queueDepth: getSimulationQueueSize(state.queue),
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
      const nextCustomer = getSimulationEntity(state.customers, customer.id);
      if (!nextCustomer || nextCustomer.status !== "queued") {
        state.conciergeBusy = false;
        maybeProcessConcierge();
        return;
      }
      nextCustomer.status = "greeted";
      nextCustomer.greetedAtMs = now();
      publish(currentRuntime().publishNodes.concierge, `cafe/queue/front/${customer.id}/greeted`, {
        customerId: customer.id,
        greetedAtMs: nextCustomer.greetedAtMs,
      });
      requestWaiterWork("seat", customer.id);
      state.conciergeBusy = false;
      maybeProcessConcierge();
      maybeDispatchWaiters();
      updateMetrics();
    });
  }

  function requestWaiterWork(type: WaiterTaskType, customerId: string) {
    const existingItem = findSimulationEntity(
      state.workItems,
      (workItem) => workItem.type === type && workItem.subjectId === customerId,
    );
    if (existingItem) {
      return existingItem;
    }

    const customer = getSimulationEntity(state.customers, customerId);
    if (!customer) {
      return null;
    }

    const workItem: WorkItem = {
      id: `work-${String(state.nextWorkItemSeq++).padStart(4, "0")}`,
      type,
      subjectId: customerId,
      createdAtMs: now(),
      status: "open",
      blockedReason: null,
    };
    upsertSimulationEntity(state.workItems, workItem);

    publish(currentRuntime().publishNodes.waiterRouter, `cafe/service/request/${type}`, {
      workItemId: workItem.id,
      requestType: type,
      customerId,
      tableId: customer.tableId ?? null,
    });

    return workItem;
  }

  function maybeDispatchWaiters() {
    if (!state.running) {
      return;
    }

    for (const workItem of listSimulationEntities(state.workItems)) {
      if (workItem.status === "open") {
        workItem.blockedReason = blockedReasonForWorkItem(workItem);
      }
    }

    for (const waiter of state.waiters) {
      if (waiter.busy) {
        continue;
      }

      const selection = nextWorkBatchForWaiter(waiter);
      const nextWorkBatch = selection.items;
      if (nextWorkBatch.length === 0) {
        continue;
      }

      waiter.lastFairnessKey = selection.cursor.lastFairnessKey ?? null;
      claimWorkBatch(waiter, nextWorkBatch);
      schedule(durationForBatch(nextWorkBatch[0]!.type, nextWorkBatch.length), () => {
        completeWaiterBatch(waiter.id, nextWorkBatch.map((workItem) => workItem.id));
        waiter.busy = false;
        waiter.currentWorkItemIds = [];
        waiter.currentWorkType = null;
        maybeDispatchWaiters();
        updateMetrics();
      });
    }
  }

  function nextWorkBatchForWaiter(waiter: WaiterState) {
    const candidates = listSimulationEntities(state.workItems)
      .filter((workItem) => workItem.status === "open")
      .filter((workItem) => canWaiterRunWork(waiter, workItem))
      .map((workItem) => ({
        item: workItem,
        workType: workItem.type,
        createdAtMs: workItem.createdAtMs,
        urgencyScore: scoreWorkItem(waiter, workItem),
        fairnessKey: workItem.type,
        batchKey: batchKeyForWorkItem(workItem),
      }));

    return selectWorkerBatch({
      config: currentRuntime().workerPolicies.waiter,
      candidates,
      cursor: { lastFairnessKey: waiter.lastFairnessKey },
      batchCapacityForSeed: (seed) => batchCapacityForWorkType(waiter, seed.workType as WaiterTaskType),
    });
  }

  function canWaiterRunWork(waiter: WaiterState, workItem: WorkItem) {
    const customer = getSimulationEntity(state.customers, workItem.subjectId);
    if (!customer) {
      return false;
    }

    switch (workItem.type) {
      case "seat":
        return customer.status === "greeted" && firstFreeTableForWaiter(waiter.id) !== null;
      case "menu":
        return customer.status === "seated" && customer.waiterId === waiter.id && Boolean(customer.tableId);
      case "order":
        return customer.status === "ready-to-order" && customer.waiterId === waiter.id && Boolean(customer.orderId && customer.dish);
      case "serve":
        return customer.status === "ready-to-serve" && customer.waiterId === waiter.id && Boolean(customer.tableId && customer.orderId && customer.dish);
      case "bill":
        return customer.status === "waiting-bill" && customer.waiterId === waiter.id && Boolean(customer.tableId && customer.dish);
      case "payment":
        return customer.status === "ready-to-pay" && customer.waiterId === waiter.id && Boolean(customer.tableId && customer.dish);
    }
  }

  function blockedReasonForWorkItem(workItem: WorkItem) {
    const customer = getSimulationEntity(state.customers, workItem.subjectId);
    if (!customer) {
      return "customer-missing";
    }

    switch (workItem.type) {
      case "seat":
        return listSimulationEntities(state.tables).some((table) => table.customerId === null)
          ? "waiting-for-section-table"
          : "no-free-tables";
      case "menu":
        return customer.status === "seated" ? null : "customer-not-seated";
      case "order":
        return customer.status === "ready-to-order" ? null : "customer-not-ready";
      case "serve":
        return customer.status === "ready-to-serve" ? null : "kitchen-not-ready";
      case "bill":
        return customer.status === "waiting-bill" ? null : "customer-still-eating";
      case "payment":
        return customer.status === "ready-to-pay" ? null : "bill-not-presented";
    }
  }

  function scoreWorkItem(waiter: WaiterState, workItem: WorkItem) {
    const customer = getSimulationEntity(state.customers, workItem.subjectId);
    const ageScore = (now() - workItem.createdAtMs) / 250;
    let score = WORK_TYPE_BASE_SCORE[workItem.type] + ageScore;

    if (workItem.type === "seat" && firstFreeTableForWaiter(waiter.id)) {
      score += getSimulationQueueSize(state.queue);
    }

    if (workItem.type === "serve") {
      score += 10;
    }

    if (workItem.type === "bill" && customer?.billRequestedAtMs) {
      score += (now() - customer.billRequestedAtMs) / 200;
    }

    if (workItem.type === "payment") {
      score += 15;
    }

    return score;
  }

  function batchCapacityForWorkType(waiter: WaiterState, type: WaiterTaskType) {
    if (type === "seat") {
      return listSimulationEntities(state.tables).filter(
        (table) => table.waiterId === waiter.id && table.customerId === null,
      ).length;
    }

    return null;
  }

  function claimWorkBatch(waiter: WaiterState, workItems: WorkItem[]) {
    claimSimulationWorkItems(
      state.workItems,
      waiter.id,
      workItems.map((workItem) => workItem.id),
      now(),
    );
    waiter.busy = true;
    waiter.currentWorkItemIds = workItems.map((workItem) => workItem.id);
    waiter.currentWorkType = workItems[0]?.type ?? null;
  }

  function enqueueKitchenTicket(customerId: string) {
    const customer = getSimulationEntity(state.customers, customerId);
    if (!customer?.orderId || !customer.dish) {
      return null;
    }

    const existingTicket = kitchenTicketForCustomer(customerId);
    if (existingTicket) {
      return existingTicket;
    }

    const ticket: KitchenTicket = {
      id: `ticket-${customer.orderId}`,
      customerId,
      orderId: customer.orderId,
      tableId: customer.tableId ?? null,
      dish: customer.dish,
      createdAtMs: now(),
      status: "queued",
      batchId: null,
    };
    upsertSimulationEntity(state.kitchenTickets, ticket);

    publish(currentRuntime().publishNodes.kitchen, `cafe/kitchen/orders/${ticket.orderId}/accepted`, {
      ticketId: ticket.id,
      orderId: ticket.orderId,
      dishId: ticket.dish.id,
      tableId: ticket.tableId,
    });

    if (
      state.chef.busy &&
      state.chef.currentDishId === ticket.dish.id &&
      state.chef.currentBatchId &&
      state.chef.currentBatchDueAtMs
    ) {
      ticket.status = "prepping";
      ticket.batchId = state.chef.currentBatchId;
      ticket.startedPrepAtMs = now();
      state.chef.currentTicketIds.push(ticket.id);
      publish(currentRuntime().publishNodes.kitchen, `cafe/kitchen/orders/${ticket.orderId}/prepping`, {
        ticketId: ticket.id,
        batchId: state.chef.currentBatchId,
        orderId: ticket.orderId,
        dishId: ticket.dish.id,
        prepMs: ticket.dish.prepMs,
        remainingPrepMs: Math.max(0, state.chef.currentBatchDueAtMs - now()),
        batchSize: state.chef.currentTicketIds.length,
      });
      updateMetrics();
      return ticket;
    }

    maybeProcessChef();
    return ticket;
  }

  function maybeProcessChef() {
    if (!state.running || state.chef.busy) {
      return;
    }

    const nextBatch = nextChefBatch();
    if (!nextBatch) {
      return;
    }

    const batchId = `batch-${String(state.nextKitchenBatchSeq++).padStart(4, "0")}`;
    const prepMs = nextBatch[0]?.dish.prepMs ?? 0;
    state.chef.busy = true;
    state.chef.currentDishId = nextBatch[0]?.dish.id ?? null;
    state.chef.currentBatchId = batchId;
    state.chef.currentTicketIds = nextBatch.map((ticket) => ticket.id);
    state.chef.currentBatchDueAtMs = now() + scaledDelay(prepMs);

    for (const ticket of nextBatch) {
      ticket.status = "prepping";
      ticket.batchId = batchId;
      ticket.startedPrepAtMs = now();
      publish(currentRuntime().publishNodes.kitchen, `cafe/kitchen/orders/${ticket.orderId}/prepping`, {
        ticketId: ticket.id,
        batchId,
        orderId: ticket.orderId,
        dishId: ticket.dish.id,
        prepMs,
        remainingPrepMs: prepMs,
        batchSize: nextBatch.length,
      });
    }

    updateMetrics();
    schedule(prepMs, () => completeChefBatch(batchId));
  }

  function nextChefBatch() {
    const queuedTickets = listSimulationEntities(state.kitchenTickets).filter(
      (ticket) => ticket.status === "queued",
    );
    const groupScores = new Map<string, number>();
    const groups = new Map<string, KitchenTicket[]>();

    for (const ticket of queuedTickets) {
      const group = groups.get(ticket.dish.id) ?? [];
      group.push(ticket);
      groups.set(ticket.dish.id, group);
    }

    for (const [dishId, tickets] of groups) {
      groupScores.set(dishId, chefBatchScore(tickets));
    }

    const selection = selectWorkerBatch({
      config: currentRuntime().workerPolicies.chef,
      candidates: queuedTickets.map((ticket) => ({
        item: ticket,
        workType: "prep",
        createdAtMs: ticket.createdAtMs,
        urgencyScore: groupScores.get(ticket.dish.id) ?? 0,
        batchKey: ticket.dish.id,
        fairnessKey: ticket.dish.id,
      })),
      cursor: { lastFairnessKey: state.chef.lastFairnessKey },
    });

    state.chef.lastFairnessKey = selection.cursor.lastFairnessKey ?? null;
    return selection.items.length > 0 ? selection.items : null;
  }

  function chefBatchScore(tickets: KitchenTicket[]) {
    const oldestAge = now() - tickets[0]!.createdAtMs;
    return oldestAge + tickets.length * 600;
  }

  function batchKeyForWorkItem(workItem: WorkItem) {
    if (workItem.type === "serve" || workItem.type === "payment") {
      return getSimulationEntity(state.customers, workItem.subjectId)?.tableId ?? workItem.subjectId;
    }
    return workItem.type;
  }

  function completeChefBatch(batchId: string) {
    if (state.chef.currentBatchId !== batchId) {
      return;
    }

    const readyAtMs = now();
    const batchTickets = state.chef.currentTicketIds
      .map((ticketId) => getSimulationEntity(state.kitchenTickets, ticketId))
      .filter((ticket): ticket is KitchenTicket => Boolean(ticket));

    for (const ticket of batchTickets) {
      const customer = getSimulationEntity(state.customers, ticket.customerId);
      if (!customer || customer.status !== "waiting-food") {
        continue;
      }

      ticket.status = "ready";
      ticket.readyAtMs = readyAtMs;
      customer.status = "ready-to-serve";
      publish(currentRuntime().publishNodes.kitchen, `cafe/kitchen/orders/${ticket.orderId}/ready`, {
        ticketId: ticket.id,
        batchId,
        orderId: ticket.orderId,
        tableId: ticket.tableId,
        dishId: ticket.dish.id,
      });
      requestWaiterWork("serve", ticket.customerId);
    }

    state.chef.busy = false;
    state.chef.currentDishId = null;
    state.chef.currentBatchId = null;
    state.chef.currentTicketIds = [];
    state.chef.currentBatchDueAtMs = null;
    maybeDispatchWaiters();
    maybeProcessChef();
    updateMetrics();
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
      case "payment":
        return Math.max(400, Math.round(config.billMs * 0.75));
    }
  }

  function durationForBatch(type: WaiterTaskType, count: number) {
    const baseDuration = durationForTask(type);
    if (count <= 1) {
      return baseDuration;
    }

    return Math.round(baseDuration * (1 + 0.35 * (count - 1)));
  }

  function clearWorkItem(workItemId: string) {
    removeSimulationEntity(state.workItems, workItemId);
  }

  function completeWaiterBatch(waiterId: string, workItemIds: string[]) {
    for (const workItemId of workItemIds) {
      completeWaiterWork(waiterId, workItemId);
    }
  }

  function completeWaiterWork(waiterId: string, workItemId: string) {
    const workItem = getSimulationEntity(state.workItems, workItemId);
    if (!workItem) {
      return;
    }

    const customer = getSimulationEntity(state.customers, workItem.subjectId);
    if (!customer) {
      clearWorkItem(workItemId);
      return;
    }

    if (workItem.claimedByWorkerId !== waiterId) {
      return;
    }

    if (workItem.type === "seat") {
      const table = firstFreeTableForWaiter(waiterId);
      if (!table) {
        reopenSimulationWorkItem(state.workItems, workItemId, "waiting-for-section-table");
        return;
      }

      table.customerId = customer.id;
      customer.status = "seated";
      customer.tableId = table.id;
      customer.waiterId = waiterId;
      removeFromSimulationQueue(state.queue, (queuedId) => queuedId === customer.id);
      publish(currentRuntime().publishNodes.seating, `cafe/tables/${table.id}/seated`, {
        tableId: table.id,
        customerId: customer.id,
        waiterId,
      });
      clearWorkItem(workItemId);
      requestWaiterWork("menu", customer.id);
      updateMetrics();
      return;
    }

    if (workItem.type === "menu") {
      customer.status = "deciding";
      customer.menuDeliveredAtMs = now();
      publish(currentRuntime().publishNodes.menu, `cafe/tables/${customer.tableId}/menu-delivered`, {
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
      clearWorkItem(workItemId);
      schedule(randomBetween(currentConfig().decisionMinMs, currentConfig().decisionMaxMs), () => {
        const decidingCustomer = getSimulationEntity(state.customers, customer.id);
        if (!decidingCustomer || decidingCustomer.status !== "deciding") {
          return;
        }
        const dish = randomDish();
        decidingCustomer.dish = dish;
        decidingCustomer.orderId = `order-${customer.id}`;
        decidingCustomer.status = "ready-to-order";
        publish(currentRuntime().publishNodes.diner, `cafe/orders/${decidingCustomer.orderId}/requested`, {
          orderId: decidingCustomer.orderId,
          customerId: decidingCustomer.id,
          tableId: decidingCustomer.tableId,
          dishId: dish.id,
          dishName: dish.name,
        });
        requestWaiterWork("order", decidingCustomer.id);
        maybeDispatchWaiters();
        updateMetrics();
      });
      updateMetrics();
      return;
    }

    if (workItem.type === "order") {
      if (!customer.dish || !customer.orderId) {
        clearWorkItem(workItemId);
        return;
      }

      customer.status = "waiting-food";
      publish(currentRuntime().publishNodes.order, `cafe/orders/${customer.orderId}/placed`, {
        orderId: customer.orderId,
        customerId: customer.id,
        tableId: customer.tableId,
        dishId: customer.dish.id,
        dishName: customer.dish.name,
        price: customer.dish.price,
        waiterId,
      });
      clearWorkItem(workItemId);
      enqueueKitchenTicket(customer.id);
      updateMetrics();
      return;
    }

    if (workItem.type === "serve") {
      customer.status = "eating";
      publish(currentRuntime().publishNodes.service, `cafe/tables/${customer.tableId}/served`, {
        tableId: customer.tableId,
        customerId: customer.id,
        orderId: customer.orderId,
        dishId: customer.dish?.id,
        waiterId,
      });
      const kitchenTicket = kitchenTicketForCustomer(customer.id);
      if (kitchenTicket) {
        removeSimulationEntity(state.kitchenTickets, kitchenTicket.id);
      }
      clearWorkItem(workItemId);
      schedule(randomBetween(currentConfig().eatMinMs, currentConfig().eatMaxMs), () => {
        const eatingCustomer = getSimulationEntity(state.customers, customer.id);
        if (!eatingCustomer || eatingCustomer.status !== "eating") {
          return;
        }
        eatingCustomer.status = "waiting-bill";
        eatingCustomer.billRequestedAtMs = now();
        publish(currentRuntime().publishNodes.diner, `cafe/billing/${eatingCustomer.tableId}/requested`, {
          customerId: eatingCustomer.id,
          tableId: eatingCustomer.tableId,
          orderId: eatingCustomer.orderId,
        });
        requestWaiterWork("bill", eatingCustomer.id);
        maybeDispatchWaiters();
        updateMetrics();
      });
      updateMetrics();
      return;
    }

    if (workItem.type === "payment") {
      clearWorkItem(workItemId);
      completePayment(customer.id, waiterId);
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
    publish(currentRuntime().publishNodes.billing, `cafe/billing/${customer.tableId}/presented`, {
      customerId: customer.id,
      tableId: customer.tableId,
      subtotal,
      billWaitMs: waitedMs,
      waiterId,
    });
    customer.status = "ready-to-pay";
    clearWorkItem(workItemId);
    requestWaiterWork("payment", customer.id);
    maybeDispatchWaiters();
    updateMetrics();
    return;
  }

  function completePayment(customerId: string, waiterId: string) {
    const customer = getSimulationEntity(state.customers, customerId);
    if (!customer || customer.status !== "ready-to-pay") {
      return;
    }

    customer.status = "paid";
    publish(currentRuntime().publishNodes.billing, `cafe/billing/${customer.tableId}/payment-submitted`, {
      customerId: customer.id,
      tableId: customer.tableId,
      subtotal: customer.dish?.price ?? 0,
      tip: customer.tipAmount ?? 0,
      total: customer.paidAmount ?? 0,
      waiterId,
    });

    const table = customer.tableId ? tableById(customer.tableId) : null;
    if (table) {
      table.customerId = null;
    }

    publish(currentRuntime().publishNodes.turnover, `cafe/tables/${customer.tableId}/cleared`, {
      tableId: customer.tableId,
      customerId: customer.id,
      readyForNextParty: true,
    });
    customer.status = "departed";
    publish(currentRuntime().publishNodes.departures, `cafe/customers/${customer.id}/departed`, {
      customerId: customer.id,
      tableId: customer.tableId,
      total: customer.paidAmount ?? 0,
      tip: customer.tipAmount ?? 0,
    });

    maybeDispatchWaiters();
    maybeProcessConcierge();
    updateMetrics();
  }

  function formatWorkItem(workItem: WorkItem) {
    const customer = getSimulationEntity(state.customers, workItem.subjectId);
    const waiterLabel = workItem.claimedByWorkerId
      ? `claimed by ${workItem.claimedByWorkerId}`
      : customer?.waiterId ?? "unassigned";
    const targetLabel = customer?.tableId ?? customer?.id ?? workItem.subjectId;
    const stateLabel = workItem.status === "open" ? workItem.blockedReason ?? "ready" : waiterLabel;
    return `${workItem.type} · ${targetLabel} · ${stateLabel}`;
  }

  function formatKitchenTicket(ticket: KitchenTicket) {
    const customer = getSimulationEntity(state.customers, ticket.customerId);
    const batchLabel = ticket.batchId ?? "queued";
    return `${ticket.orderId} · ${ticket.dish.name} · ${ticket.status} · ${customer?.waiterId ?? "?"} · ${batchLabel}`;
  }

  function updateMetrics() {
    const values = listSimulationEntities(state.customers);
    const workItems = listSimulationEntities(state.workItems).sort((left, right) => left.createdAtMs - right.createdAtMs);
    const kitchenTickets = listSimulationEntities(state.kitchenTickets).sort(
      (left, right) => left.createdAtMs - right.createdAtMs,
    );

    callbacks.onMetrics({
      customersSeen: values.length,
      queued: values.filter((customer) => customer.status === "queued" || customer.status === "greeted").length,
      seated: values.filter((customer) =>
        customer.status !== "queued" &&
        customer.status !== "greeted" &&
        customer.status !== "turned-away" &&
        customer.status !== "departed"
      ).length,
      activeTables: listSimulationEntities(state.tables).filter((table) => table.customerId !== null).length,
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
      queueCustomers: listSimulationQueue(state.queue),
      pendingWaiterTasks: workItems.map(formatWorkItem),
      readyOrders: values
        .filter((customer) => customer.status === "ready-to-order")
        .map((customer) => `${customer.orderId ?? customer.id} @ ${customer.tableId ?? "?"} · ${customer.waiterId ?? "?"}`),
      kitchenTickets: kitchenTickets.map(formatKitchenTicket),
      waitingBills: values
        .filter((customer) => customer.status === "waiting-bill" || customer.status === "ready-to-pay")
        .map((customer) => `${customer.tableId ?? "table"} · ${customer.id} · ${customer.waiterId ?? "?"}`),
      activeTables: listSimulationEntities(state.tables)
        .filter((table) => table.customerId !== null)
        .map((table) => `${table.id} · ${table.waiterId}: ${table.customerId}`),
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
