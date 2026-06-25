import type { WorkerPrimitiveConfig } from "./types";

export interface WorkerCandidate<T> {
  item: T;
  workType: string;
  createdAtMs: number;
  urgencyScore?: number;
  batchKey?: string | null;
  fairnessKey?: string | null;
}

export interface WorkerSelectionCursor {
  lastFairnessKey?: string | null;
}

export interface WorkerBatchSelection<T> {
  items: T[];
  cursor: WorkerSelectionCursor;
}

export interface SelectWorkerBatchOptions<T> {
  config?: WorkerPrimitiveConfig | null;
  candidates: WorkerCandidate<T>[];
  cursor?: WorkerSelectionCursor | null;
  batchCapacityForSeed?: (seed: WorkerCandidate<T>) => number | null | undefined;
}

export function selectWorkerBatch<T>({
  config,
  candidates,
  cursor,
  batchCapacityForSeed,
}: SelectWorkerBatchOptions<T>): WorkerBatchSelection<T> {
  if (candidates.length === 0) {
    return { items: [], cursor: { lastFairnessKey: cursor?.lastFairnessKey ?? null } };
  }

  const selectionPolicy = config?.selectionPolicy ?? "fifo";
  const seed = pickSeedCandidate(candidates, selectionPolicy, cursor);
  if (!seed) {
    return { items: [], cursor: { lastFairnessKey: cursor?.lastFairnessKey ?? null } };
  }

  const mode = config?.batchPolicy?.mode ?? "none";
  const compatible = candidates.filter((candidate) => isBatchCompatible(seed, candidate, mode));
  const orderedCompatible =
    selectionPolicy === "urgency"
      ? [...compatible].sort(compareByUrgency)
      : [...compatible].sort(compareByCreatedAt);

  const limit = resolveBatchLimit(config, seed, batchCapacityForSeed);
  const selected = orderedCompatible.slice(0, limit);

  return {
    items: selected.map((candidate) => candidate.item),
    cursor: {
      lastFairnessKey: candidateFairnessKey(seed),
    },
  };
}

function pickSeedCandidate<T>(
  candidates: WorkerCandidate<T>[],
  selectionPolicy: WorkerPrimitiveConfig["selectionPolicy"],
  cursor: WorkerSelectionCursor | null | undefined,
) {
  if (selectionPolicy === "urgency") {
    return [...candidates].sort(compareByUrgency)[0] ?? null;
  }

  if (selectionPolicy === "fair") {
    return pickFairSeed(candidates, cursor);
  }

  return [...candidates].sort(compareByCreatedAt)[0] ?? null;
}

function pickFairSeed<T>(candidates: WorkerCandidate<T>[], cursor: WorkerSelectionCursor | null | undefined) {
  const buckets = new Map<string, WorkerCandidate<T>[]>();
  for (const candidate of candidates) {
    const key = candidateFairnessKey(candidate);
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }

  const orderedKeys = Array.from(buckets.entries())
    .sort((left, right) => {
      const leftOldest = left[1].reduce((oldest, candidate) => Math.min(oldest, candidate.createdAtMs), Number.POSITIVE_INFINITY);
      const rightOldest = right[1].reduce((oldest, candidate) => Math.min(oldest, candidate.createdAtMs), Number.POSITIVE_INFINITY);
      return leftOldest - rightOldest;
    })
    .map(([key]) => key);

  if (orderedKeys.length === 0) {
    return null;
  }

  const lastKey = cursor?.lastFairnessKey ?? null;
  const startIndex = lastKey ? orderedKeys.indexOf(lastKey) : -1;
  const rotatedKeys =
    startIndex >= 0
      ? [...orderedKeys.slice(startIndex + 1), ...orderedKeys.slice(0, startIndex + 1)]
      : orderedKeys;
  const nextKey = rotatedKeys[0];
  if (!nextKey) {
    return null;
  }

  return [...(buckets.get(nextKey) ?? [])].sort(compareByCreatedAt)[0] ?? null;
}

function resolveBatchLimit<T>(
  config: WorkerPrimitiveConfig | null | undefined,
  seed: WorkerCandidate<T>,
  batchCapacityForSeed?: (seed: WorkerCandidate<T>) => number | null | undefined,
) {
  const configLimit = normalizePositiveInteger(config?.batchPolicy?.maxBatchSize) ?? normalizePositiveInteger(config?.capacity);
  const seedLimit = normalizePositiveInteger(batchCapacityForSeed?.(seed));
  const combinedLimit = [configLimit, seedLimit]
    .filter((value): value is number => value !== null)
    .reduce((smallest, value) => Math.min(smallest, value), Number.POSITIVE_INFINITY);

  return Number.isFinite(combinedLimit) ? combinedLimit : defaultBatchLimit(config?.batchPolicy?.mode ?? "none");
}

function defaultBatchLimit(mode: string) {
  return mode === "none" ? 1 : Number.POSITIVE_INFINITY;
}

function isBatchCompatible<T>(seed: WorkerCandidate<T>, candidate: WorkerCandidate<T>, mode: string) {
  if (mode === "same_work_type") {
    return candidate.workType === seed.workType;
  }
  if (mode === "by_key") {
    return seed.batchKey !== undefined && seed.batchKey !== null && seed.batchKey === candidate.batchKey;
  }
  return candidate === seed;
}

function candidateFairnessKey<T>(candidate: WorkerCandidate<T>) {
  return candidate.fairnessKey ?? candidate.workType;
}

function compareByCreatedAt<T>(left: WorkerCandidate<T>, right: WorkerCandidate<T>) {
  return left.createdAtMs - right.createdAtMs;
}

function compareByUrgency<T>(left: WorkerCandidate<T>, right: WorkerCandidate<T>) {
  const urgencyDelta = (right.urgencyScore ?? 0) - (left.urgencyScore ?? 0);
  if (urgencyDelta !== 0) {
    return urgencyDelta;
  }
  return left.createdAtMs - right.createdAtMs;
}

function normalizePositiveInteger(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(value));
}
