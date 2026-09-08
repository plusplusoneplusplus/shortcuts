//! The recursive Notes tree scan.
//!
//! A port of `buildTree` in
//! `packages/coc/src/server/notes/notes-read-handler.ts` (and its hand-copied
//! twin in `executors/note-create-executor.ts`), minus the sorting.
//!
//! Siblings come back in raw `readdir` order together with the directory's
//! `.order.json` list; Node applies the dirs-first + `localeCompare` fallback
//! sort and `applyOrder` on top. Collation is ICU, and a second implementation
//! of it here would eventually disagree with the one the SPA sees.

use std::fs;
use std::io;
use std::path::Path;

use super::order::read_order_file;
use super::path_safety::{resolve_safe_notes_path, SafePathOptions};
use super::timestamp::{format_iso_instant, unix_millis};

/// What a node in the tree is, in the SPA's vocabulary: top-level directories
/// are notebooks, nested ones sections, and every `.md` file is a page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeEntryKind {
    Notebook,
    Section,
    Page,
}

impl TreeEntryKind {
    /// The wire value; matches the `type` field the HTTP response carries.
    pub fn as_str(self) -> &'static str {
        match self {
            TreeEntryKind::Notebook => "notebook",
            TreeEntryKind::Section => "section",
            TreeEntryKind::Page => "page",
        }
    }
}

/// One node. `children`/`explicit_order` are present exactly for directories,
/// `last_modified_at` exactly for pages — the same optionality the TypeScript
/// object had.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeEntry {
    pub name: String,
    /// Root-relative, always forward-slash separated.
    pub path: String,
    pub kind: TreeEntryKind,
    pub last_modified_at: Option<String>,
    pub children: Option<Vec<TreeEntry>>,
    /// The directory's `.order.json` contents, for Node to apply.
    pub explicit_order: Option<Vec<String>>,
}

/// The scan of a whole root: its immediate children plus the root's own order file.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct NotesTree {
    pub entries: Vec<TreeEntry>,
    pub explicit_order: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TreeOptions {
    /// The default managed root trusts its own contents. Any other root is
    /// user-chosen, so symlinks are skipped and even the `.order.json` read is
    /// routed through the containment check.
    pub is_default_root: bool,
}

/// Scan `notes_root` recursively.
///
/// A directory that cannot be read yields no children rather than an error —
/// the scan is a read of whatever is there right now, and a permission-denied
/// subfolder should not blank the whole tree. A `.md` file that vanishes
/// between `readdir` and `stat` does surface, matching the TypeScript, where
/// that `stat` rejection propagated out of the handler.
pub fn scan_notes_tree(notes_root: &Path, options: TreeOptions) -> io::Result<NotesTree> {
    Ok(NotesTree {
        entries: scan_directory(notes_root, "", notes_root, options)?,
        explicit_order: read_order_for(notes_root, "", notes_root, options),
    })
}

fn scan_directory(
    dir: &Path,
    base_path: &str,
    notes_root: &Path,
    options: TreeOptions,
) -> io::Result<Vec<TreeEntry>> {
    let Ok(dir_entries) = fs::read_dir(dir) else {
        return Ok(Vec::new());
    };

    let mut nodes = Vec::new();
    for dir_entry in dir_entries {
        let Ok(dir_entry) = dir_entry else {
            continue;
        };
        // `Dirent` in Node never follows the link either, so a symlink is
        // neither a directory nor, for the default root, anything but a plain
        // name that has to end in `.md` to survive the filter.
        let Ok(file_type) = dir_entry.file_type() else {
            continue;
        };
        let name = dir_entry.file_name().to_string_lossy().into_owned();

        if !options.is_default_root && file_type.is_symlink() {
            continue;
        }
        let is_directory = file_type.is_dir();
        if is_directory {
            if name.starts_with('.') {
                continue;
            }
        } else if !name.ends_with(".md") {
            continue;
        }

        let entry_path =
            if base_path.is_empty() { name.clone() } else { format!("{base_path}/{name}") };
        let absolute = dir.join(dir_entry.file_name());

        if is_directory {
            nodes.push(TreeEntry {
                name,
                kind: if base_path.is_empty() {
                    TreeEntryKind::Notebook
                } else {
                    TreeEntryKind::Section
                },
                last_modified_at: None,
                children: Some(scan_directory(&absolute, &entry_path, notes_root, options)?),
                explicit_order: Some(read_order_for(&absolute, &entry_path, notes_root, options)),
                path: entry_path,
            });
        } else {
            let modified = fs::metadata(&absolute)?.modified()?;
            nodes.push(TreeEntry {
                name,
                path: entry_path,
                kind: TreeEntryKind::Page,
                last_modified_at: Some(format_iso_instant(unix_millis(modified))),
                children: None,
                explicit_order: None,
            });
        }
    }
    Ok(nodes)
}

/// Read a directory's order file, gated by the containment check on
/// non-default roots — a `.order.json` reachable only through a symlink out of
/// the collection must not be honoured.
fn read_order_for(
    dir: &Path,
    base_path: &str,
    notes_root: &Path,
    options: TreeOptions,
) -> Vec<String> {
    if !options.is_default_root {
        let requested = if base_path.is_empty() {
            super::order::ORDER_FILE_NAME.to_string()
        } else {
            format!("{base_path}/{}", super::order::ORDER_FILE_NAME)
        };
        if resolve_safe_notes_path(notes_root, &requested, SafePathOptions::default()).is_err() {
            return Vec::new();
        }
    }
    read_order_file(dir)
}
