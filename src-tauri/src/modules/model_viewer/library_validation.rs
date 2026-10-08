use super::library_models::{ModelCameraState, ModelLibraryInput, ModelViewState};
use super::service::validate_key;
use crate::error::{AppError, AppResult, CustomErrorCode as Code};
use std::collections::HashSet;

pub(super) const CHUNK: usize = 1024 * 1024;
pub(super) const MAX_BYTES: u64 = 512 * 1024 * 1024;
pub(super) fn invalid() -> AppError {
    AppError::custom(Code::ModelLibraryInvalid)
}
pub(super) fn missing() -> AppError {
    AppError::custom(Code::ModelLibraryMissing)
}
pub(super) fn name(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn vector(value: &[f64; 3]) -> bool {
    value.iter().all(|v| v.is_finite() && v.abs() <= 1e8)
}
fn camera(value: &ModelCameraState) -> bool {
    vector(&value.position)
        && vector(&value.target)
        && value.near.is_finite()
        && value.near > 0.0
        && value.far.is_finite()
        && value.far > value.near
        && value.far <= 1e12
}
pub(super) fn view(value: &ModelViewState) -> AppResult<()> {
    if value.version != 1 {
        return Err(AppError::custom(Code::ModelLibraryVersion));
    }
    let a = &value.animation;
    if !camera(&value.camera)
        || !vector(&value.position)
        || value.views.len() > 20
        || value
            .views
            .iter()
            .any(|v| !name(&v.id, 80) || !name(&v.name, 240) || !camera(&v.camera))
        || a.selected < -1
        || a.selected > 100_000
        || !a.time.is_finite()
        || a.time < 0.0
        || a.time > 1e12
        || !a.phase.is_finite()
        || a.phase < 0.0
        || a.phase > 1e12
        || ![0.25, 0.5, 1.0, 1.5, 2.0].contains(&a.speed)
        || !["once", "repeat", "pingpong"].contains(&a.loop_mode.as_str())
        || !["m", "cm", "mm", "ft"].contains(&value.unit.as_str())
    {
        return Err(invalid());
    }
    Ok(())
}
pub(super) fn input(value: &ModelLibraryInput) -> AppResult<u32> {
    view(&value.view)?;
    if !name(&value.name, 1024)
        || !["glb", "gltf"].iter().any(|ext| {
            value
                .name
                .to_ascii_lowercase()
                .ends_with(&format!(".{ext}"))
        })
        || value.resources.is_empty()
        || value.resources.len() > 4096
    {
        return Err(invalid());
    }
    let mut keys = HashSet::new();
    let mut size = 0_u64;
    for resource in &value.resources {
        if !resource.key.is_empty() {
            validate_key(&resource.key)?;
        }
        if !keys.insert(&resource.key) {
            return Err(invalid());
        }
        size += u64::from(resource.size);
    }
    if !keys.contains(&String::new()) || size > MAX_BYTES {
        return Err(invalid());
    }
    Ok(size as u32)
}
