export interface SimulationQueue<T> {
  items: T[];
}

export function createSimulationQueue<T>(): SimulationQueue<T> {
  return {
    items: [],
  };
}

export function listSimulationQueue<T>(queue: SimulationQueue<T>) {
  return [...queue.items];
}

export function peekSimulationQueue<T>(queue: SimulationQueue<T>) {
  return queue.items[0] ?? null;
}

export function getSimulationQueueSize<T>(queue: SimulationQueue<T>) {
  return queue.items.length;
}

export function enqueueSimulationQueue<T>(queue: SimulationQueue<T>, item: T) {
  queue.items.push(item);
}

export function dequeueSimulationQueue<T>(queue: SimulationQueue<T>) {
  return queue.items.shift() ?? null;
}

export function removeFromSimulationQueue<T>(queue: SimulationQueue<T>, predicate: (item: T) => boolean) {
  queue.items = queue.items.filter((item) => !predicate(item));
}
