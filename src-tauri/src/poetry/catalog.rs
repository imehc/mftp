//! Collection catalog: a declarative description of every poetry collection.
//!
//! Categories are data, not code — adding a new collection means appending an
//! entry to `catalog.json` (paths + field mapping). Only a fundamentally new
//! source layout requires implementing another `CollectionAdapter`.

use serde::Deserialize;
use std::collections::HashMap;

use super::model::{PoetryScript, PoetryTier};

const CATALOG_JSON: &str = include_str!("catalog.json");

#[derive(Debug, Clone, Deserialize)]
pub struct SourceSpec {
    pub repo: String,
    pub branch: String,
}

/// Field-mapping for one collection; consumed by the generic adapters.
/// Key lists act as fallback chains (first present key wins).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParserSpec {
    pub kind: String,
    /// Nested kind: key of the group array on the root object.
    #[serde(default)]
    pub item_list_key: Option<String>,
    /// Nested kind: key of the poem array inside each group.
    #[serde(default)]
    pub group_list_key: Option<String>,
    /// Nested kind: key holding the group label (stored as chapter).
    #[serde(default)]
    pub group_label_key: Option<String>,
    #[serde(default)]
    pub title_keys: Vec<String>,
    #[serde(default)]
    pub author_keys: Vec<String>,
    #[serde(default)]
    pub body_keys: Vec<String>,
    #[serde(default)]
    pub notes_keys: Vec<String>,
    #[serde(default)]
    pub rhythmic_keys: Vec<String>,
    #[serde(default)]
    pub strains_keys: Vec<String>,
    /// Values of these keys joined with `·` form the chapter column.
    #[serde(default)]
    pub chapter_join_keys: Vec<String>,
    #[serde(default)]
    pub default_author: Option<String>,
    /// Derive the title from body text when no title key matches.
    #[serde(default)]
    pub title_from_content: bool,
    /// Template like `{rhythmic}·{firstLine}` used when no title key matches.
    #[serde(default)]
    pub compose_title: Option<String>,
    #[serde(default = "default_first_line_chars")]
    pub first_line_chars: usize,
}

fn default_first_line_chars() -> usize {
    16
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSpec {
    pub id: String,
    pub name: String,
    pub dynasty: String,
    pub script: PoetryScript,
    pub tier: PoetryTier,
    /// Which tarball channel this collection ships in.
    pub source: String,
    /// Glob patterns relative to the extracted repository root (`*` wildcard).
    pub paths: Vec<String>,
    /// Optional author-bio file parsed into the authors table.
    #[serde(default)]
    pub authors_path: Option<String>,
    pub parser: ParserSpec,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Catalog {
    /// Reserved for future catalog migrations.
    #[allow(dead_code)]
    pub version: u32,
    pub sources: HashMap<String, SourceSpec>,
    pub collections: Vec<CollectionSpec>,
}

impl Catalog {
    pub fn load() -> self::AppResult<Catalog> {
        let catalog: Catalog =
            serde_json::from_str(CATALOG_JSON).map_err(|e| format!("invalid catalog: {e}"))?;
        let mut ids = std::collections::HashSet::new();
        for spec in &catalog.collections {
            if !ids.insert(spec.id.as_str()) {
                return Err(format!("duplicate collection id: {}", spec.id));
            }
            if !catalog.sources.contains_key(&spec.source) {
                return Err(format!(
                    "collection {} references unknown source {}",
                    spec.id, spec.source
                ));
            }
            if spec.paths.is_empty() {
                return Err(format!("collection {} has no paths", spec.id));
            }
        }
        Ok(catalog)
    }

    pub fn collection(&self, id: &str) -> Option<&CollectionSpec> {
        self.collections.iter().find(|c| c.id == id)
    }

    /// Sources needed to sync the given collections.
    pub fn sources_for<'a>(&'a self, ids: &[String]) -> Vec<&'a str> {
        let mut sources: Vec<&str> = self
            .collections
            .iter()
            .filter(|c| ids.iter().any(|id| id == &c.id))
            .map(|c| c.source.as_str())
            .collect();
        sources.sort_unstable();
        sources.dedup();
        sources
    }
}

pub type AppResult<T> = Result<T, String>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_valid() {
        let catalog = Catalog::load().expect("catalog parses");
        assert!(!catalog.collections.is_empty());
        // Every source id referenced must exist; enforced by load().
        assert!(catalog.collection("quantangshi").is_some());
    }

    #[test]
    fn sources_for_picks_minimal_set() {
        let catalog = Catalog::load().unwrap();
        let ids: Vec<String> = ["shijing", "quantangshi", "quansongshi"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(catalog.sources_for(&ids), vec!["upstream", "zhcn"]);
    }
}
