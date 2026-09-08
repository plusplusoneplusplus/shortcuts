//! The filesystem core behind the Notes API: path containment, `.order.json`
//! persistence, the tree scan, content read/write, and entry mutations.
//!
//! What stays in Node is deliberate and narrow — root resolution, sibling
//! sorting (`localeCompare` is ICU, and reimplementing it here would drift),
//! route parsing, and the SQLite chat-binding cascade. Everything that touches
//! a file lives here so there is exactly one implementation of it.

pub mod path_safety;

pub use path_safety::{
    canonicalize_potential_path, has_symlink_below_root, is_same_or_within_directory,
    normalize_relative_notes_path, resolve_lexically, resolve_safe_notes_path, CanonicalizeError,
    PathSafetyError, PathSafetyResult, ResolvedSafeNotesPath, SafePathOptions,
    PATH_SAFETY_STATUS_CODE,
};
