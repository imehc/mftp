//! Glob expansion for the rule catalog.
//!
//! Split out of `rules.rs` to keep both files under the 600-line cap
//! (AGENTS.md). `rules.rs` stays pure data; the filesystem walking, its
//! pruning heuristics, and their tests live here.

use std::path::{Path, PathBuf};

/// Expand a glob into the concrete directories that exist right now.
///
/// Only `**` (any depth) and `*` (one segment) are supported — enough for
/// the catalog and small enough to audit. A glob that matches nothing
/// yields an empty vec rather than an error, since most machines will not
/// have most of these tools installed.
pub fn expand(glob: &str, home: &Path) -> Vec<PathBuf> {
    let (base, pattern) = if let Some(stripped) = glob.strip_prefix('/') {
        (PathBuf::from("/"), stripped.to_string())
    } else {
        (home.to_path_buf(), glob.to_string())
    };

    let segments: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty()).collect();
    let mut current = vec![base];
    let mut index = 0;

    // Indices are stepped by hand because `**` consumes two segments at once
    // (itself plus the name it searches for), while every other segment
    // consumes one.
    while index < segments.len() {
        let segment = segments[index];
        let mut next = Vec::new();

        if segment == "**" {
            // `**` is only meaningful as `**/<name>`: find every directory
            // named `<name>` at any depth. A trailing `**` has nothing to
            // search for, so it matches nothing.
            let Some(target) = segments.get(index + 1) else {
                return Vec::new();
            };
            for dir in &current {
                collect_recursive(dir, target, &mut next);
            }
            // Both `**` and the name are now resolved; the remaining
            // segments (e.g. `.cache`) still apply to each hit.
            index += 2;
        } else {
            for dir in &current {
                if segment.contains('*') {
                    collect_wildcard(dir, segment, &mut next);
                } else {
                    let candidate = dir.join(segment);
                    if candidate.exists() {
                        next.push(candidate);
                    }
                }
            }
            index += 1;
        }

        current = next;
        if current.is_empty() {
            return Vec::new();
        }
    }

    current
}

/// Subtrees a `**` search must never descend into.
///
/// Measured, not guessed: walking `$HOME` to depth 12 for `**/.vite` took
/// 11.5s of the 361s a full-catalog probe spent, almost all of it inside
/// `~/Library` and package trees. None of these hold a project build cache.
///
/// Deliberately absent: `Documents`, `Desktop`, `Downloads`. People really do
/// keep checkouts there, and skipping them would quietly under-report.
const PRUNE_DIRS: &[&str] = &[
    ".git",
    "Library",
    ".Trash",
    "Applications",
    "Parallels",
    ".rustup",
    "Pictures",
    "Movies",
    "Music",
];

/// Directories to look *inside* but never recurse through.
///
/// `node_modules` holds two catalog targets as direct children (`.cache`,
/// `.vite`) but is also the single most expensive thing to walk — a deep
/// dependency tree is tens of thousands of directories. Checking its children
/// and stopping keeps both hits and drops the cost. A nested
/// `node_modules/foo/node_modules/.cache` is missed by design: removing the
/// outer tree already covers it.
const SHALLOW_DIRS: &[&str] = &["node_modules"];

/// Walk `dir` looking for entries named `target`. Does not descend into a
/// match — a cache dir inside a cache dir is already covered by the parent.
fn collect_recursive(dir: &Path, target: &str, out: &mut Vec<PathBuf>) {
    // Bounded so a deep tree cannot stall a scan. Real project layouts sit
    // well inside this.
    const MAX_DEPTH: usize = 12;

    fn walk(dir: &Path, target: &str, depth: usize, max: usize, out: &mut Vec<PathBuf>) {
        if depth > max {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            // Unreadable (TCC, permissions) — skip, never abort the scan.
            return;
        };
        for entry in entries.flatten() {
            // `read_dir` already carries the type on macOS, so take it from
            // the entry instead of paying a second `stat` per file. Falling
            // back to `symlink_metadata` keeps links unfollowed on the rare
            // platform that reports Unknown.
            let is_dir = match entry.file_type() {
                Ok(ft) if ft.is_symlink() => continue,
                Ok(ft) => ft.is_dir(),
                Err(_) => match entry.path().symlink_metadata() {
                    Ok(meta) => meta.is_dir(),
                    Err(_) => continue,
                },
            };
            if !is_dir {
                continue;
            }

            let name = entry.file_name();
            let name = name.to_string_lossy();

            // Name check first: a pruned or shallow dir that *is* the target
            // still matches. `**/node_modules/.cache` depends on this.
            if name == target {
                out.push(entry.path());
                continue;
            }
            if PRUNE_DIRS.contains(&name.as_ref()) {
                continue;
            }
            // Shallow dirs get their children checked at the depth cap, so the
            // loop looks one level in and no further.
            let next_depth = if SHALLOW_DIRS.contains(&name.as_ref()) {
                max
            } else {
                depth + 1
            };
            walk(&entry.path(), target, next_depth, max, out);
        }
    }

    walk(dir, target, 0, MAX_DEPTH, out);
}

/// Match one path segment containing `*`.
fn collect_wildcard(dir: &Path, pattern: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if segment_matches(pattern, &name) {
            out.push(entry.path());
        }
    }
}

/// Glob match for a single segment: `*` matches any run of characters.
fn segment_matches(pattern: &str, name: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == name;
    }

    let mut rest = name;

    // A leading empty part means the pattern starts with `*`.
    if let Some(first) = parts.first() {
        if !first.is_empty() {
            if !rest.starts_with(first) {
                return false;
            }
            rest = &rest[first.len()..];
        }
    }

    // Likewise a trailing empty part means it ends with `*`.
    let last = parts.len() - 1;
    for (index, part) in parts.iter().enumerate().skip(1) {
        if part.is_empty() {
            continue;
        }
        if index == last {
            if !rest.ends_with(part) {
                return false;
            }
            // Guard against the middle and tail overlapping.
            if rest.len() < part.len() {
                return false;
            }
        } else if let Some(found) = rest.find(part) {
            rest = &rest[found + part.len()..];
        } else {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_matching_handles_stars() {
        assert!(segment_matches("*", "anything"));
        assert!(segment_matches("Caches", "Caches"));
        assert!(!segment_matches("Caches", "caches"));
        assert!(segment_matches("com.*.app", "com.example.app"));
        assert!(segment_matches("*.log", "system.log"));
        assert!(!segment_matches("*.log", "system.txt"));
        assert!(segment_matches("pre*", "prefix"));
        assert!(!segment_matches("pre*", "nope"));
    }

    #[test]
    fn expand_finds_nested_dirs_and_skips_missing() {
        let root = std::env::temp_dir().join(format!("mftp-rules-{}", std::process::id()));
        let nested = root.join("project/node_modules/.cache");
        std::fs::create_dir_all(&nested).expect("create nested cache");

        let found = expand("**/node_modules/.cache", &root);
        // Assert the whole tail, not just `node_modules` — the earlier
        // implementation stopped one segment short and still looked plausible.
        assert!(
            found.iter().any(|p| p == &nested),
            "expected exactly {nested:?}, got {found:?}"
        );

        let missing = expand("definitely/not/here", &root);
        assert!(missing.is_empty(), "missing glob should yield nothing");

        // A bare `**` has no name to search for and must match nothing rather
        // than returning every directory in the tree.
        assert!(
            expand("**", &root).is_empty(),
            "bare ** should match nothing"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn expand_does_not_follow_symlinks_out_of_root() {
        let root = std::env::temp_dir().join(format!("mftp-rules-link-{}", std::process::id()));
        let inside = root.join("inside");
        std::fs::create_dir_all(&inside).expect("create inside");

        // A link named like a target must not be reported as a match.
        let link = root.join("linked");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/", &link).ok();

        let found = expand("**/.cache", &root);
        assert!(
            !found.iter().any(|p| p.starts_with("/System")),
            "expansion escaped through a symlink: {found:?}"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// `node_modules` is walked one level deep, never recursed through. Both
    /// halves matter: the shallow look is what keeps `**/node_modules/.cache`
    /// and `**/.vite` working, and the stop is what took the full-catalog
    /// expansion from ~6 minutes down.
    #[test]
    fn shallow_dirs_yield_direct_children_but_are_not_recursed() {
        let root = std::env::temp_dir().join(format!("mftp-rules-shallow-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();

        let modules = root.join("project/node_modules");
        std::fs::create_dir_all(modules.join(".cache")).expect("create direct cache");
        std::fs::create_dir_all(modules.join(".vite")).expect("create direct vite");
        // A cache belonging to a nested dependency. Removing the outer tree
        // already covers it, so expansion should not list it separately.
        std::fs::create_dir_all(modules.join("dep/node_modules/.cache"))
            .expect("create nested cache");

        let cache_hits = expand("**/node_modules/.cache", &root);
        assert!(
            cache_hits.contains(&modules.join(".cache")),
            "direct node_modules/.cache must still match: {cache_hits:?}"
        );
        assert!(
            !cache_hits.contains(&modules.join("dep/node_modules/.cache")),
            "nested dependency cache should not be listed separately: {cache_hits:?}"
        );

        let vite_hits = expand("**/.vite", &root);
        assert!(
            vite_hits.contains(&modules.join(".vite")),
            "node_modules/.vite must still match: {vite_hits:?}"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// Pruned trees are skipped, but a pruned name that *is* the target still
    /// matches — the name check runs before the prune check.
    #[test]
    fn pruned_dirs_are_skipped_but_still_matchable() {
        let root = std::env::temp_dir().join(format!("mftp-rules-prune-{}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();

        // `.git` is pruned, so a cache buried inside it is never reported.
        std::fs::create_dir_all(root.join(".git/objects/.vite")).expect("create git cache");
        std::fs::create_dir_all(root.join("real/.vite")).expect("create real cache");

        let hits = expand("**/.vite", &root);
        assert!(
            hits.contains(&root.join("real/.vite")),
            "cache outside a pruned tree must match: {hits:?}"
        );
        assert!(
            !hits.iter().any(|p| p.starts_with(root.join(".git"))),
            "expansion should not descend into .git: {hits:?}"
        );

        // `Library` is pruned as a subtree, yet `Library/Logs` is itself a
        // catalog target and must remain reachable as a direct path.
        std::fs::create_dir_all(root.join("Library/Logs")).expect("create logs");
        let logs = expand("Library/Logs", &root);
        assert_eq!(
            logs,
            vec![root.join("Library/Logs")],
            "direct (non-**) paths are unaffected by pruning"
        );

        std::fs::remove_dir_all(&root).ok();
    }
}
