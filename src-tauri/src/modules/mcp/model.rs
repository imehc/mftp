use super::access::ModuleGrant;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpCredentialInput {
    pub name: String,
    pub grants: BTreeMap<String, ModuleGrant>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpCredential {
    pub id: String,
    pub name: String,
    pub grants: BTreeMap<String, ModuleGrant>,
    pub created_at: f64,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpIssuedCredential {
    pub credential: McpCredential,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpSnapshot {
    pub running: bool,
    pub stopping: bool,
    pub port: u16,
    pub endpoint: Option<String>,
    pub credentials: Vec<McpCredential>,
}

#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum McpPermission {
    Read,
    Write,
    Delete,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub permission: McpPermission,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpModuleInfo {
    pub id: String,
    pub title: String,
    pub tools: Vec<McpToolInfo>,
}
