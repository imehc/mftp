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
    let text: Vec<char> = normalize(input).chars().filter(|c| is_word_char(*c)).collect();
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
pub fn poem_uid(
    collection_id: &str,
    title: &str,
    author: &str,
    body: &str,
) -> String {
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
mod tests {
    use super::*;

    #[test]
    fn folds_traditional_to_simplified() {
        assert_eq!(to_simplified("愛"), "爱");
        assert_eq!(to_simplified("詩詞"), "诗词");
        assert_eq!(to_simplified("明月光"), "明月光");
        // The character "干" is already simplified; it must pass through untouched.
        assert_eq!(to_simplified("干"), "干");
    }

    #[test]
    fn normalizes_and_strips_space() {
        assert_eq!(normalize("春 眠 不覺曉"), "春眠不觉晓");
    }

    #[test]
    fn builds_unigram_tokens() {
        assert_eq!(char_tokens("静夜思 李白"), "静 夜 思 李 白");
    }

    #[test]
    fn builds_overlapping_bigrams() {
        assert_eq!(bigram_tokens("明月光"), "明月 月光");
        assert_eq!(bigram_tokens("月"), "月");
    }

    #[test]
    fn uid_is_stable_and_sensitive() {
        let a = poem_uid("shijing", "关雎", "", "关关雎鸠");
        let b = poem_uid("shijing", "關雎", "", "關關雎鳩");
        // Script differences collapse under normalization.
        assert_eq!(a, b);
        assert_ne!(a, poem_uid("shijing", "关雎", "", "参差荇菜"));
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn expands_script_variants() {
        let variants = expand_query_variants("爱");
        assert!(variants.contains(&"爱".to_string()));
        assert!(variants.contains(&"愛".to_string()));
        // Simplified-only words expand to just themselves.
        assert_eq!(expand_query_variants("明月"), vec!["明月".to_string()]);
    }

    #[test]
    fn phrase_query_quotes_terms() {
        assert_eq!(
            phrase_query(&char_tokens("登鹳雀楼")),
            Some("\"登 鹳 雀 楼\"".to_string())
        );
        assert!(phrase_query("   ").is_none());
    }
}
