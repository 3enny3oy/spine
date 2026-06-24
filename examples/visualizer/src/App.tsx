import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
} from "@xyflow/react";
import { Menu, MenuButton, MenuItem, useMenuStore } from "@ariakit/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConfigNodeData, DemoNodeData, DeliveryTrace, PublishTrace } from "./lib/types";
import {
  createNode,
  loadSnapshot,
  publishFromPublisher,
  subscribeSnapshots,
  updateConfig,
  updateNode,
  type BackendSnapshot,
} from "./lib/backend";
import { ConfigNode, PublisherNode, ServiceNode, SubscriberNode } from "./components/GraphNodes";
import { InspectorDialog } from "./components/InspectorDialog";

const CAFE_STORY_PUBLISHERS = [
  "publisher-queue-alice",
  "publisher-queue-bob",
  "publisher-table-open",
  "publisher-seat-alice",
  "publisher-menus",
  "publisher-order",
  "publisher-ticket",
  "publisher-prep",
  "publisher-ready",
  "publisher-serve",
  "publisher-bill-request",
  "publisher-bill",
  "publisher-pay",
  "publisher-clear",
  "publisher-seat-bob",
] as const;

const nodeTypes = {
  publisher: PublisherNode,
  subscriber: SubscriberNode,
  config: ConfigNode,
  service: ServiceNode,
};

export function App() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DemoNodeData>>([] as Node<DemoNodeData>[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [backendState, setBackendState] = useState<"connecting" | "live" | "offline">("connecting");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [storyRunning, setStoryRunning] = useState(false);
  const menuStore = useMenuStore();

  const applySnapshot = useCallback(
    (next: BackendSnapshot) => {
      setSnapshot(next);
      setNodes((current) => mergeNodes(current, next.nodes));
      setSelectedNodeId((current) => (current && next.nodes.some((node) => node.id === current) ? current : null));
      setRequestError(next.lastError);
      setBackendState("live");
    },
    [setNodes],
  );

  useEffect(() => {
    let cancelled = false;

    loadSnapshot()
      .then((next) => {
        if (!cancelled) {
          applySnapshot(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBackendState("offline");
          setRequestError(error instanceof Error ? error.message : "Failed to load backend state");
        }
      });

    const stop = subscribeSnapshots(
      (next) => {
        applySnapshot(next);
      },
      (message) => {
        setBackendState("offline");
        setRequestError(message);
      },
    );

    return () => {
      cancelled = true;
      stop();
    };
  }, [applySnapshot]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)?.data ?? null;
  const publishHistory = snapshot?.publishHistory ?? [];
  const routes = snapshot?.routes ?? [];
  const config = snapshot?.config ?? null;
  const sidebarTrace = publishHistory[0] ?? null;
  const errorMessage = requestError ?? snapshot?.lastError ?? null;
  const nodeTitles = useMemo(() => new Map(nodes.map((node) => [node.id, node.data.title])), [nodes]);

  const flowEdges = useMemo(
    () =>
      routes.map((edge) => ({
        ...edge,
        type: "smoothstep" as const,
        style: {
          stroke: edge.data?.accepted ? "rgba(34,211,238,0.9)" : "rgba(148,163,184,0.35)",
          strokeWidth: 2,
        },
        labelStyle: {
          fill: "#d5f6ff",
          fontSize: 11,
          fontWeight: 600,
        },
      })),
    [routes],
  );

  async function publishNode(nodeId: string) {
    const next = await publishFromPublisher(nodeId);
    applySnapshot(next);
    setRequestError(null);
    return next;
  }

  async function handleAddNode(kind: DemoNodeData["kind"]) {
    try {
      const next = await createNode(kind);
      applySnapshot(next);
      setRequestError(null);
      setSelectedNodeId(next.nodes.at(-1)?.id ?? null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to create node");
    }
  }

  async function handleUpdateNode(updated: DemoNodeData) {
    try {
      const next = await updateNode(updated);
      applySnapshot(next);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to update node");
    }
  }

  async function handleUpdateConfig(patch: Partial<ConfigNodeData>) {
    try {
      const next = await updateConfig({
        title: patch.title,
        allowCatchAll: patch.allowCatchAll,
        defaultQueueDepth: patch.defaultQueueDepth,
        recursionPolicy: patch.recursionPolicy,
      });
      applySnapshot(next);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to update configuration");
    }
  }

  async function handlePublish(nodeId: string) {
    try {
      await publishNode(nodeId);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to publish from node");
    }
  }

  async function handlePlayCafeStory() {
    if (storyRunning) {
      return;
    }
    setStoryRunning(true);
    setRequestError(null);
    try {
      for (const nodeId of CAFE_STORY_PUBLISHERS) {
        await publishNode(nodeId);
        await new Promise((resolve) => setTimeout(resolve, 280));
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to play cafe story");
    } finally {
      setStoryRunning(false);
    }
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col text-slate-100">
        <header className="border-b border-white/10 bg-slate-950/70 px-5 py-4 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                SPINE visualizer
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                Cafe service flow with live payload feedback
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                The café preset shows the queue, seating, menu hand-off, kitchen prep, food
                service, billing, and turnover. Publish individual nodes or run the full story
                from the toolbar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MenuButton className="accent-button" store={menuStore}>
                Add node
              </MenuButton>
              <button className="accent-button" onClick={handlePlayCafeStory} disabled={storyRunning}>
                {storyRunning ? "Playing story..." : "Play cafe story"}
              </button>
              <button
                className="glass-button"
                onClick={() => setSelectedNodeId(config?.id ?? null)}
                disabled={!config}
              >
                Bus config
              </button>
              <div className="chip">scenario: cafe</div>
              <div className="chip">backend: {backendState}</div>
              <div className="chip">nodes: {nodes.length}</div>
              <div className="chip">routes: {routes.length}</div>
              {config ? <div className="chip">catch-all: {String(config.allowCatchAll)}</div> : null}
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px]">
          <section className="relative min-h-0">
            <ReactFlow
              nodes={nodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              fitView
              proOptions={{ hideAttribution: true }}
              className="bg-transparent"
            >
              <Background gap={24} size={1} color="rgba(148,163,184,0.16)" />
              <MiniMap
                pannable
                zoomable
                nodeStrokeColor={(node) => {
                  switch (node.type) {
                    case "publisher":
                      return "rgba(34,211,238,0.9)";
                    case "subscriber":
                      return "rgba(52,211,153,0.9)";
                    case "config":
                      return "rgba(192,132,252,0.9)";
                    case "service":
                      return "rgba(232,121,249,0.9)";
                    default:
                      return "rgba(255,255,255,0.2)";
                  }
                }}
                nodeColor={() => "rgba(15,23,42,0.75)"}
              />
              <Controls />
            </ReactFlow>

            <Menu
              store={menuStore}
              className="panel absolute left-6 top-20 z-20 min-w-[220px] p-2"
            >
              <MenuItem
                className="glass-button w-full justify-start"
                onClick={() => handleAddNode("publisher")}
              >
                Publisher node
              </MenuItem>
              <MenuItem
                className="glass-button mt-1 w-full justify-start"
                onClick={() => handleAddNode("subscriber")}
              >
                Subscriber node
              </MenuItem>
              <MenuItem
                className="glass-button mt-1 w-full justify-start"
                onClick={() => handleAddNode("config")}
              >
                Config node
              </MenuItem>
              <MenuItem
                className="glass-button mt-1 w-full justify-start"
                onClick={() => handleAddNode("service")}
              >
                Service node
              </MenuItem>
            </Menu>
          </section>

          <aside className="panel m-4 flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                Realtime trace
              </div>
              <div className="mt-1 text-sm text-slate-300">
                Latest publish, matching routes, and per-subscriber payload delivery.
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              {errorMessage ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                  {errorMessage}
                </div>
              ) : null}
              {sidebarTrace ? (
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-cyan-100">Most recent publish</div>
                    <div className="chip">
                      signal {sidebarTrace.signalId} ·{" "}
                      {nodeTitles.get(sidebarTrace.fromNodeId) ?? sidebarTrace.fromNodeId}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-cyan-100/90">
                    <div>
                      <span className="label mr-2">Address</span>
                      {sidebarTrace.address}
                    </div>
                    <div>
                      <span className="label mr-2">Payload</span>
                    </div>
                    <pre className="max-h-40 overflow-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-5 text-slate-100">
                      {JSON.stringify(sidebarTrace.payload, null, 2)}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                      <span className="chip">matched {sidebarTrace.matchedCount}</span>
                      <span className="chip">accepted {sidebarTrace.acceptedCount}</span>
                      <span className="chip">rejected {sidebarTrace.rejectedCount}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                  Publish any story node or run the cafe sequence to generate a live trace.
                </div>
              )}

              <div className="space-y-3">
                <div className="label">Delivery events</div>
                {sidebarTrace?.deliveries.length ? (
                  sidebarTrace.deliveries.map((delivery, index) => (
                    <DeliveryCard
                      key={`${delivery.subscriberNodeId}-${index}`}
                      delivery={delivery}
                      subscriberLabel={nodeTitles.get(delivery.subscriberNodeId) ?? delivery.subscriberNodeId}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                    No deliveries yet.
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>

        <InspectorDialog
          open={Boolean(selectedNodeId)}
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          onUpdateNode={handleUpdateNode}
          onUpdateConfig={handleUpdateConfig}
          onPromotePublisher={handlePublish}
        />
      </div>
    </ReactFlowProvider>
  );
}

function mergeNodes(current: Node<DemoNodeData>[], next: Node<DemoNodeData>[]): Node<DemoNodeData>[] {
  const currentById = new Map(current.map((node) => [node.id, node]));
  return next.map((node) => {
    const previous = currentById.get(node.id);
    if (!previous) {
      return node;
    }
    return {
      ...node,
      position: previous.position,
      selected: previous.selected,
      dragging: previous.dragging,
    };
  });
}

function DeliveryCard({
  delivery,
  subscriberLabel,
}: {
  delivery: DeliveryTrace;
  subscriberLabel: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{subscriberLabel}</div>
        <div className={`chip ${delivery.accepted ? "border-cyan-400/20 bg-cyan-400/10" : ""}`}>
          {delivery.accepted ? "accepted" : "dropped"}
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-400">{delivery.expression}</div>
      <div className="mt-3 rounded-xl bg-black/30 p-3">
        <div className="label mb-1">Payload</div>
        <pre className="overflow-auto text-[11px] leading-5 text-slate-100">
          {typeof delivery.payload === "string"
            ? delivery.payload
            : JSON.stringify(delivery.payload, null, 2)}
        </pre>
      </div>
      {Object.keys(delivery.params).length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(delivery.params).map(([key, value]) => (
            <span key={key} className="chip">
              {key}={value}
            </span>
          ))}
        </div>
      ) : null}
      {delivery.reason ? <div className="mt-3 text-xs text-rose-300">{delivery.reason}</div> : null}
    </article>
  );
}
