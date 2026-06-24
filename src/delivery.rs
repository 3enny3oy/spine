use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeliveryMode {
    FireAndForget,
    AckNack,
    Optimistic,
    RequestReply,
    NotifyOnly,
    NotifyThenFetch,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PayloadStrategy {
    SendPayload,
    NotifyOnly,
    NotifyThenFetch,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackoffKind {
    Linear,
    Exponential,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub backoff: BackoffKind,
    pub jitter: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeoutPolicy {
    pub handler_timeout: Option<Duration>,
    pub delivery_deadline: Option<Duration>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RatePolicy {
    pub max_per_second: Option<u64>,
    pub burst: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimingPolicy {
    pub debounce: Option<Duration>,
    pub throttle: Option<Duration>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConflationPolicy {
    None,
    DropDuplicateAddress,
    DropDuplicatePayloadHash,
    KeepLatestByAddress,
    KeepLatestByKey(String),
    BatchWithin(Duration),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OverflowPolicy {
    Backpressure,
    DropNewest,
    DropOldest,
    Conflate,
    RejectPublish,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueuePolicy {
    pub max_depth: usize,
    pub overflow: OverflowPolicy,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayloadLimits {
    pub max_inline_bytes: Option<usize>,
    pub max_depth: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrderingPolicy {
    None,
    PerSubscription,
    PerAddress,
    PerKey(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecursionOverflowPolicy {
    RejectPublish,
    Drop,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecursionPolicy {
    pub max_causation_depth: usize,
    pub on_exceeded: RecursionOverflowPolicy,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryOptions {
    pub mode: DeliveryMode,
    pub payload_strategy: PayloadStrategy,
    pub retry: RetryPolicy,
    pub timeout: TimeoutPolicy,
    pub rate: RatePolicy,
    pub timing: TimingPolicy,
    pub conflation: ConflationPolicy,
    pub queue: QueuePolicy,
    pub payload_limits: PayloadLimits,
    pub ordering: OrderingPolicy,
    pub recursion: RecursionPolicy,
}

impl Default for DeliveryMode {
    fn default() -> Self {
        Self::FireAndForget
    }
}

impl Default for PayloadStrategy {
    fn default() -> Self {
        Self::SendPayload
    }
}

impl Default for BackoffKind {
    fn default() -> Self {
        Self::Exponential
    }
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 0,
            initial_delay: Duration::from_millis(0),
            max_delay: Duration::from_millis(0),
            backoff: BackoffKind::default(),
            jitter: false,
        }
    }
}

impl Default for TimeoutPolicy {
    fn default() -> Self {
        Self {
            handler_timeout: None,
            delivery_deadline: None,
        }
    }
}

impl Default for RatePolicy {
    fn default() -> Self {
        Self {
            max_per_second: None,
            burst: None,
        }
    }
}

impl Default for TimingPolicy {
    fn default() -> Self {
        Self {
            debounce: None,
            throttle: None,
        }
    }
}

impl Default for ConflationPolicy {
    fn default() -> Self {
        Self::None
    }
}

impl Default for QueuePolicy {
    fn default() -> Self {
        Self {
            max_depth: 1024,
            overflow: OverflowPolicy::RejectPublish,
        }
    }
}

impl Default for PayloadLimits {
    fn default() -> Self {
        Self {
            max_inline_bytes: None,
            max_depth: None,
        }
    }
}

impl Default for OrderingPolicy {
    fn default() -> Self {
        Self::PerSubscription
    }
}

impl Default for RecursionPolicy {
    fn default() -> Self {
        Self {
            max_causation_depth: 32,
            on_exceeded: RecursionOverflowPolicy::RejectPublish,
        }
    }
}

impl Default for DeliveryOptions {
    fn default() -> Self {
        Self {
            mode: DeliveryMode::default(),
            payload_strategy: PayloadStrategy::default(),
            retry: RetryPolicy::default(),
            timeout: TimeoutPolicy::default(),
            rate: RatePolicy::default(),
            timing: TimingPolicy::default(),
            conflation: ConflationPolicy::default(),
            queue: QueuePolicy::default(),
            payload_limits: PayloadLimits::default(),
            ordering: OrderingPolicy::default(),
            recursion: RecursionPolicy::default(),
        }
    }
}
