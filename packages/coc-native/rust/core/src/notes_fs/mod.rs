//! The filesystem core behind the Notes API: path containment, `.order.json`
//! persistence, the tree scan, content read/write, and entry mutations.
//!
//! What stays in Node is deliberate and narrow — root resolution, sibling
//! sorting (`localeCompare` is ICU, and reimplementing it here would drift),
//! route parsing, and the SQLite chat-binding cascade. Everything that touches
//! a file lives here so there is exactly one implementation of it.

pub mod content;
pub mod entry;
pub mod index_sync;
pub mod order;
pub mod path_safety;
pub mod timestamp;
pub mod tree;

pub use content::{
    read_note, resolve_content_path, write_note, ContentError, ContentOptions, NoteContent,
    WriteOutcome,
};
pub use entry::{
    create_entry, delete_entry, rename_entry, write_order, CreateKind, CreatedEntry, DeleteOutcome,
    EntryError, EntryKind, EntryOptions, IoStage, RenameOutcome,
};
pub use index_sync::{
    changed as index_changed, directory_changed as index_directory_changed,
    file_changed as index_file_changed,
};
pub use order::{
    order_file_path, read_order_file, remove_from_order, serialize_order, update_order_on_rename,
    write_order_file, ORDER_FILE_NAME,
};
pub use path_safety::{
    canonicalize_potential_path, has_symlink_below_root, is_absolute_request,
    is_same_or_within_directory, lexical_relative, normalize_relative_notes_path,
    resolve_lexically, resolve_safe_notes_path, CanonicalizeError, PathSafetyError,
    PathSafetyResult, ResolvedSafeNotesPath, SafePathOptions, PATH_SAFETY_STATUS_CODE,
};
pub use timestamp::{format_iso_instant, js_round, unix_millis, unix_millis_f64};
pub use tree::{scan_notes_tree, NotesTree, TreeEntry, TreeEntryKind, TreeOptions};
