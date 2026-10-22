use crate::{
    core::diagnostics::{DiagnosticBodyEnd, DiagnosticRecorder},
    error::AppError,
};
use axum::body::Bytes;
use http_body::{Body, Frame, SizeHint};
use parking_lot::Mutex;
use std::{
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio::sync::OwnedSemaphorePermit;

pub(crate) struct Log {
    pub(crate) recorder: DiagnosticRecorder,
    pub(crate) error: Option<AppError>,
}

pub(crate) type SharedLog = Option<Arc<Mutex<Log>>>;

pub(crate) struct Tee<B> {
    inner: Pin<Box<B>>,
    log: SharedLog,
    response: bool,
    finished: bool,
    _permit: Option<OwnedSemaphorePermit>,
}

impl<B: Body> Tee<B> {
    pub(crate) fn request(inner: B, log: SharedLog) -> Self {
        let mut tee = Self {
            inner: Box::pin(inner),
            log,
            response: false,
            finished: false,
            _permit: None,
        };
        if tee.inner.is_end_stream() {
            tee.end(DiagnosticBodyEnd::Complete);
        }
        tee
    }
    pub(crate) fn response(inner: B, log: SharedLog, permit: Option<OwnedSemaphorePermit>) -> Self {
        let mut tee = Self {
            inner: Box::pin(inner),
            log,
            response: true,
            finished: false,
            _permit: permit,
        };
        if tee.inner.is_end_stream() {
            tee.end(DiagnosticBodyEnd::Complete);
        }
        tee
    }
}

impl<B> Tee<B> {
    fn end(&mut self, end: DiagnosticBodyEnd) {
        if self.finished {
            return;
        }
        self.finished = true;
        if let Some(mut log) = self.log.as_ref().and_then(|log| log.try_lock()) {
            if self.response {
                log.recorder.response_end(end);
                let error = log.error.clone();
                if end == DiagnosticBodyEnd::Complete {
                    log.recorder.finish(error.as_ref());
                } else {
                    log.recorder.unverified();
                }
            } else {
                log.recorder.request_end(end);
            }
        }
    }
}

impl<B: Body<Data = Bytes>> Body for Tee<B>
where
    B::Error: std::fmt::Display,
{
    type Data = Bytes;
    type Error = B::Error;
    fn poll_frame(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        let result = self.inner.as_mut().poll_frame(context);
        match &result {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(bytes) = frame.data_ref() {
                    if let Some(mut log) = self.log.as_ref().and_then(|log| log.try_lock()) {
                        if self.response {
                            log.recorder.response_bytes(bytes);
                        } else {
                            log.recorder.request_bytes(bytes);
                        }
                    }
                }
            }
            Poll::Ready(Some(Err(error))) => {
                if let Some(mut log) = self.log.as_ref().and_then(|log| log.try_lock()) {
                    log.recorder.transport_error(error);
                }
                self.end(DiagnosticBodyEnd::Interrupted);
            }
            Poll::Ready(None) => self.end(DiagnosticBodyEnd::Complete),
            Poll::Pending => {}
        }
        if self.inner.is_end_stream() {
            self.end(DiagnosticBodyEnd::Complete);
        }
        result
    }
    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }
    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

impl<B> Drop for Tee<B> {
    fn drop(&mut self) {
        self.end(DiagnosticBodyEnd::Interrupted);
    }
}
