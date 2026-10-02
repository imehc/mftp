//! Text normalization for search: traditional→simplified folding, uid
//! hashing, and FTS token generation.
//!
//! The mapping table is OpenCC's TSCharacters (Apache-2.0), embedded as a
//! plain-text asset — no conversion crate, per D4.

use std::collections::HashMap;
use std::sync::OnceLock;

use sha2::{Digest, Sha256};

const TS_CHARACTERS: &str = include_str!("data/ts_characters.txt");

fn forward_table() -> &'static HashMap<char, char> {
    static TABLE: OnceLock<HashMap<char, char>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut map = HashMap::with_capacity(4200);
        for line in TS_CHARACTERS.lines() {
            if line.starts_with('#') {
                continue;
            }
            let mut fields = line.split('\t');
            let (Some(key), Some(values)) = (fields.next(), fields.next()) else {
                continue;
            };
            // One traditional char may map to several candidates; the first
            // one is OpenCC's primary simplified form.
            if key.chars().count() == 1 {
                if let Some(first) = values.split_whitespace().next() {
                    if let (Some(k), Some(v)) = (key.chars().next(), first.chars().next()) {
                        map.insert(k, v);
                    }
                }
            }
        }
        map
    })
}

fn reverse_table() -> &'static HashMap<char, Vec<char>> {
    static TABLE: OnceLock<HashMap<char, Vec<char>>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut map: HashMap<char, Vec<char>> = HashMap::new();
        for (trad, simp) in forward_table() {
            map.entry(*simp).or_default().push(*trad);
        }
        map
    })
}

/// Fold traditional characters to their primary simplified counterpart.
pub fn to_simplified(input: &str) -> String {
    let table = forward_table();
    input
        .chars()
        .map(|c| table.get(&c).copied().unwrap_or(c))
        .collect()
}

/// Normalized form used for matching/uids: simplified + whitespace stripped.
pub fn normalize(input: &str) -> String {
    to_simplified(&input.replace(['\u{3000}', ' ', '\t', '\n', '\r'], ""))
}

/// True when the char participates in tokens (CJK, letters, digits).
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

/// Space-separated unigram stream for title/author FTS columns.
pub fn char_tokens(input: &str) -> String {
    normalize(input)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Overlapping-bigram token stream for body FTS. A lone character indexes as
/// itself so single-char bodies stay searchable.
pub fn bigram_tokens(input: &str) -> String {
    let text: Vec<char> = normalize(input)
        .chars()
        .filter(|c| is_word_char(*c))
        .collect();
    let mut out = String::with_capacity(text.len() * 6);
    if text.len() == 1 {
        return text[0].to_string();
    }
    for pair in text.windows(2) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push(pair[0]);
        out.push(pair[1]);
    }
    out
}

/// Build an FTS5 phrase query (`"a b c"`) from a normalized query string.
/// Returns None when nothing usable remains after filtering.
pub fn phrase_query(tokens: &str) -> Option<String> {
    let terms: Vec<&str> = tokens.split_whitespace().collect();
    if terms.is_empty() {
        return None;
    }
    Some(format!("\"{}\"", terms.join(" ")))
}

/// Content-hash uid, stable across library rebuilds (D5): sha256 over
/// collection id and normalized title/author/body, hex-truncated to 32 chars.
/// Inputs are normalized here so callers cannot drift.
pub fn poem_uid(collection_id: &str, title: &str, author: &str, body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(collection_id.as_bytes());
    hasher.update([0u8]);
    hasher.update(normalize(title).as_bytes());
    hasher.update([0u8]);
    hasher.update(normalize(author).as_bytes());
    hasher.update([0u8]);
    hasher.update(normalize(body).as_bytes());
    let digest = hasher.finalize();
    hex(&digest[..16])
}

/// Exact source-body fingerprint for user-owned derived data. Length prefixes
/// keep paragraph boundaries unambiguous without depending on JSON encoding.
pub fn body_fingerprint(body: &[String]) -> String {
    let mut hasher = Sha256::new();
    for paragraph in body {
        hasher.update((paragraph.len() as u64).to_be_bytes());
        hasher.update(paragraph.as_bytes());
    }
    hex(&hasher.finalize())
}

/// Match key shared with the annotation pack: hash of normalized
/// (title, author) only — the external data cannot know our collection ids.
pub fn annotation_key(title: &str, author: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gsw");
    hasher.update([0u8]);
    hasher.update(normalize(title).as_bytes());
    hasher.update([0u8]);
    hasher.update(normalize(author).as_bytes());
    let digest = hasher.finalize();
    hex(&digest[..16])
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Expand a query into script variants for LIKE fallback (D6): each char may
/// be replaced by any traditional char that folds onto it. Combinations are
/// capped to keep the OR list bounded.
pub fn expand_query_variants(query: &str) -> Vec<String> {
    const MAX_VARIANTS: usize = 8;
    let normalized = normalize(query);
    if normalized.is_empty() {
        return Vec::new();
    }
    let reverse = reverse_table();
    let mut variants = vec![String::new()];
    for ch in normalized.chars() {
        let mut next = Vec::with_capacity(variants.len());
        let options: Vec<char> = {
            let mut opts = vec![ch];
            if let Some(trads) = reverse.get(&ch) {
                opts.extend(trads.iter().copied());
            }
            opts
        };
        for prefix in &variants {
            for option in &options {
                let candidate = format!("{prefix}{option}");
                if !next.contains(&candidate) {
                    next.push(candidate);
                }
            }
        }
        variants = next;
        if variants.len() > MAX_VARIANTS {
            variants.truncate(MAX_VARIANTS);
        }
    }
    variants.retain(|v| !v.is_empty());
    variants
}

#[cfg(test)]
#[path = "text_tests.rs"]
mod tests;
