use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibraryResource {
    pub key: String,
    pub size: u32,
}

#[derive(Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelCameraState {
    pub position: [f64; 3],
    pub target: [f64; 3],
    pub near: f64,
    pub far: f64,
}

#[derive(Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelSavedView {
    pub id: String,
    pub name: String,
    pub camera: ModelCameraState,
}

#[derive(Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelPlaybackState {
    pub selected: i32,
    pub time: f64,
    pub phase: f64,
    pub playing: bool,
    pub speed: f64,
    pub loop_mode: String,
}

#[derive(Clone, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelViewState {
    pub version: u32,
    pub camera: ModelCameraState,
    pub views: Vec<ModelSavedView>,
    pub animation: ModelPlaybackState,
    pub position: [f64; 3],
    pub visible: bool,
    pub unit: String,
    pub wireframe: bool,
    pub normals: bool,
    pub shadows: bool,
    pub auto_rotate: bool,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibraryInput {
    pub name: String,
    pub resources: Vec<ModelLibraryResource>,
    pub view: ModelViewState,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibraryEdit {
    pub name: String,
    pub favorite: bool,
    pub group: String,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibraryEntry {
    pub id: String,
    pub name: String,
    pub source_name: String,
    pub size: u32,
    pub favorite: bool,
    pub group: String,
    pub updated_at: f64,
    pub has_thumbnail: bool,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibraryDocument {
    pub source_name: String,
    pub resources: Vec<ModelLibraryResource>,
    pub view: ModelViewState,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibraryCatalog {
    pub entries: Vec<ModelLibraryEntry>,
    pub library_bytes: f64,
    pub cache_bytes: f64,
    pub cache_limit: u32,
    pub last_id: Option<String>,
}
