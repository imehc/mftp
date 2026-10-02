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
