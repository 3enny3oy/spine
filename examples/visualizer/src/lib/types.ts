export type NodeKind = "publisher" | "subscriber" | "config" | "service";

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
};

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

export type DemoNodeData =
  | PublisherNodeData
  | SubscriberNodeData
  | ConfigNodeData
  | ServiceNodeData;

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
