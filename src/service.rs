use std::any::{Any, TypeId};
use std::sync::Arc;

use crate::address::{match_expression, Address, AddressExpression, Match};
use crate::signal::Specificity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolutionMode {
    ExactOne,
    FirstBySpecificity,
    AllMatches,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceRegistrationOptions {
    pub allow_override: bool,
}

impl Default for ServiceRegistrationOptions {
    fn default() -> Self {
        Self {
            allow_override: false,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ResolvedService<T> {
    pub service: Arc<T>,
    pub expression: AddressExpression,
    pub address: Address,
    pub params: crate::address::Params,
    pub specificity: Specificity,
}

impl<T> std::ops::Deref for ResolvedService<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.service
    }
}

#[derive(Clone)]
pub(crate) struct ServiceEntry {
    pub expression: AddressExpression,
    pub service: Arc<dyn Any + Send + Sync>,
    pub type_id: TypeId,
    pub order: usize,
}

pub(crate) fn downcast_service<T: Any + Send + Sync + 'static>(
    service: Arc<dyn Any + Send + Sync>,
) -> Option<Arc<T>> {
    Arc::downcast::<T>(service).ok()
}

pub(crate) fn service_matches(entry: &ServiceEntry, address: &Address) -> Option<Match> {
    match_expression(&entry.expression, address, entry.order)
}

pub(crate) fn service_type_name<T: ?Sized + 'static>() -> String {
    std::any::type_name::<T>().to_string()
}
