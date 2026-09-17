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
