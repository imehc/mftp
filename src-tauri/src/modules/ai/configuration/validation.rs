use super::input::*;
use crate::error::{AppError, AppResult, CustomErrorCode as Code};
use crate::modules::ai::service::url::validate_connection;

pub(in crate::modules::ai) const PROVIDER_LIMIT: i64 = 5;
pub(in crate::modules::ai) const KEY_LIMIT: i64 = 5;
pub(in crate::modules::ai) const MODEL_LIMIT: i64 = 10;

pub(in crate::modules::ai) fn text(value: &str, code: Code) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        return Err(AppError::custom(code));
    }
    Ok(value.into())
}
pub(in crate::modules::ai) fn secret(value: String) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 16_384 {
        return Err(AppError::custom(Code::AiApiKeyInvalid));
    }
    Ok(value.into())
}
fn model(model: &str, display: Option<String>) -> AppResult<(String, Option<String>)> {
    let model = model_id(model)?;
    let display = display
        .filter(|s| !s.trim().is_empty())
        .map(|s| text(&s, Code::AiDisplayNameInvalid))
        .transpose()?;
    Ok((model, display))
}

pub(super) fn model_id(model: &str) -> AppResult<String> {
    let model = model.trim();
    if model.is_empty() || model.len() > 256 || model.chars().any(char::is_control) {
        return Err(AppError::custom(Code::AiModelInvalid));
    }
    Ok(model.into())
}

#[derive(Clone)]
pub(in crate::modules::ai) struct NewProvider {
    pub expected_revision: i64,
    pub name: String,
    pub base_url: String,
    pub label: String,
    pub model: String,
    pub display: Option<String>,
}
impl NewProvider {
    pub(in crate::modules::ai) fn prepare(
        input: AiProviderCreateInput,
    ) -> AppResult<(Self, String)> {
        let config = validate_connection(&input.base_url, &input.model_id)?;
        let (model, display) = model(&config.model, input.display_name)?;
        Ok((
            Self {
                expected_revision: input.expected_revision,
                name: text(&input.name, Code::AiProviderNameInvalid)?,
                base_url: config.base_url,
                label: text(&input.key_label, Code::AiKeyLabelInvalid)?,
                model,
                display,
            },
            secret(input.api_key)?,
        ))
    }
}
#[derive(Clone)]
pub(in crate::modules::ai) struct KeyDraft {
    pub expected_revision: i64,
    pub provider_id: String,
    pub key_id: Option<String>,
    pub label: String,
}
impl KeyDraft {
    pub(in crate::modules::ai) fn prepare(
        input: AiKeySaveInput,
    ) -> AppResult<(Self, Option<String>)> {
        let secret = input.replacement_secret.map(secret).transpose()?;
        if input.key_id.is_none() && secret.is_none() {
            return Err(AppError::custom(Code::AiApiKeyMissing));
        }
        Ok((
            Self {
                expected_revision: input.expected_revision,
                provider_id: input.provider_id,
                key_id: input.key_id,
                label: text(&input.label, Code::AiKeyLabelInvalid)?,
            },
            secret,
        ))
    }
}
pub(in crate::modules::ai) fn provider_update(
    mut input: AiProviderUpdateInput,
) -> AppResult<AiProviderUpdateInput> {
    input.name = text(&input.name, Code::AiProviderNameInvalid)?;
    input.base_url = validate_connection(&input.base_url, "validation")?.base_url;
    Ok(input)
}
pub(in crate::modules::ai) fn model_save(
    mut input: AiModelSaveInput,
) -> AppResult<AiModelSaveInput> {
    (input.model_id, input.display_name) = model(&input.model_id, input.display_name)?;
    Ok(input)
}
