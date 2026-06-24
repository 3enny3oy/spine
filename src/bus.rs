use std::any::{Any, TypeId};
use std::cell::Cell;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
use std::thread;

use crate::address::{match_expression, Address, AddressExpression, Match, Params};
use crate::delivery::*;
use crate::error::*;
use crate::schema::{Schema, SignalMetadata};
use crate::service::{
    downcast_service, service_matches, service_type_name, ResolutionMode, ResolvedService,
    ServiceEntry, ServiceRegistrationOptions,
};
use crate::signal::*;

thread_local! {
    static CAUSATION_DEPTH: Cell<usize> = Cell::new(0);
}

#[derive(Clone, Debug)]
struct QueuedDelivery {
    signal_id: SignalId,
    address: Address,
    kind: SignalKind,
    payload: Arc<dyn Any + Send + Sync>,
    payload_schema: Schema,
    metadata: SignalMetadata,
}

struct SubscriptionQueue {
    items: Mutex<VecDeque<QueuedDelivery>>,
    cv: Condvar,
    closed: AtomicBool,
    in_flight: AtomicUsize,
    max_depth: usize,
    overflow: OverflowPolicy,
}

impl SubscriptionQueue {
    fn new(max_depth: usize, overflow: OverflowPolicy) -> Self {
        Self {
            items: Mutex::new(VecDeque::new()),
            cv: Condvar::new(),
            closed: AtomicBool::new(false),
            in_flight: AtomicUsize::new(0),
            max_depth,
            overflow,
        }
    }

    fn push(&self, item: QueuedDelivery) -> std::result::Result<(), QueueOverflowError> {
        let mut guard = self.items.lock().unwrap();
        let current_depth = guard.len() + self.in_flight.load(Ordering::SeqCst);
        if current_depth < self.max_depth {
            guard.push_back(item);
            self.cv.notify_one();
            return Ok(());
        }

        match self.overflow {
            OverflowPolicy::DropNewest | OverflowPolicy::RejectPublish => Err(QueueOverflowError {
                reason: "subscription queue is full".into(),
            }),
            OverflowPolicy::DropOldest | OverflowPolicy::Conflate => {
                if guard.pop_front().is_some() {
                    self.cv.notify_one();
                }
                guard.push_back(item);
                self.cv.notify_one();
                Ok(())
            }
            OverflowPolicy::Backpressure => {
                while guard.len() + self.in_flight.load(Ordering::SeqCst) >= self.max_depth
                    && !self.closed.load(Ordering::SeqCst)
                {
                    guard = self.cv.wait(guard).unwrap();
                }
                if self.closed.load(Ordering::SeqCst) {
                    Err(QueueOverflowError {
                        reason: "subscription queue closed".into(),
                    })
                } else {
                    guard.push_back(item);
                    self.cv.notify_one();
                    Ok(())
                }
            }
        }
    }

    fn pop(&self) -> Option<QueuedDelivery> {
        let mut guard = self.items.lock().unwrap();
        loop {
            if let Some(item) = guard.pop_front() {
                self.in_flight.fetch_add(1, Ordering::SeqCst);
                self.cv.notify_one();
                return Some(item);
            }
            if self.closed.load(Ordering::SeqCst) {
                return None;
            }
            guard = self.cv.wait(guard).unwrap();
        }
    }

    fn finish(&self) {
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        self.cv.notify_all();
    }

    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.cv.notify_all();
    }
}

type ErasedHandler = dyn Fn(
        DeliveryContext,
        Arc<dyn Any + Send + Sync>,
        SignalMetadata,
        SignalId,
        Address,
        SignalKind,
        AddressExpression,
        Params,
        Schema,
    ) -> Pin<Box<dyn Future<Output = std::result::Result<(), HandlerError>> + Send>>
    + Send
    + Sync;

struct SubscriptionEntry {
    id: SubscriptionId,
    expression: AddressExpression,
    schema: Schema,
    options: DeliveryOptions,
    handler: Arc<ErasedHandler>,
    queue: Arc<SubscriptionQueue>,
    order: usize,
    stopped: AtomicBool,
}

impl SubscriptionEntry {
    fn new(
        id: SubscriptionId,
        expression: AddressExpression,
        schema: Schema,
        options: DeliveryOptions,
        handler: Arc<ErasedHandler>,
        order: usize,
    ) -> Self {
        Self {
            id,
            expression,
            schema,
            options: options.clone(),
            handler,
            queue: Arc::new(SubscriptionQueue::new(
                options.queue.max_depth,
                options.queue.overflow.clone(),
            )),
            order,
            stopped: AtomicBool::new(false),
        }
    }
}

struct Inner {
    next_signal_id: AtomicU64,
    next_subscription_id: AtomicU64,
    next_registration_order: AtomicUsize,
    allow_catch_all: bool,
    default_queue_depth: usize,
    default_delivery_options: DeliveryOptions,
    recursion_policy: RecursionPolicy,
    subscriptions: Vec<Arc<SubscriptionEntry>>,
    services: Vec<ServiceEntry>,
    expression_policies: Vec<(AddressExpression, DeliveryOptions, usize)>,
}

impl Inner {
    fn new() -> Self {
        let default_delivery_options = DeliveryOptions::default();
        Self {
            next_signal_id: AtomicU64::new(1),
            next_subscription_id: AtomicU64::new(1),
            next_registration_order: AtomicUsize::new(1),
            allow_catch_all: false,
            default_queue_depth: default_delivery_options.queue.max_depth,
            recursion_policy: default_delivery_options.recursion.clone(),
            default_delivery_options,
            subscriptions: Vec::new(),
            services: Vec::new(),
            expression_policies: Vec::new(),
        }
    }

    fn next_order(&self) -> usize {
        self.next_registration_order.fetch_add(1, Ordering::SeqCst)
    }
}

#[derive(Clone)]
pub struct SignalBus {
    inner: Arc<Mutex<Inner>>,
}

pub struct SignalBusBuilder {
    allow_catch_all: bool,
    default_queue_depth: usize,
    default_delivery_options: DeliveryOptions,
    recursion_policy: RecursionPolicy,
}

impl SignalBusBuilder {
    pub fn default_queue_depth(mut self, depth: usize) -> Self {
        self.default_queue_depth = depth;
        self
    }

    pub fn allow_catch_all(mut self, allow: bool) -> Self {
        self.allow_catch_all = allow;
        self
    }

    pub fn recursion_policy(mut self, policy: RecursionPolicy) -> Self {
        self.recursion_policy = policy;
        self
    }

    pub fn build(self) -> SignalBus {
        let mut inner = Inner::new();
        inner.allow_catch_all = self.allow_catch_all;
        inner.default_queue_depth = self.default_queue_depth;
        inner.default_delivery_options.queue.max_depth = self.default_queue_depth;
        inner.default_delivery_options = self.default_delivery_options;
        inner.default_delivery_options.queue.max_depth = self.default_queue_depth;
        inner.recursion_policy = self.recursion_policy;
        SignalBus {
            inner: Arc::new(Mutex::new(inner)),
        }
    }
}

impl Default for SignalBusBuilder {
    fn default() -> Self {
        Self {
            allow_catch_all: false,
            default_queue_depth: 1024,
            default_delivery_options: DeliveryOptions::default(),
            recursion_policy: RecursionPolicy::default(),
        }
    }
}

impl SignalBus {
    pub fn new() -> Self {
        Self::builder().build()
    }

    pub fn builder() -> SignalBusBuilder {
        SignalBusBuilder::default()
    }

    pub fn configure_expression(
        &self,
        expression: impl AsRef<str>,
        options: DeliveryOptions,
    ) -> Result<()> {
        validate_retry_policy(&options.retry)
            .map_err(|reason| Error::Configuration(ConfigurationError { reason }))?;
        let mut inner = self.inner.lock().unwrap();
        let expr = AddressExpression::parse(expression.as_ref(), inner.allow_catch_all)?;
        let order = inner.next_order();
        if let Some(entry) = inner
            .expression_policies
            .iter_mut()
            .find(|(existing, _, _)| existing == &expr)
        {
            *entry = (expr, options, order);
        } else {
            inner.expression_policies.push((expr, options, order));
        }
        Ok(())
    }

    pub fn subscribe<T, F, Fut>(
        &self,
        expression: impl AsRef<str>,
        schema: Schema,
        options: DeliveryOptions,
        handler: F,
    ) -> Result<SubscriptionHandle>
    where
        T: Clone + Send + Sync + 'static,
        F: Fn(DeliveryContext, Signal<T>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = std::result::Result<(), HandlerError>> + Send + 'static,
    {
        validate_retry_policy(&options.retry)
            .map_err(|reason| Error::Configuration(ConfigurationError { reason }))?;
        let mut inner = self.inner.lock().unwrap();
        let expression = AddressExpression::parse(expression.as_ref(), inner.allow_catch_all)?;
        let effective_options = if options == DeliveryOptions::default() {
            inner
                .expression_policies
                .iter()
                .find(|(configured_expression, _, _)| configured_expression == &expression)
                .map(|(_, configured_options, _)| configured_options.clone())
                .unwrap_or(options)
        } else {
            options
        };
        let subscription_id =
            SubscriptionId(inner.next_subscription_id.fetch_add(1, Ordering::SeqCst));
        let order = inner.next_order();
        let queue_depth = if effective_options.queue.max_depth == 0 {
            inner.default_queue_depth
        } else {
            effective_options.queue.max_depth
        };
        let normalized_options = DeliveryOptions {
            queue: QueuePolicy {
                max_depth: queue_depth,
                overflow: effective_options.queue.overflow.clone(),
            },
            ..effective_options.clone()
        };
        let handler = wrap_handler::<T, F, Fut>(handler);
        let entry = Arc::new(SubscriptionEntry::new(
            subscription_id,
            expression.clone(),
            schema.clone(),
            normalized_options,
            handler,
            order,
        ));
        start_worker(entry.clone());
        inner.subscriptions.push(entry);
        Ok(SubscriptionHandle {
            bus: Arc::downgrade(&self.inner),
            id: subscription_id,
            closed: AtomicBool::new(false),
        })
    }

    pub fn publish<T>(&self, address: impl AsRef<str>, payload: T) -> Result<PublishResult>
    where
        T: Clone + Send + Sync + 'static,
    {
        self.publish_with_metadata(
            address,
            payload,
            SignalKind::Event,
            SignalMetadata::default(),
        )
    }

    pub fn publish_with_metadata<T>(
        &self,
        address: impl AsRef<str>,
        payload: T,
        kind: SignalKind,
        metadata: SignalMetadata,
    ) -> Result<PublishResult>
    where
        T: Clone + Send + Sync + 'static,
    {
        let address = Address::parse(address.as_ref())?;
        let schema = Schema::of::<T>();
        self.publish_envelope(address, payload, kind, metadata, schema)
    }

    pub fn publish_reference(
        &self,
        address: impl AsRef<str>,
        payload_ref: PayloadRef,
        kind: SignalKind,
        metadata: SignalMetadata,
    ) -> Result<PublishResult> {
        let address = Address::parse(address.as_ref())?;
        let schema = Schema {
            type_id: TypeId::of::<PayloadRef>(),
            type_name: std::any::type_name::<PayloadRef>(),
            schema_id: payload_ref.schema_id.clone().map(Into::into),
        };
        self.publish_envelope(address, payload_ref, kind, metadata, schema)
    }

    fn publish_envelope<T>(
        &self,
        address: Address,
        payload: T,
        kind: SignalKind,
        metadata: SignalMetadata,
        schema: Schema,
    ) -> Result<PublishResult>
    where
        T: Clone + Send + Sync + 'static,
    {
        let address_canonical = address.clone();
        let payload = Arc::new(payload) as Arc<dyn Any + Send + Sync>;
        let signal_id = SignalId(
            self.inner
                .lock()
                .unwrap()
                .next_signal_id
                .fetch_add(1, Ordering::SeqCst),
        );
        let mut result = PublishResult {
            signal_id,
            matched_subscribers: 0,
            accepted_deliveries: 0,
            rejected_deliveries: 0,
            errors: Vec::new(),
        };

        let matches = {
            let inner = self.inner.lock().unwrap();
            let depth = CAUSATION_DEPTH.with(Cell::get);
            if depth >= inner.recursion_policy.max_causation_depth {
                return match inner.recursion_policy.on_exceeded {
                    RecursionOverflowPolicy::RejectPublish => {
                        Err(Error::RecursionOverflow(RecursionOverflowError {
                            depth,
                            max_depth: inner.recursion_policy.max_causation_depth,
                        }))
                    }
                    RecursionOverflowPolicy::Drop => Ok(result),
                };
            }
            let mut matches = Vec::new();
            for entry in &inner.subscriptions {
                if entry.stopped.load(Ordering::SeqCst) {
                    continue;
                }
                if let Some(m) = match_expression(&entry.expression, &address, entry.order) {
                    matches.push((entry.clone(), m));
                }
            }
            matches
        };

        result.matched_subscribers = matches.len();
        if matches.is_empty() {
            return Ok(result);
        }

        CAUSATION_DEPTH.with(|cell| cell.set(cell.get() + 1));
        for (entry, _matched) in matches {
            if entry.schema.type_id != schema.type_id {
                result.rejected_deliveries += 1;
                result.errors.push(PublishError::SchemaMismatch(
                    entry.schema.type_name.to_string(),
                ));
                continue;
            }
            let queued = QueuedDelivery {
                signal_id,
                address: address_canonical.clone(),
                kind: kind.clone(),
                payload: payload.clone(),
                payload_schema: schema.clone(),
                metadata: metadata.clone(),
            };
            match entry.queue.push(queued) {
                Ok(()) => {
                    result.accepted_deliveries += 1;
                }
                Err(err) => {
                    result.rejected_deliveries += 1;
                    result.errors.push(PublishError::QueueOverflow(err));
                }
            }
        }
        CAUSATION_DEPTH.with(|cell| cell.set(cell.get().saturating_sub(1)));
        Ok(result)
    }

    pub fn register_service<T>(&self, address: impl AsRef<str>, service: Arc<T>) -> Result<()>
    where
        T: Any + Send + Sync + 'static,
    {
        self.register_service_with_options(address, service, ServiceRegistrationOptions::default())
    }

    pub fn register_service_with_options<T>(
        &self,
        address: impl AsRef<str>,
        service: Arc<T>,
        options: ServiceRegistrationOptions,
    ) -> Result<()>
    where
        T: Any + Send + Sync + 'static,
    {
        let mut inner = self.inner.lock().unwrap();
        let expression = AddressExpression::parse(address.as_ref(), inner.allow_catch_all)?;
        let order = inner.next_order();
        if let Some(existing) = inner
            .services
            .iter()
            .find(|entry| entry.expression == expression)
        {
            if !options.allow_override {
                return Err(Error::RegistrationConflict(RegistrationConflictError {
                    address: existing.expression.to_string(),
                }));
            }
        }
        let entry = ServiceEntry {
            expression,
            service: service as Arc<dyn Any + Send + Sync>,
            type_id: TypeId::of::<T>(),
            order,
        };
        if options.allow_override {
            inner
                .services
                .retain(|existing| existing.expression != entry.expression);
        }
        inner.services.push(entry);
        Ok(())
    }

    pub fn resolve_service<T>(
        &self,
        address: impl AsRef<str>,
        mode: ResolutionMode,
    ) -> Result<ResolvedService<T>>
    where
        T: Any + Send + Sync + 'static,
    {
        let address = Address::parse(address.as_ref())?;
        let inner = self.inner.lock().unwrap();
        let mut matches: Vec<(ServiceEntry, Match)> = inner
            .services
            .iter()
            .filter_map(|entry| service_matches(entry, &address).map(|m| (entry.clone(), m)))
            .filter(|(entry, _)| entry.type_id == TypeId::of::<T>())
            .collect();

        if matches.is_empty() {
            let has_type_mismatch = inner
                .services
                .iter()
                .any(|entry| service_matches(entry, &address).is_some());
            if has_type_mismatch {
                return Err(Error::ServiceTypeMismatch(ServiceTypeMismatchError {
                    address: address.to_string(),
                    expected: service_type_name::<T>(),
                }));
            }
            return Err(Error::ServiceNotFound(ServiceNotFoundError {
                address: address.to_string(),
            }));
        }

        matches.sort_by(|a, b| b.1.specificity.cmp(&a.1.specificity));
        match mode {
            ResolutionMode::ExactOne => {
                if matches.len() > 1 {
                    return Err(Error::ServiceAmbiguous(ServiceAmbiguousError {
                        address: address.to_string(),
                        matches: matches.len(),
                    }));
                }
            }
            ResolutionMode::FirstBySpecificity => {}
            ResolutionMode::AllMatches => {}
        }

        let (entry, matched) = matches.remove(0);
        let service = downcast_service::<T>(entry.service).ok_or_else(|| {
            Error::ServiceTypeMismatch(ServiceTypeMismatchError {
                address: address.to_string(),
                expected: service_type_name::<T>(),
            })
        })?;

        Ok(ResolvedService {
            service,
            expression: entry.expression,
            address,
            params: matched.params,
            specificity: matched.specificity,
        })
    }

    pub fn resolve_services<T>(&self, address: impl AsRef<str>) -> Result<Vec<ResolvedService<T>>>
    where
        T: Any + Send + Sync + 'static,
    {
        let address = Address::parse(address.as_ref())?;
        let inner = self.inner.lock().unwrap();
        let mut matches: Vec<(ServiceEntry, Match)> = inner
            .services
            .iter()
            .filter_map(|entry| service_matches(entry, &address).map(|m| (entry.clone(), m)))
            .filter(|(entry, _)| entry.type_id == TypeId::of::<T>())
            .collect();
        matches.sort_by(|a, b| b.1.specificity.cmp(&a.1.specificity));

        let mut out = Vec::new();
        for (entry, matched) in matches {
            let service = downcast_service::<T>(entry.service).ok_or_else(|| {
                Error::ServiceTypeMismatch(ServiceTypeMismatchError {
                    address: address.to_string(),
                    expected: service_type_name::<T>(),
                })
            })?;
            out.push(ResolvedService {
                service,
                expression: entry.expression,
                address: address.clone(),
                params: matched.params,
                specificity: matched.specificity,
            });
        }
        Ok(out)
    }

    pub fn unsubscribe(&self, id: SubscriptionId) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(index) = inner.subscriptions.iter().position(|entry| entry.id == id) {
            let entry = inner.subscriptions.remove(index);
            entry.stopped.store(true, Ordering::SeqCst);
            entry.queue.close();
        }
    }
}

fn wrap_handler<T, F, Fut>(handler: F) -> Arc<ErasedHandler>
where
    T: Clone + Send + Sync + 'static,
    F: Fn(DeliveryContext, Signal<T>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = std::result::Result<(), HandlerError>> + Send + 'static,
{
    Arc::new(
        move |ctx, payload, metadata, signal_id, address, kind, expression, params, schema| {
            let typed_payload = match Arc::downcast::<T>(payload) {
                Ok(payload) => (*payload).clone(),
                Err(_) => {
                    let err = HandlerError {
                        reason: format!("payload downcast failed for {}", schema.type_name),
                    };
                    return Box::pin(async move { Err(err) });
                }
            };
            let signal = Signal {
                id: signal_id,
                address,
                kind,
                payload: Payload::Inline(typed_payload),
                metadata,
            };
            let _ = expression;
            let _ = params;
            Box::pin(handler(ctx, signal))
        },
    )
}

fn start_worker(entry: Arc<SubscriptionEntry>) {
    thread::spawn(move || {
        while let Some(item) = entry.queue.pop() {
            if entry.stopped.load(Ordering::SeqCst) {
                break;
            }
            let match_result = match_expression(&entry.expression, &item.address, entry.order)
                .unwrap_or_else(|| Match {
                    expression: entry.expression.clone(),
                    address: item.address.clone(),
                    params: Params::default(),
                    specificity: Specificity::default(),
                });
            let ctx = DeliveryContext {
                signal_id: item.signal_id,
                subscription_id: entry.id,
                address: item.address.clone(),
                expression: entry.expression.clone(),
                params: match_result.params.clone(),
                metadata: item.metadata.clone(),
            };

            let handler = entry.handler.clone();
            let payload = item.payload.clone();
            let metadata = item.metadata.clone();
            let signal_id = item.signal_id;
            let address = item.address.clone();
            let kind = item.kind.clone();
            let expression = entry.expression.clone();
            let params = match_result.params.clone();
            let schema = item.payload_schema.clone();
            let timeout = entry.options.timeout.handler_timeout;
            let (tx, rx) = std::sync::mpsc::channel();
            thread::spawn(move || {
                let previous_depth = CAUSATION_DEPTH.with(|cell| {
                    let depth = cell.get();
                    cell.set(depth + 1);
                    depth
                });
                let fut = (handler)(
                    ctx, payload, metadata, signal_id, address, kind, expression, params, schema,
                );
                let result = block_on(fut);
                let _ = tx.send(result);
                CAUSATION_DEPTH.with(|cell| cell.set(previous_depth));
            });

            if let Some(timeout) = timeout {
                match rx.recv_timeout(timeout) {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {}
                }
            } else {
                let _ = rx.recv();
            }
            entry.queue.finish();
        }
    });
}

fn block_on<F: Future>(mut future: F) -> F::Output {
    fn raw_waker() -> RawWaker {
        fn clone(_: *const ()) -> RawWaker {
            raw_waker()
        }
        fn wake(_: *const ()) {}
        fn wake_by_ref(_: *const ()) {}
        fn drop(_: *const ()) {}
        RawWaker::new(
            std::ptr::null(),
            &RawWakerVTable::new(clone, wake, wake_by_ref, drop),
        )
    }

    let waker = unsafe { Waker::from_raw(raw_waker()) };
    let mut cx = Context::from_waker(&waker);
    let mut future = unsafe { Pin::new_unchecked(&mut future) };
    loop {
        match Future::poll(future.as_mut(), &mut cx) {
            Poll::Ready(output) => return output,
            Poll::Pending => thread::yield_now(),
        }
    }
}

pub struct SubscriptionHandle {
    bus: std::sync::Weak<Mutex<Inner>>,
    id: SubscriptionId,
    closed: AtomicBool,
}

impl SubscriptionHandle {
    pub fn id(&self) -> SubscriptionId {
        self.id
    }

    pub fn unsubscribe(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(bus) = self.bus.upgrade() {
            let mut inner = bus.lock().unwrap();
            if let Some(index) = inner
                .subscriptions
                .iter()
                .position(|entry| entry.id == self.id)
            {
                let entry = inner.subscriptions.remove(index);
                entry.stopped.store(true, Ordering::SeqCst);
                entry.queue.close();
            }
        }
    }
}

impl Drop for SubscriptionHandle {
    fn drop(&mut self) {
        self.unsubscribe();
    }
}

impl Default for SignalBus {
    fn default() -> Self {
        Self::new()
    }
}
