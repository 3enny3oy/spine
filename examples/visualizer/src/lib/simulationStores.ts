export interface SimulationEntityRecord {
  id: string;
}

export interface SimulationEntityStore<T extends SimulationEntityRecord> {
  records: Map<string, T>;
}

export type SimulationWorkItemStatus = "open" | "claimed";

export interface SimulationWorkItem<
  TWorkType extends string = string,
  TSubjectId extends string = string,
  TWorkerId extends string = string,
> extends SimulationEntityRecord {
  type: TWorkType;
  subjectId: TSubjectId;
  createdAtMs: number;
  status: SimulationWorkItemStatus;
  claimedByWorkerId?: TWorkerId;
  claimedAtMs?: number;
  blockedReason?: string | null;
}

export type SimulationWorkStore<T extends SimulationWorkItem = SimulationWorkItem> = SimulationEntityStore<T>;

export function createSimulationEntityStore<T extends SimulationEntityRecord>(): SimulationEntityStore<T> {
  return {
    records: new Map<string, T>(),
  };
}

export function createSimulationWorkStore<T extends SimulationWorkItem>(): SimulationWorkStore<T> {
  return createSimulationEntityStore<T>();
}

export function listSimulationEntities<T extends SimulationEntityRecord>(store: SimulationEntityStore<T>) {
  return Array.from(store.records.values());
}

export function getSimulationEntity<T extends SimulationEntityRecord>(
  store: SimulationEntityStore<T>,
  id: string,
) {
  return store.records.get(id) ?? null;
}

export function findSimulationEntity<T extends SimulationEntityRecord>(
  store: SimulationEntityStore<T>,
  predicate: (entity: T) => boolean,
) {
  return listSimulationEntities(store).find(predicate) ?? null;
}

export function upsertSimulationEntity<T extends SimulationEntityRecord>(
  store: SimulationEntityStore<T>,
  entity: T,
) {
  store.records.set(entity.id, entity);
  return entity;
}

export function removeSimulationEntity<T extends SimulationEntityRecord>(
  store: SimulationEntityStore<T>,
  id: string,
) {
  store.records.delete(id);
}

export function claimSimulationWorkItems<T extends SimulationWorkItem>(
  store: SimulationWorkStore<T>,
  workerId: T["claimedByWorkerId"],
  itemIds: string[],
  claimedAtMs: number,
) {
  for (const itemId of itemIds) {
    const item = store.records.get(itemId);
    if (!item) {
      continue;
    }
    item.status = "claimed";
    item.claimedByWorkerId = workerId;
    item.claimedAtMs = claimedAtMs;
    item.blockedReason = null;
  }
}

export function reopenSimulationWorkItem<T extends SimulationWorkItem>(
  store: SimulationWorkStore<T>,
  itemId: string,
  blockedReason: string | null = null,
) {
  const item = store.records.get(itemId);
  if (!item) {
    return null;
  }
  item.status = "open";
  item.claimedByWorkerId = undefined;
  item.claimedAtMs = undefined;
  item.blockedReason = blockedReason;
  return item;
}
