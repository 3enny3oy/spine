use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    AddressParse(AddressParseError),
    ExpressionParse(ExpressionParseError),
    SchemaMismatch,
    Delivery(DeliveryError),
    Handler(HandlerError),
    Timeout(TimeoutError),
    RetryExhausted(RetryExhaustedError),
    QueueOverflow(QueueOverflowError),
    ServiceNotFound(ServiceNotFoundError),
    ServiceAmbiguous(ServiceAmbiguousError),
    ServiceTypeMismatch(ServiceTypeMismatchError),
    RegistrationConflict(RegistrationConflictError),
    Configuration(ConfigurationError),
    RecursionOverflow(RecursionOverflowError),
}

pub type BusError = Error;
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddressParseError {
    pub address: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExpressionParseError {
    pub expression: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeliveryError {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandlerError {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeoutError {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetryExhaustedError {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueueOverflowError {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceNotFoundError {
    pub address: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceAmbiguousError {
    pub address: String,
    pub matches: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceTypeMismatchError {
    pub address: String,
    pub expected: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistrationConflictError {
    pub address: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigurationError {
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecursionOverflowError {
    pub depth: usize,
    pub max_depth: usize,
}

impl AddressParseError {
    pub(crate) fn new(address: &str, reason: String) -> Self {
        Self {
            address: address.to_string(),
            reason,
        }
    }
}

impl ExpressionParseError {
    pub(crate) fn new(expression: &str, reason: String) -> Self {
        Self {
            expression: expression.to_string(),
            reason,
        }
    }
}

macro_rules! display_reason {
    ($ty:ty) => {
        impl fmt::Display for $ty {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.reason)
            }
        }
    };
}

display_reason!(AddressParseError);
display_reason!(ExpressionParseError);
display_reason!(DeliveryError);
display_reason!(HandlerError);
display_reason!(TimeoutError);
display_reason!(RetryExhaustedError);
display_reason!(QueueOverflowError);
display_reason!(ConfigurationError);

impl fmt::Display for ServiceNotFoundError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "service not found: {}", self.address)
    }
}

impl fmt::Display for ServiceAmbiguousError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ambiguous service resolution for {} ({} matches)",
            self.address, self.matches
        )
    }
}

impl fmt::Display for ServiceTypeMismatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "service type mismatch for {} expected {}",
            self.address, self.expected
        )
    }
}

impl fmt::Display for RegistrationConflictError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "registration conflict at {}", self.address)
    }
}

impl fmt::Display for RecursionOverflowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "recursion depth {} exceeded max {}",
            self.depth, self.max_depth
        )
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::AddressParse(e) => e.fmt(f),
            Error::ExpressionParse(e) => e.fmt(f),
            Error::SchemaMismatch => write!(f, "schema mismatch"),
            Error::Delivery(e) => e.fmt(f),
            Error::Handler(e) => e.fmt(f),
            Error::Timeout(e) => e.fmt(f),
            Error::RetryExhausted(e) => e.fmt(f),
            Error::QueueOverflow(e) => e.fmt(f),
            Error::ServiceNotFound(e) => e.fmt(f),
            Error::ServiceAmbiguous(e) => e.fmt(f),
            Error::ServiceTypeMismatch(e) => e.fmt(f),
            Error::RegistrationConflict(e) => e.fmt(f),
            Error::Configuration(e) => e.fmt(f),
            Error::RecursionOverflow(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for Error {}
