# Vendored native Markdown editor

Source: https://github.com/wabzqem/gpui-kit-markdown-editor

Revision: c470f7470f6d8a19515c23a55f5761488989588c (version 0.2.0).

License: Apache-2.0; Lucide icons are provided by GPUI Kit under ISC. The original Lucide license notice is retained in `assets/icons/LICENSE-LUCIDE`.

Local changes:

- The direct GPUI projection initializes ListItem.task_marker to None for GPUI Kit 0.9.1. Like the other span fields in this projection, there is no Markdown source span at this boundary.
- Long inherent impl blocks are split at complete method boundaries into include fragments, preserving their original module privacy and behavior. Each Rust source file remains under 600 lines. No methods are moved into new child modules.
- The package manifest contains only the dependencies used by this native application and fixes the Kit to 0.9.1. Optional syntax-highlighting features, examples and upstream test modules are excluded from this production dependency.
- Unused private helpers for the omitted upstream tests are removed so all library targets pass linting; application integration tests exercise the production editor.
- BlockEditor exposes a localized accessible name, uses entity-scoped element identity, and registers native test observations. The test-support feature publishes accessible values to the isolated headless harness.
- Two unchecked editable-leaf lookups return gracefully or report a parse error instead of unwrapping.
- Setting a new link at a collapsed caret inserts the visible URL and link mark in one undo step; existing-link edits keep their label and update the entire link.
- Host image methods insert or remove image atoms through normal selection-aware transactions. The host publishes prepared resource URI identities; unprepared atoms remain placeholders, and the component forwards the host image-source resolver into the direct renderer.
- PasteRequest exposes its plain-text mode through `is_plain()` so the host can leave literal pastes unchanged while admitting resource copies for semantic Markdown pastes. Existing selection and document-version checks still govern the final insertion.
- Prepared-resource visibility changes invalidate projection and culling measurements so image height changes do not retain stale scroll geometry. Resource completion never resets the source, selection or editing history.
- The optional upstream toolbar now uses GPUI Kit's Lucide `IconName` rather than copied SVG files. Its named icons require an appropriate host asset source; the application composes selected icons with the default component bundle.

The application supplies its localized toolbar, domain limits, resource admission, persistence and integration tests. The library's English toolbar is not used. Do not edit Cargo's global source cache to apply updates.
