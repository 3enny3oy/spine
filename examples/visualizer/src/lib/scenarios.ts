import type { Node } from "@xyflow/react";
import type { DemoNodeData } from "./types";

export type ScenarioId = "blank" | "cafe-pipeline";

export interface ScenarioOption {
  id: ScenarioId;
  title: string;
  description: string;
  supportsSimulation: boolean;
}

export interface ScenarioEdgeDefinition {
  id: string;
  source: string;
  target: string;
}

export interface ScenarioEdgeData {
  lane: number;
  active?: boolean;
  label?: string;
  orientation?: "row" | "wrap";
}

export interface ScenarioNodePlacement {
  column: number;
  row: number;
}

export interface ScenarioGraphDefinition {
  placements: Record<string, ScenarioNodePlacement>;
  edges: ScenarioEdgeDefinition[];
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

export const SCENARIO_OPTIONS: ScenarioOption[] = [
  {
    id: "cafe-pipeline",
    title: "Cafe pipeline",
    description: "Queue, waiter pool, kitchen stages, billing, and turnover driven through the bus.",
    supportsSimulation: true,
  },
  {
    id: "blank",
    title: "Blank canvas",
    description: "Empty workspace with only the shared bus configuration node.",
    supportsSimulation: false,
  },
];

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

export const DEFAULT_CAFE_SCENARIO_CONFIG: CafeScenarioConfig = {
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

export const SCENARIO_GRAPHS: Record<ScenarioId, ScenarioGraphDefinition> = {
  blank: {
    placements: {
      "config-1": { column: 0, row: 0 },
    },
    edges: [],
  },
  "cafe-pipeline": {
    placements: {
      "config-1": { column: 0, row: 0 },
      "publisher-arrivals": { column: 0, row: 1 },
      "subscriber-front-door": { column: 1, row: 1 },
      "publisher-queue": { column: 2, row: 1 },
      "subscriber-queue": { column: 3, row: 1 },
      "publisher-concierge": { column: 4, row: 1 },
      "publisher-waiter-router": { column: 5, row: 1 },
      "subscriber-router": { column: 6, row: 1 },
      "service-waiter-pool": { column: 7, row: 1 },
      "publisher-seating": { column: 0, row: 3 },
      "subscriber-tables": { column: 1, row: 3 },
      "publisher-menu": { column: 2, row: 3 },
      "service-menu-catalog": { column: 3, row: 3 },
      "publisher-diner": { column: 4, row: 3 },
      "publisher-order": { column: 5, row: 3 },
      "subscriber-orders": { column: 6, row: 3 },
      "publisher-kitchen": { column: 0, row: 5 },
      "subscriber-kitchen": { column: 1, row: 5 },
      "publisher-service": { column: 2, row: 5 },
      "publisher-billing": { column: 3, row: 5 },
      "subscriber-billing": { column: 4, row: 5 },
      "publisher-turnover": { column: 5, row: 5 },
      "publisher-departures": { column: 6, row: 5 },
    },
    edges: [
      { id: "arrivals-front-door", source: "publisher-arrivals", target: "subscriber-front-door" },
      { id: "front-door-queue", source: "subscriber-front-door", target: "publisher-queue" },
      { id: "queue-queue-rules", source: "publisher-queue", target: "subscriber-queue" },
      { id: "queue-concierge", source: "subscriber-queue", target: "publisher-concierge" },
      { id: "concierge-router", source: "publisher-concierge", target: "publisher-waiter-router" },
      { id: "router-requests", source: "publisher-waiter-router", target: "subscriber-router" },
      { id: "requests-waiter-pool", source: "subscriber-router", target: "service-waiter-pool" },
      { id: "waiter-pool-seating", source: "service-waiter-pool", target: "publisher-seating" },
      { id: "seating-tables", source: "publisher-seating", target: "subscriber-tables" },
      { id: "tables-menu", source: "subscriber-tables", target: "publisher-menu" },
      { id: "menu-catalog", source: "publisher-menu", target: "service-menu-catalog" },
      { id: "catalog-diner", source: "service-menu-catalog", target: "publisher-diner" },
      { id: "diner-order", source: "publisher-diner", target: "publisher-order" },
      { id: "order-intake", source: "publisher-order", target: "subscriber-orders" },
      { id: "orders-kitchen", source: "subscriber-orders", target: "publisher-kitchen" },
      { id: "kitchen-stages", source: "publisher-kitchen", target: "subscriber-kitchen" },
      { id: "kitchen-service", source: "subscriber-kitchen", target: "publisher-service" },
      { id: "service-billing", source: "publisher-service", target: "publisher-billing" },
      { id: "billing-queue", source: "publisher-billing", target: "subscriber-billing" },
      { id: "billing-turnover", source: "subscriber-billing", target: "publisher-turnover" },
      { id: "turnover-departures", source: "publisher-turnover", target: "publisher-departures" },
    ],
  },
};

export function cloneCafeConfig(config: CafeScenarioConfig): CafeScenarioConfig {
  return {
    ...config,
    dishes: config.dishes.map((dish) => ({ ...dish })),
  };
}

export function layoutNodesForScenario<T extends { id: string; position: { x: number; y: number } }>(
  scenarioId: ScenarioId,
  nodes: T[],
): T[] {
  const definition = SCENARIO_GRAPHS[scenarioId];
  if (!definition) {
    return nodes;
  }
  const columnWidth = 320;
  const rowHeight = 260;
  const startX = 80;
  const startY = 80;
  return nodes.map((node) => {
    const placement = definition.placements[node.id];
    if (!placement) {
      return node;
    }
    return {
      ...node,
      position: {
        x: startX + placement.column * columnWidth,
        y: startY + placement.row * rowHeight,
      },
    };
  });
}

export function scenarioEdgesForNodes(
  scenarioId: ScenarioId,
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
  activeMessages?: Map<string, string>,
) {
  const definition = SCENARIO_GRAPHS[scenarioId];
  if (!definition) {
    return [];
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, number>();

  return definition.edges
    .filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .map((edge) => {
      const source = nodeMap.get(edge.source)!;
      const target = nodeMap.get(edge.target)!;
      const sameRow = Math.abs(source.position.y - target.position.y) < 2;
      const corridorKey = `${source.position.x}->${target.position.x}`;
      const lane = groups.get(corridorKey) ?? 0;
      groups.set(corridorKey, lane + 1);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: "right",
        targetHandle: "left",
        type: "scenarioManhattan" as const,
        data: {
          lane,
          active: activeMessages?.has(`${edge.source}->${edge.target}`) ?? false,
          label: activeMessages?.get(`${edge.source}->${edge.target}`),
          orientation: sameRow ? "row" : "wrap",
        },
      };
    });
}

export function decorateNodesWithCafeQueues(
  nodes: DemoNodeData[],
  queueState: CafeQueueSnapshot,
): DemoNodeData[] {
  return nodes.map((node) => {
    if (node.kind === "subscriber") {
      switch (node.id) {
        case "subscriber-queue":
          return { ...node, queueLabel: "Customers waiting", queueItems: queueState.queueCustomers };
        case "subscriber-router":
          return { ...node, queueLabel: "Pending waiter tasks", queueItems: queueState.pendingWaiterTasks };
        case "subscriber-orders":
          return { ...node, queueLabel: "Orders ready", queueItems: queueState.readyOrders };
        case "subscriber-kitchen":
          return { ...node, queueLabel: "Kitchen tickets", queueItems: queueState.kitchenTickets };
        case "subscriber-billing":
          return { ...node, queueLabel: "Bills waiting", queueItems: queueState.waitingBills };
        case "subscriber-tables":
          return { ...node, queueLabel: "Occupied tables", queueItems: queueState.activeTables };
        default:
          return node;
      }
    }
    if (node.kind === "service" && node.id === "service-waiter-pool") {
      return { ...node, queueLabel: "Active tasks", queueItems: queueState.pendingWaiterTasks };
    }
    return node;
  });
}

export function decorateScenarioNodesWithCafeQueues(
  nodes: Node<DemoNodeData>[],
  queueState: CafeQueueSnapshot,
): Node<DemoNodeData>[] {
  return nodes.map((node) => ({
    ...node,
    data: decorateNodesWithCafeQueues([node.data], queueState)[0] ?? node.data,
  }));
}
