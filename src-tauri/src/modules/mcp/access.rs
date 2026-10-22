use crate::error::{AppError, AppResult, CustomErrorCode};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Permission {
    Read,
    Write,
    Delete,
}

pub(crate) const ALL_MODULES: &str = "*";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModuleGrant {
    pub read: bool,
    pub write: bool,
    pub delete: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct Caller {
    subject: String,
    grants: BTreeMap<String, ModuleGrant>,
    authorization: Option<Arc<Authorization>>,
}

#[derive(Debug, Default)]
pub(crate) struct Authorization {
    disabled: AtomicBool,
    workers: RwLock<()>,
}

impl Authorization {
    pub(crate) fn disable(&self) {
        self.disabled.store(true, Ordering::SeqCst);
    }
    pub(crate) fn drain(&self) {
        let _workers = self.workers.write();
    }
}

impl Caller {
    #[cfg(test)]
    pub(crate) fn new(subject: String, grants: BTreeMap<String, ModuleGrant>) -> Self {
        Self {
            subject,
            grants,
            authorization: None,
        }
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.authorization
            .as_ref()
            .is_some_and(|authorization| authorization.disabled.load(Ordering::SeqCst))
    }

    pub(crate) fn authenticated(
        subject: String,
        grants: BTreeMap<String, ModuleGrant>,
        authorization: Arc<Authorization>,
    ) -> Self {
        Self {
            subject,
            grants,
            authorization: Some(authorization),
        }
    }

    pub(crate) fn execute<T>(&self, operation: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
        let _workers = self
            .authorization
            .as_ref()
            .map(|authorization| authorization.workers.read());
        if self
            .authorization
            .as_ref()
            .is_some_and(|authorization| authorization.disabled.load(Ordering::SeqCst))
        {
            return Err(AppError::custom(CustomErrorCode::McpUnauthorized));
        }
        operation()
    }

    pub(crate) fn subject(&self) -> &str {
        &self.subject
    }

    pub(crate) fn allows(&self, module: &str, permission: Permission) -> bool {
        !self.subject.is_empty()
            && self
                .authorization
                .as_ref()
                .is_none_or(|authorization| !authorization.disabled.load(Ordering::SeqCst))
            && self
                .grants
                .get(ALL_MODULES)
                .or_else(|| self.grants.get(module))
                .is_some_and(|grant| match permission {
                    Permission::Read => grant.read,
                    Permission::Write => grant.read && grant.write,
                    Permission::Delete => grant.read && grant.write && grant.delete,
                })
    }
}
