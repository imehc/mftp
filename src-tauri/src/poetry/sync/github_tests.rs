use super::*;

fn blob(path: &str, size: u64) -> TreeEntry {
    TreeEntry {
        path: path.into(),
        kind: "blob".into(),
        sha: "0".repeat(40),
        size,
    }
}

fn tree_dir(path: &str) -> TreeEntry {
    TreeEntry {
        path: path.into(),
        kind: "tree".into(),
        sha: "0".repeat(40),
        size: 0,
    }
}

#[test]
fn needed_blobs_takes_only_the_requested_collections_files() {
    let catalog = Catalog::load().unwrap();
    let tree = vec![
        // Same repository, but not part of any requested collection.
        blob("json/唐诗.json", 999),
        tree_dir("纳兰性德"),
        blob("纳兰性德/纳兰性德诗集.json", 79_626),
        blob("五代诗词/nantang/poetrys.json", 71_500),
    ];

    let ids = vec!["nantang".to_string()];
    let needed = needed_blobs(&tree, &catalog, &ids);

    assert_eq!(needed.len(), 1);
    assert_eq!(needed[0].path, "五代诗词/nantang/poetrys.json");
}

#[test]
fn needed_blobs_expands_globs_and_drops_directories() {
    let catalog = Catalog::load().unwrap();
    let tree = vec![
        tree_dir("五代诗词/huajianji"),
        blob("五代诗词/huajianji/huajianji-1-juan.json", 10),
        blob("五代诗词/huajianji/huajianji-2-juan.json", 20),
        blob("五代诗词/huajianji/huajianji-0-preface.json", 30),
    ];

    let ids = vec!["huajianji".to_string()];
    let needed = needed_blobs(&tree, &catalog, &ids);

    assert_eq!(
        needed.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
        vec![
            "五代诗词/huajianji/huajianji-1-juan.json",
            "五代诗词/huajianji/huajianji-2-juan.json",
        ]
    );
    // Total drives the progress bar, so it must count only real matches.
    assert_eq!(needed.iter().map(|e| e.size).sum::<u64>(), 30);
}

#[test]
fn needed_blobs_unions_multiple_collections() {
    let catalog = Catalog::load().unwrap();
    let tree = vec![
        blob("诗经/shijing.json", 1),
        blob("五代诗词/nantang/poetrys.json", 2),
        blob("元曲/yuanqu.json", 3),
    ];

    let ids = vec!["shijing".to_string(), "nantang".to_string()];
    let needed = needed_blobs(&tree, &catalog, &ids);

    assert_eq!(needed.len(), 2);
    assert_eq!(needed[0].path, "五代诗词/nantang/poetrys.json");
    assert_eq!(needed[1].path, "诗经/shijing.json");
}

#[test]
fn write_blob_stays_inside_the_scratch_dir() {
    let root = std::env::temp_dir().join(format!("mftp-blob-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    let nested = root.join("五代诗词/nantang");
    fs::create_dir_all(&nested).unwrap();
    write_blob(&root, &blob("五代诗词/nantang/poetrys.json", 3), b"[1]").unwrap();
    assert!(nested.join("poetrys.json").is_file());

    // A listing is untrusted input: traversal and absolute paths must fail
    // rather than write outside the scratch directory.
    assert!(write_blob(&root, &blob("../../escaped.json", 1), b"x").is_err());
    assert!(write_blob(&root, &blob("/tmp/escaped.json", 1), b"x").is_err());

    let _ = fs::remove_dir_all(&root);
}

/// Opt-in network probe for the blob path:
/// MFTP_NET_PROBE=1 cargo test blob_fetch -- --nocapture
#[test]
fn blob_fetch_pulls_only_the_requested_files() {
    if std::env::var("MFTP_NET_PROBE").is_err() {
        return;
    }
    let catalog = Catalog::load().unwrap();
    let spec = catalog.sources.get("upstream").expect("upstream source");
    let ids = vec!["nantang".to_string(), "nalanxingde".to_string()];

    let root = std::env::temp_dir().join(format!("mftp-blob-probe-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();

    let cancelled = AtomicBool::new(false);
    // `ProgressFn` is a plain `Fn`, so the last reported total is recorded
    // through an atomic rather than a captured `&mut`.
    let last_total = std::sync::atomic::AtomicU64::new(0);
    let progress = |p: PoetrySyncProgress| {
        if let Some(total) = p.bytes_total {
            last_total.store(total, Ordering::SeqCst);
        }
    };
    let fetched = fetch_needed_blobs(&progress, spec, &catalog, &ids, &root, &cancelled).unwrap();
    assert!(fetched, "budget should cover two blobs");

    let nantang = root.join("五代诗词/nantang/poetrys.json");
    let nalan = root.join("纳兰性德/纳兰性德诗集.json");
    assert_eq!(fs::metadata(&nantang).unwrap().len(), 71_500);
    assert_eq!(fs::metadata(&nalan).unwrap().len(), 79_626);
    // Nothing else may land in the scratch dir.
    assert_eq!(count_files(&root), 2);
    assert_eq!(last_total.load(Ordering::SeqCst), 71_500 + 79_626);

    let _ = fs::remove_dir_all(&root);
}

fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .map(|path| if path.is_dir() { count_files(&path) } else { 1 })
        .sum()
}
