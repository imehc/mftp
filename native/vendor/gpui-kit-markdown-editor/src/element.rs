//! `BlockEditor` view (design §7).
//!
//! `render` takes the cached projection and renders it with gpui-kit's own
//! `BlockNode` renderer, so the editor looks exactly like `TextView`. The
//! [`EditorRoot`] element installs a frame-local [`FrameSink`] while its
//! children prepaint: keyed text leaves report their layouts into it and take
//! their selection backgrounds from it (`text::editor_seam`, D3). The root
//! then paints the caret and the composition underline from that geometry.
//! Paint never updates the editor entity.

include!("element/items_0.rs");
include!("element/items_1.rs");
