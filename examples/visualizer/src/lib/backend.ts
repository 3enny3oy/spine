import type { Node } from "@xyflow/react";
import type {
  ConfigNodeData,
  DemoNodeData,
  DeliveryOptions,
  DeliveryTrace,
  PublishTrace,
} from "./types";
import type { ScenarioDefinition, ScenarioOption } from "./scenarios";

const API_ROOT = "/api";

export interface RouteEdge {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  label?: string;
  data?: { accepted: boolean };
}

export interface BackendSnapshot {
  scenarioId: string;
  scenario: ScenarioDefinition;
  config: ConfigNodeData;
  nodes: Node<DemoNodeData>[];
  publishHistory: PublishTrace[];
  routes: RouteEdge[];
  lastError: string | null;
}

export type ConfigPatch = Partial<Pick<ConfigNodeData, "title" | "allowCatchAll" | "defaultQueueDepth">> & {
  recursionPolicy?: Partial<ConfigNodeData["recursionPolicy"]>;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<T>;
}

async function readError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = await response.json();
      if (typeof body === "object" && body && "error" in body && typeof body.error === "string") {
        return body.error;
      }
    } catch {
      // Fall through to text handling.
    }
  }
  const text = await response.text();
  return text || response.statusText || "Request failed";
}

function encodeForm(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    params.set(key, value);
  }
  return params.toString();
}

function encodeNode(node: DemoNodeData): string {
  const primitiveFields = {
    primitive_type: node.primitiveType ?? "",
    instance_name: node.instanceName ?? "",
    primitive_config: node.primitiveConfig ? JSON.stringify(node.primitiveConfig) : "",
  };

  switch (node.kind) {
    case "publisher":
      return encodeForm({
        ...primitiveFields,
        title: node.title,
        address: node.address,
        payload_text: node.payloadText,
        signal_kind: node.signalKind,
        custom_signal_kind: node.customSignalKind,
      });
    case "subscriber":
      return encodeForm({
        ...primitiveFields,
        title: node.title,
        expression: node.expression,
        schema_id: node.schemaId,
        queue_depth: String(node.queueDepth),
        delivery_mode: node.delivery.mode,
        payload_strategy: node.delivery.payloadStrategy,
        overflow: node.delivery.queue.overflow,
        debounce_ms: node.delivery.timing.debounceMs ? String(node.delivery.timing.debounceMs) : "",
        throttle_ms: node.delivery.timing.throttleMs ? String(node.delivery.timing.throttleMs) : "",
        configuration_expression: node.configurationExpression,
      });
    case "config":
      return encodeConfigPatch({
        title: node.title,
        allowCatchAll: node.allowCatchAll,
        defaultQueueDepth: node.defaultQueueDepth,
        recursionPolicy: node.recursionPolicy,
      });
    case "service":
      return encodeForm({
        ...primitiveFields,
        title: node.title,
        address: node.address,
        service_name: node.serviceName,
      });
    case "group":
      throw new Error("group nodes are visual-only and cannot be persisted through the backend");
  }
}

function encodeConfigPatch(patch: ConfigPatch): string {
  const fields: Record<string, string> = {};
  if (patch.title !== undefined) {
    fields.title = patch.title;
  }
  if (patch.allowCatchAll !== undefined) {
    fields.allow_catch_all = String(patch.allowCatchAll);
  }
  if (patch.defaultQueueDepth !== undefined) {
    fields.default_queue_depth = String(patch.defaultQueueDepth);
  }
  if (patch.recursionPolicy?.maxCausationDepth !== undefined) {
    fields.recursion_depth = String(patch.recursionPolicy.maxCausationDepth);
  }
  if (patch.recursionPolicy?.onExceeded !== undefined) {
    fields.on_exceeded = patch.recursionPolicy.onExceeded;
  }
  return encodeForm(fields);
}

export async function loadSnapshot(): Promise<BackendSnapshot> {
  return requestJson<BackendSnapshot>("/state", { method: "GET" });
}

export function subscribeSnapshots(
  onSnapshot: (snapshot: BackendSnapshot) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(`${API_ROOT}/events`);
  source.addEventListener("state", (event) => {
    const message = event as MessageEvent<string>;
    try {
      onSnapshot(JSON.parse(message.data) as BackendSnapshot);
    } catch {
      onError?.("Failed to parse backend snapshot");
    }
  });
  source.onerror = () => {
    onError?.("Lost connection to the Rust backend");
  };
  return () => source.close();
}

export async function createNode(kind: "publisher" | "subscriber" | "config" | "service") {
  return requestJson<BackendSnapshot>("/nodes", {
    method: "POST",
    body: encodeForm({ kind }),
  });
}

export async function updateNode(node: DemoNodeData) {
  return requestJson<BackendSnapshot>(`/nodes/${encodeURIComponent(node.id)}`, {
    method: "POST",
    body: encodeNode(node),
  });
}

export async function updateConfig(patch: ConfigPatch) {
  return requestJson<BackendSnapshot>("/config", {
    method: "POST",
    body: encodeConfigPatch(patch),
  });
}

export async function loadScenario(scenarioId: string) {
  return requestJson<BackendSnapshot>("/scenarios/load", {
    method: "POST",
    body: encodeForm({ scenarioId }),
  });
}

export async function loadScenarioCatalog() {
  return requestJson<ScenarioOption[]>("/scenarios", { method: "GET" });
}

export async function saveScenario(scenarioId: string) {
  return requestJson<BackendSnapshot>("/scenarios/save", {
    method: "POST",
    body: encodeForm({ scenarioId }),
  });
}

export async function publishFromPublisher(publisherId: string) {
  return requestJson<BackendSnapshot>("/publish", {
    method: "POST",
    body: encodeForm({ publisherId }),
  });
}

export async function publishCustomSignal(nodeId: string, address: string, payloadText: string) {
  return requestJson<BackendSnapshot>("/publish/custom", {
    method: "POST",
    body: encodeForm({ nodeId, address, payloadText }),
  });
}

export function formatPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}

export function formatDeliveryOptions(options: DeliveryOptions): string {
  return [
    options.mode,
    options.payloadStrategy,
    options.queue.overflow,
    `depth:${options.queue.maxDepth}`,
  ].join(" · ");
}

export function toDeliverySummary(delivery: DeliveryTrace): string {
  return delivery.accepted ? "accepted" : "dropped";
}
