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
fn body_fingerprint_preserves_content_and_paragraph_boundaries() {
    let source = vec!["春眠不觉晓".to_string(), "处处闻啼鸟".to_string()];
    assert_eq!(body_fingerprint(&source), body_fingerprint(&source));
    assert_ne!(
        body_fingerprint(&source),
        body_fingerprint(&["春眠不觉晓处处闻啼鸟".to_string()])
    );
    assert_ne!(
        body_fingerprint(&source),
        body_fingerprint(&["春眠不觉晓".to_string(), "处处闻啼鸟。".to_string()])
    );
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
