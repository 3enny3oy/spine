use std::any::TypeId;
use std::fmt;
use std::time::{Duration, SystemTime};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SchemaId(pub String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Schema {
    pub type_id: TypeId,
    pub type_name: &'static str,
    pub schema_id: Option<SchemaId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ContentType(pub String);

pub type Timestamp = SystemTime;
pub type Priority = u8;
pub type SourceId = String;
pub type CorrelationId = String;
pub type TraceId = String;

impl Schema {
    pub fn of<T: 'static>() -> Self {
        Self {
            type_id: TypeId::of::<T>(),
            type_name: std::any::type_name::<T>(),
            schema_id: None,
        }
    }

    pub fn with_id<T: 'static>(schema_id: impl Into<SchemaId>) -> Self {
        Self {
            type_id: TypeId::of::<T>(),
            type_name: std::any::type_name::<T>(),
            schema_id: Some(schema_id.into()),
        }
    }
}

impl From<&str> for SchemaId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

impl From<String> for SchemaId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for SchemaId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Display for ContentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignalMetadata {
    pub timestamp: Timestamp,
    pub source: Option<SourceId>,
    pub correlation_id: Option<CorrelationId>,
    pub causation_id: Option<crate::signal::SignalId>,
    pub trace_id: Option<TraceId>,
    pub priority: Priority,
    pub ttl: Option<Duration>,
    pub schema_id: Option<SchemaId>,
    pub content_type: Option<ContentType>,
}

impl Default for SignalMetadata {
    fn default() -> Self {
        Self {
            timestamp: SystemTime::now(),
            source: None,
            correlation_id: None,
            causation_id: None,
            trace_id: None,
            priority: 0,
            ttl: None,
            schema_id: None,
            content_type: None,
        }
    }
}
