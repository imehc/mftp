use std::collections::BTreeSet;

use rusqlite::{Connection, Transaction};

use super::model::{AiConfigurationView, AiKeyState, AiKeyView, AiModelView, AiProviderView};
use crate::error::AppResult;
use crate::modules::ai::AiRepository;

impl AiRepository {
    pub(in crate::modules::ai) fn configuration(&self) -> AppResult<AiConfigurationView> {
        snapshot(&mut self.storage.conn()?)
    }
}

pub(super) fn snapshot(conn: &mut Connection) -> AppResult<AiConfigurationView> {
    // The first SELECT pins a SQLite snapshot for settings, children, and
    // candidates. No credential IO occurs here, nor across the transaction.
    let tx = conn.transaction()?;
    let view = snapshot_in(&tx)?;
    tx.commit()?;
    Ok(view)
}

pub(super) fn snapshot_in(tx: &Transaction<'_>) -> AppResult<AiConfigurationView> {
    let (revision, active_provider_id, streaming_enabled) = tx.query_row(
        "SELECT revision, active_provider_id, streaming_enabled FROM ai_settings WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
    )?;
    let mut providers = tx
        .prepare(
            "SELECT id, name, base_url, endpoint_key IS NULL, current_key_id, current_model_id,
             revision FROM ai_providers ORDER BY created_at, id",
        )?
        .query_map([], |r| {
            Ok(AiProviderView {
                id: r.get(0)?,
                name: r.get(1)?,
                base_url: r.get(2)?,
                requires_address_repair: r.get(3)?,
                current_key_id: r.get(4)?,
                current_model_id: r.get(5)?,
                revision: r.get(6)?,
                keys: Vec::new(),
                models: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut labels = BTreeSet::new();
    let mut models = BTreeSet::new();
    for provider in &mut providers {
        provider.keys = keys(&tx, &provider.id)?;
        provider.models = provider_models(&tx, &provider.id)?;
        for key in &provider.keys {
            add_candidate(&mut labels, &key.label);
        }
        for model in &provider.models {
            add_candidate(&mut models, &model.model_id);
        }
    }
    Ok(AiConfigurationView {
        revision,
        active_provider_id,
        streaming_enabled,
        providers,
        label_candidates: labels.into_iter().collect(),
        model_candidates: models.into_iter().collect(),
    })
}

fn add_candidate(candidates: &mut BTreeSet<String>, value: &str) {
    let value = value.trim();
    if !value.is_empty() {
        candidates.insert(value.to_string());
    }
}

fn keys(tx: &Transaction<'_>, provider_id: &str) -> AppResult<Vec<AiKeyView>> {
    Ok(tx
        .prepare(
            "SELECT id, label, credential_ref IS NOT NULL FROM ai_provider_keys
             WHERE provider_id = ?1 ORDER BY created_at, id",
        )?
        .query_map([provider_id], |r| {
            Ok(AiKeyView {
                id: r.get(0)?,
                label: r.get(1)?,
                state: if r.get::<_, bool>(2)? {
                    AiKeyState::SavedUnverified
                } else {
                    AiKeyState::Missing
                },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn provider_models(tx: &Transaction<'_>, provider_id: &str) -> AppResult<Vec<AiModelView>> {
    Ok(tx
        .prepare(
            "SELECT id, model_id, display_name FROM ai_provider_models
             WHERE provider_id = ?1 ORDER BY sort_order, created_at, id",
        )?
        .query_map([provider_id], |r| {
            Ok(AiModelView {
                id: r.get(0)?,
                model_id: r.get(1)?,
                display_name: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
#[path = "read_tests.rs"]
mod tests;
