import {
  Background,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Menu, MenuButton, MenuItem, useMenuStore } from "@ariakit/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfigNode, PublisherNode, ServiceNode, SubscriberNode } from "./components/GraphNodes";
import { ScenarioManhattanEdge } from "./components/ScenarioManhattanEdge";
import { InspectorDialog } from "./components/InspectorDialog";
import {
  createNode,
  loadScenario,
  loadScenarioCatalog,
  loadSnapshot,
  publishCustomSignal,
  publishFromPublisher,
  saveScenario,
  subscribeSnapshots,
  updateConfig,
  updateNode,
  type BackendSnapshot,
} from "./lib/backend";
import {
  createCafeSimulation,
  formatMoney,
  resetCafeMetrics,
  resetCafeQueues,
  type CafeSimulationController,
} from "./lib/cafeSimulation";
import {
  cloneCafeConfig,
  decorateScenarioNodesWithCafeQueues,
  DEFAULT_CAFE_QUEUE_SNAPSHOT,
  FALLBACK_CAFE_SCENARIO_CONFIG,
  resolveCafeSimulationRuntime,
  scenarioEdgesForNodes,
  type CafeDishConfig,
  type CafeMetrics,
  type CafeQueueSnapshot,
  type CafeScenarioConfig,
  type ScenarioOption,
} from "./lib/scenarios";
import { layoutScenarioNodes } from "./lib/autoLayout";
import type { ConfigNodeData, DemoNodeData, DeliveryTrace, PublishTrace } from "./lib/types";

const nodeTypes = {
  publisher: PublisherNode,
  subscriber: SubscriberNode,
  config: ConfigNode,
  service: ServiceNode,
};

const edgeTypes = {
  scenarioManhattan: ScenarioManhattanEdge,
};

export function App() {
  return (
    <ReactFlowProvider>
      <ScenarioVisualizer />
    </ReactFlowProvider>
  );
}

function ScenarioVisualizer() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  const snapshotRef = useRef<BackendSnapshot | null>(null);
  const reactFlowRef = useRef<ReactFlowInstance<Node<DemoNodeData>, Edge> | null>(null);
  const simulationRef = useRef<CafeSimulationController | null>(null);
  const forceLayoutRef = useRef(false);
  const layoutRunRef = useRef(0);
  const publishEpochRef = useRef(0);
  const publishQueueRef = useRef<Promise<void>>(Promise.resolve());
  const { getNodes } = useReactFlow<Node<DemoNodeData>, Edge>();
  const nodesInitialized = useNodesInitialized({ includeHiddenNodes: false });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DemoNodeData>>([] as Node<DemoNodeData>[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [backendState, setBackendState] = useState<"connecting" | "live" | "offline">("connecting");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [scenarioOptions, setScenarioOptions] = useState<ScenarioOption[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("cafe-pipeline");
  const [loadingScenario, setLoadingScenario] = useState(false);
  const [savingScenario, setSavingScenario] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [pendingLayout, setPendingLayout] = useState<{ scenarioId: string; revision: number } | null>(null);
  const [sidebarSections, setSidebarSections] = useState({
    run: true,
    metrics: true,
    inspect: false,
    tuning: false,
  });
  const [tuningSections, setTuningSections] = useState({
    arrival: false,
    dining: false,
    billing: false,
    menu: false,
  });
  const [cafeConfig, setCafeConfig] = useState<CafeScenarioConfig>(() => cloneCafeConfig(FALLBACK_CAFE_SCENARIO_CONFIG));
  const cafeConfigRef = useRef(cafeConfig);
  const [cafeMetrics, setCafeMetrics] = useState<CafeMetrics>(() => resetCafeMetrics());
  const [cafeQueues, setCafeQueues] = useState<CafeQueueSnapshot>(() => ({ ...DEFAULT_CAFE_QUEUE_SNAPSHOT }));
  const cafeQueuesRef = useRef(cafeQueues);
  const menuStore = useMenuStore();

  useEffect(() => {
    cafeConfigRef.current = cafeConfig;
  }, [cafeConfig]);

  useEffect(() => {
    cafeQueuesRef.current = cafeQueues;
  }, [cafeQueues]);

  useEffect(() => {
    if (selectedNodeId) {
      setSidebarSections((current) => ({ ...current, inspect: true }));
    }
  }, [selectedNodeId]);

  useEffect(() => {
    if (!pendingLayout || !nodesInitialized) {
      return;
    }

    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot || currentSnapshot.scenarioId !== pendingLayout.scenarioId) {
      return;
    }

    let cancelled = false;
    const runId = ++layoutRunRef.current;

    void layoutScenarioNodes(getNodes(), currentSnapshot.scenario.edges)
      .then((layoutedNodes) => {
        if (cancelled || runId !== layoutRunRef.current) {
          return;
        }
        setNodes(layoutedNodes);
        setPendingLayout((current) => (current?.revision === pendingLayout.revision ? null : current));
        queueMicrotask(() => {
          requestAnimationFrame(() => {
            reactFlowRef.current?.fitView({ padding: 0.12, minZoom: 0.55, duration: 280 });
          });
        });
      })
      .catch((error) => {
        if (cancelled || runId !== layoutRunRef.current) {
          return;
        }
        setPendingLayout((current) => (current?.revision === pendingLayout.revision ? null : current));
        setRequestError(error instanceof Error ? error.message : "Failed to layout scenario");
      });

    return () => {
      cancelled = true;
    };
  }, [getNodes, nodesInitialized, pendingLayout, setNodes]);

  const applySnapshot = useCallback(
    (next: BackendSnapshot) => {
      const currentSnapshot = snapshotRef.current;
      const scenarioChanged = currentSnapshot?.scenarioId !== next.scenarioId;
      const shouldRelayout = forceLayoutRef.current || scenarioChanged;
      if (isStaleSnapshot(currentSnapshot, next)) {
        return;
      }
      snapshotRef.current = next;
      setSnapshot(next);
      setSelectedScenarioId(next.scenarioId);
      setScenarioOptions((current) => upsertScenarioOption(current, next.scenario));
      if (scenarioChanged) {
        setCafeConfig(cloneCafeConfig(next.scenario.cafeConfig ?? FALLBACK_CAFE_SCENARIO_CONFIG));
      }
      setNodes((current) => {
        const decorated = decorateSnapshotNodes(next, cafeQueuesRef.current);
        return shouldRelayout ? decorated : mergeNodes(current, decorated);
      });
      setSelectedNodeId((current) => (current && next.nodes.some((node) => node.id === current) ? current : null));
      setRequestError(next.lastError);
      setBackendState("live");
      if (shouldRelayout) {
        forceLayoutRef.current = false;
        const revision = Date.now();
        setPendingLayout({ scenarioId: next.scenarioId, revision });
        setLayoutRevision(revision);
      }
    },
    [setNodes],
  );

  useEffect(() => {
    let cancelled = false;

    loadScenarioCatalog()
      .then((options) => {
        if (!cancelled) {
          setScenarioOptions(options);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRequestError(error instanceof Error ? error.message : "Failed to load scenarios");
        }
      });

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
      (next) => applySnapshot(next),
      (message) => {
        setBackendState("offline");
        setRequestError(message);
      },
    );

    return () => {
      cancelled = true;
      publishEpochRef.current += 1;
      stop();
      simulationRef.current?.stop();
    };
  }, [applySnapshot]);

  const emitScenarioSignal = useCallback(
    async (nodeId: string, address: string, payload: unknown) => {
      const payloadText = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      const taskEpoch = publishEpochRef.current;
      publishQueueRef.current = publishQueueRef.current
        .catch(() => {
          // Continue processing later publishes after an earlier failure.
        })
        .then(async () => {
          if (taskEpoch !== publishEpochRef.current) {
            return;
          }
          await publishCustomSignal(nodeId, address, payloadText);
          if (taskEpoch === publishEpochRef.current) {
            setRequestError(null);
          }
        })
        .catch((error) => {
          if (taskEpoch === publishEpochRef.current) {
            setRequestError(error instanceof Error ? error.message : "Failed to publish scenario signal");
          }
        });
      await publishQueueRef.current;
    },
    [],
  );

  const ensureCafeSimulation = useCallback(() => {
    if (simulationRef.current) {
      return simulationRef.current;
    }
    const controller = createCafeSimulation({
      getConfig: () => cafeConfigRef.current,
      getRuntime: () => resolveCafeSimulationRuntime(snapshotRef.current?.scenario, snapshotRef.current?.nodes ?? []),
      getSpeedMultiplier: () => simulationSpeed,
      onMetrics: setCafeMetrics,
      onQueues: setCafeQueues,
      publish: emitScenarioSignal,
    });
    simulationRef.current = controller;
    return controller;
  }, [emitScenarioSignal, simulationSpeed]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)?.data ?? null;
  const publishHistory = snapshot?.publishHistory ?? [];
  const config = snapshot?.config ?? null;
  const errorMessage = requestError ?? snapshot?.lastError ?? null;
  const nodeTitles = useMemo(() => new Map(nodes.map((node) => [node.id, node.data.title])), [nodes]);
  const activeScenario =
    (snapshot?.scenarioId === selectedScenarioId ? snapshot.scenario : null) ??
    scenarioOptions.find((scenario) => scenario.id === selectedScenarioId) ??
    scenarioOptions[0] ??
    null;
  const supportsCafeSimulation = snapshot?.scenario.simulationKind === "cafe-pipeline";
  const activeEdgeMessages = useMemo(() => buildActiveEdgeMessages(snapshot), [snapshot]);

  const flowEdges = useMemo(
    () =>
      scenarioEdgesForNodes(
        snapshot?.scenario.edges ?? [],
        nodes.map((node) => ({ id: node.id, position: node.position })),
        activeEdgeMessages,
      ).map((edge) => ({
        ...edge,
        animated: Boolean(edge.data?.active),
        style: {
          stroke: edge.data?.active ? "rgba(103,232,249,0.98)" : "rgba(34,211,238,0.82)",
          strokeWidth: edge.data?.active ? 3.2 : 2.5,
        },
      })),
    [activeEdgeMessages, nodes, snapshot?.scenario.edges],
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

  async function handleLoadScenario(scenarioId: string) {
    setLoadingScenario(true);
    publishEpochRef.current += 1;
    simulationRef.current?.stop();
    simulationRef.current = null;
    setSimulationRunning(false);
    setCafeMetrics(resetCafeMetrics());
    setCafeQueues(resetCafeQueues());
    forceLayoutRef.current = true;
    try {
      const next = await loadScenario(scenarioId);
      applySnapshot(next);
      setSelectedScenarioId(scenarioId);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to load scenario");
    } finally {
      setLoadingScenario(false);
    }
  }

  async function handleSaveScenario() {
    setSavingScenario(true);
    try {
      const next = await saveScenario(selectedScenarioId);
      applySnapshot(next);
      setRequestError(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Failed to save scenario");
    } finally {
      setSavingScenario(false);
    }
  }

  function handleStartPipeline() {
    const simulation = ensureCafeSimulation();
    simulation.start();
    setSimulationRunning(simulation.isRunning());
  }

  function handleStopPipeline() {
    publishEpochRef.current += 1;
    simulationRef.current?.stop();
    setSimulationRunning(false);
  }

  async function handleResetPipeline() {
    handleStopPipeline();
    simulationRef.current?.reset();
    simulationRef.current = null;
    setCafeMetrics(resetCafeMetrics());
    setCafeQueues(resetCafeQueues());
    await handleLoadScenario(selectedScenarioId);
  }

  function handleResetCafeConfig() {
    setCafeConfig(cloneCafeConfig(snapshot?.scenario.cafeConfig ?? FALLBACK_CAFE_SCENARIO_CONFIG));
  }

  function toggleSidebarSection(section: keyof typeof sidebarSections) {
    setSidebarSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function toggleTuningSection(section: keyof typeof tuningSections) {
    setTuningSections((current) => ({ ...current, [section]: !current[section] }));
  }

  return (
    <div className="relative h-full overflow-hidden text-slate-100">
        <div className="absolute inset-0">
          <ReactFlow
            key={`${selectedScenarioId}-${layoutRevision}`}
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            onInit={(instance) => {
              reactFlowRef.current = instance;
            }}
            proOptions={{ hideAttribution: true }}
            className="bg-transparent"
          >
            <Background gap={24} size={1} color="rgba(148,163,184,0.16)" />
          </ReactFlow>
        </div>

        <header className="absolute inset-x-3 top-3 z-20">
          <div className="panel flex items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.34em] text-cyan-300">
                SPINE visualizer
              </div>
              <div className="mt-0.5 flex items-baseline gap-3">
                <h1 className="truncate text-[18px] font-semibold text-white">
                  Scenario-driven bus visualizer
                </h1>
                <p className="hidden truncate text-[12px] text-slate-400 xl:block">
                  The graph is the primary surface. Controls and diagnostics float over it.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <MenuButton className="glass-button" store={menuStore}>
                Add node
              </MenuButton>
              <div className="chip">scenario: {activeScenario?.title ?? selectedScenarioId}</div>
              <div className="chip">backend: {backendState}</div>
              <div className="chip">nodes: {nodes.length}</div>
              <div className="chip">edges: {flowEdges.length}</div>
              {supportsCafeSimulation ? <div className="chip">revenue: {formatMoney(cafeMetrics.revenue)}</div> : null}
            </div>
          </div>
        </header>

        <Menu
          store={menuStore}
          className="panel absolute right-[332px] top-[56px] z-30 min-w-[190px] p-1.5"
        >
          <MenuItem className="glass-button w-full justify-start" onClick={() => handleAddNode("publisher")}>
            Publisher node
          </MenuItem>
          <MenuItem className="glass-button mt-1 w-full justify-start" onClick={() => handleAddNode("subscriber")}>
            Subscriber node
          </MenuItem>
          <MenuItem className="glass-button mt-1 w-full justify-start" onClick={() => handleAddNode("service")}>
            Service node
          </MenuItem>
        </Menu>

        <div className="absolute bottom-[212px] left-4 z-20">
          <CanvasControls
            onZoomIn={() => void reactFlowRef.current?.zoomIn({ duration: 180 })}
            onZoomOut={() => void reactFlowRef.current?.zoomOut({ duration: 180 })}
            onFitView={() => void reactFlowRef.current?.fitView({ padding: 0.14, minZoom: 0.55, duration: 220 })}
          />
        </div>

        <div className="absolute bottom-[212px] right-[332px] z-20 w-[172px]">
          <div className="panel p-1.5">
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
              <div className="label">Map</div>
              <button
                className="chip"
                onClick={() => void reactFlowRef.current?.fitView({ padding: 0.14, minZoom: 0.55, duration: 220 })}
              >
                Fit
              </button>
            </div>
            <MiniMap
              className="flow-minimap flow-minimap-docked"
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
          </div>
        </div>

        <aside className="panel absolute bottom-3 right-3 top-[72px] z-20 flex w-[308px] min-h-0 flex-col overflow-hidden">
            <div className="border-b border-white/10 px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                Scenario controls
              </div>
              <div className="mt-1 text-[13px] leading-5 text-slate-300">
                {activeScenario?.description ?? "Load a saved scenario to inspect the bus graph."}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
              <SidebarSection
                title="Run"
                subtitle="Scenario selection, runtime controls, and playback speed."
                open={sidebarSections.run}
                onToggle={() => toggleSidebarSection("run")}
              >
                <label className="block">
                  <div className="label mb-2">Load scenario</div>
                  <select
                    className="field"
                    value={selectedScenarioId}
                    onChange={(event) => void handleLoadScenario(event.target.value)}
                    disabled={loadingScenario}
                  >
                    {scenarioOptions.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    className="accent-button w-full"
                    onClick={handleStartPipeline}
                    disabled={!supportsCafeSimulation || simulationRunning || loadingScenario}
                  >
                    Run pipeline
                  </button>
                  <button className="glass-button w-full" onClick={handleStopPipeline} disabled={!simulationRunning}>
                    Stop
                  </button>
                  <button className="glass-button w-full" onClick={() => void handleResetPipeline()} disabled={loadingScenario}>
                    Reset
                  </button>
                  <button className="glass-button w-full" onClick={() => void handleLoadScenario(selectedScenarioId)} disabled={loadingScenario}>
                    Reload scenario
                  </button>
                  <button className="glass-button w-full" onClick={() => void handleSaveScenario()} disabled={loadingScenario || savingScenario}>
                    Save JSON
                  </button>
                  <button className="glass-button w-full" onClick={() => setSelectedNodeId(config?.id ?? null)} disabled={!config}>
                    Bus config
                  </button>
                </div>
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <div className="label">Simulation speed</div>
                    <div className="chip">{simulationSpeed.toFixed(2)}x</div>
                  </div>
                  <input
                    className="accent-range"
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.25}
                    value={simulationSpeed}
                    onChange={(event) => setSimulationSpeed(Number(event.target.value))}
                  />
                </label>
              </SidebarSection>

              {errorMessage ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                  {errorMessage}
                </div>
              ) : null}

              {supportsCafeSimulation ? (
                <SidebarSection
                  title="Metrics"
                  subtitle="Live counters for throughput, occupancy, and revenue."
                  open={sidebarSections.metrics}
                  onToggle={() => toggleSidebarSection("metrics")}
                >
                  <CafeMetricsCard metrics={cafeMetrics} />
                </SidebarSection>
              ) : null}

              <SidebarSection
                title="Inspect selected"
                subtitle="Selected node detail, activity, and queue state."
                open={sidebarSections.inspect}
                onToggle={() => toggleSidebarSection("inspect")}
              >
                <SelectedNodePanel node={selectedNode} />
              </SidebarSection>

              {supportsCafeSimulation ? (
                <SidebarSection
                  title="Tuning"
                  subtitle="Client-side simulation timings and menu behaviour."
                  open={sidebarSections.tuning}
                  onToggle={() => toggleSidebarSection("tuning")}
                >
                  <CafeConfigPanel
                    config={cafeConfig}
                    onChange={setCafeConfig}
                    onResetDefaults={handleResetCafeConfig}
                    tuningSections={tuningSections}
                    onToggleSection={toggleTuningSection}
                  />
                </SidebarSection>
              ) : null}
            </div>
        </aside>

        <div className="absolute bottom-3 left-3 right-[332px] z-20 h-[196px]">
          <DebugConsole traces={publishHistory} nodeTitles={nodeTitles} />
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
  );
}

function mergeNodes(current: Node<DemoNodeData>[], next: Node<DemoNodeData>[]): Node<DemoNodeData>[] {
  const currentById = new Map(current.map((node) => [node.id, node]));
  const nextById = new Map(next.map((node) => [node.id, node]));
  const merged: Node<DemoNodeData>[] = [];
  const seen = new Set<string>();

  for (const node of current) {
    const incoming = nextById.get(node.id);
    if (incoming) {
      merged.push({
        ...incoming,
        position: node.position,
        selected: node.selected,
        dragging: node.dragging,
      });
    } else {
      merged.push(node);
    }
    seen.add(node.id);
  }

  for (const node of next) {
    if (seen.has(node.id)) {
      continue;
    }
    merged.push(node);
  }

  return merged;
}

function upsertScenarioOption(current: ScenarioOption[], scenario: BackendSnapshot["scenario"]): ScenarioOption[] {
  const option = {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    supportsSimulation: scenario.supportsSimulation,
  };
  const existing = current.findIndex((item) => item.id === option.id);
  if (existing === -1) {
    return [...current, option].sort((left, right) => left.title.localeCompare(right.title));
  }
  return current.map((item, index) => (index === existing ? option : item));
}

function isStaleSnapshot(current: BackendSnapshot | null, next: BackendSnapshot) {
  if (!current || current.scenarioId !== next.scenarioId) {
    return false;
  }

  const currentSignalId = current.publishHistory[0]?.signalId;
  const nextSignalId = next.publishHistory[0]?.signalId;

  if (currentSignalId === undefined || nextSignalId === undefined) {
    return false;
  }

  return nextSignalId < currentSignalId;
}

function decorateSnapshotNodes(
  snapshot: BackendSnapshot,
  cafeQueues: CafeQueueSnapshot,
): Node<DemoNodeData>[] {
  const withActivity = decorateScenarioNodesWithActivity(snapshot.nodes, snapshot);
  if (snapshot.scenario.simulationKind !== "cafe-pipeline") {
    return withActivity;
  }
  return decorateScenarioNodesWithCafeQueues(withActivity, cafeQueues);
}

function decorateScenarioNodesWithActivity(
  nodes: Node<DemoNodeData>[],
  snapshot: BackendSnapshot,
): Node<DemoNodeData>[] {
  const latestTrace = snapshot.publishHistory[0];
  if (!latestTrace) {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isActive: false,
        activityLabel: undefined,
        activityValue: undefined,
        activityTone: undefined,
      },
    }));
  }

  const activity = new Map<
    string,
    { isActive: boolean; activityLabel?: string; activityValue?: string; activityTone?: DemoNodeData["activityTone"] }
  >();
  const summary = summarizePayload(latestTrace.payload);
  const addressLabel = compactAddress(latestTrace.address);

  activity.set(latestTrace.fromNodeId, {
    isActive: true,
    activityLabel: `sent ${addressLabel}`,
    activityValue: summary,
    activityTone: "sent",
  });

  for (const delivery of latestTrace.deliveries.slice(0, 6)) {
    activity.set(delivery.subscriberNodeId, {
      isActive: delivery.accepted,
      activityLabel: `${delivery.accepted ? "received" : "dropped"} ${addressLabel}`,
      activityValue: summarizePayload(delivery.payload),
      activityTone: delivery.accepted ? "received" : "dropped",
    });
  }

  return nodes.map((node) => {
    const detail = activity.get(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        isActive: detail?.isActive ?? false,
        activityLabel: detail?.activityLabel,
        activityValue: detail?.activityValue,
        activityTone: detail?.activityTone,
      },
    };
  });
}

function buildActiveEdgeMessages(snapshot: BackendSnapshot | null): Map<string, string> {
  const messages = new Map<string, string>();
  const latestTrace = snapshot?.publishHistory[0];
  if (!latestTrace) {
    return messages;
  }
  const label = `${compactAddress(latestTrace.address)} · ${summarizePayload(latestTrace.payload)}`;
  for (const delivery of latestTrace.deliveries) {
    if (!delivery.accepted) {
      continue;
    }
    messages.set(`${latestTrace.fromNodeId}->${delivery.subscriberNodeId}`, label);
  }
  return messages;
}

function compactAddress(address: string) {
  const parts = address.split("/");
  if (parts.length <= 2) {
    return address;
  }
  return parts.slice(-2).join("/");
}

function summarizePayload(payload: unknown) {
  if (typeof payload === "string") {
    return truncateText(payload.replace(/\s+/g, " "), 44);
  }
  if (!payload || typeof payload !== "object") {
    return String(payload);
  }

  const record = payload as Record<string, unknown>;
  const keys = ["customerId", "orderId", "tableId", "requestType", "dishName", "total", "tip"];
  const pairs = keys
    .filter((key) => record[key] !== undefined && record[key] !== null)
    .slice(0, 3)
    .map((key) => `${key}:${String(record[key])}`);

  if (pairs.length) {
    return truncateText(pairs.join(" · "), 44);
  }

  const firstEntry = Object.entries(record)[0];
  if (!firstEntry) {
    return "{}";
  }
  return truncateText(`${firstEntry[0]}:${String(firstEntry[1])}`, 44);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function DebugConsole({
  traces,
  nodeTitles,
}: {
  traces: PublishTrace[];
  nodeTitles: Map<string, string>;
}) {
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [followLatest, setFollowLatest] = useState(true);
  const [selectedSignalId, setSelectedSignalId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(traces.map((trace) => trace.fromNodeId))).map((nodeId) => ({
        value: nodeId,
        label: nodeTitles.get(nodeId) ?? nodeId,
      })),
    [nodeTitles, traces],
  );

  const filteredTraces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return traces.filter((trace) => {
      if (sourceFilter !== "all" && trace.fromNodeId !== sourceFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const title = (nodeTitles.get(trace.fromNodeId) ?? trace.fromNodeId).toLowerCase();
      const address = trace.address.toLowerCase();
      const payload = summarizePayload(trace.payload).toLowerCase();
      return title.includes(normalizedQuery) || address.includes(normalizedQuery) || payload.includes(normalizedQuery);
    });
  }, [nodeTitles, query, sourceFilter, traces]);

  const selectedTrace =
    filteredTraces.find((trace) => trace.signalId === selectedSignalId) ?? filteredTraces[0] ?? null;

  useEffect(() => {
    if (!followLatest) {
      return;
    }
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [filteredTraces, followLatest]);

  useEffect(() => {
    if (!filteredTraces.length) {
      setSelectedSignalId(null);
      return;
    }
    if (followLatest || !filteredTraces.some((trace) => trace.signalId === selectedSignalId)) {
      setSelectedSignalId(filteredTraces[0].signalId);
    }
  }, [filteredTraces, followLatest, selectedSignalId]);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-white/10 bg-slate-950/84 px-2.5 py-2 backdrop-blur-xl">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Debug console</div>
          <div className="text-xs text-slate-400">Live event feed on the left, selected event detail on the right.</div>
        </div>
        <div className="chip">
          {filteredTraces.length}/{traces.length} events
        </div>
      </div>
      <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_150px_auto_auto] gap-1.5">
        <input
          className="field"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by node, address, or payload"
        />
        <select className="field" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="all">All sources</option>
          {sourceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="glass-button" onClick={() => setFollowLatest((current) => !current)}>
          {followLatest ? "Pause follow" : "Follow latest"}
        </button>
        <button
          className="glass-button"
          onClick={() => {
            setQuery("");
            setSourceFilter("all");
          }}
        >
          Clear
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)] gap-2">
        <div ref={listRef} className="min-h-0 space-y-1.5 overflow-auto pr-1">
          {filteredTraces.length ? (
            filteredTraces.map((trace) => {
              const active = trace.signalId === selectedTrace?.signalId;
              return (
                <button
                  key={trace.signalId}
                  type="button"
                  onClick={() => setSelectedSignalId(trace.signalId)}
                  className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                    active
                      ? "border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.16)]"
                      : "border-white/8 bg-black/20 hover:border-white/16 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-3">
                    <div className="truncate text-xs font-semibold text-slate-100">
                      {nodeTitles.get(trace.fromNodeId) ?? trace.fromNodeId}
                    </div>
                    <div className="truncate font-mono text-[11px] text-cyan-100">{trace.address}</div>
                    <div className="chip">#{trace.signalId}</div>
                  </div>
                  <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="truncate text-[11px] text-slate-300">{summarizePayload(trace.payload)}</div>
                    <div className="flex flex-wrap justify-end gap-1.5 text-[10px]">
                      <span className="chip">matched {trace.matchedCount}</span>
                      <span className="chip">accepted {trace.acceptedCount}</span>
                      <span className="chip">rejected {trace.rejectedCount}</span>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-4 text-sm text-slate-400">
              {traces.length ? "No events match the current filters." : "No events yet."}
            </div>
          )}
        </div>

        <EventTraceDetail trace={selectedTrace} nodeTitles={nodeTitles} />
      </div>
    </section>
  );
}

function CafeMetricsCard({ metrics }: { metrics: CafeMetrics }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">Cafe metrics</div>
        <div className="chip">{metrics.activeTables}/10 tables in use</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-sm text-slate-200">
        <Metric label="Seen" value={String(metrics.customersSeen)} />
        <Metric label="Queued" value={String(metrics.queued)} />
        <Metric label="Seated" value={String(metrics.seated)} />
        <Metric label="Orders" value={String(metrics.openOrders)} />
        <Metric label="Completed" value={String(metrics.completedVisits)} />
        <Metric label="Turned away" value={String(metrics.turnedAway)} />
        <Metric label="Revenue" value={formatMoney(metrics.revenue)} />
        <Metric label="Tips" value={formatMoney(metrics.tips)} />
      </div>
    </section>
  );
}

function CafeConfigPanel({
  config,
  onChange,
  onResetDefaults,
  tuningSections,
  onToggleSection,
}: {
  config: CafeScenarioConfig;
  onChange: React.Dispatch<React.SetStateAction<CafeScenarioConfig>>;
  onResetDefaults: () => void;
  tuningSections: {
    arrival: boolean;
    dining: boolean;
    billing: boolean;
    menu: boolean;
  };
  onToggleSection: (section: "arrival" | "dining" | "billing" | "menu") => void;
}) {
  function updateNumber<K extends keyof CafeScenarioConfig>(key: K, value: string) {
    onChange((current) => ({
      ...current,
      [key]: Math.max(0, Number(value) || 0),
    }));
  }

  function updateDish(index: number, patch: Partial<CafeDishConfig>) {
    onChange((current) => ({
      ...current,
      dishes: current.dishes.map((dish, dishIndex) => (dishIndex === index ? { ...dish, ...patch } : dish)),
    }));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-2.5">
        <div className="text-[11px] leading-4 text-slate-400">
          The client-side runner reads these values live while it is publishing to the bus.
        </div>
        <button className="glass-button shrink-0" onClick={onResetDefaults}>
          Defaults
        </button>
      </div>

      <CompactGroup
        title="Arrival"
        summary="Arrival rate and queue intake."
        open={tuningSections.arrival}
        onToggle={() => onToggleSection("arrival")}
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Arrival min ms" value={config.arrivalMinMs} onChange={(value) => updateNumber("arrivalMinMs", value)} />
          <NumberField label="Arrival max ms" value={config.arrivalMaxMs} onChange={(value) => updateNumber("arrivalMaxMs", value)} />
          <NumberField label="Queue capacity" value={config.queueCapacity} onChange={(value) => updateNumber("queueCapacity", value)} />
          <NumberField label="Greeting ms" value={config.greetingMs} onChange={(value) => updateNumber("greetingMs", value)} />
        </div>
      </CompactGroup>

      <CompactGroup
        title="Dining"
        summary="Seating, menu, ordering, service, and eat timings."
        open={tuningSections.dining}
        onToggle={() => onToggleSection("dining")}
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Seating ms" value={config.seatingMs} onChange={(value) => updateNumber("seatingMs", value)} />
          <NumberField label="Menu ms" value={config.menuMs} onChange={(value) => updateNumber("menuMs", value)} />
          <NumberField label="Order ms" value={config.orderMs} onChange={(value) => updateNumber("orderMs", value)} />
          <NumberField label="Serve ms" value={config.serveMs} onChange={(value) => updateNumber("serveMs", value)} />
          <NumberField label="Decision min ms" value={config.decisionMinMs} onChange={(value) => updateNumber("decisionMinMs", value)} />
          <NumberField label="Decision max ms" value={config.decisionMaxMs} onChange={(value) => updateNumber("decisionMaxMs", value)} />
          <NumberField label="Eat min ms" value={config.eatMinMs} onChange={(value) => updateNumber("eatMinMs", value)} />
          <NumberField label="Eat max ms" value={config.eatMaxMs} onChange={(value) => updateNumber("eatMaxMs", value)} />
        </div>
      </CompactGroup>

      <CompactGroup
        title="Billing"
        summary="Bill timing, patience, and tipping behaviour."
        open={tuningSections.billing}
        onToggle={() => onToggleSection("billing")}
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Bill ms" value={config.billMs} onChange={(value) => updateNumber("billMs", value)} />
          <NumberField label="Bill patience ms" value={config.billPatienceMs} onChange={(value) => updateNumber("billPatienceMs", value)} />
          <NumberField label="Tip %" value={Math.round(config.tipPercent * 100)} onChange={(value) => onChange((current) => ({ ...current, tipPercent: (Number(value) || 0) / 100 }))} />
          <NumberField label="Tip floor $" value={config.tipFlat} onChange={(value) => updateNumber("tipFlat", value)} />
        </div>
      </CompactGroup>

      <CompactGroup
        title="Menu"
        summary="Dish names, prices, and prep timings."
        open={tuningSections.menu}
        onToggle={() => onToggleSection("menu")}
      >
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_84px_92px] gap-2 px-2">
            <div className="label">Dish</div>
            <div className="label">Price</div>
            <div className="label">Prep ms</div>
          </div>
          {config.dishes.map((dish, index) => (
            <div key={dish.id} className="rounded-2xl border border-white/10 bg-black/20 p-2">
              <div className="grid grid-cols-[1fr_84px_92px] gap-2">
                <input className="field" value={dish.name} onChange={(event) => updateDish(index, { name: event.target.value })} />
                <input
                  className="field"
                  type="number"
                  min={0}
                  step="0.5"
                  value={dish.price}
                  onChange={(event) => updateDish(index, { price: Math.max(0, Number(event.target.value) || 0) })}
                />
                <input
                  className="field"
                  type="number"
                  min={0}
                  step="100"
                  value={dish.prepMs}
                  onChange={(event) => updateDish(index, { prepMs: Math.max(0, Number(event.target.value) || 0) })}
                />
              </div>
            </div>
          ))}
        </div>
      </CompactGroup>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <div className="label mb-1.5">{label}</div>
      <input className="field" type="number" min={0} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-black/20 px-2.5 py-2">
      <div className="label">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function DeliveryCard({
  delivery,
  subscriberLabel,
}: {
  delivery: DeliveryTrace;
  subscriberLabel: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">{subscriberLabel}</div>
        <div className={`chip ${delivery.accepted ? "border-cyan-400/20 bg-cyan-400/10" : ""}`}>
          {delivery.accepted ? "accepted" : "dropped"}
        </div>
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-400">{delivery.expression}</div>
      <div className="mt-2 rounded-xl bg-black/30 px-3 py-2 text-[11px] text-slate-100">
        {summarizePayload(delivery.payload)}
      </div>
      {Object.keys(delivery.params).length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(delivery.params).map(([key, value]) => (
            <span key={key} className="chip">
              {key}={value}
            </span>
          ))}
        </div>
      ) : null}
      {delivery.reason ? <div className="mt-2 text-xs text-rose-300">{delivery.reason}</div> : null}
    </article>
  );
}

function SidebarSection({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-2.5 py-2.5 text-left"
        onClick={onToggle}
      >
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-[11px] leading-4 text-slate-400">{subtitle}</div>
        </div>
        <span className="chip">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? <div className="border-t border-white/8 px-2.5 py-2.5">{children}</div> : null}
    </section>
  );
}

function CompactGroup({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left" onClick={onToggle}>
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{summary}</div>
        </div>
        <span className="chip">{open ? "Open" : "Closed"}</span>
      </button>
      {open ? <div className="border-t border-white/8 px-2.5 py-2.5">{children}</div> : null}
    </div>
  );
}

function SelectedNodePanel({ node }: { node: DemoNodeData | null }) {
  if (!node) {
    return (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-400">
        Select a node in the graph to inspect its role, address or expression, recent activity, and queue state.
      </div>
    );
  }

  const queueItems = "queueItems" in node ? node.queueItems ?? [] : [];
  const queueLabel = "queueLabel" in node ? node.queueLabel : undefined;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{node.title}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">{node.kind}</div>
          </div>
          <div className="chip">{node.lastPulse ? "active" : "idle"}</div>
        </div>
        {node.note ? <div className="mt-2.5 text-[12px] leading-5 text-slate-300">{node.note}</div> : null}
      </div>

      {"address" in node ? <DetailField label="Address" value={node.address} mono /> : null}
      {"expression" in node ? <DetailField label="Expression" value={node.expression} mono /> : null}
      {"serviceName" in node ? <DetailField label="Service" value={node.serviceName} /> : null}
      {node.primitiveType ? <DetailField label="Primitive" value={node.primitiveType} /> : null}
      {node.instanceName ? <DetailField label="Instance" value={node.instanceName} /> : null}
      {node.primitiveConfig ? (
        <DetailField label="Primitive config" value={JSON.stringify(node.primitiveConfig, null, 2)} mono multiline />
      ) : null}

      {node.activityLabel ? (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2.5">
          <div className="label">Latest activity</div>
          <div className="mt-2 text-sm font-semibold text-cyan-100">{node.activityLabel}</div>
          {node.activityValue ? <div className="mt-1 text-[11px] text-cyan-100/90">{node.activityValue}</div> : null}
        </div>
      ) : null}

      {queueLabel ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-white">{queueLabel}</div>
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white">
              {queueItems.length}
            </span>
          </div>
          {queueItems.length ? (
            <div className="mt-2.5 max-h-56 space-y-1 overflow-auto rounded-xl bg-black/20 p-2">
              {queueItems.map((item) => (
                <div key={item} className="truncate rounded-lg bg-black/30 px-3 py-2 text-[11px] text-slate-100" title={item}>
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2.5 rounded-xl bg-black/20 px-3 py-2 text-[11px] text-slate-400">No items waiting.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
  multiline = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="label">{label}</div>
      <div
        className={`mt-1.5 break-words text-[12px] text-slate-100 ${mono ? "font-mono" : ""} ${multiline ? "whitespace-pre-wrap" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function EventTraceDetail({
  trace,
  nodeTitles,
}: {
  trace: PublishTrace | null;
  nodeTitles: Map<string, string>;
}) {
  if (!trace) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-400">
        Select an event from the list to inspect full payload and delivery detail.
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{nodeTitles.get(trace.fromNodeId) ?? trace.fromNodeId}</div>
          <div className="mt-1 font-mono text-[11px] text-cyan-100">{trace.address}</div>
        </div>
        <div className="chip">#{trace.signalId}</div>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <span className="chip">matched {trace.matchedCount}</span>
        <span className="chip">accepted {trace.acceptedCount}</span>
        <span className="chip">rejected {trace.rejectedCount}</span>
      </div>

      <div className="mt-2.5 rounded-xl bg-black/30 p-2.5">
        <div className="label mb-2">Payload</div>
        <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-100">
          {typeof trace.payload === "string" ? trace.payload : JSON.stringify(trace.payload, null, 2)}
        </pre>
      </div>

      <div className="mt-2.5">
        <div className="label mb-1.5">Deliveries</div>
        <div className="space-y-2">
          {trace.deliveries.length ? (
            trace.deliveries.map((delivery, index) => (
              <DeliveryCard
                key={`${delivery.subscriberNodeId}-${index}`}
                delivery={delivery}
                subscriberLabel={nodeTitles.get(delivery.subscriberNodeId) ?? delivery.subscriberNodeId}
              />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-400">
              No deliveries recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CanvasControls({
  onZoomIn,
  onZoomOut,
  onFitView,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}) {
  return (
    <div className="flow-controls flex flex-col overflow-hidden">
      <button type="button" className="flow-control-button" onClick={onZoomIn}>
        +
      </button>
      <button type="button" className="flow-control-button" onClick={onZoomOut}>
        -
      </button>
      <button type="button" className="flow-control-button text-[11px]" onClick={onFitView}>
        Fit
      </button>
    </div>
  );
}
