use spine::{
    Address, AddressExpression, ConflationPolicy, DeliveryContext, DeliveryMode, DeliveryOptions,
    HandlerError, OverflowPolicy, Payload, PublishResult, QueuePolicy, RecursionOverflowPolicy,
    RecursionPolicy, Schema, Signal, SignalBus, SignalId, SignalMetadata, SubscriptionHandle,
};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::str::FromStr;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_ADDR: &str = "127.0.0.1:8787";

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let runtime = Arc::new(Runtime::new());
    let listener = TcpListener::bind(DEFAULT_ADDR).map_err(|err| format!("bind {DEFAULT_ADDR}: {err}"))?;
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
            bus: Arc::new(Mutex::new(SignalBus::builder().allow_catch_all(false).default_queue_depth(1024).build())),
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
        let mut bus = SignalBus::builder()
            .allow_catch_all(allow_catch_all)
            .default_queue_depth(default_queue_depth)
            .recursion_policy(recursion_policy)
            .build();

        let mut handles = Vec::new();
        for subscriber in state
            .nodes
            .iter()
            .filter_map(|node| match node {
                Node::Subscriber(subscriber) => Some(subscriber.clone()),
                _ => None,
            })
        {
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
                            record_delivery(&state, &update_cv, &events, subscriber_id, ctx, signal)?;
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
            match state
                .nodes
                .iter()
                .find_map(|node| match node {
                    Node::Publisher(publisher) if publisher.id == publisher_id => Some(publisher.clone()),
                    _ => None,
                }) {
                Some(publisher) => publisher,
                None => return Err(format!("publisher not found: {publisher_id}")),
            }
        };

        let bus = self.bus.lock().unwrap().clone();
        let result = bus
            .publish(publisher.address.clone(), publisher.payload_text.clone())
            .map_err(|err| format!("publish failed: {err}"))?;
        self.wait_for_deliveries(result.signal_id, result.accepted_deliveries);

        let mut state = self.inner.lock().unwrap();
        let trace = trace_from_publish(&state, &publisher, result);
        state.publish_history.insert(0, trace);
        state.publish_history.truncate(12);
        let snapshot = state.snapshot();
        drop(state);
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
        state.config.allow_catch_all = parse_bool(form.get("allow_catch_all").map(String::as_str)).unwrap_or(false);
        state.config.default_queue_depth = parse_usize(form.get("default_queue_depth").map(String::as_str)).unwrap_or(1024);
        state.config.recursion_policy.max_causation_depth =
            parse_usize(form.get("recursion_depth").map(String::as_str)).unwrap_or(32);
        state.config.recursion_policy.on_exceeded = match form.get("on_exceeded").map(String::as_str) {
            Some("Drop") => RecursionOverflowPolicy::Drop,
            _ => RecursionOverflowPolicy::RejectPublish,
        };
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
            "publisher" => Node::Publisher(PublisherNode::default_with_id(format!("publisher-{idx}"))),
            "subscriber" => Node::Subscriber(SubscriberNode::default_with_id(format!("subscriber-{idx}"))),
            "config" => Node::Config(ConfigNode::default_with_id(format!("config-{idx}"))),
            "service" => Node::Service(ServiceNode::default_with_id(format!("service-{idx}"))),
            other => return Err(format!("unsupported kind: {other}")),
        };
        state.nodes.push(node);
        drop(state);
        self.sync_bus()?;
        let snapshot = self.snapshot();
        self.events.broadcast(snapshot.to_json());
        Ok(snapshot)
    }

    fn update_node(&self, node_id: &str, form: &HashMap<String, String>) -> Result<Snapshot, String> {
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
}

#[derive(Clone)]
struct AppState {
    config: ConfigNode,
    nodes: Vec<Node>,
    publish_history: Vec<PublishTrace>,
    publish_delivery_counts: HashMap<u64, usize>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: ConfigNode::default_with_id("config-1".to_string()),
            nodes: vec![
                Node::Publisher(PublisherNode::default_with_id("publisher-1".to_string())),
                Node::Subscriber(SubscriberNode::default_with_id("subscriber-1".to_string())),
                Node::Subscriber(SubscriberNode::default_with_id("subscriber-2".to_string())),
                Node::Service(ServiceNode::default_with_id("service-1".to_string())),
            ],
            publish_history: Vec::new(),
            publish_delivery_counts: HashMap::new(),
        }
    }
}

impl AppState {
    fn snapshot(&self) -> Snapshot {
        let nodes = self.nodes.clone();
        let routes = compute_routes(&nodes, &self.config);
        Snapshot {
            config: self.config.clone(),
            nodes,
            publish_history: self.publish_history.clone(),
            routes,
            last_error: None,
        }
    }
}

#[derive(Clone)]
struct Snapshot {
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
    allow_catch_all: bool,
    default_queue_depth: usize,
    recursion_policy: RecursionPolicy,
    note: String,
}

impl ConfigNode {
    fn default_with_id(id: String) -> Self {
        Self {
            id,
            title: "Bus Config".to_string(),
            last_pulse: 0,
            allow_catch_all: false,
            default_queue_depth: 1024,
            recursion_policy: RecursionPolicy {
                max_causation_depth: 32,
                on_exceeded: RecursionOverflowPolicy::RejectPublish,
            },
            note: "Global delivery controls".to_string(),
        }
    }

    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"kind\":\"config\",\"title\":{},\"lastPulse\":{},\"allowCatchAll\":{},\"defaultQueueDepth\":{},\"recursionPolicy\":{{\"maxCausationDepth\":{},\"onExceeded\":{}}},\"note\":{}}}",
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
        if let Some(depth) = form.get("default_queue_depth").and_then(|value| value.parse::<usize>().ok()) {
            self.default_queue_depth = depth;
        }
        if let Some(depth) = form.get("recursion_depth").and_then(|value| value.parse::<usize>().ok()) {
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
    address: String,
    payload_text: String,
    signal_kind: String,
    custom_signal_kind: String,
    metadata: SignalMetadata,
    note: String,
}

impl PublisherNode {
    fn default_with_id(id: String) -> Self {
        Self {
            id,
            title: "Publisher".to_string(),
            last_pulse: 0,
            address: "documents/doc-1/blocks/block-9/changed".to_string(),
            payload_text: "{\n  \"blockId\": \"block-9\",\n  \"revision\": 42,\n  \"text\": \"Hello from the Rust backend\"\n}".to_string(),
            signal_kind: "Event".to_string(),
            custom_signal_kind: String::new(),
            metadata: SignalMetadata::default(),
            note: "Publish from here".to_string(),
        }
    }

    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"type\":\"publisher\",\"position\":{{\"x\":100,\"y\":160}},\"data\":{{\"id\":{},\"kind\":\"publisher\",\"title\":{},\"lastPulse\":{},\"address\":{},\"payloadText\":{},\"signalKind\":{},\"customSignalKind\":{},\"metadata\":{},\"note\":{}}}}}",
            json_string(&self.id),
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            json_string(&self.address),
            json_string(&self.payload_text),
            json_string(&self.signal_kind),
            json_string(&self.custom_signal_kind),
            signal_metadata_json(&self.metadata),
            json_string(&self.note)
        )
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
    }
}

#[derive(Clone)]
struct SubscriberNode {
    id: String,
    title: String,
    last_pulse: u64,
    expression: String,
    schema_id: String,
    delivery: DeliveryOptionsDto,
    received: Vec<DeliveryTrace>,
    configuration_expression: String,
    queue_depth: usize,
    note: String,
}

impl SubscriberNode {
    fn default_with_id(id: String) -> Self {
        Self {
            id,
            title: "Subscriber".to_string(),
            last_pulse: 0,
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
        out.push_str(",\"type\":\"subscriber\",\"position\":{\"x\":600,\"y\":120},\"data\":{");
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
        write!(
            out,
            "],\"configurationExpression\":{},\"queueDepth\":{},\"note\":{}}}",
            json_string(&self.configuration_expression),
            self.queue_depth,
            json_string(&self.note),
        )
        .unwrap();
        out.push('}');
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
        if let Some(queue_depth) = form.get("queue_depth").and_then(|value| value.parse::<usize>().ok()) {
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
        if let Some(debounce_ms) = form.get("debounce_ms").and_then(|value| value.parse::<u64>().ok()) {
            self.delivery.timing.debounce_ms = Some(debounce_ms);
        }
        if let Some(throttle_ms) = form.get("throttle_ms").and_then(|value| value.parse::<u64>().ok()) {
            self.delivery.timing.throttle_ms = Some(throttle_ms);
        }
        if let Some(configuration_expression) = form.get("configuration_expression") {
            self.configuration_expression = configuration_expression.clone();
        }
    }
}

#[derive(Clone)]
struct ServiceNode {
    id: String,
    title: String,
    last_pulse: u64,
    address: String,
    service_name: String,
    note: String,
}

impl ServiceNode {
    fn default_with_id(id: String) -> Self {
        Self {
            id,
            title: "Service".to_string(),
            last_pulse: 0,
            address: "services/search/default".to_string(),
            service_name: "SearchService".to_string(),
            note: "Lookup through address space".to_string(),
        }
    }

    fn to_json(&self) -> String {
        format!(
            "{{\"id\":{},\"type\":\"service\",\"position\":{{\"x\":930,\"y\":220}},\"data\":{{\"id\":{},\"kind\":\"service\",\"title\":{},\"lastPulse\":{},\"address\":{},\"serviceName\":{},\"note\":{}}}}}",
            json_string(&self.id),
            json_string(&self.id),
            json_string(&self.title),
            self.last_pulse,
            json_string(&self.address),
            json_string(&self.service_name),
            json_string(&self.note)
        )
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
            Node::Config(node) => node.to_json(),
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
        Self { handler_timeout_ms: None, delivery_deadline_ms: None }
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
        Self { max_per_second: None, burst: None }
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
        Self { debounce_ms: None, throttle_ms: None }
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

fn delivery_options_for_subscriber(node: &SubscriberNode, default_queue_depth: usize) -> DeliveryOptions {
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

fn trace_from_publish(state: &AppState, publisher: &PublisherNode, result: PublishResult) -> PublishTrace {
    let deliveries = state
        .nodes
        .iter()
        .filter_map(|node| match node {
            Node::Subscriber(subscriber) => {
                let Some(params) = match_and_capture(
                    &subscriber.expression,
                    &publisher.address,
                    state.config.allow_catch_all,
                ) else {
                    return None;
                };
                Some(DeliveryTrace {
                    subscriber_node_id: subscriber.id.clone(),
                    expression: subscriber.expression.clone(),
                    params,
                    payload: publisher.payload_text.clone(),
                    accepted: true,
                    reason: None,
                })
            }
            _ => None,
        })
        .collect();
    PublishTrace {
        signal_id: result.signal_id.0,
        from_node_id: publisher.id.clone(),
        address: publisher.address.clone(),
        payload: publisher.payload_text.clone(),
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
            if let Some(params) =
                match_and_capture(&subscriber.expression, &publisher.address, config.allow_catch_all)
            {
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

fn capture_params(expression: &AddressExpression, address: &Address) -> Option<HashMap<String, String>> {
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
    *state.publish_delivery_counts.entry(ctx.signal_id.0).or_insert(0) += 1;
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
    value.map(|value| value.to_string()).unwrap_or_else(|| "null".to_string())
}

fn opt_string(value: Option<&str>) -> String {
    value.map(json_string).unwrap_or_else(|| "null".to_string())
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

fn parse_bool(input: Option<&str>) -> Option<bool> {
    input.map(|value| value == "true" || value == "1")
}

fn parse_usize(input: Option<&str>) -> Option<usize> {
    input.and_then(|value| value.parse::<usize>().ok())
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
    let header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n").unwrap() + 4;
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
        ("POST", "/api/publish") => {
            let form = parse_form(&body);
            let publisher_id = form.get("publisherId").ok_or("missing publisherId")?.clone();
            let snapshot = runtime.publish_from(&publisher_id)?;
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
    stream.write_all(response.as_bytes()).map_err(|err| err.to_string())
}

fn respond_sse(runtime: Arc<Runtime>, stream: &mut TcpStream) -> Result<(), String> {
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n";
    stream.write_all(headers.as_bytes()).map_err(|err| err.to_string())?;
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
