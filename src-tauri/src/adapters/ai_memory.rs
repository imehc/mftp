//! Instance-local test store. No native calls or process-global builder changes.

use keyring::credential::{CredentialApi, CredentialBuilderApi};
use parking_lot::Mutex;
use std::{any::Any, collections::HashMap, sync::Arc};

type Account = (String, String);

#[derive(Default)]
struct State {
    values: HashMap<Account, Vec<u8>>,
    calls: Vec<(String, Account)>,
    fail_service: Option<String>,
}

#[derive(Clone, Default)]
pub(super) struct MemoryCredentialBuilder(Arc<Mutex<State>>);

impl MemoryCredentialBuilder {
    pub(super) fn fail_service(&self, service: Option<&str>) {
        self.0.lock().fail_service = service.map(str::to_string);
    }

    pub(super) fn calls(&self) -> Vec<(String, Account)> {
        self.0.lock().calls.clone()
    }
}

impl CredentialBuilderApi for MemoryCredentialBuilder {
    fn build(
        &self,
        target: Option<&str>,
        service: &str,
        user: &str,
    ) -> keyring::Result<Box<keyring::Credential>> {
        assert!(target.is_none());
        Ok(Box::new(MemoryCredential {
            store: self.clone(),
            account: (service.into(), user.into()),
        }))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

struct MemoryCredential {
    store: MemoryCredentialBuilder,
    account: Account,
}

impl MemoryCredential {
    fn access<T>(
        &self,
        action: &str,
        apply: impl FnOnce(&mut State) -> keyring::Result<T>,
    ) -> keyring::Result<T> {
        let mut state = self.store.0.lock();
        state.calls.push((action.into(), self.account.clone()));
        if state.fail_service.as_deref() == Some(&self.account.0) {
            return Err(keyring::Error::BadEncoding(b"private-test-secret".to_vec()));
        }
        apply(&mut state)
    }
}

impl CredentialApi for MemoryCredential {
    fn set_secret(&self, value: &[u8]) -> keyring::Result<()> {
        self.access("write", |state| {
            state.values.insert(self.account.clone(), value.to_vec());
            Ok(())
        })
    }

    fn get_secret(&self) -> keyring::Result<Vec<u8>> {
        self.access("read", |state| {
            state
                .values
                .get(&self.account)
                .cloned()
                .ok_or(keyring::Error::NoEntry)
        })
    }

    fn delete_credential(&self) -> keyring::Result<()> {
        self.access("delete", |state| {
            state
                .values
                .remove(&self.account)
                .map(|_| ())
                .ok_or(keyring::Error::NoEntry)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}
