use crate::address::{Address, AddressExpression, Params};
use crate::delivery::RetryPolicy;
use crate::error::{HandlerError, QueueOverflowError};
use crate::schema::SignalMetadata;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SignalId(pub u64);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignalKind {
    Event,
    Command,
    State,
    Notice,
    Custom(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayloadRef {
    pub uri: String,
    pub content_type: Option<String>,
    pub schema_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Payload<T> {
    Inline(T),
    Reference(PayloadRef),
    Empty,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signal<T> {
    pub id: SignalId,
    pub address: Address,
    pub kind: SignalKind,
    pub payload: Payload<T>,
    pub metadata: SignalMetadata,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryContext {
    pub signal_id: SignalId,
    pub subscription_id: SubscriptionId,
    pub address: Address,
    pub expression: AddressExpression,
    pub params: Params,
    pub metadata: SignalMetadata,
}

impl DeliveryContext {
    pub fn param(&self, key: &str) -> Option<&str> {
        self.params.get(key)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SubscriptionId(pub u64);

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Specificity {
    pub literal_segments: usize,
    pub dynamic_segments: usize,
    pub wildcard_segments: usize,
    pub recursive_segments: usize,
    pub recursive_consumed: usize,
    pub registration_order: usize,
}

impl Specificity {
    pub fn cmp_specificity(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering::*;
        match self.literal_segments.cmp(&other.literal_segments) {
            Equal => {}
            ord => return ord,
        }
        match self.dynamic_segments.cmp(&other.dynamic_segments) {
            Equal => {}
            ord => return ord,
        }
        match other.wildcard_segments.cmp(&self.wildcard_segments) {
            Equal => {}
            ord => return ord,
        }
        match other.recursive_segments.cmp(&self.recursive_segments) {
            Equal => {}
            ord => return ord,
        }
        match other.recursive_consumed.cmp(&self.recursive_consumed) {
            Equal => {}
            ord => return ord,
        }
        self.registration_order.cmp(&other.registration_order)
    }
}

impl Ord for Specificity {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.cmp_specificity(other)
    }
}

impl PartialOrd for Specificity {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishResult {
    pub signal_id: SignalId,
    pub matched_subscribers: usize,
    pub accepted_deliveries: usize,
    pub rejected_deliveries: usize,
    pub errors: Vec<PublishError>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PublishError {
    QueueOverflow(QueueOverflowError),
    Handler(HandlerError),
    Timeout(String),
    SchemaMismatch(String),
    RecursionOverflow(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryResult {
    pub accepted: bool,
    pub error: Option<PublishError>,
}

pub(crate) fn validate_retry_policy(policy: &RetryPolicy) -> Result<(), String> {
    if policy.max_attempts == u32::MAX {
        return Err("infinite retry configuration is not allowed".into());
    }
    Ok(())
}
