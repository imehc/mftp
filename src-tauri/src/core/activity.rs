use crate::error::{AppError, AppResult};

/// Explicit safe metadata only; never capture entire inputs or credentials.
pub(crate) struct OperationContext {
    pub source: &'static str,
    pub action: &'static str,
    pub address: String,
    pub detail: Option<String>,
}

impl OperationContext {
    pub(crate) fn new(
        source: &'static str,
        action: &'static str,
        address: impl Into<String>,
    ) -> Self {
        Self {
            source,
            action,
            address: address.into(),
            detail: None,
        }
    }

    pub(crate) fn with_detail(mut self, detail: String) -> Self {
        self.detail = Some(detail);
        self
    }
}

pub(crate) trait ActivitySink: Send + Sync {
    fn record(&self, context: &OperationContext, error: Option<&AppError>) -> AppResult<()>;
}
