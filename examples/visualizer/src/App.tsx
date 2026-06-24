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
import { useMemo, useState } from "react";
import {
  applyBusConfiguration,
  defaultBusConfig,
  defaultConfigNode,
  defaultPublisherNode,
  defaultServiceNode,
  defaultSubscriberNode,
  publishFromPublisher,
  parseAddress,
  routeGraph,
} from "./lib/bus";
import type {
  ConfigNodeData,
  DemoNodeData,
  DeliveryTrace,
  PublishTrace,
} from "./lib/types";
import { ConfigNode, PublisherNode, ServiceNode, SubscriberNode } from "./components/GraphNodes";
import { InspectorDialog } from "./components/InspectorDialog";

const initialNodes: Node<DemoNodeData>[] = [
  {
    id: "publisher-1",
    type: "publisher",
    position: { x: 100, y: 160 },
    data: defaultPublisherNode("publisher-1", 100, 160),
  },
  {
    id: "subscriber-1",
    type: "subscriber",
    position: { x: 600, y: 120 },
    data: defaultSubscriberNode(
      "subscriber-1",
      600,
      120,
      "documents/{document_id}/blocks/{block_id}/changed",
      "Block subscriber",
    ),
  },
  {
    id: "subscriber-2",
    type: "subscriber",
    position: { x: 600, y: 340 },
    data: defaultSubscriberNode(
      "subscriber-2",
      600,
      340,
      "documents/{document_id}/**",
      "Document catch-all",
    ),
  },
  {
    id: "config-1",
    type: "config",
    position: { x: 360, y: 360 },
    data: defaultConfigNode("config-1", 360, 360),
  },
  {
    id: "service-1",
    type: "service",
    position: { x: 930, y: 220 },
    data: defaultServiceNode("service-1", 930, 220),
  },
];

const nodeTypes = {
  publisher: PublisherNode,
  subscriber: SubscriberNode,
  config: ConfigNode,
  service: ServiceNode,
};

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [publishHistory, setPublishHistory] = useState<PublishTrace[]>([]);
  const [signalCounter, setSignalCounter] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const menuStore = useMenuStore();

  const busConfig = useMemo(() => applyBusConfiguration(nodes.map((node) => node.data), defaultBusConfig()), [nodes]);
  const routes = useMemo(() => routeGraph(nodes.map((node) => node.data), busConfig), [nodes, busConfig]);

  const flowEdges = routes.edges.map((edge) => ({
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
  }));

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)?.data ?? null;
  function addNode(kind: DemoNodeData["kind"]) {
    const id = `${kind}-${Date.now().toString(36)}`;
    const x = 120 + nodes.length * 40;
    const y = 120 + nodes.length * 36;
    let data: DemoNodeData;
    if (kind === "publisher") {
      data = defaultPublisherNode(id, x, y);
    } else if (kind === "subscriber") {
      data = defaultSubscriberNode(id, x, y, "documents/{document_id}/blocks/{block_id}/changed", "New subscriber");
    } else if (kind === "config") {
      data = defaultConfigNode(id, x, y);
    } else {
      data = defaultServiceNode(id, x, y);
    }
    setNodes((current) => [...current, { id, type: kind, position: { x, y }, data }]);
    setSelectedNodeId(id);
  }

  function updateNode(updated: DemoNodeData) {
    setNodes((current) =>
      current.map((node) => (node.id === updated.id ? { ...node, data: updated } : node)),
    );
  }

  function updateConfig(patch: Partial<ConfigNodeData>) {
    setNodes((current) =>
      current.map((node) =>
        node.data.kind === "config"
          ? {
              ...node,
              data: {
                ...node.data,
                ...patch,
                recursionPolicy: {
                  ...node.data.recursionPolicy,
                  ...(patch.recursionPolicy ?? {}),
                },
              },
            }
          : node,
      ),
    );
  }

  function publishFromNode(nodeId: string) {
    try {
      setNodes((current) => {
        const currentData = current.map((node) => node.data);
        const currentConfig = applyBusConfiguration(currentData, defaultBusConfig());
        const publisher = currentData.find((node) => node.id === nodeId && node.kind === "publisher");
        if (!publisher) {
          throw new Error("publisher not found");
        }
        parseAddress(publisher.address);
        const result = publishFromPublisher(currentData, currentConfig, nodeId, signalCounter);
        setPublishHistory((history) => [result.trace, ...history].slice(0, 12));
        setSignalCounter((count) => count + 1);
        setErrorMessage(null);
        return current.map((node) => {
          const updated = result.nodes.find((candidate) => candidate.id === node.id);
          return updated ? { ...node, data: updated } : node;
        });
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to publish");
    }
  }

  const sidebarTrace = publishHistory[0];

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
                Routed pub / sub paths with live payload feedback
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Edit node expressions, delivery policy, and bus configuration. Publish from a node
                to see matching subscribers light up, capture params, and record the payload in
                each inbox.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MenuButton className="accent-button" store={menuStore}>
                Add node
              </MenuButton>
              <button className="glass-button" onClick={() => setSelectedNodeId("config-1")}>
                Bus config
              </button>
              <div className="chip">catch-all: {String(busConfig.allowCatchAll)}</div>
              <div className="chip">queue depth: {busConfig.defaultQueueDepth}</div>
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
                nodeColor={(node) => "rgba(15,23,42,0.75)"}
              />
              <Controls />
            </ReactFlow>

            <Menu
              store={menuStore}
              className="panel absolute left-6 top-20 z-20 min-w-[220px] p-2"
            >
              <MenuItem
                className="glass-button w-full justify-start"
                onClick={() => addNode("publisher")}
              >
                Publisher node
              </MenuItem>
              <MenuItem
                className="glass-button mt-1 w-full justify-start"
                onClick={() => addNode("subscriber")}
              >
                Subscriber node
              </MenuItem>
              <MenuItem
                className="glass-button mt-1 w-full justify-start"
                onClick={() => addNode("config")}
              >
                Config node
              </MenuItem>
              <MenuItem
                className="glass-button mt-1 w-full justify-start"
                onClick={() => addNode("service")}
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
                    <div className="chip">signal {sidebarTrace.signalId}</div>
                  </div>
                  <div className="mt-3 space-y-2 text-xs text-cyan-100/90">
                    <div><span className="label mr-2">Address</span>{sidebarTrace.address}</div>
                    <div><span className="label mr-2">Payload</span></div>
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
                  Publish from the publisher node to generate a live trace.
                </div>
              )}

              <div className="space-y-3">
                <div className="label">Delivery events</div>
                {sidebarTrace?.deliveries.length ? (
                  sidebarTrace.deliveries.map((delivery, index) => (
                    <DeliveryCard key={`${delivery.subscriberNodeId}-${index}`} delivery={delivery} />
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
          onUpdateNode={updateNode}
          onUpdateConfig={updateConfig}
          onPromotePublisher={publishFromNode}
        />
      </div>
    </ReactFlowProvider>
  );
}

function DeliveryCard({ delivery }: { delivery: DeliveryTrace }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{delivery.subscriberNodeId}</div>
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
