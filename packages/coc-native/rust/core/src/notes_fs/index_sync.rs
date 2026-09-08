//! Write-through from a `notes_fs` mutation into the live search index.
//!
//! The Notes search index is refreshed by a debounced `fs.watch` pipeline in
//! Node, which is right for edits the server did not make — AI writes, sync,
//! a user editing the file in another editor. It is wrong for the server's own
//! saves: a note written through `PUT /notes/content` should be findable
//! immediately, not one debounce later. So every mutation here also folds its
//! own paths into whatever index is live for that root, on this side of the
//! N-API boundary.
//!
//! This is deliberately best-effort. The filesystem write has already
//! succeeded by the time these run, so a failed index update is reported to
//! nobody: the watcher still fires for the same path, and an idempotent
//! upsert makes the double update harmless.

use std::path::Path;

use crate::notes_index::registry::{apply_changes, NotesIndexChanges, WriteThroughOutcome};

use super::path_safety::lexical_relative;

/// A page was created, saved, or otherwise replaced.
pub fn file_changed(notes_root: &Path, absolute: &Path) -> WriteThroughOutcome {
    changed(notes_root, &[absolute], &[])
}

/// A directory subtree appeared or vanished.
pub fn directory_changed(notes_root: &Path, absolute: &Path) -> WriteThroughOutcome {
    changed(notes_root, &[], &[absolute])
}

/// The general form: any mix of file and directory paths, absolute.
pub fn changed(notes_root: &Path, files: &[&Path], directories: &[&Path]) -> WriteThroughOutcome {
    let changes = NotesIndexChanges {
        files: files.iter().map(|path| relative_path(notes_root, path)).collect(),
        directories: directories.iter().map(|path| relative_path(notes_root, path)).collect(),
    };
    apply_changes(notes_root, &changes)
}

/// Root-relative, forward-slash — the form the index speaks. A path outside the
/// root (the default root's absolute-path escape hatch) comes out `..`-prefixed
/// and the registry drops it, which is correct: it was never indexed.
fn relative_path(notes_root: &Path, absolute: &Path) -> String {
    lexical_relative(notes_root, absolute)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}
