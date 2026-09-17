use std::sync::Mutex;

use super::*;

#[test]
fn glob_matches_catalog_patterns() {
    assert!(glob_match("宋词/ci.song.*.json", "宋词/ci.song.0.json"));
    assert!(glob_match(
        "五代诗词/huajianji/huajianji-*-juan.json",
        "五代诗词/huajianji/huajianji-1-juan.json"
    ));
    assert!(!glob_match(
        "五代诗词/huajianji/huajianji-*-juan.json",
        "五代诗词/huajianji/huajianji-0-preface.json"
    ));
    assert!(glob_match(
        "poetry/poet.tang.*.json",
        "poetry/poet.tang.123.json"
    ));
    assert!(!glob_match(
        "poetry/poet.tang.*.json",
        "poetry/authors.tang.json"
    ));
    assert!(!glob_match("诗经/shijing.json", "楚辞/chuci.json"));
}

fn temp_root(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("mftp-poetry-sync-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp root");
    dir
}

/// End-to-end: local directory import → FTS/browse/detail queries.
#[test]
fn local_import_pipeline_is_searchable() {
    let root = temp_root("pipeline");
    let repo = root.join("repo");
    fs::create_dir_all(repo.join("诗经")).unwrap();
    fs::create_dir_all(repo.join("蒙学")).unwrap();
    fs::write(
        repo.join("诗经/shijing.json"),
        r#"[
                {"title":"關雎","chapter":"國風","section":"周南",
                 "content":["关关雎鸠，在河之洲。","窈窕淑女，君子好逑。"]},
                {"title":"碩鼠","chapter":"國風","section":"魏風",
                 "content":["硕鼠硕鼠，无食我黍。"]}
            ]"#,
    )
    .unwrap();
    fs::write(
        repo.join("蒙学/tangshisanbaishou.json"),
        r#"{"title":"唐詩三百首","content":[
                {"type":"五言絕句","content":[
                    {"chapter":"行宮","subchapter":null,"author":"元稹",
                     "paragraphs":["寥落古行宮，宮花寂寞紅。","白頭宮女在，閒坐說玄宗。"]}
                ]}
            ]}"#,
    )
    .unwrap();

    let library = Arc::new(PoetryLibrary::new(root.clone()));
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = events.clone();
    let progress = move |event: PoetrySyncProgress| {
        sink.lock()
            .unwrap()
            .push(format!("{}:{}", event.collection_id, event.phase));
    };
    let ids = vec!["shijing".to_string(), "tangshi300".to_string()];
    run_local_import(&library, &progress, &repo, &ids, &AtomicBool::new(false))
        .expect("import succeeds");

    let db = library.db();
    // Browse across both installed collections.
    let page = db
        .browse(&crate::poetry::model::PoetryBrowseRequest {
            collection_ids: None,
            author: None,
            cursor: None,
            limit: 50,
        })
        .expect("browse");
    assert_eq!(page.items.len(), 3);

    // Traditional query folds onto simplified-indexed titles.
    let result = db
        .search(&crate::poetry::model::PoetrySearchRequest {
            query: "关雎".into(),
            scope: crate::poetry::model::PoetrySearchScope::Title,
            collection_ids: None,
            limit: 10,
            offset: 0,
        })
        .expect("title search");
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].title, "關雎");

    // Nested collection imported with its chapter label.
    let detail = db
        .poem_detail(&{
            let conn = db.open().unwrap();
            conn.query_row("SELECT uid FROM poems WHERE title='行宮'", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap()
        })
        .expect("detail");
    assert_eq!(detail.chapter, "五言絕句");
    assert_eq!(detail.body.len(), 2);

    // Daily pick works on a non-empty library.
    assert!(db.discover_daily().unwrap().is_some());

    // Re-import is idempotent thanks to uid upserts.
    run_local_import(&library, &progress, &repo, &ids, &AtomicBool::new(false)).expect("re-import");
    let conn = db.open().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM poems", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 3);

    let _ = fs::remove_dir_all(&root);
}
