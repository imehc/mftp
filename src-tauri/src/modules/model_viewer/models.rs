use serde::Serialize;
use specta::Type;

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelImportSession {
    pub id: String,
    pub name: String,
    pub size: u32,
}
