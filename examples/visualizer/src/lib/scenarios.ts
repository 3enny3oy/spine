import type { Node } from "@xyflow/react";
import type {
  DemoNodeData,
  DeliveryOptions,
  GenericPrimitiveConfig,
  JsonObject,
  NodeKind,
  PrimitiveType,
  QueuePrimitiveConfig,
  ResourcePoolPrimitiveConfig,
  SourcePrimitiveConfig,
  StorePrimitiveConfig,
  NodePort,
  TimerPrimitiveConfig,
  WorkerBatchPolicyConfig,
  WorkerPrimitiveConfig,
} from "./types";

export interface ScenarioOption {
  id: string;
  title: string;
  description: string;
  supportsSimulation: boolean;
}

export interface ScenarioEdgeDefinition {
  id: string;
  source: string;
  target: string;
}

export interface ScenarioDefinition extends ScenarioOption {
  edges: ScenarioEdgeDefinition[];
  simulationKind?: string | null;
  cafeConfig?: CafeScenarioConfig | null;
  visualGroups?: ScenarioVisualGroupDefinition[] | null;
  blueprint?: SimulationBlueprintDefinition | null;
}

export interface ScenarioVisualGroupDefinition {
  id: string;
  title: string;
  position: BlueprintNodePosition;
  size: {
    width: number;
    height: number;
  };
  nodeIds: string[];
  note?: string;
  tone?: string | null;
}

export interface SimulationBlueprintDefinition {
  primitiveSchemaVersion: number;
  instanceConfig?: JsonObject | null;
  globals?: JsonObject | null;
  nodes: BlueprintNodeDefinition[];
  edges: BlueprintEdgeDefinition[];
}

export interface BlueprintNodePosition {
  x: number;
  y: number;
}

export interface BlueprintPublisherBindings {
  address: string;
  payloadText?: string;
  signalKind?: string;
  customSignalKind?: string;
}

export interface BlueprintSubscriberBindings {
  expression: string;
  schemaId: string;
  delivery?: DeliveryOptions;
  configurationExpression?: string;
  queueDepth?: number;
}

export interface BlueprintServiceBindings {
  address: string;
  serviceName: string;
}

export type BlueprintBindingsDefinition =
  | BlueprintPublisherBindings
  | BlueprintSubscriberBindings
  | BlueprintServiceBindings;

interface BlueprintNodeBase {
  id: string;
  kind: Exclude<NodeKind, "config">;
  title: string;
  position: BlueprintNodePosition;
  note?: string;
  instanceName: string;
  bindings: BlueprintBindingsDefinition;
}

type UnspecializedBlueprintPrimitiveType = Exclude<
  PrimitiveType,
  "source" | "queue" | "worker" | "timer" | "store" | "resource_pool"
>;

export type BlueprintNodeDefinition =
  | (BlueprintNodeBase & {
      primitiveType: "source";
      config?: SourcePrimitiveConfig | null;
    })
  | (BlueprintNodeBase & {
      primitiveType: "queue";
      config?: QueuePrimitiveConfig | null;
    })
  | (BlueprintNodeBase & {
      primitiveType: "worker";
      config?: WorkerPrimitiveConfig | null;
    })
  | (BlueprintNodeBase & {
      primitiveType: "timer";
      config?: TimerPrimitiveConfig | null;
    })
  | (BlueprintNodeBase & {
      primitiveType: "store";
      config?: StorePrimitiveConfig | null;
    })
  | (BlueprintNodeBase & {
      primitiveType: "resource_pool";
      config?: ResourcePoolPrimitiveConfig | null;
    })
  | (BlueprintNodeBase & {
      primitiveType: UnspecializedBlueprintPrimitiveType;
      config?: GenericPrimitiveConfig | null;
    });

export interface BlueprintEdgeDefinition {
  id: string;
  source: string;
  target: string;
  channel?: string | null;
  semantics?: JsonObject | null;
}

export interface ScenarioEdgeData {
  active?: boolean;
  label?: string;
}

export interface ScenarioGraphVisuals {
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
    type: "scenarioManhattan";
    data: ScenarioEdgeData;
  }>;
  portsByNodeId: Map<string, NodePort[]>;
}

export interface CafeDishConfig {
  id: string;
  name: string;
  price: number;
  prepMs: number;
}

export interface CafeScenarioConfig {
  arrivalMinMs: number;
  arrivalMaxMs: number;
  queueCapacity: number;
  greetingMs: number;
  seatingMs: number;
  menuMs: number;
  orderMs: number;
  serveMs: number;
  billMs: number;
  decisionMinMs: number;
  decisionMaxMs: number;
  eatMinMs: number;
  eatMaxMs: number;
  billPatienceMs: number;
  tipPercent: number;
  tipFlat: number;
  dishes: CafeDishConfig[];
}

export interface CafeMetrics {
  customersSeen: number;
  queued: number;
  seated: number;
  activeTables: number;
  openOrders: number;
  completedVisits: number;
  turnedAway: number;
  revenue: number;
  tips: number;
}

export interface CafeQueueSnapshot {
  queueCustomers: string[];
  pendingWaiterTasks: string[];
  readyOrders: string[];
  kitchenTickets: string[];
  waitingBills: string[];
  activeTables: string[];
}

export const DEFAULT_CAFE_METRICS: CafeMetrics = {
  customersSeen: 0,
  queued: 0,
  seated: 0,
  activeTables: 0,
  openOrders: 0,
  completedVisits: 0,
  turnedAway: 0,
  revenue: 0,
  tips: 0,
};

export const DEFAULT_CAFE_QUEUE_SNAPSHOT: CafeQueueSnapshot = {
  queueCustomers: [],
  pendingWaiterTasks: [],
  readyOrders: [],
  kitchenTickets: [],
  waitingBills: [],
  activeTables: [],
};

export const FALLBACK_CAFE_SCENARIO_CONFIG: CafeScenarioConfig = {
  arrivalMinMs: 1200,
  arrivalMaxMs: 2600,
  queueCapacity: 12,
  greetingMs: 700,
  seatingMs: 900,
  menuMs: 500,
  orderMs: 800,
  serveMs: 650,
  billMs: 700,
  decisionMinMs: 2400,
  decisionMaxMs: 5200,
  eatMinMs: 5000,
  eatMaxMs: 9000,
  billPatienceMs: 3000,
  tipPercent: 0.16,
  tipFlat: 4,
  dishes: [
    { id: "ramen", name: "Miso ramen", price: 18.5, prepMs: 4200 },
    { id: "salad", name: "Citrus salad", price: 13.0, prepMs: 1900 },
    { id: "pie", name: "Chicken pie", price: 21.0, prepMs: 5600 },
  ],
};

export const CAFE_NODE_IDS = {
  arrivals: "publisher-arrivals",
  queue: "publisher-queue",
  concierge: "publisher-concierge",
  waiterRouter: "publisher-waiter-router",
  seating: "publisher-seating",
  menu: "publisher-menu",
  service: "publisher-service",
  order: "publisher-order",
  kitchen: "publisher-kitchen",
  diner: "publisher-diner",
  billing: "publisher-billing",
  turnover: "publisher-turnover",
  departures: "publisher-departures",
} as const;

export interface CafeSimulationRuntime {
  publishNodes: {
    arrivals: string;
    queue: string;
    concierge: string;
    waiterRouter: string;
    seating: string;
    menu: string;
    service: string;
    order: string;
    kitchen: string;
    diner: string;
    billing: string;
    turnover: string;
    departures: string;
  };
  queueNodes: {
    queue: string;
    router: string;
    orders: string;
    kitchen: string;
    billing: string;
    tables: string;
    waiterPool: string;
  };
  waiters: Array<{
    id: string;
    tableIds: string[];
  }>;
  tableIds: string[];
  workerPolicies: {
    concierge: WorkerPrimitiveConfig;
    waiter: WorkerPrimitiveConfig;
    chef: WorkerPrimitiveConfig;
  };
}

const DEFAULT_CAFE_WAITERS: CafeSimulationRuntime["waiters"] = [
  {
    id: "waiter-1",
    tableIds: ["table-01", "table-02", "table-03", "table-04", "table-05"],
  },
  {
    id: "waiter-2",
    tableIds: ["table-06", "table-07", "table-08", "table-09", "table-10"],
  },
];

const DEFAULT_CAFE_RUNTIME: CafeSimulationRuntime = {
  publishNodes: {
    ...CAFE_NODE_IDS,
  },
  queueNodes: {
    queue: "subscriber-queue",
    router: "subscriber-router",
    orders: "subscriber-orders",
    kitchen: "subscriber-kitchen",
    billing: "subscriber-billing",
    tables: "subscriber-tables",
    waiterPool: "service-waiter-pool",
  },
  waiters: DEFAULT_CAFE_WAITERS.map((waiter) => ({
    ...waiter,
    tableIds: [...waiter.tableIds],
  })),
  tableIds: DEFAULT_CAFE_WAITERS.flatMap((waiter) => waiter.tableIds),
  workerPolicies: {
    concierge: {
      workerRole: "concierge",
      selectionPolicy: "fifo",
      batchPolicy: {
        mode: "none",
      },
      capacity: 1,
    },
    waiter: {
      workerRole: "waiter",
      selectionPolicy: "urgency",
      batchPolicy: {
        mode: "same_work_type",
      },
      capacity: 1,
    },
    chef: {
      workerRole: "chef",
      selectionPolicy: "urgency",
      batchPolicy: {
        mode: "by_key",
        key: "dishId",
      },
      capacity: 1,
    },
  },
};

export function cloneCafeConfig(config: CafeScenarioConfig): CafeScenarioConfig {
  return {
    ...config,
    dishes: config.dishes.map((dish) => ({ ...dish })),
  };
}

export function resolveCafeSimulationRuntime(
  scenario: ScenarioDefinition | null | undefined,
  nodes: Array<DemoNodeData | Node<DemoNodeData>>,
): CafeSimulationRuntime {
  const nodeData = nodes.map((node) => ("data" in node ? node.data : node));
  const blueprintConfig = scenario?.blueprint?.instanceConfig ?? null;

  const waiterIds =
    readStringArray(blueprintConfig?.waiterIds) ??
    makeSequentialIds("waiter", readPositiveInteger(blueprintConfig?.waiterCount) ?? inferWaiterCount(nodeData));
  const tableIds =
    readStringArray(blueprintConfig?.tableIds) ??
    makeSequentialIds("table", readPositiveInteger(blueprintConfig?.tableCount) ?? 10, 2);

  const waiterSections = distributeTables(waiterIds, tableIds);
  const fallback = DEFAULT_CAFE_RUNTIME;
  const conciergeNode = findNode(
    nodeData,
    (node) =>
      node.kind === "publisher" &&
      node.primitiveType === "worker" &&
      readWorkerConfig(node).workerRole === "concierge",
  );
  const chefNode = findNode(
    nodeData,
    (node) =>
      node.kind === "publisher" &&
      node.primitiveType === "worker" &&
      readWorkerConfig(node).workerRole === "chef",
  );
  const waiterNodes = nodeData.filter(
    (node) =>
      node.kind === "publisher" &&
      node.primitiveType === "worker" &&
      readWorkerConfig(node).workerRole === "waiter",
  );

  return {
    publishNodes: {
      arrivals:
        findNodeId(
          nodeData,
          (node) => node.kind === "publisher" && node.primitiveType === "source" && node.instanceName === "customer-arrivals",
        ) ?? fallback.publishNodes.arrivals,
      queue:
        findNodeId(
          nodeData,
          (node) => node.kind === "publisher" && node.primitiveType === "queue" && node.instanceName === "front-door-queue",
        ) ?? fallback.publishNodes.queue,
      concierge:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            readWorkerConfig(node).workerRole === "concierge",
        ) ?? fallback.publishNodes.concierge,
      waiterRouter:
        findNodeId(
          nodeData,
          (node) => node.kind === "publisher" && node.primitiveType === "router" && node.instanceName === "waiter-work-router",
        ) ?? fallback.publishNodes.waiterRouter,
      seating:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            readWorkerConfig(node).workType === "seat",
        ) ?? fallback.publishNodes.seating,
      menu:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            readWorkerConfig(node).workType === "menu",
        ) ?? fallback.publishNodes.menu,
      service:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            readWorkerConfig(node).workType === "serve",
        ) ?? fallback.publishNodes.service,
      order:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            readWorkerConfig(node).workType === "order",
        ) ?? fallback.publishNodes.order,
      kitchen:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            readWorkerConfig(node).workerRole === "chef",
        ) ?? fallback.publishNodes.kitchen,
      diner:
        findNodeId(
          nodeData,
          (node) => node.kind === "publisher" && node.primitiveType === "timer" && node.instanceName === "customer-timers",
        ) ?? fallback.publishNodes.diner,
      billing:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "publisher" &&
            node.primitiveType === "worker" &&
            includesWorkType(readWorkerConfig(node), "bill"),
        ) ?? fallback.publishNodes.billing,
      turnover:
        findNodeId(
          nodeData,
          (node) => node.kind === "publisher" && node.primitiveType === "transform" && node.instanceName === "table-turnover",
        ) ?? fallback.publishNodes.turnover,
      departures:
        findNodeId(
          nodeData,
          (node) => node.kind === "publisher" && node.primitiveType === "observer" && node.instanceName === "customer-departures",
        ) ?? fallback.publishNodes.departures,
    },
    queueNodes: {
      queue:
        findNodeId(
          nodeData,
          (node) => node.kind === "subscriber" && node.instanceName === "front-door-queue-state",
        ) ?? fallback.queueNodes.queue,
      router:
        findNodeId(
          nodeData,
          (node) => node.kind === "subscriber" && node.instanceName === "work-request-stream",
        ) ?? fallback.queueNodes.router,
      orders:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "subscriber" &&
            node.primitiveType === "store" &&
            readStoreConfig(node).entityType === "order",
        ) ?? fallback.queueNodes.orders,
      kitchen:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "subscriber" &&
            node.primitiveType === "store" &&
            readStoreConfig(node).entityType === "kitchen_ticket",
        ) ?? fallback.queueNodes.kitchen,
      billing:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "subscriber" &&
            node.primitiveType === "store" &&
            readStoreConfig(node).entityType === "bill",
        ) ?? fallback.queueNodes.billing,
      tables:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "subscriber" &&
            node.primitiveType === "store" &&
            readStoreConfig(node).entityType === "table",
        ) ?? fallback.queueNodes.tables,
      waiterPool:
        findNodeId(
          nodeData,
          (node) =>
            node.kind === "service" &&
            node.primitiveType === "resource_pool" &&
            readResourcePoolConfig(node).resourceType === "staff_section",
        ) ?? fallback.queueNodes.waiterPool,
    },
    waiters: waiterSections,
    tableIds,
    workerPolicies: {
      concierge: mergeWorkerConfig(fallback.workerPolicies.concierge, readWorkerConfig(conciergeNode)),
      waiter: mergeWorkerConfig(
        fallback.workerPolicies.waiter,
        combineWorkerConfigs(waiterNodes.map((node) => readWorkerConfig(node))),
      ),
      chef: mergeWorkerConfig(fallback.workerPolicies.chef, readWorkerConfig(chefNode)),
    },
  };
}

export function scenarioEdgesForNodes(
  edges: ScenarioEdgeDefinition[],
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
  activeMessages?: Map<string, string>,
): ScenarioGraphVisuals {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = edges.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target));
  const portsByNodeId = new Map<string, NodePort[]>();
  const sourceHandleByEdgeId = new Map<string, string>();
  const targetHandleByEdgeId = new Map<string, string>();
  const outgoingByNode = new Map<
    string,
    Array<{ edge: ScenarioEdgeDefinition; counterpartY: number }>
  >();
  const incomingByNode = new Map<
    string,
    Array<{ edge: ScenarioEdgeDefinition; counterpartY: number }>
  >();

  for (const edge of visibleEdges) {
    const sourceGroup = outgoingByNode.get(edge.source) ?? [];
    sourceGroup.push({
      edge,
      counterpartY: nodeMap.get(edge.target)?.position.y ?? 0,
    });
    outgoingByNode.set(edge.source, sourceGroup);

    const targetGroup = incomingByNode.get(edge.target) ?? [];
    targetGroup.push({
      edge,
      counterpartY: nodeMap.get(edge.source)?.position.y ?? 0,
    });
    incomingByNode.set(edge.target, targetGroup);
  }

  for (const [nodeId, group] of outgoingByNode) {
    const ordered = [...group].sort(
      (left, right) => left.counterpartY - right.counterpartY || left.edge.id.localeCompare(right.edge.id),
    );
    ordered.forEach(({ edge }, index) => {
      const handleId = `source-${edge.id}`;
      sourceHandleByEdgeId.set(edge.id, handleId);
      pushNodePort(portsByNodeId, nodeId, {
        id: handleId,
        side: "right",
        offset: distributePortOffset(index, ordered.length),
      });
    });
  }

  for (const [nodeId, group] of incomingByNode) {
    const ordered = [...group].sort(
      (left, right) => left.counterpartY - right.counterpartY || left.edge.id.localeCompare(right.edge.id),
    );
    ordered.forEach(({ edge }, index) => {
      const handleId = `target-${edge.id}`;
      targetHandleByEdgeId.set(edge.id, handleId);
      pushNodePort(portsByNodeId, nodeId, {
        id: handleId,
        side: "left",
        offset: distributePortOffset(index, ordered.length),
      });
    });
  }

  return {
    portsByNodeId,
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: sourceHandleByEdgeId.get(edge.id) ?? "right",
      targetHandle: targetHandleByEdgeId.get(edge.id) ?? "left",
      type: "scenarioManhattan" as const,
      data: {
        active: activeMessages?.has(`${edge.source}->${edge.target}`) ?? false,
        label: activeMessages?.get(`${edge.source}->${edge.target}`),
      },
    })),
  };
}

function distributePortOffset(index: number, count: number) {
  if (count <= 1) {
    return 50;
  }

  const minOffset = 20;
  const maxOffset = 80;
  return minOffset + ((maxOffset - minOffset) * index) / (count - 1);
}

function pushNodePort(portsByNodeId: Map<string, NodePort[]>, nodeId: string, port: NodePort) {
  const ports = portsByNodeId.get(nodeId) ?? [];
  ports.push(port);
  portsByNodeId.set(nodeId, ports);
}

export function materializeScenarioVisualGroups(
  scenario: ScenarioDefinition | null | undefined,
  nodes: Node<DemoNodeData>[],
): Node<DemoNodeData>[] {
  const groups = scenario?.visualGroups ?? [];
  if (!groups.length) {
    return nodes;
  }

  const GROUP_PADDING_X = 44;
  const GROUP_PADDING_TOP = 88;
  const GROUP_PADDING_BOTTOM = 40;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const groupByNodeId = new Map<string, ScenarioVisualGroupDefinition>();
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (!nodeIds.has(nodeId) || groupByNodeId.has(nodeId)) {
        continue;
      }
      groupByNodeId.set(nodeId, group);
    }
  }

  const boundsByGroupId = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();

  for (const group of groups) {
    const memberNodes = nodes.filter((node) => group.nodeIds.includes(node.id));
    if (!memberNodes.length) {
      boundsByGroupId.set(group.id, {
        x: group.position.x,
        y: group.position.y,
        width: group.size.width,
        height: group.size.height,
      });
      continue;
    }

    const memberBounds = memberNodes.reduce(
      (bounds, node) => {
        const { width, height } = estimateNodeFootprint(node.data);
        return {
          minX: Math.min(bounds.minX, node.position.x),
          minY: Math.min(bounds.minY, node.position.y),
          maxX: Math.max(bounds.maxX, node.position.x + width),
          maxY: Math.max(bounds.maxY, node.position.y + height),
        };
      },
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );

    const groupX = Math.min(group.position.x, memberBounds.minX - GROUP_PADDING_X);
    const groupY = Math.min(group.position.y, memberBounds.minY - GROUP_PADDING_TOP);
    const groupMaxX = Math.max(group.position.x + group.size.width, memberBounds.maxX + GROUP_PADDING_X);
    const groupMaxY = Math.max(group.position.y + group.size.height, memberBounds.maxY + GROUP_PADDING_BOTTOM);

    boundsByGroupId.set(group.id, {
      x: groupX,
      y: groupY,
      width: groupMaxX - groupX,
      height: groupMaxY - groupY,
    });
  }

  const parentNodes = groups.map<Node<DemoNodeData>>((group) => {
    const bounds = boundsByGroupId.get(group.id) ?? {
      x: group.position.x,
      y: group.position.y,
      width: group.size.width,
      height: group.size.height,
    };

    return {
      id: group.id,
      type: "scenarioGroup",
      position: {
        x: bounds.x,
        y: bounds.y,
      },
      draggable: true,
      selectable: true,
      connectable: false,
      deletable: false,
      data: {
        id: group.id,
        kind: "group",
        title: group.title,
        lastPulse: 0,
        note: group.note,
        tone: group.tone ?? undefined,
        isActive: false,
      },
      style: {
        width: bounds.width,
        height: bounds.height,
      },
    };
  });

  const topLevelNodes: Node<DemoNodeData>[] = [];
  const childNodes: Node<DemoNodeData>[] = [];

  for (const node of nodes) {
    const group = groupByNodeId.get(node.id);
    if (!group) {
      topLevelNodes.push({
        ...node,
        parentId: undefined,
        extent: undefined,
      });
      continue;
    }

    const bounds = boundsByGroupId.get(group.id) ?? {
      x: group.position.x,
      y: group.position.y,
    };

    childNodes.push({
      ...node,
      position: {
        x: node.position.x - bounds.x,
        y: node.position.y - bounds.y,
      },
      parentId: group.id,
      // ELK owns compound-node geometry. Constraining children to the parent
      // causes React Flow to clamp them against layouted bounds and can
      // collapse the render tree once live updates start changing measurements.
      extent: undefined,
    });
  }

  return [...parentNodes, ...topLevelNodes, ...childNodes];
}

function estimateNodeFootprint(node: DemoNodeData) {
  switch (node.kind) {
    case "publisher":
      return { width: 250, height: 228 };
    case "subscriber":
      return { width: 250, height: 278 };
    case "service":
      return { width: 250, height: 254 };
    case "config":
      return { width: 250, height: 176 };
    default:
      return { width: 250, height: 200 };
  }
}

export function decorateNodesWithCafeQueues(
  nodes: DemoNodeData[],
  queueState: CafeQueueSnapshot,
): DemoNodeData[] {
  const runtime = resolveCafeSimulationRuntime(null, nodes);
  return nodes.map((node) => decorateCafeQueueNode(node, queueState, runtime));
}

export function decorateScenarioNodesWithCafeQueues(
  nodes: Node<DemoNodeData>[],
  queueState: CafeQueueSnapshot,
): Node<DemoNodeData>[] {
  const runtime = resolveCafeSimulationRuntime(null, nodes);
  return nodes.map((node) => ({
    ...node,
    data: decorateCafeQueueNode(node.data, queueState, runtime),
  }));
}

function decorateCafeQueueNode(
  node: DemoNodeData,
  queueState: CafeQueueSnapshot,
  runtime: CafeSimulationRuntime,
): DemoNodeData {
  if (node.kind === "subscriber") {
    switch (node.id) {
      case runtime.queueNodes.queue:
        return { ...node, queueLabel: "Customers waiting", queueItems: queueState.queueCustomers };
      case runtime.queueNodes.router:
        return { ...node, queueLabel: "Pending waiter tasks", queueItems: queueState.pendingWaiterTasks };
      case runtime.queueNodes.orders:
        return { ...node, queueLabel: "Orders ready", queueItems: queueState.readyOrders };
      case runtime.queueNodes.kitchen:
        return { ...node, queueLabel: "Kitchen tickets", queueItems: queueState.kitchenTickets };
      case runtime.queueNodes.billing:
        return { ...node, queueLabel: "Bills waiting", queueItems: queueState.waitingBills };
      case runtime.queueNodes.tables:
        return { ...node, queueLabel: "Occupied tables", queueItems: queueState.activeTables };
      default:
        return node;
    }
  }
  if (node.kind === "service" && node.id === runtime.queueNodes.waiterPool) {
    return { ...node, queueLabel: "Active tasks", queueItems: queueState.pendingWaiterTasks };
  }
  return node;
}

function inferWaiterCount(nodes: DemoNodeData[]) {
  const resourcePoolNode = nodes.find(
    (node) =>
      node.kind === "service" &&
      node.primitiveType === "resource_pool" &&
      readResourcePoolConfig(node).resourceType === "staff_section",
  );
  const count = readResourcePoolConfig(resourcePoolNode).count;
  return typeof count === "number" && count > 0 ? Math.max(1, Math.floor(count)) : DEFAULT_CAFE_WAITERS.length;
}

function findNodeId(nodes: DemoNodeData[], predicate: (node: DemoNodeData) => boolean) {
  return nodes.find(predicate)?.id;
}

function findNode(nodes: DemoNodeData[], predicate: (node: DemoNodeData) => boolean) {
  return nodes.find(predicate);
}

function makeSequentialIds(prefix: string, count: number, width = 0) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const ordinal = String(index + 1).padStart(width, "0");
    return `${prefix}-${ordinal}`;
  });
}

function distributeTables(waiterIds: string[], tableIds: string[]) {
  const normalizedWaiters = waiterIds.length > 0 ? waiterIds : DEFAULT_CAFE_WAITERS.map((waiter) => waiter.id);
  const sections = normalizedWaiters.map((waiterId) => ({
    id: waiterId,
    tableIds: [] as string[],
  }));

  for (const [index, tableId] of tableIds.entries()) {
    sections[index % sections.length]?.tableIds.push(tableId);
  }

  return sections;
}

function readPositiveInteger(value: JsonObject[keyof JsonObject] | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function readStringArray(value: JsonObject[keyof JsonObject] | null | undefined) {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length > 0 ? items : null;
}

function readWorkerConfig(node: DemoNodeData | undefined): WorkerPrimitiveConfig {
  return node?.primitiveType === "worker" ? (node.primitiveConfig ?? {}) : {};
}

function readStoreConfig(node: DemoNodeData): StorePrimitiveConfig {
  return node.primitiveType === "store" ? (node.primitiveConfig ?? {}) : {};
}

function readResourcePoolConfig(node: DemoNodeData | undefined): ResourcePoolPrimitiveConfig {
  return node?.primitiveType === "resource_pool" ? (node.primitiveConfig ?? {}) : {};
}

function includesWorkType(config: WorkerPrimitiveConfig, workType: string) {
  return config.workType === workType || config.workTypes?.includes(workType) === true;
}

function combineWorkerConfigs(configs: WorkerPrimitiveConfig[]) {
  return configs.reduce<WorkerPrimitiveConfig>(
    (combined, config) => mergeWorkerConfig(combined, config),
    {},
  );
}

function mergeWorkerConfig(base: WorkerPrimitiveConfig, override: WorkerPrimitiveConfig) {
  const mergedBatchPolicy = mergeWorkerBatchPolicy(base.batchPolicy, override.batchPolicy);
  return {
    ...base,
    ...override,
    batchPolicy: mergedBatchPolicy,
  };
}

function mergeWorkerBatchPolicy(
  base: WorkerBatchPolicyConfig | undefined,
  override: WorkerBatchPolicyConfig | undefined,
) {
  if (!base && !override) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}
