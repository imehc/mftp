//! Collection parsing abstraction.
//!
//! Every collection in `catalog.json` is parsed by one of a few generic,
//! config-driven adapters (`flat`, `nested`, plus the author-bio parser).
//! Adding a collection never touches this file; only a source layout the
//! generic adapters cannot express needs a new `CollectionAdapter`
//! implementation registered in [`adapter_for`].

use serde_json::Value;

use super::catalog::CollectionSpec;
use super::text;

pub struct ParsedPoem {
    pub title: String,
    pub author: String,
    pub rhythmic: String,
    pub chapter: String,
    pub paragraphs: Vec<String>,
    pub notes: Vec<String>,
    pub strains: Vec<String>,
}

/// One poem-source adapter. Implementations receive the catalog spec and the
/// raw JSON document of a matched file and return flat poems.
pub trait CollectionAdapter: Send + Sync {
    fn parse(&self, spec: &CollectionSpec, data: &Value) -> Result<Vec<ParsedPoem>, String>;
}

/// Resolve the first present string value among candidate keys.
fn first_string<'a>(obj: &'a Value, keys: &[String]) -> Option<&'a str> {
    for key in keys {
        if let Some(value) = obj.get(key).and_then(Value::as_str) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// Accept either a bare string or an array of strings (body/notes shapes).
fn collect_strings(obj: &Value, keys: &[String], into: &mut Vec<String>) {
    for key in keys {
        match obj.get(key) {
            Some(Value::String(text)) => {
                if !text.trim().is_empty() {
                    into.push(text.clone());
                }
            }
            Some(Value::Array(items)) => {
                for item in items {
                    if let Some(text) = item.as_str() {
                        if !text.trim().is_empty() {
                            into.push(text.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn excerpt(paragraphs: &[String], max_chars: usize) -> String {
    let joined = paragraphs.join("\n");
    let mut out: String = joined.chars().take(max_chars).collect();
    if joined.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// Shared view over a ParserSpec so both adapters reuse field resolution.
struct ParserSpecShared<'a> {
    spec: &'a crate::poetry::catalog::ParserSpec,
}

impl<'a> ParserSpecShared<'a> {
    fn resolve_title(
        &self,
        obj: &Value,
        paragraphs: &[String],
        rhythmic: &str,
        fallback_index: usize,
    ) -> String {
        if let Some(title) = first_string(obj, &self.spec.title_keys) {
            return title.to_string();
        }
        if let Some(template) = &self.spec.compose_title {
            let first_line = paragraphs.first().map(String::as_str).unwrap_or("");
            let first_line = first_line.chars().take(self.spec.first_line_chars).collect::<String>();
            let composed = template
                .replace("{rhythmic}", rhythmic)
                .replace("{firstLine}", &first_line);
            if !composed.trim().is_empty() && composed != "·" {
                return composed;
            }
        }
        if self.spec.title_from_content && !paragraphs.is_empty() {
            return excerpt(paragraphs, 12);
        }
        // Last resort: keep every entry addressable even without a title.
        format!("第{}篇", fallback_index + 1)
    }
}

/// Flat adapter: the document is an array of poem objects.
struct FlatAdapter;

impl CollectionAdapter for FlatAdapter {
    fn parse(&self, spec: &CollectionSpec, data: &Value) -> Result<Vec<ParsedPoem>, String> {
        let items = data.as_array().ok_or_else(|| {
            format!(
                "collection {} expects a top-level JSON array",
                spec.id
            )
        })?;
        let shared = ParserSpecShared { spec: &spec.parser };
        let mut poems = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            if let Some(parsed) = parse_poem_object(item, &shared, index) {
                poems.push(parsed);
            }
        }
        Ok(poems)
    }
}

/// Nested adapter: root object holds an array of groups, each holding an
/// array of poem objects (e.g. Three Hundred Tang Poems: type → poems).
struct NestedAdapter;

impl CollectionAdapter for NestedAdapter {
    fn parse(&self, spec: &CollectionSpec, data: &Value) -> Result<Vec<ParsedPoem>, String> {
        let parser = &spec.parser;
        let list_key = parser.item_list_key.as_deref().ok_or_else(|| {
            format!("nested parser for {} requires itemListKey", spec.id)
        })?;
        let group_key = parser.group_list_key.as_deref().ok_or_else(|| {
            format!("nested parser for {} requires groupListKey", spec.id)
        })?;
        let groups = data
            .get(list_key)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("collection {}: missing group array {list_key}", spec.id))?;
        let shared = ParserSpecShared { spec: parser };
        let mut poems = Vec::new();
        for group in groups {
            let label = parser
                .group_label_key
                .as_deref()
                .and_then(|key| group.get(key))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let items = group
                .get(group_key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for (index, item) in items.iter().enumerate() {
                let mut parsed = match parse_poem_object(item, &shared, index) {
                    Some(parsed) => parsed,
                    None => continue,
                };
                if !label.is_empty() && parsed.chapter.is_empty() {
                    parsed.chapter = label.clone();
                }
                poems.push(parsed);
            }
        }
        Ok(poems)
    }
}

fn parse_poem_object(
    value: &Value,
    shared: &ParserSpecShared<'_>,
    index: usize,
) -> Option<ParsedPoem> {
    let obj = value.as_object()?;
    let parser = shared.spec;
    let mut paragraphs = Vec::new();
    collect_strings(value, &parser.body_keys, &mut paragraphs);
    if paragraphs.is_empty() {
        // Not a usable entry; count it as skipped rather than failing the file.
        return None;
    }
    let rhythmic = first_string(value, &parser.rhythmic_keys)
        .unwrap_or_default()
        .to_string();
    let title = shared.resolve_title(value, &paragraphs, &rhythmic, index);
    let author = first_string(value, &parser.author_keys)
        .map(str::to_string)
        .or_else(|| parser.default_author.clone())
        .unwrap_or_default();
    let mut notes = Vec::new();
    collect_strings(value, &parser.notes_keys, &mut notes);
    let mut strains = Vec::new();
    collect_strings(value, &parser.strains_keys, &mut strains);
    let chapter = parser
        .chapter_join_keys
        .iter()
        .filter_map(|key| obj.get(key).and_then(Value::as_str))
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("·");
    Some(ParsedPoem {
        title,
        author,
        rhythmic,
        chapter,
        paragraphs,
        notes,
        strains,
    })
}

/// Registry of adapter kinds. A new source layout plugs in here.
pub fn adapter_for(kind: &str) -> Result<&'static dyn CollectionAdapter, String> {
    match kind {
        "flat" => Ok(&FlatAdapter),
        "nested" => Ok(&NestedAdapter),
        other => Err(format!("unknown parser kind: {other}")),
    }
}

/// Author-bio documents share one shape across sources; parse tolerantly.
#[allow(clippy::type_complexity)]
pub fn parse_author_bios(data: &Value) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let Some(items) = data.as_array() else {
        return out;
    };
    for item in items {
        let Some(name) = item.get("name").and_then(Value::as_str) else {
            continue;
        };
        let dynasty = item
            .get("dynasty")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let desc = item
            .get("desc")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        out.push((name.to_string(), dynasty, desc));
    }
    out
}

/// Convenience: normalize helpers re-exported for the import pipeline.
pub fn normalized_parts(poem: &ParsedPoem) -> (String, String, String) {
    (
        text::normalize(&poem.title),
        text::normalize(&poem.author),
        text::normalize(&poem.paragraphs.join("\n")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::poetry::catalog::Catalog;
    use serde_json::json;
    fn spec(id: &str) -> CollectionSpec {
        Catalog::load()
            .expect("catalog")
            .collections
            .into_iter()
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("missing spec {id}"))
    }

    #[test]
    fn flat_adapter_parses_shijing() {
        let spec = spec("shijing");
        let data = json!([
            {"title": "關雎", "chapter": "國風", "section": "周南",
             "content": ["关关雎鸠，在河之洲。", "窈窕淑女，君子好逑。"]}
        ]);
        let poems = adapter_for("flat").unwrap().parse(&spec, &data).unwrap();
        assert_eq!(poems.len(), 1);
        assert_eq!(poems[0].title, "關雎");
        // Chapter keeps source fidelity; only matching/uids normalize.
        assert_eq!(poems[0].chapter, "國風·周南");
        assert_eq!(poems[0].paragraphs.len(), 2);
    }

    #[test]
    fn songci_composes_title_from_rhythmic() {
        let spec = spec("songci");
        let data = json!([
            {"author": "苏轼", "rhythmic": "水调歌头", "paragraphs": ["明月几时有", "把酒问青天"]}
        ]);
        let poems = adapter_for("flat").unwrap().parse(&spec, &data).unwrap();
        assert_eq!(poems[0].title, "水调歌头·明月几时有");
    }

    #[test]
    fn youmengying_derives_title_and_notes() {
        let spec = spec("youmengying");
        let data = json!([
            {"content": "读经宜冬，其神专也；读史宜夏。", "comment": ["曹秋岳曰：可想见。"]}
        ]);
        let poems = adapter_for("flat").unwrap().parse(&spec, &data).unwrap();
        assert_eq!(poems[0].title, "读经宜冬，其神专也；读史…");
        assert_eq!(poems[0].notes.len(), 1);
        assert_eq!(poems[0].author, "张潮");
    }

    #[test]
    fn nested_adapter_walks_tangshi300() {
        let spec = spec("tangshi300");
        let data = json!({
            "title": "唐詩三百首",
            "content": [
                {"type": "五言絕句", "content": [
                    {"chapter": "行宮", "subchapter": null, "author": "元稹",
                     "paragraphs": ["寥落古行宮，宮花寂寞紅。"]}
                ]}
            ]
        });
        let poems = adapter_for("nested").unwrap().parse(&spec, &data).unwrap();
        assert_eq!(poems.len(), 1);
        assert_eq!(poems[0].title, "行宮");
        assert_eq!(poems[0].chapter, "五言絕句");
    }

    #[test]
    fn tangshi_with_strains_keeps_them() {
        let spec = spec("quantangshi");
        let data = json!([
            {"title": "帝京篇十首 一", "author": "太宗皇帝",
             "paragraphs": ["秦川雄帝宅"], "strains": ["平平平仄仄"]}
        ]);
        let poems = adapter_for("flat").unwrap().parse(&spec, &data).unwrap();
        assert_eq!(poems[0].strains, vec!["平平平仄仄".to_string()]);
    }

    #[test]
    fn author_bios_parse_tolerantly() {
        let data = json!([
            {"name": "李白", "desc": "字太白"},
            {"name": "杜甫", "dynasty": "唐", "desc": "字子美"},
            {"nope": true}
        ]);
        let bios = parse_author_bios(&data);
        assert_eq!(bios.len(), 2);
        assert_eq!(bios[0].0, "李白");
        assert_eq!(bios[1].2, "字子美");
    }

    #[test]
    fn entries_without_body_are_skipped_not_fatal() {
        let spec = spec("yuanqu");
        let data = json!([
            {"dynasty": "yuan"},
            {"title": "有正文", "paragraphs": ["词"]}
        ]);
        let poems = adapter_for("flat").unwrap().parse(&spec, &data).unwrap();
        assert_eq!(poems.len(), 1);
        assert_eq!(poems[0].title, "有正文");
    }
}
