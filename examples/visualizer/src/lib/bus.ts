import type {
  BusConfig,
  DeliveryOptions,
  DeliveryTrace,
  MatchRecord,
  PublishTrace,
  Specificity,
  SubscriberNodeData,
  PublisherNodeData,
  DemoNodeData,
  ConfigNodeData,
} from "./types";

const ALLOWED_SEGMENT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";

type ExpressionSegment =
  | { type: "literal"; value: string }
  | { type: "dynamic"; name: string }
  | { type: "wildcard" }
  | { type: "recursive" };

interface ParsedExpression {
  canonical: string;
  segments: ExpressionSegment[];
}

interface ParsedAddress {
  canonical: string;
  segments: string[];
}

export interface RouteSnapshot {
  matches: MatchRecord[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    animated: boolean;
    label?: string;
    data?: { accepted: boolean };
  }>;
}

export function defaultDeliveryOptions(): DeliveryOptions {
  return {
    mode: "FireAndForget",
    payloadStrategy: "SendPayload",
    retry: {
      maxAttempts: 0,
      initialDelayMs: 0,
      maxDelayMs: 0,
      backoff: "Exponential",
      jitter: false,
    },
    timeout: {
      handlerTimeoutMs: null,
      deliveryDeadlineMs: null,
    },
    rate: {
      maxPerSecond: null,
      burst: null,
    },
    timing: {
      debounceMs: null,
      throttleMs: null,
    },
    conflation: "None",
    queue: {
      maxDepth: 1024,
      overflow: "RejectPublish",
    },
    payloadLimits: {
      maxInlineBytes: null,
      maxDepth: null,
    },
    ordering: "PerSubscription",
    recursion: {
      maxCausationDepth: 32,
      onExceeded: "RejectPublish",
    },
  };
}

export function defaultBusConfig(): BusConfig {
  return {
    allowCatchAll: false,
    defaultQueueDepth: 1024,
    recursionPolicy: {
      maxCausationDepth: 32,
      onExceeded: "RejectPublish",
    },
  };
}

export function defaultPublisherNode(id: string, x: number, y: number): PublisherNodeData {
  return {
    id,
    kind: "publisher",
    title: "Publisher",
    lastPulse: 0,
    address: "documents/doc-1/blocks/block-9/changed",
    payloadText: JSON.stringify(
      {
        blockId: "block-9",
        revision: 42,
        text: "Hello from SPINE",
      },
      null,
      2,
    ),
    signalKind: "Event",
    customSignalKind: "",
    metadata: {
      timestamp: new Date().toISOString(),
      priority: 0,
    },
    note: "Publish from here",
  };
}

export function defaultSubscriberNode(
  id: string,
  x: number,
  y: number,
  expression: string,
  title: string,
): SubscriberNodeData {
  return {
    id,
    kind: "subscriber",
    title,
    lastPulse: 0,
    expression,
    schemaId: "document.block.changed.v1",
    delivery: defaultDeliveryOptions(),
    received: [],
    configurationExpression: "",
    queueDepth: 8,
    note: "Receives only matching signals",
  };
}

export function defaultConfigNode(id: string, x: number, y: number): ConfigNodeData {
  return {
    id,
    kind: "config",
    title: "Bus Config",
    lastPulse: 0,
    allowCatchAll: false,
    defaultQueueDepth: 1024,
    recursionPolicy: {
      maxCausationDepth: 32,
      onExceeded: "RejectPublish",
    },
    note: "Global delivery controls",
  };
}

export function defaultServiceNode(id: string, x: number, y: number): ServiceNodeData {
  return {
    id,
    kind: "service",
    title: "Service",
    lastPulse: 0,
    address: "services/search/default",
    serviceName: "SearchService",
    note: "Lookup through address space",
  };
}

export function parseAddress(input: string): ParsedAddress {
  if (!input) {
    throw new Error("address is empty");
  }
  if (input.startsWith("/") || input.endsWith("/")) {
    throw new Error("leading or trailing slash is not allowed");
  }
  if (input.includes("//")) {
    throw new Error("empty segments are not allowed");
  }
  const segments = input.split("/");
  if (segments.length === 0) {
    throw new Error("address must contain at least one segment");
  }
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("invalid address segment");
    }
    if ([...segment].some((char) => !ALLOWED_SEGMENT_CHARS.includes(char))) {
      throw new Error(`invalid address segment: ${segment}`);
    }
    if (segment.includes("{") || segment.includes("}") || segment.includes("*")) {
      throw new Error("address may not contain expression syntax");
    }
  }
  return { canonical: segments.join("/"), segments };
}

export function parseExpression(input: string, allowCatchAll: boolean): ParsedExpression {
  if (!input) {
    throw new Error("expression is empty");
  }
  if (input.startsWith("/") || input.endsWith("/")) {
    throw new Error("leading or trailing slash is not allowed");
  }
  if (input.includes("//")) {
    throw new Error("empty segments are not allowed");
  }
  const rawSegments = input.split("/");
  const segments: ExpressionSegment[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawSegments.length; index += 1) {
    const raw = rawSegments[index];
    if (raw === "*") {
      segments.push({ type: "wildcard" });
      continue;
    }
    if (raw === "**") {
      if (!allowCatchAll) {
        throw new Error("catch-all expressions are disabled");
      }
      if (index !== rawSegments.length - 1) {
        throw new Error("recursive wildcard must be final");
      }
      segments.push({ type: "recursive" });
      continue;
    }
    if (raw.startsWith("{") && raw.endsWith("}")) {
      const name = raw.slice(1, -1);
      if (!name) {
        throw new Error("dynamic variable name is empty");
      }
      if (name === "." || name === "..") {
        throw new Error("traversal-like variable names are not allowed");
      }
      if ([...name].some((char) => !ALLOWED_SEGMENT_CHARS.includes(char))) {
        throw new Error(`invalid dynamic variable name: ${name}`);
      }
      if (seen.has(name)) {
        throw new Error(`duplicate dynamic variable name: ${name}`);
      }
      seen.add(name);
      segments.push({ type: "dynamic", name });
      continue;
    }
    if ([...raw].some((char) => !ALLOWED_SEGMENT_CHARS.includes(char))) {
      throw new Error(`invalid expression literal: ${raw}`);
    }
    if (raw.includes("{") || raw.includes("}") || raw.includes("*")) {
      throw new Error("literal expression segments may not contain expression syntax");
    }
    segments.push({ type: "literal", value: raw });
  }
  return {
    canonical: segments
      .map((segment) => {
        switch (segment.type) {
          case "literal":
            return segment.value;
          case "dynamic":
            return `{${segment.name}}`;
          case "wildcard":
            return "*";
          case "recursive":
            return "**";
        }
      })
      .join("/"),
    segments,
  };
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  const fields: Array<[number, number, boolean]> = [
    [a.literalSegments, b.literalSegments, true],
    [a.dynamicSegments, b.dynamicSegments, true],
    [a.wildcardSegments, b.wildcardSegments, false],
    [a.recursiveSegments, b.recursiveSegments, false],
    [a.recursiveConsumed, b.recursiveConsumed, true],
    [a.registrationOrder, b.registrationOrder, false],
  ];
  for (const [left, right, higherIsBetter] of fields) {
    if (left !== right) {
      return higherIsBetter ? right - left : left - right;
    }
  }
  return 0;
}

export function matchExpression(
  expression: string,
  address: string,
  allowCatchAll: boolean,
  registrationOrder: number,
): MatchRecord | null {
  let parsedExpression: ParsedExpression;
  let parsedAddress: ParsedAddress;
  try {
    parsedExpression = parseExpression(expression, allowCatchAll);
    parsedAddress = parseAddress(address);
  } catch {
    return null;
  }
  const params: Record<string, string> = {};
  let addressIndex = 0;
  let literalSegments = 0;
  let dynamicSegments = 0;
  let wildcardSegments = 0;
  let recursiveSegments = 0;
  let recursiveConsumed = 0;

  for (let index = 0; index < parsedExpression.segments.length; index += 1) {
    const segment = parsedExpression.segments[index];
    if (segment.type === "literal") {
      if (parsedAddress.segments[addressIndex] !== segment.value) {
        return null;
      }
      literalSegments += 1;
      addressIndex += 1;
      continue;
    }
    if (segment.type === "dynamic") {
      const value = parsedAddress.segments[addressIndex];
      if (value === undefined) {
        return null;
      }
      params[segment.name] = value;
      dynamicSegments += 1;
      addressIndex += 1;
      continue;
    }
    if (segment.type === "wildcard") {
      if (parsedAddress.segments[addressIndex] === undefined) {
        return null;
      }
      wildcardSegments += 1;
      addressIndex += 1;
      continue;
    }
    if (segment.type === "recursive") {
      recursiveSegments += 1;
      recursiveConsumed = parsedAddress.segments.length - addressIndex;
      addressIndex = parsedAddress.segments.length;
    }
  }

  if (addressIndex !== parsedAddress.segments.length) {
    return null;
  }

  return {
    subscriberNodeId: "",
    expression: parsedExpression.canonical,
    params,
    specificity: {
      literalSegments,
      dynamicSegments,
      wildcardSegments,
      recursiveSegments,
      recursiveConsumed,
      registrationOrder,
    },
    registrationOrder,
  };
}

export function routeGraph(
  nodes: DemoNodeData[],
  busConfig: BusConfig,
): RouteSnapshot {
  const publishers = nodes.filter((node): node is PublisherNodeData => node.kind === "publisher");
  const subscribers = nodes.filter((node): node is SubscriberNodeData => node.kind === "subscriber");
  const matches: MatchRecord[] = [];
  const edges: RouteSnapshot["edges"] = [];

  for (const publisher of publishers) {
    const publisherMatches: MatchRecord[] = [];
    for (const [index, subscriber] of subscribers.entries()) {
      const route = matchExpression(
        subscriber.expression,
        publisher.address,
        busConfig.allowCatchAll,
        index + 1,
      );
      if (!route) {
        continue;
      }
      const enriched: MatchRecord = {
        ...route,
        subscriberNodeId: subscriber.id,
      };
      publisherMatches.push(enriched);
      matches.push(enriched);
    }
    publisherMatches.sort((left, right) => compareSpecificity(left.specificity, right.specificity));
    for (const match of publisherMatches) {
      edges.push({
        id: `${publisher.id}-${match.subscriberNodeId}`,
        source: publisher.id,
        target: match.subscriberNodeId,
        animated: true,
        label: Object.entries(match.params)
          .map(([key, value]) => `${key}=${value}`)
          .join(", "),
        data: { accepted: true },
      });
    }
  }

  return { matches, edges };
}

function parsePayload(payloadText: string): unknown {
  if (!payloadText.trim()) {
    return null;
  }
  try {
    return JSON.parse(payloadText);
  } catch {
    return payloadText;
  }
}

export function publishFromPublisher(
  nodes: DemoNodeData[],
  busConfig: BusConfig,
  publisherId: string,
  signalId: number,
): { nodes: DemoNodeData[]; trace: PublishTrace } {
  const publisher = nodes.find((node): node is PublisherNodeData => node.id === publisherId && node.kind === "publisher");
  if (!publisher) {
    throw new Error("publisher not found");
  }

  const payload = parsePayload(publisher.payloadText);
  const subscribers = nodes.filter((node): node is SubscriberNodeData => node.kind === "subscriber");
  const deliveries: DeliveryTrace[] = [];

  const matching = subscribers
    .map((subscriber, index) => {
      const route = matchExpression(subscriber.expression, publisher.address, busConfig.allowCatchAll, index + 1);
      if (!route) {
        return null;
      }
      return {
        subscriber,
        route,
      };
    })
    .filter((item): item is { subscriber: SubscriberNodeData; route: MatchRecord } => item !== null)
    .sort((left, right) => compareSpecificity(right.route.specificity, left.route.specificity));

  if (matching.length === 0 && publisher.address.trim() && !publisher.address.includes("/")) {
    // fall through: invalid route shapes are surfaced in the trace as no matches
  }

  const nextNodes = nodes.map((node) => {
    if (node.id === publisher.id) {
      return {
        ...node,
        lastPulse: Date.now(),
      } satisfies DemoNodeData;
    }
    const match = matching.find((item) => item.subscriber.id === node.id);
    if (!match || node.kind !== "subscriber") {
      return node;
    }
    const queueDepth = Math.max(node.queueDepth, node.delivery.queue.maxDepth);
    const accepted = node.received.length < queueDepth;
    const delivery: DeliveryTrace = {
      subscriberNodeId: node.id,
      expression: node.expression,
      params: match.route.params,
      payload,
      accepted,
      reason: accepted ? undefined : `Queue overflow (${node.delivery.queue.overflow})`,
    };
    deliveries.push(delivery);
    return {
      ...node,
      lastPulse: Date.now(),
      received: accepted ? [delivery, ...node.received].slice(0, 8) : node.received,
    } satisfies DemoNodeData;
  });

  const trace: PublishTrace = {
    signalId,
    fromNodeId: publisher.id,
    address: publisher.address,
    payload,
    matchedCount: matching.length,
    acceptedCount: deliveries.filter((item) => item.accepted).length,
    rejectedCount: deliveries.filter((item) => !item.accepted).length,
    deliveries,
  };

  return { nodes: nextNodes, trace };
}

export function applyBusConfiguration(
  nodes: DemoNodeData[],
  config: BusConfig,
): BusConfig {
  const configNode = nodes.find((node): node is ConfigNodeData => node.kind === "config");
  if (!configNode) {
    return config;
  }
  return {
    allowCatchAll: configNode.allowCatchAll,
    defaultQueueDepth: configNode.defaultQueueDepth,
    recursionPolicy: configNode.recursionPolicy,
  };
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

export function updateSubscriberDelivery(
  subscriber: SubscriberNodeData,
  patch: Partial<DeliveryOptions>,
): SubscriberNodeData {
  return {
    ...subscriber,
    delivery: {
      ...subscriber.delivery,
      ...patch,
      queue: {
        ...subscriber.delivery.queue,
        ...(patch.queue ?? {}),
      },
      retry: {
        ...subscriber.delivery.retry,
        ...(patch.retry ?? {}),
      },
      timeout: {
        ...subscriber.delivery.timeout,
        ...(patch.timeout ?? {}),
      },
      rate: {
        ...subscriber.delivery.rate,
        ...(patch.rate ?? {}),
      },
      timing: {
        ...subscriber.delivery.timing,
        ...(patch.timing ?? {}),
      },
      payloadLimits: {
        ...subscriber.delivery.payloadLimits,
        ...(patch.payloadLimits ?? {}),
      },
      recursion: {
        ...subscriber.delivery.recursion,
        ...(patch.recursion ?? {}),
      },
    },
  };
}
