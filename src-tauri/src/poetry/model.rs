//! IPC-facing types for the poetry library. Generated into `bindings.ts`
//! by specta; do not hand-write counterparts on the frontend.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Install tier from the catalog config; drives default checkboxes in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PoetryTier {
    /// Tiny collections pre-checked on first run (<2MB combined).
    Recommended,
    /// Checked by default in the sync dialog.
    Default,
    /// Large collections that are never checked automatically.
    OptIn,
}

/// Character script of a collection's source text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PoetryScript {
    Simplified,
    Traditional,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetryCollectionStatus {
    pub id: String,
    pub name: String,
    pub dynasty: String,
    pub script: PoetryScript,
    pub tier: PoetryTier,
    pub installed: bool,
    pub poem_count: i64,
    /// Approximate stored size (body + metadata) in bytes; 0 when absent.
    pub bytes_used: i64,
    /// Upstream commit sha this collection was imported from.
    pub source_sha: String,
}

/// One downloadable upstream repository (tarball channel).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetrySourceStatus {
    pub id: String,
    pub upstream_sha: Option<String>,
    /// Sha recorded locally at last import; None when never synced.
    pub local_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetrySyncPlan {
    pub sources: Vec<PoetrySourceStatus>,
    /// Collections whose source sha differs from upstream (or missing).
    pub outdated: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoemSummary {
    pub uid: String,
    pub collection_id: String,
    pub collection_name: String,
    pub title: String,
    pub author: String,
    pub dynasty: String,
    /// First paragraph, truncated for cards.
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthorBio {
    pub name: String,
    pub dynasty: String,
    pub desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoemAnnotation {
    pub remark: String,
    pub translation: String,
    pub appreciation: String,
    /// External recitation link; surfaced as a badge only, never proxied.
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoemDetail {
    pub uid: String,
    pub collection_id: String,
    pub collection_name: String,
    pub title: String,
    pub author: String,
    pub dynasty: String,
    pub rhythmic: String,
    pub chapter: String,
    /// Paragraphs preserve the source line rhythm; render one per line.
    pub body: Vec<String>,
    /// Upstream notes/comment/prologue fields (fallback annotations).
    pub notes: Vec<String>,
    /// Ping-ze (tonal pattern) lines when the source provides them.
    pub strains: Vec<String>,
    pub author_bio: Option<AuthorBio>,
    /// Matched entry from the external annotation pack, if installed.
    pub annotation: Option<PoemAnnotation>,
}

/// Cursor is an opaque keyset token (last rowid); pass back for the next page.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoemPage {
    pub items: Vec<PoemSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetryBrowseRequest {
    #[serde(default)]
    pub collection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default = "default_page_size")]
    pub limit: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PoetrySearchScope {
    All,
    Title,
    Author,
    Body,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetrySearchRequest {
    pub query: String,
    pub scope: PoetrySearchScope,
    #[serde(default)]
    pub collection_ids: Option<Vec<String>>,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetrySearchResult {
    pub items: Vec<PoemSummary>,
    /// True when more hits exist beyond this page.
    pub has_more: bool,
    /// Whether the bigram body index was used for body scope.
    pub body_indexed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthorSummary {
    pub name: String,
    pub dynasty: String,
    #[serde(default)]
    pub desc: String,
    pub poem_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetryAuthorsRequest {
    #[serde(default)]
    pub collection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default = "default_page_size")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetryContentIndexStatus {
    pub enabled: bool,
    /// Rows currently present in the bigram body index.
    pub indexed_poems: i64,
}

fn default_page_size() -> u32 {
    50
}

/// Progress payload for `library://sync-progress`.
///
/// Phases: `downloading` | `extracting` | `importing` | `indexing`.
/// `collection_id` is `"annotations"` while installing the annotation pack.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetrySyncProgress {
    pub collection_id: String,
    /// `downloading` | `extracting` | `importing` | `indexing` |
    /// `done` | `error`
    pub phase: String,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub imported: u32,
    pub total: Option<u32>,
    /// Populated only on the terminal `error` phase.
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PoetryAnnotationsStatus {
    pub installed: bool,
    pub entry_count: i64,
}
