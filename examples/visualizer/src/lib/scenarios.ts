import type { Node } from "@xyflow/react";
import type { DemoNodeData } from "./types";

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
}

export interface ScenarioEdgeData {
  lane: number;
  active?: boolean;
  label?: string;
  orientation?: "row" | "wrap";
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

export function cloneCafeConfig(config: CafeScenarioConfig): CafeScenarioConfig {
  return {
    ...config,
    dishes: config.dishes.map((dish) => ({ ...dish })),
  };
}

export function scenarioEdgesForNodes(
  edges: ScenarioEdgeDefinition[],
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
  activeMessages?: Map<string, string>,
) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, number>();

  return edges
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
