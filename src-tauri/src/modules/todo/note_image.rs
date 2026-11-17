//! Platform-neutral image preparation lives in the shared crate.
pub(super) use mftp_image::{
    prepare_image as prepare_note_image, PrepareImageError as NoteImageError,
    PreparedImage as PreparedNoteImage, MAX_EDGE, MAX_IMAGE_BYTES, MAX_INPUT_BYTES, MAX_PIXELS,
};
