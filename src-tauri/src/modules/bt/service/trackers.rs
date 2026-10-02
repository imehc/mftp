//! Tracker policy: local public-list configuration, URL normalization, and
//! source inspection used before a torrent is added to the shared session.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use librqbit_core::magnet::Magnet;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

const TRACKER_CONFIG_FILENAME: &str = "trackers.json";
const DEFAULT_TRACKERS: [&str; 6] = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://open.stealth.si:80/announce",
];

#[derive(Debug, Deserialize, Serialize)]
struct TrackerConfig {
    trackers: Vec<String>,
}

fn supported_tracker(raw: &str) -> Option<Url> {
    let mut url = Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "udp") || url.host().is_none() {
        return None;
    }
    // Fragments are never sent to trackers and would make equivalent URLs
    // compare differently, so remove them before inserting into the set.
    url.set_fragment(None);
    Some(url)
}

pub(super) fn parse_tracker_urls<I, S>(trackers: I) -> HashSet<Url>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    trackers
        .into_iter()
        .filter_map(|tracker| supported_tracker(tracker.as_ref()))
        .collect()
}

fn default_trackers() -> HashSet<Url> {
    parse_tracker_urls(DEFAULT_TRACKERS)
}

pub(super) fn load_public_trackers(base: &Path) -> HashSet<Url> {
    let path = base.join(TRACKER_CONFIG_FILENAME);
    let configured = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<TrackerConfig>(&raw).ok())
        .map(|config| parse_tracker_urls(config.trackers))
        .filter(|trackers| !trackers.is_empty());

    if let Some(trackers) = configured {
        return trackers;
    }

    let trackers = default_trackers();
    let config = TrackerConfig {
        trackers: tracker_strings(&trackers),
    };
    if let Ok(raw) = serde_json::to_vec_pretty(&config) {
        let _ = std::fs::write(path, raw);
    }
    trackers
}

pub(super) fn tracker_strings(trackers: &HashSet<Url>) -> Vec<String> {
    let mut values: Vec<_> = trackers.iter().map(ToString::to_string).collect();
    values.sort_unstable();
    values
}

/// Returns whether a source contains at least one valid tracker and whether
/// the metainfo marks it private. Unknown remote URLs are left untouched: we
/// must not add public trackers before seeing their metainfo.
pub(super) fn inspect_source(source: &str) -> AppResult<Option<SourceTrackerInfo>> {
    if source.starts_with("magnet:") {
        let magnet = Magnet::parse(source).map_err(|error| {
            AppError::external(
                "bt:magnet_parse",
                format!("Magnet link parse failed: {error:#}"),
            )
        })?;
        return Ok(Some(SourceTrackerInfo {
            trackers: parse_tracker_urls(magnet.trackers),
            is_private: false,
        }));
    }

    let path = PathBuf::from(source);
    if !path.is_file() {
        return Ok(None);
    }
    let bytes =
        std::fs::read(&path).map_err(|error| AppError::from(error).context("Read torrent file"))?;
    Ok(Some(inspect_torrent_bytes(&bytes)?))
}

pub(super) fn inspect_torrent_bytes(bytes: &[u8]) -> AppResult<SourceTrackerInfo> {
    let parsed = librqbit::torrent_from_bytes(bytes).map_err(|error| {
        AppError::external("bt:torrent_parse", format!("Torrent parse failed: {error}"))
    })?;
    let trackers = parsed
        .iter_announce()
        .filter_map(|tracker| std::str::from_utf8(tracker.as_ref()).ok())
        .collect::<Vec<_>>();
    Ok(SourceTrackerInfo {
        trackers: parse_tracker_urls(trackers),
        is_private: parsed.info.data.private,
    })
}

#[derive(Debug, Clone)]
pub(super) struct SourceTrackerInfo {
    pub trackers: HashSet<Url>,
    pub is_private: bool,
}

pub(super) fn fallback_for_source(
    source_info: Option<&SourceTrackerInfo>,
    public_trackers: &HashSet<Url>,
) -> Option<Vec<String>> {
    let source_info = source_info?;
    if source_info.is_private || !source_info.trackers.is_empty() || public_trackers.is_empty() {
        return None;
    }
    Some(tracker_strings(public_trackers))
}

#[cfg(test)]
#[path = "trackers_tests.rs"]
mod tests;
