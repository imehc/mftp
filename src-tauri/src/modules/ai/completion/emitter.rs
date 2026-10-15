use super::{AiObservation, AiStreamEvent, AiStreamEventPayload};
use parking_lot::Mutex;
use std::sync::Arc;

struct Delivery<'a> {
    sequence: u32,
    callback: Box<dyn FnMut(AiStreamEvent) + Send + 'a>,
}

pub(crate) struct AiEmitter<'a> {
    request_id: String,
    observation: Arc<AiObservation>,
    delivery: Mutex<Delivery<'a>>,
}

impl<'a> AiEmitter<'a> {
    pub(crate) fn new(
        observation: Arc<AiObservation>,
        callback: impl FnMut(AiStreamEvent) + Send + 'a,
    ) -> Arc<Self> {
        Self::with_id(uuid::Uuid::new_v4().to_string(), observation, callback)
    }

    pub(crate) fn with_id(
        request_id: String,
        observation: Arc<AiObservation>,
        callback: impl FnMut(AiStreamEvent) + Send + 'a,
    ) -> Arc<Self> {
        Arc::new(Self {
            request_id,
            observation,
            delivery: Mutex::new(Delivery {
                sequence: 0,
                callback: Box::new(callback),
            }),
        })
    }

    pub(crate) fn emit(&self, payload: AiStreamEventPayload) {
        let mut delivery = self.delivery.lock();
        let event = AiStreamEvent {
            request_id: self.request_id.clone(),
            sequence: delivery.sequence,
            elapsed_ms: self.observation.elapsed_ms(),
            payload,
        };
        delivery.sequence = delivery.sequence.saturating_add(1);
        (delivery.callback)(event);
    }
}
