//! Compose selected Lucide icons with the framework's default component bundle.

use gpui_kit::{AssetSource, Result, SharedString, assets::Assets};
use std::borrow::Cow;

gpui_kit::assets::icon_assets!(
    EditorIcons,
    [
        Save,
        Trash,
        Flag,
        Tag,
        Clock,
        Archive,
        SquarePen,
        Info,
        RotateCcw,
        Bold,
        Italic,
        Image,
        Link,
        List,
        ListOrdered,
        Strikethrough,
        Code,
        TextQuote,
        ListIndentIncrease,
        ListIndentDecrease
    ]
);

pub(super) struct NativeAssets;

impl AssetSource for NativeAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        if let Some(bytes) = EditorIcons.load(path)? {
            return Ok(Some(bytes));
        }
        Assets.load(path)
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut paths = Assets.list(path)?;
        paths.extend(EditorIcons.list(path)?);
        paths.sort();
        paths.dedup();
        Ok(paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::assets::IconName;

    #[test]
    fn native_source_loads_editor_and_default_component_icons() {
        for icon in [
            IconName::Bold,
            IconName::Italic,
            IconName::Image,
            IconName::Link,
            IconName::List,
            IconName::ListOrdered,
            IconName::Undo,
            IconName::Redo,
            IconName::Ellipsis,
            IconName::Search,
            IconName::SquarePen,
            IconName::Save,
            IconName::Trash,
            IconName::Archive,
            IconName::Flag,
            IconName::Tag,
            IconName::Info,
            IconName::RotateCcw,
        ] {
            assert!(
                NativeAssets
                    .load(&icon.path())
                    .is_ok_and(|bytes| { bytes.is_some_and(|bytes| !bytes.is_empty()) })
            );
        }
    }
}
