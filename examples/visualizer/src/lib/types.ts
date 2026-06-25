export type NodeKind = "publisher" | "subscriber" | "config" | "service" | "group";
export type PrimitiveType =
  | "source"
  | "queue"
  | "worker"
  | "timer"
  | "store"
  | "resource_pool"
  | "router"
  | "scheduler"
  | "transform"
  | "observer"
  | (string & {});

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type KnownPrimitiveType =
  | "source"
  | "queue"
  | "worker"
  | "timer"
  | "store"
  | "resource_pool";

export interface RangeConfig extends JsonObject {
  min?: number;
  max?: number;
}

export interface SourcePrimitiveConfig extends JsonObject {
  mode?: "random_interval" | "periodic" | "burst" | "scripted" | (string & {});
  entityType?: string;
  intervalMs?: RangeConfig;
  payloadTemplate?: JsonObject;
}

export interface QueuePrimitiveConfig extends JsonObject {
  capacity?: number;
  overflow?: "reject" | "backpressure" | "drop_newest" | "drop_oldest" | "conflate" | (string & {});
  ordering?: "fifo" | "lifo" | "priority" | (string & {});
  views?: string[];
}

export interface WorkerBatchPolicyConfig extends JsonObject {
  mode?: "same_work_type" | "by_key" | "none" | (string & {});
  key?: string;
  maxBatchSize?: number;
}

export interface WorkerPrimitiveConfig extends JsonObject {
  workerRole?: string;
  workType?: string;
  workTypes?: string[];
  selectionPolicy?: "urgency" | "fifo" | "fair" | (string & {});
  batchPolicy?: WorkerBatchPolicyConfig;
  ownership?: JsonObject;
  durations?: JsonObject;
  capacity?: number;
}

export interface TimerPrimitiveConfig extends JsonObject {
  mode?: "random_range" | "fixed" | "periodic" | (string & {});
  modes?: string[];
  durationMs?: RangeConfig;
  onExpire?: string;
}

export interface StorePrimitiveConfig extends JsonObject {
  entityType?: string;
  keyField?: string;
  indexes?: string[];
  partitionBy?: string;
  views?: string[];
}

export interface ResourcePoolPrimitiveConfig extends JsonObject {
  resourceType?: string;
  count?: number;
  partitionBy?: string;
  allocationPolicy?: string;
}

export interface GenericPrimitiveConfig extends JsonObject {}

export type PrimitiveConfig =
  | SourcePrimitiveConfig
  | QueuePrimitiveConfig
  | WorkerPrimitiveConfig
  | TimerPrimitiveConfig
  | StorePrimitiveConfig
  | ResourcePoolPrimitiveConfig
  | GenericPrimitiveConfig;

type UnspecializedPrimitiveType = Exclude<PrimitiveType, KnownPrimitiveType>;

export type PrimitiveMetadata =
  | {
      primitiveType?: undefined;
      instanceName?: undefined;
      primitiveConfig?: undefined;
    }
  | {
      primitiveType: "source";
      instanceName?: string;
      primitiveConfig?: SourcePrimitiveConfig;
    }
  | {
      primitiveType: "queue";
      instanceName?: string;
      primitiveConfig?: QueuePrimitiveConfig;
    }
  | {
      primitiveType: "worker";
      instanceName?: string;
      primitiveConfig?: WorkerPrimitiveConfig;
    }
  | {
      primitiveType: "timer";
      instanceName?: string;
      primitiveConfig?: TimerPrimitiveConfig;
    }
  | {
      primitiveType: "store";
      instanceName?: string;
      primitiveConfig?: StorePrimitiveConfig;
    }
  | {
      primitiveType: "resource_pool";
      instanceName?: string;
      primitiveConfig?: ResourcePoolPrimitiveConfig;
    }
  | {
      primitiveType: UnspecializedPrimitiveType;
      instanceName?: string;
      primitiveConfig?: GenericPrimitiveConfig;
    };

export type DeliveryMode =
  | "FireAndForget"
  | "AckNack"
  | "Optimistic"
  | "RequestReply"
  | "NotifyOnly"
  | "NotifyThenFetch";

export type OverflowPolicy =
  | "Backpressure"
  | "DropNewest"
  | "DropOldest"
  | "Conflate"
  | "RejectPublish";

export type ConflationPolicy =
  | "None"
  | "DropDuplicateAddress"
  | "DropDuplicatePayloadHash"
  | "KeepLatestByAddress"
  | "KeepLatestByKey"
  | "BatchWithin";

export type RecursionOverflowPolicy = "RejectPublish" | "Drop";

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoff: "Linear" | "Exponential";
  jitter: boolean;
}

export interface TimeoutPolicy {
  handlerTimeoutMs: number | null;
  deliveryDeadlineMs: number | null;
}

export interface RatePolicy {
  maxPerSecond: number | null;
  burst: number | null;
}

export interface TimingPolicy {
  debounceMs: number | null;
  throttleMs: number | null;
}

export interface QueuePolicy {
  maxDepth: number;
  overflow: OverflowPolicy;
}

export interface PayloadLimits {
  maxInlineBytes: number | null;
  maxDepth: number | null;
}

export interface RecursionPolicy {
  maxCausationDepth: number;
  onExceeded: RecursionOverflowPolicy;
}

export interface DeliveryOptions {
  mode: DeliveryMode;
  payloadStrategy: "SendPayload" | "NotifyOnly" | "NotifyThenFetch";
  retry: RetryPolicy;
  timeout: TimeoutPolicy;
  rate: RatePolicy;
  timing: TimingPolicy;
  conflation: ConflationPolicy;
  queue: QueuePolicy;
  payloadLimits: PayloadLimits;
  ordering: "None" | "PerSubscription" | "PerAddress" | "PerKey";
  recursion: RecursionPolicy;
}

export interface BusConfig {
  allowCatchAll: boolean;
  defaultQueueDepth: number;
  recursionPolicy: RecursionPolicy;
}

export interface PublishTrace {
  signalId: number;
  fromNodeId: string;
  address: string;
  payload: unknown;
  matchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  deliveries: DeliveryTrace[];
}

export interface DeliveryTrace {
  subscriberNodeId: string;
  expression: string;
  params: Record<string, string>;
  payload: unknown;
  accepted: boolean;
  reason?: string;
}

export interface SignalMetadata {
  timestamp: string;
  source?: string;
  correlationId?: string;
  causationId?: number;
  traceId?: string;
  priority: number;
  ttlMs?: number;
  schemaId?: string;
  contentType?: string;
}

export interface NodePort {
  id: string;
  side: "left" | "right";
  offset: number;
}

export type NodeBase = {
  id: string;
  kind: NodeKind;
  title: string;
  lastPulse: number;
  note?: string;
  isActive?: boolean;
  activityLabel?: string;
  activityValue?: string;
  activityTone?: "sent" | "received" | "service" | "dropped";
  ports?: NodePort[];
} & PrimitiveMetadata;

export interface PublisherNodeData extends NodeBase {
  kind: "publisher";
  address: string;
  payloadText: string;
  signalKind: "Event" | "Command" | "State" | "Notice" | "Custom";
  customSignalKind: string;
  metadata: SignalMetadata;
  lastPublish?: PublishTrace | null;
}

export interface SubscriberNodeData extends NodeBase {
  kind: "subscriber";
  expression: string;
  schemaId: string;
  delivery: DeliveryOptions;
  received: DeliveryTrace[];
  configurationExpression: string;
  queueDepth: number;
  queueLabel?: string;
  queueItems?: string[];
}

export interface ConfigNodeData extends NodeBase {
  kind: "config";
  allowCatchAll: boolean;
  defaultQueueDepth: number;
  recursionPolicy: RecursionPolicy;
}

export interface ServiceNodeData extends NodeBase {
  kind: "service";
  address: string;
  serviceName: string;
  queueLabel?: string;
  queueItems?: string[];
}

export interface GroupNodeData extends NodeBase {
  kind: "group";
  tone?: string;
}

export type DemoNodeData =
  | PublisherNodeData
  | SubscriberNodeData
  | ConfigNodeData
  | ServiceNodeData
  | GroupNodeData;

export interface MatchRecord {
  subscriberNodeId: string;
  expression: string;
  params: Record<string, string>;
  specificity: Specificity;
  registrationOrder: number;
}

export interface PublishError {
  message: string;
}

export interface Specificity {
  literalSegments: number;
  dynamicSegments: number;
  wildcardSegments: number;
  recursiveSegments: number;
  recursiveConsumed: number;
  registrationOrder: number;
}
