//! Rule catalog for disk cleaning. Pure data plus glob matching.
//!
//! Rust owns only the rule `id`; the frontend maps that id to Lingui
//! copy. Keeping titles out of here means adding a language never
//! touches Rust.

use serde::{Deserialize, Serialize};
use specta::Type;

/// How dangerous a rule is to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum RuleTier {
    /// Pure build output. Deleting costs a rebuild, nothing else.
    Safe,
    /// Recoverable but expensive to refetch (package caches, device support).
    Caution,
    /// Analyse only — never offer a delete button. The app cannot remove
    /// these safely, so it points the user at the vendor's own UI instead.
    Manual,
}

/// What it costs the user to get the deleted bytes back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum RebuildCost {
    /// Regenerated automatically on next use, no network.
    None,
    /// Local rebuild, seconds to a minute.
    Cheap,
    /// Requires a network refetch or a long rebuild.
    Expensive,
}

/// One cleanable location. `globs` are relative to `$HOME` unless they
/// start with `/`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanRule {
    pub id: String,
    pub tier: RuleTier,
    pub globs: Vec<String>,
    pub rebuild_cost: RebuildCost,
    /// Lingui key for the "do this by hand instead" hint. Always set for
    /// `Manual`, always `None` otherwise.
    pub external_hint: Option<String>,
}

impl CleanRule {
    fn new(
        id: &str,
        tier: RuleTier,
        globs: &[&str],
        rebuild_cost: RebuildCost,
        external_hint: Option<&str>,
    ) -> Self {
        Self {
            id: id.to_string(),
            tier,
            globs: globs.iter().map(|g| g.to_string()).collect(),
            rebuild_cost,
            external_hint: external_hint.map(|h| h.to_string()),
        }
    }

    /// True when this rule may be deleted by the app at all. `Manual`
    /// rules are analysis-only by design.
    pub fn deletable(&self) -> bool {
        self.tier != RuleTier::Manual
    }
}

/// The full rule catalog.
///
/// Ordering matters only for display; the frontend groups by `tier`.
pub fn catalog() -> Vec<CleanRule> {
    vec![
        // ---- safe: build output, regenerated on demand ----
        CleanRule::new(
            "frontend-build-cache",
            RuleTier::Safe,
            &[
                "**/node_modules/.cache",
                "**/.next/cache",
                "**/.turbo",
                "**/.vite",
                "**/.parcel-cache",
            ],
            RebuildCost::Cheap,
            None,
        ),
        CleanRule::new(
            "xcode-derived-data",
            RuleTier::Safe,
            &["Library/Developer/Xcode/DerivedData"],
            RebuildCost::Cheap,
            None,
        ),
        CleanRule::new(
            "homebrew-cache",
            RuleTier::Safe,
            &["Library/Caches/Homebrew"],
            RebuildCost::Expensive,
            None,
        ),
        CleanRule::new(
            "user-logs",
            RuleTier::Safe,
            &["Library/Logs"],
            RebuildCost::None,
            None,
        ),
        // ---- caution: recoverable, but you pay to get it back ----
        CleanRule::new(
            "npm-cache",
            RuleTier::Caution,
            &[".npm/_cacache"],
            RebuildCost::Expensive,
            None,
        ),
        CleanRule::new(
            "pnpm-store",
            RuleTier::Caution,
            &["Library/pnpm/store", ".pnpm-store"],
            RebuildCost::Expensive,
            None,
        ),
        CleanRule::new(
            "cargo-registry-cache",
            RuleTier::Caution,
            &[".cargo/registry/cache"],
            RebuildCost::Expensive,
            None,
        ),
        CleanRule::new(
            "go-module-cache",
            RuleTier::Caution,
            &["go/pkg/mod/cache/download"],
            RebuildCost::Expensive,
            None,
        ),
        CleanRule::new(
            "gradle-cache",
            RuleTier::Caution,
            &[".gradle/caches"],
            RebuildCost::Expensive,
            None,
        ),
        CleanRule::new(
            "xcode-device-support",
            RuleTier::Caution,
            &["Library/Developer/Xcode/iOS DeviceSupport"],
            RebuildCost::Cheap,
            None,
        ),
        // ---- manual: analyse only, hand the user off to the vendor UI ----
        // TCC refuses `~/.Trash` to any process without Full Disk Access, so a
        // scan reports 0 bytes however it is written. Even with access, the only
        // correct action is emptying the *contents* — moving `~/.Trash` itself
        // to the Trash is nonsense. Finder already does this properly.
        CleanRule::new(
            "trash",
            RuleTier::Manual,
            &[".Trash"],
            RebuildCost::None,
            Some("hint.trash"),
        ),
        // Runtimes live under `/Library` (system-wide), not `$HOME`. The
        // per-user CoreSimulator dir only holds device metadata and is tiny.
        CleanRule::new(
            "ios-simulator-runtime",
            RuleTier::Manual,
            &["/Library/Developer/CoreSimulator/Profiles/Runtimes"],
            RebuildCost::Expensive,
            Some("hint.ios-simulator-runtime"),
        ),
        CleanRule::new(
            "wechat-data",
            RuleTier::Manual,
            &["Library/Containers/com.tencent.xinWeChat/Data/Documents"],
            RebuildCost::Expensive,
            Some("hint.wechat-data"),
        ),
        CleanRule::new(
            "parallels-vm",
            RuleTier::Manual,
            &["Parallels"],
            RebuildCost::Expensive,
            Some("hint.parallels-vm"),
        ),
        CleanRule::new(
            "docker-data",
            RuleTier::Manual,
            &["Library/Containers/com.docker.docker/Data"],
            RebuildCost::Expensive,
            Some("hint.docker-data"),
        ),
    ]
}

/// Look a rule up by id.
pub fn find(id: &str) -> Option<CleanRule> {
    catalog().into_iter().find(|rule| rule.id == id)
}

mod glob;

pub use glob::expand;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_ids_are_unique() {
        let rules = catalog();
        let mut ids: Vec<&str> = rules.iter().map(|r| r.id.as_str()).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "duplicate rule id in catalog");
    }

    #[test]
    fn manual_rules_are_not_deletable_and_carry_a_hint() {
        for rule in catalog() {
            if rule.tier == RuleTier::Manual {
                assert!(!rule.deletable(), "{} must not be deletable", rule.id);
                assert!(
                    rule.external_hint.is_some(),
                    "{} needs an external hint",
                    rule.id
                );
            } else {
                assert!(rule.deletable(), "{} should be deletable", rule.id);
                assert!(
                    rule.external_hint.is_none(),
                    "{} should not carry a hint",
                    rule.id
                );
            }
        }
    }

    #[test]
    fn every_rule_declares_at_least_one_glob() {
        for rule in catalog() {
            assert!(!rule.globs.is_empty(), "{} has no globs", rule.id);
        }
    }

    #[test]
    fn manual_rules_contribute_no_deletable_roots() {
        // The manager builds a job's allowlist from `deletable()` rules only.
        // If a manual rule ever flipped to deletable, the remove gate would
        // start accepting paths under e.g. the WeChat container.
        let manual: Vec<_> = catalog()
            .into_iter()
            .filter(|rule| rule.tier == RuleTier::Manual)
            .collect();

        assert!(
            !manual.is_empty(),
            "catalog should still carry manual-tier rules"
        );
        for rule in manual {
            assert!(
                !rule.deletable(),
                "{} is manual but reports deletable",
                rule.id
            );
        }
    }
}
