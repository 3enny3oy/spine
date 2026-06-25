use serde::{Deserialize, Serialize};
use serde_json::Value;
use spine::{
    Address, AddressExpression, ConflationPolicy, DeliveryContext, DeliveryMode, DeliveryOptions,
    HandlerError, OverflowPolicy, Payload, PublishResult, QueuePolicy, RecursionOverflowPolicy,
    RecursionPolicy, Schema, Signal, SignalBus, SignalId, SignalMetadata, SubscriptionHandle,
};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_ADDR: &str = "127.0.0.1:8787";
const CAFE_PUBLISHER_START_X: i32 = 60;
const CAFE_PUBLISHER_START_Y: i32 = 120;
const CAFE_PUBLISHER_COLUMN_STEP: i32 = 360;
const CAFE_PUBLISHER_ROW_STEP: i32 = 360;
const CAFE_SUBSCRIBER_X: i32 = 1200;
const CAFE_SUBSCRIBER_START_Y: i32 = 120;
const CAFE_SUBSCRIBER_ROW_STEP: i32 = 360;
const CAFE_SERVICE_X: i32 = 1540;
const CAFE_SERVICE_START_Y: i32 = 480;
const CAFE_SERVICE_ROW_STEP: i32 = 240;

fn scenarios_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scenarios")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioState {
    id: String,
    title: String,
    description: String,
    supports_simulation: bool,
    edges: Vec<ScenarioEdgeDefinition>,
    simulation_kind: Option<String>,
    cafe_config: Option<CafeScenarioConfig>,
    blueprint: Option<SimulationBlueprintFile>,
    #[serde(skip_serializing)]
    materialized_from_blueprint: bool,
}

impl ScenarioState {
    fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "null".to_string())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioOption {
    id: String,
    title: String,
    description: String,
    supports_simulation: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioFile {
    id: String,
    title: String,
    description: String,
    supports_simulation: bool,
    #[serde(default)]
    simulation_kind: Option<String>,
    #[serde(default)]
    cafe_config: Option<CafeScenarioConfig>,
    #[serde(default)]
    blueprint: Option<SimulationBlueprintFile>,
    config: ScenarioConfigFile,
    #[serde(default)]
    nodes: Vec<ScenarioNodeFile>,
    #[serde(default)]
    edges: Vec<ScenarioEdgeDefinition>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PositionFile {
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioEdgeDefinition {
    id: String,
    source: String,
    target: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationBlueprintFile {
    primitive_schema_version: u32,
    #[serde(default)]
    instance_config: Option<Value>,
    #[serde(default)]
    globals: Option<Value>,
    #[serde(default)]
    nodes: Vec<BlueprintNodeFile>,
    #[serde(default)]
    edges: Vec<BlueprintEdgeFile>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlueprintNodeFile {
    id: String,
    kind: String,
    primitive_type: String,
    instance_name: String,
    title: String,
    position: PositionFile,
    #[serde(default)]
    note: String,
    #[serde(default)]
    config: Option<Value>,
    bindings: BlueprintBindingsFile,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlueprintBindingsFile {
    #[serde(default)]
    address: Option<String>,
    #[serde(default)]
    payload_text: Option<String>,
    #[serde(default)]
    signal_kind: Option<String>,
    #[serde(default)]
    custom_signal_kind: Option<String>,
    #[serde(default)]
    expression: Option<String>,
    #[serde(default)]
    schema_id: Option<String>,
    #[serde(default)]
    delivery: Option<ScenarioDeliveryOptionsFile>,
    #[serde(default)]
    configuration_expression: Option<String>,
    #[serde(default)]
    queue_depth: Option<usize>,
    #[serde(default)]
    service_name: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlueprintEdgeFile {
    id: String,
    source: String,
    target: String,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    semantics: Option<Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioConfigFile {
    id: String,
    title: String,
    position: PositionFile,
    allow_catch_all: bool,
    default_queue_depth: usize,
    recursion_policy: ScenarioRecursionPolicyFile,
    note: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioRecursionPolicyFile {
    max_causation_depth: usize,
    on_exceeded: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ScenarioNodeFile {
    Publisher {
        id: String,
        title: String,
        position: PositionFile,
        #[serde(default)]
        primitive_type: Option<String>,
        #[serde(default)]
        instance_name: Option<String>,
        #[serde(default)]
        primitive_config: Option<Value>,
        address: String,
        #[serde(rename = "payloadText")]
        payload_text: String,
        #[serde(rename = "signalKind")]
        signal_kind: String,
        #[serde(rename = "customSignalKind")]
        custom_signal_kind: String,
        note: String,
    },
    Subscriber {
        id: String,
        title: String,
        position: PositionFile,
        #[serde(default)]
        primitive_type: Option<String>,
        #[serde(default)]
        instance_name: Option<String>,
        #[serde(default)]
        primitive_config: Option<Value>,
        expression: String,
        #[serde(rename = "schemaId")]
        schema_id: String,
        delivery: ScenarioDeliveryOptionsFile,
        #[serde(rename = "configurationExpression")]
        configuration_expression: String,
        #[serde(rename = "queueDepth")]
        queue_depth: usize,
        note: String,
    },
    Service {
        id: String,
        title: String,
        position: PositionFile,
        #[serde(default)]
        primitive_type: Option<String>,
        #[serde(default)]
        instance_name: Option<String>,
        #[serde(default)]
        primitive_config: Option<Value>,
        address: String,
        #[serde(rename = "serviceName")]
        service_name: String,
        note: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioDeliveryOptionsFile {
    mode: String,
    payload_strategy: String,
    retry: ScenarioRetryPolicyFile,
    timeout: ScenarioTimeoutPolicyFile,
    rate: ScenarioRatePolicyFile,
    timing: ScenarioTimingPolicyFile,
    conflation: String,
    queue: ScenarioQueuePolicyFile,
    payload_limits: ScenarioPayloadLimitsFile,
    ordering: String,
    recursion: ScenarioRecursionPolicyFile,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioRetryPolicyFile {
    max_attempts: u32,
    initial_delay_ms: u64,
    max_delay_ms: u64,
    backoff: String,
    jitter: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioTimeoutPolicyFile {
    handler_timeout_ms: Option<u64>,
    delivery_deadline_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioRatePolicyFile {
    max_per_second: Option<u64>,
    burst: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioTimingPolicyFile {
    debounce_ms: Option<u64>,
    throttle_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioQueuePolicyFile {
    max_depth: usize,
    overflow: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioPayloadLimitsFile {
    max_inline_bytes: Option<usize>,
    max_depth: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CafeScenarioConfig {
    arrival_min_ms: u64,
    arrival_max_ms: u64,
    queue_capacity: usize,
    greeting_ms: u64,
    seating_ms: u64,
    menu_ms: u64,
    order_ms: u64,
    serve_ms: u64,
    bill_ms: u64,
    decision_min_ms: u64,
    decision_max_ms: u64,
    eat_min_ms: u64,
    eat_max_ms: u64,
    bill_patience_ms: u64,
    tip_percent: f64,
    tip_flat: f64,
    dishes: Vec<CafeDishConfig>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CafeDishConfig {
    id: String,
    name: String,
    price: f64,
    prep_ms: u64,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let runtime = Arc::new(Runtime::new());
    let listener =
        TcpListener::bind(DEFAULT_ADDR).map_err(|err| format!("bind {DEFAULT_ADDR}: {err}"))?;
    eprintln!("SPINE visualizer backend listening on http://{DEFAULT_ADDR}");

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let runtime = runtime.clone();
        thread::spawn(move || {
            if let Err(err) = handle_connection(runtime, stream) {
                eprintln!("{err}");
            }
        });
    }

    Ok(())
}

struct Runtime {
    inner: Arc<Mutex<AppState>>,
    update_cv: Arc<Condvar>,
    events: Broadcaster,
    bus: Arc<Mutex<SignalBus>>,
    handles: Arc<Mutex<Vec<SubscriptionHandle>>>,
}

impl Runtime {
    fn new() -> Self {
        let runtime = Self {
            inner: Arc::new(Mutex::new(AppState::default())),
            update_cv: Arc::new(Condvar::new()),
            events: Broadcaster::new(),
            bus: Arc::new(Mutex::new(
                SignalBus::builder()
                    .allow_catch_all(false)
                    .default_queue_depth(1024)
                    .build(),
            )),
            handles: Arc::new(Mutex::new(Vec::new())),
        };
        runtime.sync_bus().expect("initial sync");
        runtime
    }

    fn snapshot(&self) -> Snapshot {
        let state = self.inner.lock().unwrap();
        state.snapshot()
    }

    fn sync_bus(&self) -> Result<(), String> {
        let state = self.inner.lock().unwrap().clone();
        let default_queue_depth = state.config.default_queue_depth;
        let recursion_policy = state.config.recursion_policy.clone();
        let allow_catch_all = state.config.allow_catch_all;
        let bus = SignalBus::builder()
            .allow_catch_all(allow_catch_all)
            .default_queue_depth(default_queue_depth)
            .recursion_policy(recursion_policy)
            .build();

        let mut handles = Vec::new();
        for subscriber in state.nodes.iter().filter_map(|node| match node {
            Node::Subscriber(subscriber) => Some(subscriber.clone()),
            _ => None,
        }) {
            let state = Arc::clone(&self.inner);
            let update_cv = Arc::clone(&self.update_cv);
            let events = self.events.clone();
            let options = delivery_options_for_subscriber(&subscriber, default_queue_depth);
            let subscriber_id = subscriber.id.clone();
            let subscribe_error_id = subscriber_id.clone();
            let handle = bus
                .subscribe::<String, _, _>(
                    subscriber.expression.clone(),
                    Schema::of::<String>(),
                    options,
                    move |ctx, signal| {
                        let state = Arc::clone(&state);
                        let update_cv = Arc::clone(&update_cv);
                        let events = events.clone();
                        let subscriber_id = subscriber_id.clone();
                        async move {
                            record_delivery(
                                &state,
                                &update_cv,
                                &events,
                                subscriber_id,
                                ctx,
                                signal,
                            )?;
                            Ok(())
                        }
                    },
                )
                .map_err(|err| format!("subscribe {}: {err}", subscribe_error_id))?;
            handles.push(handle);
        }

        let mut current_bus = self.bus.lock().unwrap();
        *current_bus = bus;
        *self.handles.lock().unwrap() = handles;
        Ok(())
    }

    fn publish_from(&self, publisher_id: &str) -> Result<Snapshot, String> {
        let publisher = {
            let state = self.inner.lock().unwrap();
            match state.nodes.iter().find_map(|node| match node {
                Node::Publisher(publisher) if publisher.id == publisher_id => {
                    Some(publisher.clone())
                }
                _ => None,
            }) {
                Some(publisher) => publisher,
                None => return Err(format!("publisher not found: {publisher_id}")),
            }
        };

        self.publish_signal(&publisher.id, publisher.address, publisher.payload_text)
    }

    fn publish_signal(
        &self,
        from_node_id: &str,
        address: String,
        payload_text: String,
    ) -> Result<Snapshot, String> {
        {
            let state = self.inner.lock().unwrap();
            if state.nodes.iter().all(|node| node.id() != from_node_id) {
                return Err(format!("node not found: {from_node_id}"));
            }
        }

        let bus = self.bus.lock().unwrap().clone();
        let result = bus
            .publish(address.clone(), payload_text.clone())
            .map_err(|err| format!("publish failed: {err}"))?;
        self.wait_for_deliveries(result.signal_id, result.accepted_deliveries);

        let mut state = self.inner.lock().unwrap();
        if let Some(node) = state
            .nodes
            .iter_mut()
            .find(|node| node.id() == from_node_id)
        {
            node.mark_pulse(now_millis());
        }
        let trace = trace_from_signal(&state, from_node_id, &address, &payload_text, result);
        state.publish_history.insert(0, trace);
        state.publish_history.truncate(200);
        let snapshot = state.snapshot();
        drop(state);
        self.events.broadcast(snapshot.to_json());
        Ok(snapshot)
    }

    fn load_scenario(&self, scenario_id: &str) -> Result<Snapshot, String> {
        let mut state = self.inner.lock().unwrap();
        *state = AppState::for_scenario(scenario_id)?;
        drop(state);
        self.sync_bus()?;
        let snapshot = self.snapshot();
        self.events.broadcast(snapshot.to_json());
        Ok(snapshot)
    }

    fn wait_for_deliveries(&self, signal_id: SignalId, expected: usize) {
        if expected == 0 {
            return;
        }
        let mut guard = self.inner.lock().unwrap();
        let deadline = SystemTime::now() + Duration::from_millis(500);
        loop {
            let delivered = guard
                .publish_delivery_counts
                .get(&signal_id.0)
                .copied()
                .unwrap_or(0);
            if delivered >= expected {
                return;
            }
            let now = SystemTime::now();
            if now >= deadline {
                return;
            }
            let timeout = deadline.duration_since(now).unwrap_or_default();
            let (next_guard, _) = self.update_cv.wait_timeout(guard, timeout).unwrap();
            guard = next_guard;
        }
    }

    fn update_config(&self, form: &HashMap<String, String>) -> Result<Snapshot, String> {
        let mut state = self.inner.lock().unwrap();
        state.config.apply(form);
        drop(state);
        self.sync_bus()?;
        let snapshot = self.snapshot();
        self.events.broadcast(snapshot.to_json());
        Ok(snapshot)
    }

    fn create_node(&self, form: &HashMap<String, String>) -> Result<Snapshot, String> {
        let kind = form.get("kind").ok_or("missing kind")?.as_str();
        let mut state = self.inner.lock().unwrap();
        let idx = state.nodes.len() + 1;
        let node = match kind {
            "publisher" => {
                let (x, y) = next_publisher_position(&state);
                Node::Publisher(PublisherNode::default_with_id(
                    format!("publisher-{idx}"),
                    x,
                    y,
                ))
            }
            "subscriber" => {
                let (x, y) = next_subscriber_position(&state);
                Node::Subscriber(SubscriberNode::default_with_id(
                    format!("subscriber-{idx}"),
                    x,
                    y,
                ))
            }
            "config" => return Err("only one config node is supported per scenario".to_string()),
            "service" => {
                let (x, y) = next_service_position(&state);
                Node::Service(ServiceNode::default_with_id(format!("service-{idx}"), x, y))
            }
            other => return Err(format!("unsupported kind: {other}")),
        };
        state.nodes.push(node);
        drop(state);
        self.sync_bus()?;
        let snapshot = self.snapshot();
        self.events.broadcast(snapshot.to_json());
        Ok(snapshot)
    }

    fn update_node(
        &self,
        node_id: &str,
        form: &HashMap<String, String>,
    ) -> Result<Snapshot, String> {
        let mut state = self.inner.lock().unwrap();
        let Some(node) = state.nodes.iter_mut().find(|node| node.id() == node_id) else {
            return Err(format!("node not found: {node_id}"));
        };
        node.apply(form);
        drop(state);
        self.sync_bus()?;
        let snapshot = self.snapshot();
        self.events.broadcast(snapshot.to_json());
        Ok(snapshot)
    }

    fn json_state(&self) -> String {
        self.snapshot().to_json()
    }

    fn scenario_options_json(&self) -> Result<String, String> {
        let options = ScenarioFile::list_options()?;
        serde_json::to_string(&options).map_err(|err| format!("encode scenarios: {err}"))
    }

    fn save_scenario(&self, scenario_id: &str) -> Result<Snapshot, String> {
        let state = self.inner.lock().unwrap().clone();
        if state.scenario.id != scenario_id {
            return Err(format!(
                "loaded scenario is {}, cannot save {}",
                state.scenario.id, scenario_id
            ));
        }
        ScenarioFile::from_state(&state).save()?;
        Ok(self.snapshot())
    }
}

impl ScenarioFile {
    fn path_for(scenario_id: &str) -> PathBuf {
        scenarios_dir().join(format!("{scenario_id}.json"))
    }

    fn load(scenario_id: &str) -> Result<Self, String> {
        let path = Self::path_for(scenario_id);
        let contents =
            fs::read_to_string(&path).map_err(|err| format!("read {}: {err}", path.display()))?;
        serde_json::from_str(&contents).map_err(|err| format!("parse {}: {err}", path.display()))
    }

    fn load_all() -> Result<Vec<Self>, String> {
        let dir = scenarios_dir();
        let entries = fs::read_dir(&dir).map_err(|err| format!("read {}: {err}", dir.display()))?;
        let mut files = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|err| format!("scan {}: {err}", dir.display()))?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let contents = fs::read_to_string(&path)
                .map_err(|err| format!("read {}: {err}", path.display()))?;
            let file: ScenarioFile = serde_json::from_str(&contents)
                .map_err(|err| format!("parse {}: {err}", path.display()))?;
            files.push(file);
        }
        files.sort_by(|left, right| {
            left.title
                .cmp(&right.title)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(files)
    }

    fn list_options() -> Result<Vec<ScenarioOption>, String> {
        Ok(Self::load_all()?
            .into_iter()
            .map(|file| file.into_option())
            .collect())
    }

    fn save(&self) -> Result<(), String> {
        let path = Self::path_for(&self.id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("create {}: {err}", parent.display()))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|err| format!("encode scenario {}: {err}", self.id))?;
        fs::write(&path, json).map_err(|err| format!("write {}: {err}", path.display()))
    }

    fn into_option(self) -> ScenarioOption {
        ScenarioOption {
            id: self.id,
            title: self.title,
            description: self.description,
            supports_simulation: self.supports_simulation,
        }
    }

    fn into_app_state(self) -> Result<AppState, String> {
        let materialized_from_blueprint = self.nodes.is_empty() && self.blueprint.is_some();
        let scenario_edges = if self.edges.is_empty() {
            self.blueprint
                .as_ref()
                .map(SimulationBlueprintFile::to_scenario_edges)
                .unwrap_or_default()
        } else {
            self.edges.clone()
        };

        let runtime_nodes = if self.nodes.is_empty() {
            self.blueprint
                .as_ref()
                .map(SimulationBlueprintFile::instantiate_nodes)
                .transpose()?
                .unwrap_or_default()
        } else {
            self.nodes
                .into_iter()
                .map(ScenarioNodeFile::into_runtime)
                .collect()
        };

        Ok(AppState {
            scenario: ScenarioState {
                id: self.id,
                title: self.title,
                description: self.description,
                supports_simulation: self.supports_simulation,
                edges: scenario_edges,
                simulation_kind: self.simulation_kind,
                cafe_config: self.cafe_config,
                blueprint: self.blueprint,
                materialized_from_blueprint,
            },
            config: self.config.into_runtime(),
            nodes: runtime_nodes,
            publish_history: Vec::new(),
            publish_delivery_counts: HashMap::new(),
        })
    }

    fn from_state(state: &AppState) -> Self {
        Self {
            id: state.scenario.id.clone(),
            title: state.scenario.title.clone(),
            description: state.scenario.description.clone(),
            supports_simulation: state.scenario.supports_simulation,
            simulation_kind: state.scenario.simulation_kind.clone(),
            cafe_config: state.scenario.cafe_config.clone(),
            blueprint: state.scenario.blueprint.clone(),
            config: ScenarioConfigFile::from_runtime(&state.config),
            nodes: if state.scenario.materialized_from_blueprint {
                Vec::new()
            } else {
                state.nodes
                    .iter()
                    .filter_map(ScenarioNodeFile::from_runtime)
                    .collect()
            },
            edges: if state.scenario.materialized_from_blueprint {
                Vec::new()
            } else {
                state.scenario.edges.clone()
            },
        }
    }
}

#[derive(Clone)]
struct AppState {
    scenario: ScenarioState,
    config: ConfigNode,
    nodes: Vec<Node>,
    publish_history: Vec<PublishTrace>,
    publish_delivery_counts: HashMap<u64, usize>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::for_scenario("cafe-pipeline").expect("default scenario")
    }
}

impl AppState {
    fn for_scenario(scenario_id: &str) -> Result<Self, String> {
        ScenarioFile::load(scenario_id)?.into_app_state()
    }

    fn snapshot(&self) -> Snapshot {
        let mut nodes = Vec::with_capacity(self.nodes.len() + 1);
        nodes.push(Node::Config(self.config.clone()));
        nodes.extend(self.nodes.clone());
        let routes = compute_routes(&nodes, &self.config);
        Snapshot {
            scenario_id: self.scenario.id.clone(),
            scenario: self.scenario.clone(),
            config: self.config.clone(),
            nodes,
            publish_history: self.publish_history.clone(),
            routes,
            last_error: None,
        }
    }
}

impl SimulationBlueprintFile {
    fn instantiate_nodes(&self) -> Result<Vec<Node>, String> {
        self.nodes
            .iter()
            .cloned()
            .map(BlueprintNodeFile::into_runtime)
            .collect()
    }

    fn to_scenario_edges(&self) -> Vec<ScenarioEdgeDefinition> {
        self.edges
            .iter()
            .map(BlueprintEdgeFile::to_scenario_edge)
            .collect()
    }
}

impl BlueprintNodeFile {
    fn into_runtime(self) -> Result<Node, String> {
        let BlueprintNodeFile {
            id,
            kind,
            primitive_type,
            instance_name,
            title,
            position,
            note,
            config,
            bindings,
        } = self;

        match kind.as_str() {
            "publisher" => Ok(Node::Publisher(PublisherNode {
                id: id.clone(),
                title,
                last_pulse: 0,
                position_x: position.x,
                position_y: position.y,
                primitive_type: Some(primitive_type),
                instance_name: Some(instance_name),
                primitive_config: config,
                address: required_binding(&bindings.address, &id, "address")?,
                payload_text: bindings.payload_text.unwrap_or_else(|| "{}".to_string()),
                signal_kind: bindings
                    .signal_kind
                    .unwrap_or_else(|| "Event".to_string()),
                custom_signal_kind: bindings.custom_signal_kind.unwrap_or_default(),
                metadata: SignalMetadata::default(),
                note,
            })),
            "subscriber" => {
                let delivery = bindings
                    .delivery
                    .map(ScenarioDeliveryOptionsFile::into_runtime)
                    .unwrap_or_default();
                let queue_depth = bindings.queue_depth.unwrap_or(delivery.queue.max_depth);
                Ok(Node::Subscriber(SubscriberNode {
                    id: id.clone(),
                    title,
                    last_pulse: 0,
                    position_x: position.x,
                    position_y: position.y,
                    primitive_type: Some(primitive_type),
                    instance_name: Some(instance_name),
                    primitive_config: config,
                    expression: required_binding(&bindings.expression, &id, "expression")?,
                    schema_id: required_binding(&bindings.schema_id, &id, "schemaId")?,
                    delivery,
                    received: Vec::new(),
                    configuration_expression: bindings
                        .configuration_expression
                        .unwrap_or_default(),
                    queue_depth,
                    note,
                }))
            }
            "service" => Ok(Node::Service(ServiceNode {
                id: id.clone(),
                title,
                last_pulse: 0,
                position_x: position.x,
                position_y: position.y,
                primitive_type: Some(primitive_type),
                instance_name: Some(instance_name),
                primitive_config: config,
                address: required_binding(&bindings.address, &id, "address")?,
                service_name: required_binding(&bindings.service_name, &id, "serviceName")?,
                note,
            })),
            other => Err(format!(
                "unsupported blueprint node kind {other} for {}",
                id
            )),
        }
    }
}

impl BlueprintEdgeFile {
    fn to_scenario_edge(&self) -> ScenarioEdgeDefinition {
        ScenarioEdgeDefinition {
            id: self.id.clone(),
            source: self.source.clone(),
            target: self.target.clone(),
        }
    }
}

fn next_publisher_position(state: &AppState) -> (i32, i32) {
    let index = state
        .nodes
        .iter()
        .filter(|node| matches!(node, Node::Publisher(_)))
        .count();
    let column = (index % 3) as i32;
    let row = (index / 3) as i32;
    (
        CAFE_PUBLISHER_START_X + column * CAFE_PUBLISHER_COLUMN_STEP,
        CAFE_PUBLISHER_START_Y + row * CAFE_PUBLISHER_ROW_STEP,
    )
}

fn next_subscriber_position(state: &AppState) -> (i32, i32) {
    let index = state
        .nodes
        .iter()
        .filter(|node| matches!(node, Node::Subscriber(_)))
        .count();
    (
        CAFE_SUBSCRIBER_X,
        CAFE_SUBSCRIBER_START_Y + index as i32 * CAFE_SUBSCRIBER_ROW_STEP,
    )
}

fn next_service_position(state: &AppState) -> (i32, i32) {
    let index = state
        .nodes
        .iter()
        .filter(|node| matches!(node, Node::Service(_)))
        .count();
    (
        CAFE_SERVICE_X,
        CAFE_SERVICE_START_Y + index as i32 * CAFE_SERVICE_ROW_STEP,
    )
}

#[derive(Clone)]
struct Snapshot {
    scenario_id: String,
    scenario: ScenarioState,
    config: ConfigNode,
    nodes: Vec<Node>,
    publish_history: Vec<PublishTrace>,
    routes: Vec<RouteEdge>,
    last_error: Option<String>,
}

impl Snapshot {
    fn to_json(&self) -> String {
        let mut out = String::new();
        out.push('{');
        write!(out, "\"scenarioId\":{},", json_string(&self.scenario_id)).unwrap();
        write!(out, "\"scenario\":{},", self.scenario.to_json()).unwrap();
        write!(out, "\"config\":{},", self.config.to_json()).unwrap();
        out.push_str("\"nodes\":[");
        for (index, node) in self.nodes.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&node.to_json());
        }
        out.push_str("],\"publishHistory\":[");
        for (index, trace) in self.publish_history.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&trace.to_json());
        }
        out.push_str("],\"routes\":[");
        for (index, edge) in self.routes.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&edge.to_json());
        }
        out.push_str("],\"lastError\":");
        match &self.last_error {
            Some(message) => out.push_str(&json_string(message)),
            None => out.push_str("null"),
        }
        out.push('}');
        out
    }
}

#[derive(Clone)]
struct RouteEdge {
    id: String,
    source: String,
    target: String,
    label: String,
    accepted: bool,
}

impl RouteEdge {
    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"source\":{},\"target\":{},\"animated\":true,\"label\":{},\"data\":{{\"accepted\":{}}}}}",
            json_string(&self.id),
            json_string(&self.source),
            json_string(&self.target),
            json_string(&self.label),
            if self.accepted { "true" } else { "false" }
        )
    }
}

#[derive(Clone)]
struct PublishTrace {
    signal_id: u64,
    from_node_id: String,
    address: String,
    payload: String,
    matched_count: usize,
    accepted_count: usize,
    rejected_count: usize,
    deliveries: Vec<DeliveryTrace>,
}

impl PublishTrace {
    fn to_json(&self) -> String {
        let mut out = String::new();
        out.push('{');
        write!(
            out,
            "\"signalId\":{},\"fromNodeId\":{},\"address\":{},\"payload\":{},\"matchedCount\":{},\"acceptedCount\":{},\"rejectedCount\":{},\"deliveries\":[",
            self.signal_id,
            json_string(&self.from_node_id),
            json_string(&self.address),
            json_string(&self.payload),
            self.matched_count,
            self.accepted_count,
            self.rejected_count,
        )
        .unwrap();
        for (index, delivery) in self.deliveries.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&delivery.to_json());
        }
        out.push_str("]}");
        out
    }
}

#[derive(Clone)]
struct DeliveryTrace {
    subscriber_node_id: String,
    expression: String,
    params: HashMap<String, String>,
    payload: String,
    accepted: bool,
    reason: Option<String>,
}

impl DeliveryTrace {
    fn to_json(&self) -> String {
        let mut out = String::new();
        out.push('{');
        write!(
            out,
            "\"subscriberNodeId\":{},\"expression\":{},\"params\":{{",
            json_string(&self.subscriber_node_id),
            json_string(&self.expression)
        )
        .unwrap();
        for (index, (key, value)) in self.params.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write!(out, "{}:{}", json_string(key), json_string(value)).unwrap();
        }
        write!(
            out,
            "}},\"payload\":{},\"accepted\":{},\"reason\":{} }}",
            json_string(&self.payload),
            if self.accepted { "true" } else { "false" },
            match &self.reason {
                Some(reason) => json_string(reason),
                None => "null".to_string(),
            }
        )
        .unwrap();
        out
    }
}

#[derive(Clone)]
struct ConfigNode {
    id: String,
    title: String,
    last_pulse: u64,
    position_x: i32,
    position_y: i32,
    allow_catch_all: bool,
    default_queue_depth: usize,
    recursion_policy: RecursionPolicy,
    note: String,
}

impl ConfigNode {
    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"kind\":\"config\",\"title\":{},\"lastPulse\":{},\"allowCatchAll\":{},\"defaultQueueDepth\":{},\"recursionPolicy\":{{\"maxCausationDepth\":{},\"onExceeded\":{}}},\"note\":{},\"position\":{{\"x\":{},\"y\":{}}}}}",
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            if self.allow_catch_all { "true" } else { "false" },
            self.default_queue_depth,
            self.recursion_policy.max_causation_depth,
            json_string(match self.recursion_policy.on_exceeded {
                RecursionOverflowPolicy::RejectPublish => "RejectPublish",
                RecursionOverflowPolicy::Drop => "Drop",
            }),
            json_string(&self.note),
            self.position_x,
            self.position_y,
        )
    }

    fn to_flow_json(&self) -> String {
        format!(
            "{{\"id\":{},\"type\":\"config\",\"position\":{{\"x\":{},\"y\":{}}},\"data\":{{\"id\":{},\"kind\":\"config\",\"title\":{},\"lastPulse\":{},\"allowCatchAll\":{},\"defaultQueueDepth\":{},\"recursionPolicy\":{{\"maxCausationDepth\":{},\"onExceeded\":{}}},\"note\":{}}}}}",
            json_string(&self.id),
            self.position_x,
            self.position_y,
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            if self.allow_catch_all { "true" } else { "false" },
            self.default_queue_depth,
            self.recursion_policy.max_causation_depth,
            json_string(match self.recursion_policy.on_exceeded {
                RecursionOverflowPolicy::RejectPublish => "RejectPublish",
                RecursionOverflowPolicy::Drop => "Drop",
            }),
            json_string(&self.note),
        )
    }

    fn apply(&mut self, form: &HashMap<String, String>) {
        if let Some(title) = form.get("title") {
            self.title = title.clone();
        }
        if let Some(allow) = form.get("allow_catch_all") {
            self.allow_catch_all = allow == "true";
        }
        if let Some(depth) = form
            .get("default_queue_depth")
            .and_then(|value| value.parse::<usize>().ok())
        {
            self.default_queue_depth = depth;
        }
        if let Some(depth) = form
            .get("recursion_depth")
            .and_then(|value| value.parse::<usize>().ok())
        {
            self.recursion_policy.max_causation_depth = depth;
        }
        if let Some(on_exceeded) = form.get("on_exceeded") {
            self.recursion_policy.on_exceeded = if on_exceeded == "Drop" {
                RecursionOverflowPolicy::Drop
            } else {
                RecursionOverflowPolicy::RejectPublish
            };
        }
    }
}

#[derive(Clone)]
struct PublisherNode {
    id: String,
    title: String,
    last_pulse: u64,
    position_x: i32,
    position_y: i32,
    primitive_type: Option<String>,
    instance_name: Option<String>,
    primitive_config: Option<Value>,
    address: String,
    payload_text: String,
    signal_kind: String,
    custom_signal_kind: String,
    metadata: SignalMetadata,
    note: String,
}

impl PublisherNode {
    fn default_with_id(id: String, position_x: i32, position_y: i32) -> Self {
        Self {
            id,
            title: "Publisher".to_string(),
            last_pulse: 0,
            position_x,
            position_y,
            primitive_type: None,
            instance_name: None,
            primitive_config: None,
            address: "documents/doc-1/blocks/block-9/changed".to_string(),
            payload_text: "{\n  \"blockId\": \"block-9\",\n  \"revision\": 42,\n  \"text\": \"Hello from the Rust backend\"\n}".to_string(),
            signal_kind: "Event".to_string(),
            custom_signal_kind: String::new(),
            metadata: SignalMetadata::default(),
            note: "Publish from here".to_string(),
        }
    }

    fn to_json(&self) -> String {
        let mut out = String::new();
        write!(
            out,
            "{{\"id\":{},\"type\":\"publisher\",\"position\":{{\"x\":{},\"y\":{}}},\"data\":{{\"id\":{},\"kind\":\"publisher\",\"title\":{},\"lastPulse\":{},\"address\":{},\"payloadText\":{},\"signalKind\":{},\"customSignalKind\":{},\"metadata\":{}",
            json_string(&self.id),
            self.position_x,
            self.position_y,
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            json_string(&self.address),
            json_string(&self.payload_text),
            json_string(&self.signal_kind),
            json_string(&self.custom_signal_kind),
            signal_metadata_json(&self.metadata),
        )
        .unwrap();
        push_primitive_metadata(
            &mut out,
            &self.primitive_type,
            &self.instance_name,
            &self.primitive_config,
        );
        write!(out, ",\"note\":{}}}}}", json_string(&self.note)).unwrap();
        out
    }

    fn apply(&mut self, form: &HashMap<String, String>) {
        if let Some(title) = form.get("title") {
            self.title = title.clone();
        }
        if let Some(address) = form.get("address") {
            self.address = address.clone();
        }
        if let Some(payload_text) = form.get("payload_text") {
            self.payload_text = payload_text.clone();
        }
        if let Some(signal_kind) = form.get("signal_kind") {
            self.signal_kind = signal_kind.clone();
        }
        if let Some(custom_signal_kind) = form.get("custom_signal_kind") {
            self.custom_signal_kind = custom_signal_kind.clone();
        }
        apply_primitive_metadata(
            &mut self.primitive_type,
            &mut self.instance_name,
            &mut self.primitive_config,
            form,
        );
    }
}

#[derive(Clone)]
struct SubscriberNode {
    id: String,
    title: String,
    last_pulse: u64,
    position_x: i32,
    position_y: i32,
    primitive_type: Option<String>,
    instance_name: Option<String>,
    primitive_config: Option<Value>,
    expression: String,
    schema_id: String,
    delivery: DeliveryOptionsDto,
    received: Vec<DeliveryTrace>,
    configuration_expression: String,
    queue_depth: usize,
    note: String,
}

impl SubscriberNode {
    fn default_with_id(id: String, position_x: i32, position_y: i32) -> Self {
        Self {
            id,
            title: "Subscriber".to_string(),
            last_pulse: 0,
            position_x,
            position_y,
            primitive_type: None,
            instance_name: None,
            primitive_config: None,
            expression: "documents/{document_id}/blocks/{block_id}/changed".to_string(),
            schema_id: "document.block.changed.v1".to_string(),
            delivery: DeliveryOptionsDto::default(),
            received: Vec::new(),
            configuration_expression: String::new(),
            queue_depth: 8,
            note: "Receives matching signals".to_string(),
        }
    }

    fn to_json(&self) -> String {
        let mut out = String::new();
        out.push_str("{\"id\":");
        out.push_str(&json_string(&self.id));
        write!(
            out,
            ",\"type\":\"subscriber\",\"position\":{{\"x\":{},\"y\":{}}},\"data\":{{",
            self.position_x, self.position_y
        )
        .unwrap();
        write!(
            out,
            "\"id\":{},\"kind\":\"subscriber\",\"title\":{},\"lastPulse\":{},\"expression\":{},\"schemaId\":{},\"delivery\":{},\"received\":[",
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            json_string(&self.expression),
            json_string(&self.schema_id),
            self.delivery.to_json()
        )
        .unwrap();
        for (index, item) in self.received.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(&item.to_json());
        }
        out.push(']');
        push_primitive_metadata(
            &mut out,
            &self.primitive_type,
            &self.instance_name,
            &self.primitive_config,
        );
        write!(
            out,
            ",\"configurationExpression\":{},\"queueDepth\":{},\"note\":{}}}",
            json_string(&self.configuration_expression),
            self.queue_depth,
            json_string(&self.note),
        )
        .unwrap();
        out.push_str("}");
        out
    }

    fn apply(&mut self, form: &HashMap<String, String>) {
        if let Some(title) = form.get("title") {
            self.title = title.clone();
        }
        if let Some(expression) = form.get("expression") {
            self.expression = expression.clone();
        }
        if let Some(schema_id) = form.get("schema_id") {
            self.schema_id = schema_id.clone();
        }
        if let Some(queue_depth) = form
            .get("queue_depth")
            .and_then(|value| value.parse::<usize>().ok())
        {
            self.queue_depth = queue_depth;
            self.delivery.queue.max_depth = queue_depth;
        }
        if let Some(mode) = form.get("delivery_mode") {
            self.delivery.mode = mode.clone();
        }
        if let Some(strategy) = form.get("payload_strategy") {
            self.delivery.payload_strategy = strategy.clone();
        }
        if let Some(overflow) = form.get("overflow") {
            self.delivery.queue.overflow = match overflow.as_str() {
                "DropNewest" => OverflowPolicy::DropNewest,
                "DropOldest" => OverflowPolicy::DropOldest,
                "Conflate" => OverflowPolicy::Conflate,
                "Backpressure" => OverflowPolicy::Backpressure,
                _ => OverflowPolicy::RejectPublish,
            };
        }
        if let Some(debounce_ms) = form
            .get("debounce_ms")
            .and_then(|value| value.parse::<u64>().ok())
        {
            self.delivery.timing.debounce_ms = Some(debounce_ms);
        }
        if let Some(throttle_ms) = form
            .get("throttle_ms")
            .and_then(|value| value.parse::<u64>().ok())
        {
            self.delivery.timing.throttle_ms = Some(throttle_ms);
        }
        if let Some(configuration_expression) = form.get("configuration_expression") {
            self.configuration_expression = configuration_expression.clone();
        }
        apply_primitive_metadata(
            &mut self.primitive_type,
            &mut self.instance_name,
            &mut self.primitive_config,
            form,
        );
    }
}

#[derive(Clone)]
struct ServiceNode {
    id: String,
    title: String,
    last_pulse: u64,
    position_x: i32,
    position_y: i32,
    primitive_type: Option<String>,
    instance_name: Option<String>,
    primitive_config: Option<Value>,
    address: String,
    service_name: String,
    note: String,
}

impl ServiceNode {
    fn default_with_id(id: String, position_x: i32, position_y: i32) -> Self {
        Self {
            id,
            title: "Service".to_string(),
            last_pulse: 0,
            position_x,
            position_y,
            primitive_type: None,
            instance_name: None,
            primitive_config: None,
            address: "services/search/default".to_string(),
            service_name: "SearchService".to_string(),
            note: "Lookup through address space".to_string(),
        }
    }

    fn to_json(&self) -> String {
        let mut out = String::new();
        write!(
            out,
            "{{\"id\":{},\"type\":\"service\",\"position\":{{\"x\":{},\"y\":{}}},\"data\":{{\"id\":{},\"kind\":\"service\",\"title\":{},\"lastPulse\":{},\"address\":{},\"serviceName\":{}",
            json_string(&self.id),
            self.position_x,
            self.position_y,
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            json_string(&self.address),
            json_string(&self.service_name),
        )
        .unwrap();
        push_primitive_metadata(
            &mut out,
            &self.primitive_type,
            &self.instance_name,
            &self.primitive_config,
        );
        write!(out, ",\"note\":{}}}}}", json_string(&self.note)).unwrap();
        out
    }

    fn apply(&mut self, form: &HashMap<String, String>) {
        if let Some(title) = form.get("title") {
            self.title = title.clone();
        }
        if let Some(address) = form.get("address") {
            self.address = address.clone();
        }
        if let Some(service_name) = form.get("service_name") {
            self.service_name = service_name.clone();
        }
        apply_primitive_metadata(
            &mut self.primitive_type,
            &mut self.instance_name,
            &mut self.primitive_config,
            form,
        );
    }
}

#[derive(Clone)]
enum Node {
    Publisher(PublisherNode),
    Subscriber(SubscriberNode),
    Config(ConfigNode),
    Service(ServiceNode),
}

impl Node {
    fn id(&self) -> &str {
        match self {
            Node::Publisher(node) => &node.id,
            Node::Subscriber(node) => &node.id,
            Node::Config(node) => &node.id,
            Node::Service(node) => &node.id,
        }
    }

    fn to_json(&self) -> String {
        match self {
            Node::Publisher(node) => node.to_json(),
            Node::Subscriber(node) => node.to_json(),
            Node::Config(node) => node.to_flow_json(),
            Node::Service(node) => node.to_json(),
        }
    }

    fn apply(&mut self, form: &HashMap<String, String>) {
        match self {
            Node::Publisher(node) => node.apply(form),
            Node::Subscriber(node) => node.apply(form),
            Node::Config(node) => node.apply(form),
            Node::Service(node) => node.apply(form),
        }
    }

    fn mark_pulse(&mut self, timestamp: u64) {
        match self {
            Node::Publisher(node) => node.last_pulse = timestamp,
            Node::Subscriber(node) => node.last_pulse = timestamp,
            Node::Config(node) => node.last_pulse = timestamp,
            Node::Service(node) => node.last_pulse = timestamp,
        }
    }
}

#[derive(Clone)]
struct DeliveryOptionsDto {
    mode: String,
    payload_strategy: String,
    retry: RetryPolicyDto,
    timeout: TimeoutPolicyDto,
    rate: RatePolicyDto,
    timing: TimingPolicyDto,
    conflation: String,
    queue: QueuePolicyDto,
    payload_limits: PayloadLimitsDto,
    ordering: String,
    recursion: RecursionPolicyDto,
}

impl Default for DeliveryOptionsDto {
    fn default() -> Self {
        Self {
            mode: "FireAndForget".to_string(),
            payload_strategy: "SendPayload".to_string(),
            retry: RetryPolicyDto::default(),
            timeout: TimeoutPolicyDto::default(),
            rate: RatePolicyDto::default(),
            timing: TimingPolicyDto::default(),
            conflation: "None".to_string(),
            queue: QueuePolicyDto::default(),
            payload_limits: PayloadLimitsDto::default(),
            ordering: "PerSubscription".to_string(),
            recursion: RecursionPolicyDto::default(),
        }
    }
}

impl DeliveryOptionsDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"mode\":{},\"payloadStrategy\":{},\"retry\":{},\"timeout\":{},\"rate\":{},\"timing\":{},\"conflation\":{},\"queue\":{},\"payloadLimits\":{},\"ordering\":{},\"recursion\":{}}}",
            json_string(&self.mode),
            json_string(&self.payload_strategy),
            self.retry.to_json(),
            self.timeout.to_json(),
            self.rate.to_json(),
            self.timing.to_json(),
            json_string(&self.conflation),
            self.queue.to_json(),
            self.payload_limits.to_json(),
            json_string(&self.ordering),
            self.recursion.to_json(),
        )
    }
}

#[derive(Clone)]
struct RetryPolicyDto {
    max_attempts: u32,
    initial_delay_ms: u64,
    max_delay_ms: u64,
    backoff: String,
    jitter: bool,
}

impl Default for RetryPolicyDto {
    fn default() -> Self {
        Self {
            max_attempts: 0,
            initial_delay_ms: 0,
            max_delay_ms: 0,
            backoff: "Exponential".to_string(),
            jitter: false,
        }
    }
}

impl RetryPolicyDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"maxAttempts\":{},\"initialDelayMs\":{},\"maxDelayMs\":{},\"backoff\":{},\"jitter\":{}}}",
            self.max_attempts,
            self.initial_delay_ms,
            self.max_delay_ms,
            json_string(&self.backoff),
            if self.jitter { "true" } else { "false" },
        )
    }
}

#[derive(Clone)]
struct TimeoutPolicyDto {
    handler_timeout_ms: Option<u64>,
    delivery_deadline_ms: Option<u64>,
}

impl Default for TimeoutPolicyDto {
    fn default() -> Self {
        Self {
            handler_timeout_ms: None,
            delivery_deadline_ms: None,
        }
    }
}

impl TimeoutPolicyDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"handlerTimeoutMs\":{},\"deliveryDeadlineMs\":{}}}",
            opt_num(self.handler_timeout_ms),
            opt_num(self.delivery_deadline_ms),
        )
    }
}

#[derive(Clone)]
struct RatePolicyDto {
    max_per_second: Option<u64>,
    burst: Option<u64>,
}

impl Default for RatePolicyDto {
    fn default() -> Self {
        Self {
            max_per_second: None,
            burst: None,
        }
    }
}

impl RatePolicyDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"maxPerSecond\":{},\"burst\":{}}}",
            opt_num(self.max_per_second),
            opt_num(self.burst),
        )
    }
}

#[derive(Clone)]
struct TimingPolicyDto {
    debounce_ms: Option<u64>,
    throttle_ms: Option<u64>,
}

impl Default for TimingPolicyDto {
    fn default() -> Self {
        Self {
            debounce_ms: None,
            throttle_ms: None,
        }
    }
}

impl TimingPolicyDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"debounceMs\":{},\"throttleMs\":{}}}",
            opt_num(self.debounce_ms),
            opt_num(self.throttle_ms),
        )
    }
}

#[derive(Clone)]
struct QueuePolicyDto {
    max_depth: usize,
    overflow: OverflowPolicy,
}

impl Default for QueuePolicyDto {
    fn default() -> Self {
        Self {
            max_depth: 1024,
            overflow: OverflowPolicy::RejectPublish,
        }
    }
}

impl QueuePolicyDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"maxDepth\":{},\"overflow\":{}}}",
            self.max_depth,
            json_string(match self.overflow {
                OverflowPolicy::Backpressure => "Backpressure",
                OverflowPolicy::DropNewest => "DropNewest",
                OverflowPolicy::DropOldest => "DropOldest",
                OverflowPolicy::Conflate => "Conflate",
                OverflowPolicy::RejectPublish => "RejectPublish",
            }),
        )
    }
}

#[derive(Clone)]
struct PayloadLimitsDto {
    max_inline_bytes: Option<usize>,
    max_depth: Option<usize>,
}

impl Default for PayloadLimitsDto {
    fn default() -> Self {
        Self {
            max_inline_bytes: None,
            max_depth: None,
        }
    }
}

impl PayloadLimitsDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"maxInlineBytes\":{},\"maxDepth\":{}}}",
            opt_num(self.max_inline_bytes.map(|value| value as u64)),
            opt_num(self.max_depth.map(|value| value as u64)),
        )
    }
}

#[derive(Clone)]
struct RecursionPolicyDto {
    max_causation_depth: usize,
    on_exceeded: RecursionOverflowPolicy,
}

impl Default for RecursionPolicyDto {
    fn default() -> Self {
        Self {
            max_causation_depth: 32,
            on_exceeded: RecursionOverflowPolicy::RejectPublish,
        }
    }
}

impl RecursionPolicyDto {
    fn to_json(&self) -> String {
        format!(
            "{{\"maxCausationDepth\":{},\"onExceeded\":{}}}",
            self.max_causation_depth,
            json_string(match self.on_exceeded {
                RecursionOverflowPolicy::RejectPublish => "RejectPublish",
                RecursionOverflowPolicy::Drop => "Drop",
            }),
        )
    }
}

impl ScenarioConfigFile {
    fn into_runtime(self) -> ConfigNode {
        ConfigNode {
            id: self.id,
            title: self.title,
            last_pulse: 0,
            position_x: self.position.x,
            position_y: self.position.y,
            allow_catch_all: self.allow_catch_all,
            default_queue_depth: self.default_queue_depth,
            recursion_policy: RecursionPolicy {
                max_causation_depth: self.recursion_policy.max_causation_depth,
                on_exceeded: recursion_overflow_from_str(&self.recursion_policy.on_exceeded),
            },
            note: self.note,
        }
    }

    fn from_runtime(node: &ConfigNode) -> Self {
        Self {
            id: node.id.clone(),
            title: node.title.clone(),
            position: PositionFile {
                x: node.position_x,
                y: node.position_y,
            },
            allow_catch_all: node.allow_catch_all,
            default_queue_depth: node.default_queue_depth,
            recursion_policy: ScenarioRecursionPolicyFile {
                max_causation_depth: node.recursion_policy.max_causation_depth,
                on_exceeded: recursion_overflow_to_str(node.recursion_policy.on_exceeded.clone())
                    .to_string(),
            },
            note: node.note.clone(),
        }
    }
}

impl ScenarioNodeFile {
    fn into_runtime(self) -> Node {
        match self {
            ScenarioNodeFile::Publisher {
                id,
                title,
                position,
                primitive_type,
                instance_name,
                primitive_config,
                address,
                payload_text,
                signal_kind,
                custom_signal_kind,
                note,
            } => Node::Publisher(PublisherNode {
                id,
                title,
                last_pulse: 0,
                position_x: position.x,
                position_y: position.y,
                primitive_type,
                instance_name,
                primitive_config,
                address,
                payload_text,
                signal_kind,
                custom_signal_kind,
                metadata: SignalMetadata::default(),
                note,
            }),
            ScenarioNodeFile::Subscriber {
                id,
                title,
                position,
                primitive_type,
                instance_name,
                primitive_config,
                expression,
                schema_id,
                delivery,
                configuration_expression,
                queue_depth,
                note,
            } => Node::Subscriber(SubscriberNode {
                id,
                title,
                last_pulse: 0,
                position_x: position.x,
                position_y: position.y,
                primitive_type,
                instance_name,
                primitive_config,
                expression,
                schema_id,
                delivery: delivery.into_runtime(),
                received: Vec::new(),
                configuration_expression,
                queue_depth,
                note,
            }),
            ScenarioNodeFile::Service {
                id,
                title,
                position,
                primitive_type,
                instance_name,
                primitive_config,
                address,
                service_name,
                note,
            } => Node::Service(ServiceNode {
                id,
                title,
                last_pulse: 0,
                position_x: position.x,
                position_y: position.y,
                primitive_type,
                instance_name,
                primitive_config,
                address,
                service_name,
                note,
            }),
        }
    }

    fn from_runtime(node: &Node) -> Option<Self> {
        match node {
            Node::Publisher(node) => Some(Self::Publisher {
                id: node.id.clone(),
                title: node.title.clone(),
                position: PositionFile {
                    x: node.position_x,
                    y: node.position_y,
                },
                primitive_type: node.primitive_type.clone(),
                instance_name: node.instance_name.clone(),
                primitive_config: node.primitive_config.clone(),
                address: node.address.clone(),
                payload_text: node.payload_text.clone(),
                signal_kind: node.signal_kind.clone(),
                custom_signal_kind: node.custom_signal_kind.clone(),
                note: node.note.clone(),
            }),
            Node::Subscriber(node) => Some(Self::Subscriber {
                id: node.id.clone(),
                title: node.title.clone(),
                position: PositionFile {
                    x: node.position_x,
                    y: node.position_y,
                },
                primitive_type: node.primitive_type.clone(),
                instance_name: node.instance_name.clone(),
                primitive_config: node.primitive_config.clone(),
                expression: node.expression.clone(),
                schema_id: node.schema_id.clone(),
                delivery: ScenarioDeliveryOptionsFile::from_runtime(&node.delivery),
                configuration_expression: node.configuration_expression.clone(),
                queue_depth: node.queue_depth,
                note: node.note.clone(),
            }),
            Node::Service(node) => Some(Self::Service {
                id: node.id.clone(),
                title: node.title.clone(),
                position: PositionFile {
                    x: node.position_x,
                    y: node.position_y,
                },
                primitive_type: node.primitive_type.clone(),
                instance_name: node.instance_name.clone(),
                primitive_config: node.primitive_config.clone(),
                address: node.address.clone(),
                service_name: node.service_name.clone(),
                note: node.note.clone(),
            }),
            Node::Config(_) => None,
        }
    }
}

impl ScenarioDeliveryOptionsFile {
    fn into_runtime(self) -> DeliveryOptionsDto {
        DeliveryOptionsDto {
            mode: self.mode,
            payload_strategy: self.payload_strategy,
            retry: RetryPolicyDto {
                max_attempts: self.retry.max_attempts,
                initial_delay_ms: self.retry.initial_delay_ms,
                max_delay_ms: self.retry.max_delay_ms,
                backoff: self.retry.backoff,
                jitter: self.retry.jitter,
            },
            timeout: TimeoutPolicyDto {
                handler_timeout_ms: self.timeout.handler_timeout_ms,
                delivery_deadline_ms: self.timeout.delivery_deadline_ms,
            },
            rate: RatePolicyDto {
                max_per_second: self.rate.max_per_second,
                burst: self.rate.burst,
            },
            timing: TimingPolicyDto {
                debounce_ms: self.timing.debounce_ms,
                throttle_ms: self.timing.throttle_ms,
            },
            conflation: self.conflation,
            queue: QueuePolicyDto {
                max_depth: self.queue.max_depth,
                overflow: overflow_policy_from_str(&self.queue.overflow),
            },
            payload_limits: PayloadLimitsDto {
                max_inline_bytes: self.payload_limits.max_inline_bytes,
                max_depth: self.payload_limits.max_depth,
            },
            ordering: self.ordering,
            recursion: RecursionPolicyDto {
                max_causation_depth: self.recursion.max_causation_depth,
                on_exceeded: recursion_overflow_from_str(&self.recursion.on_exceeded),
            },
        }
    }

    fn from_runtime(options: &DeliveryOptionsDto) -> Self {
        Self {
            mode: options.mode.clone(),
            payload_strategy: options.payload_strategy.clone(),
            retry: ScenarioRetryPolicyFile {
                max_attempts: options.retry.max_attempts,
                initial_delay_ms: options.retry.initial_delay_ms,
                max_delay_ms: options.retry.max_delay_ms,
                backoff: options.retry.backoff.clone(),
                jitter: options.retry.jitter,
            },
            timeout: ScenarioTimeoutPolicyFile {
                handler_timeout_ms: options.timeout.handler_timeout_ms,
                delivery_deadline_ms: options.timeout.delivery_deadline_ms,
            },
            rate: ScenarioRatePolicyFile {
                max_per_second: options.rate.max_per_second,
                burst: options.rate.burst,
            },
            timing: ScenarioTimingPolicyFile {
                debounce_ms: options.timing.debounce_ms,
                throttle_ms: options.timing.throttle_ms,
            },
            conflation: options.conflation.clone(),
            queue: ScenarioQueuePolicyFile {
                max_depth: options.queue.max_depth,
                overflow: overflow_policy_to_str(options.queue.overflow.clone()).to_string(),
            },
            payload_limits: ScenarioPayloadLimitsFile {
                max_inline_bytes: options.payload_limits.max_inline_bytes,
                max_depth: options.payload_limits.max_depth,
            },
            ordering: options.ordering.clone(),
            recursion: ScenarioRecursionPolicyFile {
                max_causation_depth: options.recursion.max_causation_depth,
                on_exceeded: recursion_overflow_to_str(options.recursion.on_exceeded.clone())
                    .to_string(),
            },
        }
    }
}

fn overflow_policy_to_str(policy: OverflowPolicy) -> &'static str {
    match policy {
        OverflowPolicy::Backpressure => "Backpressure",
        OverflowPolicy::DropNewest => "DropNewest",
        OverflowPolicy::DropOldest => "DropOldest",
        OverflowPolicy::Conflate => "Conflate",
        OverflowPolicy::RejectPublish => "RejectPublish",
    }
}

fn overflow_policy_from_str(value: &str) -> OverflowPolicy {
    match value {
        "Backpressure" => OverflowPolicy::Backpressure,
        "DropNewest" => OverflowPolicy::DropNewest,
        "DropOldest" => OverflowPolicy::DropOldest,
        "Conflate" => OverflowPolicy::Conflate,
        _ => OverflowPolicy::RejectPublish,
    }
}

fn recursion_overflow_to_str(policy: RecursionOverflowPolicy) -> &'static str {
    match policy {
        RecursionOverflowPolicy::RejectPublish => "RejectPublish",
        RecursionOverflowPolicy::Drop => "Drop",
    }
}

fn recursion_overflow_from_str(value: &str) -> RecursionOverflowPolicy {
    match value {
        "Drop" => RecursionOverflowPolicy::Drop,
        _ => RecursionOverflowPolicy::RejectPublish,
    }
}

fn delivery_options_for_subscriber(
    node: &SubscriberNode,
    default_queue_depth: usize,
) -> DeliveryOptions {
    let queue_depth = if node.queue_depth == 0 {
        default_queue_depth
    } else {
        node.queue_depth
    };
    DeliveryOptions {
        mode: DeliveryMode::FireAndForget,
        payload_strategy: spine::PayloadStrategy::SendPayload,
        retry: spine::RetryPolicy::default(),
        timeout: spine::TimeoutPolicy::default(),
        rate: spine::RatePolicy::default(),
        timing: spine::TimingPolicy::default(),
        conflation: ConflationPolicy::None,
        queue: QueuePolicy {
            max_depth: queue_depth,
            overflow: node.delivery.queue.overflow.clone(),
        },
        payload_limits: spine::PayloadLimits::default(),
        ordering: spine::OrderingPolicy::PerSubscription,
        recursion: RecursionPolicy {
            max_causation_depth: 32,
            on_exceeded: RecursionOverflowPolicy::RejectPublish,
        },
    }
}

fn trace_from_signal(
    state: &AppState,
    from_node_id: &str,
    address: &str,
    payload_text: &str,
    result: PublishResult,
) -> PublishTrace {
    let deliveries = state
        .nodes
        .iter()
        .filter_map(|node| match node {
            Node::Subscriber(subscriber) => {
                let Some(params) = match_and_capture(
                    &subscriber.expression,
                    address,
                    state.config.allow_catch_all,
                ) else {
                    return None;
                };
                Some(DeliveryTrace {
                    subscriber_node_id: subscriber.id.clone(),
                    expression: subscriber.expression.clone(),
                    params,
                    payload: payload_text.to_string(),
                    accepted: true,
                    reason: None,
                })
            }
            _ => None,
        })
        .collect();
    PublishTrace {
        signal_id: result.signal_id.0,
        from_node_id: from_node_id.to_string(),
        address: address.to_string(),
        payload: payload_text.to_string(),
        matched_count: result.matched_subscribers,
        accepted_count: result.accepted_deliveries,
        rejected_count: result.rejected_deliveries,
        deliveries,
    }
}

fn compute_routes(nodes: &[Node], config: &ConfigNode) -> Vec<RouteEdge> {
    let mut edges = Vec::new();
    let publishers: Vec<&PublisherNode> = nodes
        .iter()
        .filter_map(|node| match node {
            Node::Publisher(node) => Some(node),
            _ => None,
        })
        .collect();
    let subscribers: Vec<&SubscriberNode> = nodes
        .iter()
        .filter_map(|node| match node {
            Node::Subscriber(node) => Some(node),
            _ => None,
        })
        .collect();
    for publisher in publishers {
        for subscriber in subscribers.iter() {
            if let Some(params) = match_and_capture(
                &subscriber.expression,
                &publisher.address,
                config.allow_catch_all,
            ) {
                edges.push(RouteEdge {
                    id: format!("{}-{}", publisher.id, subscriber.id),
                    source: publisher.id.clone(),
                    target: subscriber.id.clone(),
                    label: params
                        .iter()
                        .map(|(key, value)| format!("{key}={value}"))
                        .collect::<Vec<_>>()
                        .join(", "),
                    accepted: true,
                });
            }
        }
    }
    edges
}

fn match_and_capture(
    expression: &str,
    address: &str,
    allow_catch_all: bool,
) -> Option<HashMap<String, String>> {
    let expression = AddressExpression::parse(expression, allow_catch_all).ok()?;
    let address = Address::parse(address).ok()?;
    capture_params(&expression, &address)
}

fn capture_params(
    expression: &AddressExpression,
    address: &Address,
) -> Option<HashMap<String, String>> {
    use spine::ExpressionSegment;

    let mut out = HashMap::new();
    let remaining: Vec<&str> = address.segments().collect();
    let mut index = 0usize;

    for segment in expression.segments() {
        match segment {
            ExpressionSegment::Literal(expected) => {
                let Some(actual) = remaining.get(index) else {
                    return None;
                };
                if actual != expected {
                    return None;
                }
                index += 1;
            }
            ExpressionSegment::Dynamic(name) => {
                let Some(actual) = remaining.get(index) else {
                    return None;
                };
                out.insert(name.clone(), (*actual).to_string());
                index += 1;
            }
            ExpressionSegment::Wildcard => {
                if remaining.get(index).is_none() {
                    return None;
                }
                index += 1;
            }
            ExpressionSegment::RecursiveWildcard => {
                let tail = remaining.get(index..).unwrap_or(&[]);
                let _ = tail;
                index = remaining.len();
            }
        }
    }

    if index != remaining.len() {
        return None;
    }

    Some(out)
}

fn record_delivery(
    state: &Arc<Mutex<AppState>>,
    update_cv: &Arc<Condvar>,
    events: &Broadcaster,
    subscriber_id: String,
    ctx: DeliveryContext,
    signal: Signal<String>,
) -> Result<(), HandlerError> {
    let payload = match signal.payload {
        Payload::Inline(value) => value,
        Payload::Reference(reference) => reference.uri,
        Payload::Empty => String::new(),
    };
    let mut state = state.lock().unwrap();
    let now = now_millis();
    let Some(Node::Subscriber(subscriber)) = state
        .nodes
        .iter_mut()
        .find(|node| node.id() == subscriber_id)
    else {
        return Ok(());
    };

    subscriber.last_pulse = now;
    let delivery = DeliveryTrace {
        subscriber_node_id: subscriber.id.clone(),
        expression: ctx.expression.to_string(),
        params: capture_params(&ctx.expression, &ctx.address).unwrap_or_default(),
        payload: payload.clone(),
        accepted: true,
        reason: None,
    };
    subscriber.received.insert(0, delivery);
    subscriber.received.truncate(8);
    *state
        .publish_delivery_counts
        .entry(ctx.signal_id.0)
        .or_insert(0) += 1;
    let snapshot = state.snapshot();
    drop(state);
    update_cv.notify_all();
    events.broadcast(snapshot.to_json());
    Ok(())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn signal_metadata_json(metadata: &SignalMetadata) -> String {
    format!(
        "{{\"timestamp\":{},\"source\":{},\"correlationId\":{},\"causationId\":{},\"traceId\":{},\"priority\":{},\"ttlMs\":{},\"schemaId\":{},\"contentType\":{}}}",
        json_string(&format_system_time(metadata.timestamp)),
        opt_string(metadata.source.as_deref()),
        opt_string(metadata.correlation_id.as_deref()),
        metadata.causation_id.map(|id| id.0.to_string()).map_or("null".to_string(), |value| json_string(&value)),
        opt_string(metadata.trace_id.as_deref()),
        metadata.priority,
        metadata.ttl.map(|duration| duration.as_millis() as u64).map_or("null".to_string(), |value| value.to_string()),
        opt_string(metadata.schema_id.as_ref().map(|id| id.0.as_str())),
        opt_string(metadata.content_type.as_ref().map(|ct| ct.0.as_str())),
    )
}

fn format_system_time(time: SystemTime) -> String {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn opt_num(value: Option<u64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "null".to_string())
}

fn opt_string(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_string())
}

fn push_primitive_metadata(
    out: &mut String,
    primitive_type: &Option<String>,
    instance_name: &Option<String>,
    primitive_config: &Option<Value>,
) {
    if let Some(primitive_type) = primitive_type {
        write!(out, ",\"primitiveType\":{}", json_string(primitive_type)).unwrap();
    }
    if let Some(instance_name) = instance_name {
        write!(out, ",\"instanceName\":{}", json_string(instance_name)).unwrap();
    }
    if let Some(primitive_config) = primitive_config {
        out.push_str(",\"primitiveConfig\":");
        out.push_str(&primitive_config.to_string());
    }
}

fn apply_primitive_metadata(
    primitive_type: &mut Option<String>,
    instance_name: &mut Option<String>,
    primitive_config: &mut Option<Value>,
    form: &HashMap<String, String>,
) {
    if let Some(value) = form.get("primitive_type") {
        *primitive_type = if value.is_empty() {
            None
        } else {
            Some(value.clone())
        };
    }
    if let Some(value) = form.get("instance_name") {
        *instance_name = if value.is_empty() {
            None
        } else {
            Some(value.clone())
        };
    }
    if let Some(value) = form.get("primitive_config") {
        *primitive_config = if value.is_empty() {
            None
        } else {
            serde_json::from_str(value).ok()
        };
    }
}

fn required_binding<'a>(
    value: &'a Option<String>,
    node_id: &str,
    field: &str,
) -> Result<String, String> {
    value
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("blueprint node {node_id} is missing bindings.{field}"))
}

fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => {
                write!(out, "\\u{:04x}", c as u32).unwrap();
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn handle_connection(runtime: Arc<Runtime>, mut stream: TcpStream) -> Result<(), String> {
    let mut buffer = Vec::new();
    let mut temp = [0u8; 4096];
    loop {
        let read = stream.read(&mut temp).map_err(|err| err.to_string())?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&temp[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap()
        + 4;
    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines.next().ok_or("missing request line")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().ok_or("missing method")?;
    let path = request_parts.next().ok_or("missing path")?;
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut temp).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&temp[..read]);
    }
    let body = String::from_utf8_lossy(&body).to_string();
    route_request(runtime, &mut stream, method, path, body)
}

fn route_request(
    runtime: Arc<Runtime>,
    stream: &mut TcpStream,
    method: &str,
    path: &str,
    body: String,
) -> Result<(), String> {
    match (method, path) {
        ("GET", "/api/state") => respond_json(stream, 200, &runtime.json_state()),
        ("GET", "/api/scenarios") => {
            let body = runtime.scenario_options_json()?;
            respond_json(stream, 200, &body)
        }
        ("GET", "/api/events") => respond_sse(runtime, stream),
        ("POST", "/api/nodes") => {
            let form = parse_form(&body);
            let snapshot = runtime.create_node(&form)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        ("POST", "/api/config") => {
            let form = parse_form(&body);
            let snapshot = runtime.update_config(&form)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        ("POST", "/api/scenarios/load") => {
            let form = parse_form(&body);
            let scenario_id = form.get("scenarioId").ok_or("missing scenarioId")?.clone();
            let snapshot = runtime.load_scenario(&scenario_id)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        ("POST", "/api/scenarios/save") => {
            let form = parse_form(&body);
            let scenario_id = form.get("scenarioId").ok_or("missing scenarioId")?.clone();
            let snapshot = runtime.save_scenario(&scenario_id)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        ("POST", "/api/publish") => {
            let form = parse_form(&body);
            let publisher_id = form
                .get("publisherId")
                .ok_or("missing publisherId")?
                .clone();
            let snapshot = runtime.publish_from(&publisher_id)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        ("POST", "/api/publish/custom") => {
            let form = parse_form(&body);
            let node_id = form.get("nodeId").ok_or("missing nodeId")?.clone();
            let address = form.get("address").ok_or("missing address")?.clone();
            let payload_text = form
                .get("payloadText")
                .ok_or("missing payloadText")?
                .clone();
            let snapshot = runtime.publish_signal(&node_id, address, payload_text)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        _ if method == "POST" && path.starts_with("/api/nodes/") => {
            let node_id = &path["/api/nodes/".len()..];
            let form = parse_form(&body);
            let snapshot = runtime.update_node(node_id, &form)?;
            respond_json(stream, 200, &snapshot.to_json())
        }
        _ => respond_json(stream, 404, "{\"error\":\"not found\"}"),
    }
}

fn respond_json(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        400 => "Bad Request",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|err| err.to_string())
}

fn respond_sse(runtime: Arc<Runtime>, stream: &mut TcpStream) -> Result<(), String> {
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
    stream
        .write_all(headers.as_bytes())
        .map_err(|err| err.to_string())?;
    let receiver = runtime.events.subscribe();
    let initial = runtime.json_state();
    stream
        .write_all(format!("event: state\ndata: {}\n\n", initial).as_bytes())
        .map_err(|err| err.to_string())?;
    while let Ok(message) = receiver.recv() {
        if stream
            .write_all(format!("event: state\ndata: {}\n\n", message).as_bytes())
            .and_then(|_| stream.flush())
            .is_err()
        {
            break;
        }
    }
    Ok(())
}

fn parse_form(body: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in body.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        out.insert(url_decode(key), url_decode(value));
    }
    out
}

fn url_decode(input: &str) -> String {
    let mut out = String::new();
    let mut chars = input.as_bytes().iter().copied().peekable();
    while let Some(byte) = chars.next() {
        match byte {
            b'+' => out.push(' '),
            b'%' => {
                let hi = chars.next();
                let lo = chars.next();
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    if let (Some(hi), Some(lo)) = (hex_val(hi), hex_val(lo)) {
                        out.push((hi << 4 | lo) as char);
                    }
                }
            }
            other => out.push(other as char),
        }
    }
    out
}

fn hex_val(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone)]
struct Broadcaster {
    subscribers: Arc<Mutex<Vec<std::sync::mpsc::Sender<String>>>>,
}

impl Broadcaster {
    fn new() -> Self {
        Self {
            subscribers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn subscribe(&self) -> std::sync::mpsc::Receiver<String> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.subscribers.lock().unwrap().push(tx);
        rx
    }

    fn broadcast(&self, message: String) {
        let mut subscribers = self.subscribers.lock().unwrap();
        subscribers.retain(|subscriber| subscriber.send(message.clone()).is_ok());
    }
}
