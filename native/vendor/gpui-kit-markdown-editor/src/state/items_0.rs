use super::input_rule::RuleKind;
use std::sync::Arc;
use std::{cell::RefCell, ops::Range, rc::Rc};

use gpui::{
    App, AppContext, Bounds, ClipboardItem, Context, Entity, EntityInputHandler, EventEmitter,
    FocusHandle, Focusable, KeyBinding, Pixels, Point, SharedString, Subscription, UTF16Selection,
    Window, actions,
};

use super::{
    command::{CommandError, EditorCommand},
    editor::BlockEditorModel,
    frame::FrameLayout,
    id::BlockId,
    kind::BlockKind,
    marks::MarkKind,
    position::BlockPosition,
    projection::{ProjectionCache, Snapshot},
    selection::BlockSelection,
    style::BlockEditorStyle,
    transaction::EditOrigin,
};
use crate::support::BlinkCursor;
use gpui_kit::base::text::MarkdownExtensions;

pub(crate) const CONTEXT: &str = "BlockEditor";
/// Side of the whole-table corner handle, in px.
pub(crate) const TABLE_HANDLE_SIZE: f32 = 14.;
/// How far the handle sits up and left of the table frame's corner; the
/// rest overlaps the corner cell's padding, which has no text.
pub(crate) const TABLE_HANDLE_OUTSET: f32 = 8.;

actions!(
    block_editor,
    [
        Backspace,
        Delete,
        Enter,
        StructuralEnter,
        MoveLeft,
        MoveRight,
        MoveUp,
        MoveDown,
        MoveHome,
        MoveEnd,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectHome,
        SelectEnd,
        MoveDocStart,
        MoveDocEnd,
        SelectDocStart,
        SelectDocEnd,
        SelectAll,
        MoveWordLeft,
        MoveWordRight,
        SelectWordLeft,
        SelectWordRight,
        Undo,
        Redo,
        ToggleBold,
        ToggleItalic,
        EditLink,
        SoftBreak,
        ExitBlock,
        ToggleCode,
        NormalText,
        TableInsertColumnLeft,
        TableInsertColumnRight,
        TableInsertRowAbove,
        TableInsertRowBelow,
        TableDeleteLine,
        CloseTableMenu,
        Indent,
        Outdent,
        Copy,
        Cut,
        Paste,
        PastePlain,
        DeleteWordLeft,
        DeleteWordRight,
        DeleteToLineStart,
        DeleteToLineEnd,
        MoveParagraphStart,
        MoveParagraphEnd,
        SelectParagraphStart,
        SelectParagraphEnd,
        ToggleToolbar,
    ]
);

pub(crate) fn init(cx: &mut App) {
    let ctx = Some(CONTEXT);
    // Keep native Cmd/Option vs Ctrl bindings static for both Kit versions.
    macro_rules! platform_key {
        ($mac_modifier:literal, $key:literal) => {
            if cfg!(target_os = "macos") {
                concat!($mac_modifier, "-", $key)
            } else {
                concat!("ctrl-", $key)
            }
        };
    }
    cx.bind_keys(vec![
        KeyBinding::new("backspace", Backspace, ctx),
        KeyBinding::new("delete", Delete, ctx),
        KeyBinding::new("enter", Enter, ctx),
        KeyBinding::new("left", MoveLeft, ctx),
        KeyBinding::new("right", MoveRight, ctx),
        KeyBinding::new("up", MoveUp, ctx),
        KeyBinding::new("down", MoveDown, ctx),
        KeyBinding::new("home", MoveHome, ctx),
        KeyBinding::new("end", MoveEnd, ctx),
        KeyBinding::new(platform_key!("alt", "left"), MoveWordLeft, ctx),
        KeyBinding::new(platform_key!("alt", "right"), MoveWordRight, ctx),
        KeyBinding::new(platform_key!("alt", "shift-left"), SelectWordLeft, ctx),
        KeyBinding::new(platform_key!("alt", "shift-right"), SelectWordRight, ctx),
        KeyBinding::new("shift-left", SelectLeft, ctx),
        KeyBinding::new("shift-right", SelectRight, ctx),
        KeyBinding::new("shift-up", SelectUp, ctx),
        KeyBinding::new("shift-down", SelectDown, ctx),
        KeyBinding::new("shift-home", SelectHome, ctx),
        KeyBinding::new("shift-end", SelectEnd, ctx),
        KeyBinding::new(platform_key!("cmd", "home"), MoveDocStart, ctx),
        KeyBinding::new(platform_key!("cmd", "end"), MoveDocEnd, ctx),
        KeyBinding::new(platform_key!("cmd", "shift-home"), SelectDocStart, ctx),
        KeyBinding::new(platform_key!("cmd", "shift-end"), SelectDocEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-up", MoveDocStart, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-down", MoveDocEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-shift-up", SelectDocStart, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-shift-down", SelectDocEnd, ctx),
        // D21: word deletes (Option on macOS, Ctrl elsewhere).
        KeyBinding::new(platform_key!("alt", "backspace"), DeleteWordLeft, ctx),
        KeyBinding::new(platform_key!("alt", "delete"), DeleteWordRight, ctx),
        // D21: macOS line keys and the emacs bindings of Cocoa text fields.
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-backspace", DeleteToLineStart, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-delete", DeleteToLineEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-k", DeleteToLineEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-a", MoveHome, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-e", MoveEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-shift-a", SelectHome, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-shift-e", SelectEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-d", Delete, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("ctrl-h", Backspace, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-left", MoveHome, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-right", MoveEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-shift-left", SelectHome, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("cmd-shift-right", SelectEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("alt-up", MoveParagraphStart, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("alt-down", MoveParagraphEnd, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("alt-shift-up", SelectParagraphStart, ctx),
        #[cfg(target_os = "macos")]
        KeyBinding::new("alt-shift-down", SelectParagraphEnd, ctx),
        // Elsewhere paragraph motion is Ctrl+Up/Down (Ctrl+Alt+arrows stay
        // the table keys, Ctrl+Home/End the document edges).
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-up", MoveParagraphStart, ctx),
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-down", MoveParagraphEnd, ctx),
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-shift-up", SelectParagraphStart, ctx),
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-shift-down", SelectParagraphEnd, ctx),
        KeyBinding::new("tab", Indent, ctx),
        KeyBinding::new("shift-tab", Outdent, ctx),
        KeyBinding::new(platform_key!("cmd", "a"), SelectAll, ctx),
        KeyBinding::new(platform_key!("cmd", "z"), Undo, ctx),
        KeyBinding::new(platform_key!("cmd", "shift-z"), Redo, ctx),
        #[cfg(not(target_os = "macos"))]
        KeyBinding::new("ctrl-y", Redo, ctx),
        KeyBinding::new(platform_key!("cmd", "b"), ToggleBold, ctx),
        KeyBinding::new(platform_key!("cmd", "i"), ToggleItalic, ctx),
        KeyBinding::new(platform_key!("cmd", "e"), ToggleCode, ctx),
        KeyBinding::new(platform_key!("cmd", "k"), EditLink, ctx),
        // "Normal text": the block (or each selected block) becomes a paragraph.
        KeyBinding::new(platform_key!("cmd", "alt-0"), NormalText, ctx),
        // Tables (D20): only act with the caret or a cell selection in a
        // table; elsewhere the keystroke propagates.
        KeyBinding::new(platform_key!("cmd", "alt-left"), TableInsertColumnLeft, ctx),
        KeyBinding::new(
            platform_key!("cmd", "alt-right"),
            TableInsertColumnRight,
            ctx,
        ),
        KeyBinding::new(platform_key!("cmd", "alt-up"), TableInsertRowAbove, ctx),
        KeyBinding::new(platform_key!("cmd", "alt-down"), TableInsertRowBelow, ctx),
        KeyBinding::new(platform_key!("cmd", "alt-backspace"), TableDeleteLine, ctx),
        KeyBinding::new("escape", CloseTableMenu, Some("BlockEditor && table_menu")),
        KeyBinding::new("shift-enter", SoftBreak, ctx),
        KeyBinding::new(platform_key!("cmd", "enter"), ExitBlock, ctx),
        KeyBinding::new(platform_key!("cmd", "c"), Copy, ctx),
        KeyBinding::new(platform_key!("cmd", "x"), Cut, ctx),
        KeyBinding::new(platform_key!("cmd", "v"), Paste, ctx),
        KeyBinding::new(platform_key!("cmd", "shift-v"), PastePlain, ctx),
        // Composer overrides only; standalone Newline/ModifiedEnter keep
        // Shift+Enter soft breaks and the platform secondary-Enter command.
        KeyBinding::new(
            "shift-enter",
            StructuralEnter,
            Some("BlockEditor && submit == enter"),
        ),
        KeyBinding::new(
            "ctrl-enter",
            SoftBreak,
            Some("BlockEditor && submit == enter"),
        ),
    ]);
}

/// Clipboard metadata that marks a copy as the editor's own inline Markdown
/// (D17). Paste parses tagged text as inline Markdown; untagged text keeps
/// the conservative import.
pub(crate) const COPY_TAG: &str = "gpui-kit/block-editor/inline-markdown/v1";

/// Clipboard metadata for a copy of several blocks, written as Markdown
/// (headings, lists, quotes, code, tables, tasks and marks). Paste parses it
/// back into blocks.
pub(crate) const BLOCKS_COPY_TAG: &str = "gpui-kit/block-editor/blocks-markdown/v1";

/// What the clipboard item says about where it came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CopyKind {
    /// Text from elsewhere: the conservative import.
    External,
    /// The editor's own copy inside one block: inline Markdown (D17).
    Inline,
    /// The editor's own copy of whole or partial blocks: block Markdown.
    Blocks,
}

impl CopyKind {
    fn of(item: &ClipboardItem) -> Self {
        match item.metadata() {
            Some(m) if m == COPY_TAG => Self::Inline,
            Some(m) if m == BLOCKS_COPY_TAG => Self::Blocks,
            _ => Self::External,
        }
    }

    fn tag(self) -> Option<&'static str> {
        match self {
            Self::External => None,
            Self::Inline => Some(COPY_TAG),
            Self::Blocks => Some(BLOCKS_COPY_TAG),
        }
    }
}

/// Events emitted by [`BlockEditorState`].
#[non_exhaustive]
#[derive(Clone, Debug)]
pub enum BlockEditorEvent {
    /// Once per committed transaction, including undo and redo.
    Changed {
        revision: u64,
        origin: EditOrigin,
    },
    SelectionChanged,
    /// Cmd/Ctrl+K: the host should show its link popover (D14) for the
    /// selection or the link at the caret, then call
    /// [`BlockEditorState::set_link`]. `url` is the current link, if any.
    EditLinkRequested {
        url: Option<SharedString>,
    },
    /// Cmd/Ctrl+click on a link. The editor never opens a browser.
    LinkClicked {
        url: SharedString,
    },
    /// The link under the mouse changed (`None` when it left a link).
    LinkHovered {
        url: Option<SharedString>,
    },
    Focus,
    Blur,
    /// Enter requested submission; emitted only outside IME composition. The
    /// owner applies completion/picker and domain-send policy, in that order.
    SubmitRequested,
    /// Semantic paste interception, shared by keyboard and native actions.
    /// The owner must resolve this request with `apply_paste`; stale requests
    /// are rejected instead of pasting into a later selection/document.
    PasteRequested {
        request: PasteRequest,
        item: ClipboardItem,
    },
}

/// Which Enter action requests submission. Newline is the document-editor default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SubmitPolicy {
    #[default]
    Newline,
    /// Enter submits; Shift+Enter edits structurally and Ctrl+Enter inserts
    /// a cell soft break. On macOS Cmd+Enter also submits.
    Enter,
    ModifiedEnter,
}

/// Whether paste uses editor defaults or is first offered to the host.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClipboardPolicy {
    #[default]
    Editor,
    Host,
}

type InputRuleFilter = Arc<dyn Fn(super::InputRule, &str) -> bool + Send + Sync>;

/// An intercepted semantic paste tied to the editor's current document and
/// selection. Resolve once; no synthetic key events or OS clipboard access is
/// needed when delivering an explicit `ClipboardItem`.
#[derive(Clone, Debug)]
pub struct PasteRequest {
    range: super::CapturedRange,
    plain: bool,
    /// Where the item came from (the editor's own tagged copies, D17).
    copy: CopyKind,
    sequence: u64,
}

impl PasteRequest {
    /// Whether the host should preserve only literal clipboard text.
    pub fn is_plain(&self) -> bool {
        self.plain
    }
}

/// D22: a press on a top-level block's handle. It becomes a reorder drag
/// once the pointer moves past a small threshold; until then the press is
/// an ordinary click.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BlockDrag {
    pub(crate) block: BlockId,
    pub(crate) start: Point<Pixels>,
    pub(crate) active: bool,
    /// The gap between top-level blocks the block would drop into.
    pub(crate) drop: Option<usize>,
}

/// IME composition in progress: the marked byte range in one leaf.
#[derive(Clone, Debug)]
struct Marked {
    block: BlockId,
    range: Range<usize>,
}

pub struct BlockEditorState {
    /// Hidden by [`ToggleToolbar`] / [`Self::set_toolbar_hidden`].
    pub(crate) toolbar_hidden: bool,
    pub(crate) model: BlockEditorModel,
    pub(crate) focus_handle: FocusHandle,
    pub(crate) blink_cursor: Entity<BlinkCursor>,
    pub(crate) style: BlockEditorStyle,
    pub(crate) projection: ProjectionCache,
    /// Last complete frame, written by the element after prepaint.
    pub(crate) frame: Rc<RefCell<FrameLayout>>,
    pub(crate) cull: Rc<RefCell<super::cull::CullState>>,
    /// The accessible value (document text), cached per revision (D8).
    pub(crate) a11y_value: RefCell<Option<(u64, SharedString)>>,
    /// Scroll container to keep the caret in view (see `set_scroll_handle`).
    pub(crate) scroll_handle: Option<gpui::ScrollHandle>,
    /// The caret moved and should be scrolled into view after layout.
    pub(crate) reveal: std::cell::Cell<bool>,
    marked: Option<Marked>,
    /// An IME composition opened an undo group that is not committed yet.
    composition_open: bool,
    /// Remembered x for repeated up/down.
    goal_x: Option<Pixels>,
    pub(crate) dragging: bool,
    /// A press on a block handle, and the drag to reorder it (D22).
    pub(crate) block_drag: Option<BlockDrag>,
    readonly: bool,
    image_policy: super::ImagePolicy,
    submit_policy: SubmitPolicy,
    clipboard_policy: ClipboardPolicy,
    paste_sequence: u64,
    pending_paste: Option<u64>,
    input_rules: Vec<super::input_rule::InputRule>,
    input_rule_filter: Option<InputRuleFilter>,
    hovered_link: Option<SharedString>,
    /// The mouse is over a task checkbox, or a link with Cmd/Ctrl held.
    pub(crate) pointer_hand: bool,
    /// The open table grip menu (D20).
    pub(crate) table_menu: Option<super::table_ui::TableMenu>,
    /// The table grips the pointer shows (to repaint on change).
    pub(crate) table_hover: Vec<(BlockId, crate::TableLine)>,
    /// The pointer is on a table grip (grab cursor).
    pub(crate) grip_hover: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<BlockEditorEvent> for BlockEditorState {}

impl Focusable for BlockEditorState {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

include!("part_0.rs");
include!("part_1.rs");
include!("part_2.rs");
include!("part_3.rs");
include!("part_4.rs");
include!("part_5.rs");


fn command_name(command: &EditorCommand) -> &'static str {
    match command {
        EditorCommand::ToggleMark(_) => "toggle_mark",
        EditorCommand::ApplyMark(_) => "apply_mark",
        EditorCommand::SetBlockKind(_) => "set_block_kind",
        EditorCommand::ToggleList { .. } => "toggle_list",
        EditorCommand::ToggleTask => "toggle_task",
        EditorCommand::ToggleBlockquote => "toggle_blockquote",
        EditorCommand::SetTaskChecked(_) => "set_task_checked",
        EditorCommand::Indent => "indent",
        EditorCommand::Outdent => "outdent",
        EditorCommand::MoveBlocks { .. } => "move_blocks",
        EditorCommand::InsertBlock(_) => "insert_block",
        EditorCommand::SelectAll => "select_all",
        EditorCommand::DeleteSelection => "delete_selection",
        EditorCommand::SetCodeBlock { .. } => "code_block",
        EditorCommand::InsertTable { .. } => "insert_table",
        EditorCommand::EditTable(_) => "edit_table",
    }
}

pub(crate) fn utf16_to_byte(text: &str, utf16: usize) -> usize {
    let mut count = 0;
    for (ix, ch) in text.char_indices() {
        if count >= utf16 {
            return ix;
        }
        count += ch.len_utf16();
    }
    text.len()
}

pub(crate) fn byte_to_utf16(text: &str, byte: usize) -> usize {
    text.get(..byte.min(text.len()))
        .map(|s| s.encode_utf16().count())
        .unwrap_or(0)
}
