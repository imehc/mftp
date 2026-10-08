use super::models::ModelImportSession;
use crate::error::{AppError, AppResult, CustomErrorCode as Code};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Arc, Mutex};

const MAX_FILE_SIZE: u64 = 512 * 1024 * 1024;
const MAX_CHUNK_SIZE: u32 = 1024 * 1024;

struct Resource {
    file: Mutex<File>,
    size: u32,
}

#[derive(Default)]
pub(crate) struct ModelViewerService {
    sessions: Mutex<HashMap<String, HashMap<String, Arc<Resource>>>>,
}

fn invalid() -> AppError {
    AppError::custom(Code::ModelSourceInvalid)
}

fn open_resource(path: &Path) -> AppResult<Resource> {
    // Open only a file explicitly supplied by the picker/drop adapter. Model
    // URIs never become filesystem paths, including symlinks in dependencies.
    if !std::fs::metadata(path)?.is_file() {
        return Err(invalid());
    }
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_SIZE {
        return Err(AppError::custom(Code::ModelResourceTooLarge));
    }
    Ok(Resource {
        file: Mutex::new(file),
        size: metadata.len() as u32,
    })
}

pub(super) fn validate_key(key: &str) -> AppResult<()> {
    if key.is_empty()
        || key.len() > 4096
        || key.contains(['\\', ':'])
        || key.chars().any(char::is_control)
        || key
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(AppError::custom(Code::ModelUnsafePath));
    }
    Ok(())
}

impl ModelViewerService {
    pub(crate) fn open(&self, path: &Path) -> AppResult<ModelImportSession> {
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(invalid)?
            .to_owned();
        let extension = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "glb" | "gltf" | "fbx") {
            return Err(invalid());
        }
        let resource = open_resource(path)?;
        let size = resource.size;
        let id = uuid::Uuid::new_v4().to_string();
        let mut sessions = self.sessions.lock().map_err(|_| invalid())?;
        // There is one pending import per page. Bound abandoned WebView sessions.
        if sessions.len() >= 8 {
            return Err(AppError::custom(Code::ModelSessionLimit));
        }
        sessions.insert(
            id.clone(),
            HashMap::from([(String::new(), Arc::new(resource))]),
        );
        Ok(ModelImportSession { id, name, size })
    }

    pub(crate) fn attach(&self, id: &str, key: String, path: &Path) -> AppResult<()> {
        validate_key(&key)?;
        let resource = Arc::new(open_resource(path)?);
        let mut sessions = self.sessions.lock().map_err(|_| invalid())?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| AppError::custom(Code::ModelSessionClosed))?;
        if session.len() >= 4096 {
            return Err(AppError::custom(Code::ModelResourceTooLarge));
        }
        session.insert(key, resource);
        Ok(())
    }

    fn resource(&self, id: &str, key: &str) -> AppResult<Arc<Resource>> {
        if !key.is_empty() {
            validate_key(key)?;
        }
        let sessions = self.sessions.lock().map_err(|_| invalid())?;
        let session = sessions
            .get(id)
            .ok_or_else(|| AppError::custom(Code::ModelSessionClosed))?;
        session
            .get(key)
            .cloned()
            .ok_or_else(|| AppError::custom(Code::ModelResourceMissing))
    }

    pub(crate) fn size(&self, id: &str, key: &str) -> AppResult<u32> {
        Ok(self.resource(id, key)?.size)
    }

    pub(crate) fn read(&self, id: &str, key: &str, offset: u32, length: u32) -> AppResult<Vec<u8>> {
        let resource = self.resource(id, key)?;
        if length == 0 || length > MAX_CHUNK_SIZE || offset > resource.size {
            return Err(invalid());
        }
        let count = length.min(resource.size - offset) as usize;
        let mut bytes = vec![0; count];
        let mut file = resource.file.lock().map_err(|_| invalid())?;
        file.seek(SeekFrom::Start(u64::from(offset)))?;
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }

    pub(crate) fn close(&self, id: &str) -> AppResult<()> {
        // A running read retains its file handle until the real worker exits.
        self.sessions.lock().map_err(|_| invalid())?.remove(id);
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
