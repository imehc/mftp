//! Android-only short-lived plaintext reuse. No serialization or debug output.

use std::{sync::Arc, time::Duration};

use parking_lot::Mutex;
use tokio::{sync::Mutex as AsyncMutex, task::AbortHandle, time::Instant};
use zeroize::Zeroizing;

use crate::{
    error::{AppError, AppResult, CustomErrorCode},
    modules::ai::AiCredentials,
};

pub(super) const REUSE_DURATION: Duration = Duration::from_secs(5 * 60);

struct Entry {
    reference: String,
    value: Zeroizing<String>,
    deadline: Instant,
}

struct State {
    foreground: bool,
    generation: u64,
    entry_id: u64,
    entry: Option<Entry>,
    expiry: Option<AbortHandle>,
}

impl State {
    fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.forget();
    }

    fn forget(&mut self) {
        self.entry_id = self.entry_id.wrapping_add(1);
        self.entry = None;
        if let Some(expiry) = self.expiry.take() {
            expiry.abort();
        }
    }

    fn check(&self, generation: u64) -> AppResult<()> {
        if self.foreground && self.generation == generation {
            Ok(())
        } else {
            Err(AppError::custom(CustomErrorCode::AiAuthenticationExpired))
        }
    }
}

impl Drop for State {
    fn drop(&mut self) {
        self.invalidate();
    }
}

pub(super) struct CachedCredentials<C> {
    native: C,
    state: Arc<Mutex<State>>,
    // Native authentication must finish before another prompt can be started.
    operation: AsyncMutex<()>,
}

impl<C: AiCredentials> CachedCredentials<C> {
    pub(super) fn new(native: C) -> Self {
        Self {
            native,
            state: Arc::new(Mutex::new(State {
                // Tauri omits Android's first onResume on Activity creation.
                foreground: true,
                generation: 0,
                entry_id: 0,
                entry: None,
                expiry: None,
            })),
            operation: AsyncMutex::new(()),
        }
    }

    pub(super) fn set_foreground(&self, foreground: bool) {
        let mut state = self.state.lock();
        state.foreground = foreground;
        if !foreground {
            state.invalidate();
        }
    }

    fn admission(&self) -> AppResult<u64> {
        let state = self.state.lock();
        state.check(state.generation)?;
        Ok(state.generation)
    }

    fn publish(
        &self,
        generation: u64,
        reference: String,
        value: Zeroizing<String>,
    ) -> AppResult<()> {
        let mut state = self.state.lock();
        state.check(generation)?;
        // Replacing the one cached reference wipes its value and timer.
        state.forget();
        let entry_id = state.entry_id;
        let deadline = Instant::now() + REUSE_DURATION;
        state.entry = Some(Entry {
            reference,
            value,
            deadline,
        });
        let weak = Arc::downgrade(&self.state);
        state.expiry = Some(
            tokio::spawn(async move {
                tokio::time::sleep_until(deadline).await;
                if let Some(state) = weak.upgrade() {
                    let mut state = state.lock();
                    if state.entry_id == entry_id {
                        state.forget();
                    }
                }
            })
            .abort_handle(),
        );
        Ok(())
    }
}

impl<C: AiCredentials> AiCredentials for CachedCredentials<C> {
    async fn save(&self, reference: String, value: String) -> AppResult<()> {
        let value = Zeroizing::new(value);
        // Invalidate before waiting: even a failed replacement retires reuse.
        let generation = {
            let mut state = self.state.lock();
            state.invalidate();
            state.check(state.generation)?;
            state.generation
        };
        let _operation = self.operation.lock().await;
        self.state.lock().check(generation)?;
        self.native
            .save(reference.clone(), value.to_string())
            .await?;
        self.publish(generation, reference, value)
    }

    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        let generation = self.admission()?;
        let _operation = self.operation.lock().await;
        {
            let mut state = self.state.lock();
            state.check(generation)?;
            if state
                .entry
                .as_ref()
                .is_some_and(|entry| entry.deadline <= Instant::now())
            {
                // The timer can be delayed by runtime scheduling. A read must
                // still enforce the exact deadline before copying plaintext.
                state.forget();
            }
            if let Some(entry) = &state.entry {
                if entry.reference == reference {
                    return Ok(Some(entry.value.to_string()));
                }
            }
        }
        let value = self
            .native
            .read(reference.clone())
            .await?
            .map(Zeroizing::new);
        self.state.lock().check(generation)?;
        if let Some(value) = value {
            self.publish(generation, reference, value.clone())?;
            Ok(Some(value.to_string()))
        } else {
            Ok(None)
        }
    }

    async fn clear(&self, reference: String) -> AppResult<()> {
        {
            let mut state = self.state.lock();
            state.generation = state.generation.wrapping_add(1);
            // Journal cleanup of a retired reference must not discard a newly
            // authenticated replacement that has already been published.
            if state
                .entry
                .as_ref()
                .is_some_and(|entry| entry.reference == reference)
            {
                state.forget();
            }
        }
        let _operation = self.operation.lock().await;
        // Cleanup is permitted while backgrounded; it cannot populate reuse.
        self.native.clear(reference).await
    }
}

#[cfg(test)]
#[path = "ai_cache_tests.rs"]
mod tests;
