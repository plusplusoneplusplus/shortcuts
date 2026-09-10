//! The process-wide registry that lets a `notes_fs` write update the very
//! snapshot a later search reads.
//!
//! Node owns one index handle per `(workspaceId, rootId)` and a filesystem
//! watcher that refreshes it after external edits. That watcher is debounced,
//! so a note saved through `PUT /notes/content` used to be unfindable for a
//! moment right after saving. The write path now reaches the same in-memory
//! snapshot directly, on the Rust side of the boundary — no second N-API
//! crossing, and no change to the watcher, which still covers AI writes, sync,
//! and manual edits.
//!
//! Handles are held weakly: the registry never keeps an index alive, and the
//! last dropped JavaScript handle removes the root. A write against a root with
//! no live index is a no-op, because the index builds lazily on first search.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use super::{NotesIndex, NotesIndexInner, MAX_CHANGED_PATHS};

/// What one root's write-through did, for logging and for tests. Callers of
/// [`apply_changes`] never fail because of it: the filesystem write already
/// succeeded, and a stale index is repaired by the watcher or the next full
/// refresh.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WriteThroughOutcome {
    /// No live index for this root — nothing to update.
    NoIndex,
    /// Every live index absorbed the change incrementally.
    Incremental,
    /// At least one index had to rebuild its whole root, because a directory
    /// change touched more than `MAX_CHANGED_PATHS` documents.
    FullRefresh,
    /// At least one index could not be updated at all. The snapshot is stale
    /// until the watcher catches up.
    Failed,
}

/// Root-relative paths touched by one `notes_fs` mutation.
///
/// Directories are expanded per index, from that index's own snapshot (what it
/// used to hold) plus the current disk contents (what it should hold now), so
/// a rename that moves a whole notebook is a remove-and-add rather than a
/// rebuild.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct NotesIndexChanges {
    pub files: Vec<String>,
    pub directories: Vec<String>,
}

impl NotesIndexChanges {
    /// One changed file.
    pub fn file(path: impl Into<String>) -> Self {
        Self { files: vec![path.into()], directories: Vec::new() }
    }

    /// One changed directory subtree.
    pub fn directory(path: impl Into<String>) -> Self {
        Self { files: Vec::new(), directories: vec![path.into()] }
    }

    fn is_empty(&self) -> bool {
        self.files.is_empty() && self.directories.is_empty()
    }
}

type Registry = Mutex<Vec<(PathBuf, Weak<NotesIndexInner>)>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}

/// The lookup key. Two roots that canonicalize to the same directory share
/// their write-through, which is the point: Node may resolve the same notes
/// directory through different symlinked or differently-cased spellings.
/// An unresolvable root (it may not exist yet) keeps its literal path.
fn registry_key(root: &Path) -> PathBuf {
    fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
}

/// Record a freshly built index. Called by `NotesIndex::build`; there is no
/// unregister, because the weak handle expires on its own.
pub(crate) fn register(index: &NotesIndex) {
    let key = registry_key(index.root());
    let mut entries = registry().lock().unwrap_or_else(|error| error.into_inner());
    entries.retain(|(_, handle)| handle.strong_count() > 0);
    entries.push((key, Arc::downgrade(index.inner())));
}

/// Every live index for `root`, in registration order.
pub fn live_indexes(root: &Path) -> Vec<NotesIndex> {
    let key = registry_key(root);
    let mut entries = registry().lock().unwrap_or_else(|error| error.into_inner());
    entries.retain(|(_, handle)| handle.strong_count() > 0);
    entries
        .iter()
        .filter(|(entry_key, _)| *entry_key == key)
        .filter_map(|(_, handle)| handle.upgrade())
        .map(NotesIndex::from_inner)
        .collect()
}

/// Fold a completed `notes_fs` mutation into every live index for `root`.
///
/// Never returns an error: the file is already written, and reporting a
/// failed index update as a failed save would be a lie. The outcome is for the
/// caller's logs and for tests.
pub fn apply_changes(root: &Path, changes: &NotesIndexChanges) -> WriteThroughOutcome {
    if changes.is_empty() {
        return WriteThroughOutcome::NoIndex;
    }
    let indexes = live_indexes(root);
    if indexes.is_empty() {
        return WriteThroughOutcome::NoIndex;
    }

    let mut outcome = WriteThroughOutcome::Incremental;
    for index in indexes {
        let index_outcome = apply_to_index(&index, changes);
        outcome = worse_of(outcome, index_outcome);
    }
    outcome
}

fn worse_of(left: WriteThroughOutcome, right: WriteThroughOutcome) -> WriteThroughOutcome {
    fn rank(outcome: WriteThroughOutcome) -> u8 {
        match outcome {
            WriteThroughOutcome::NoIndex => 0,
            WriteThroughOutcome::Incremental => 1,
            WriteThroughOutcome::FullRefresh => 2,
            WriteThroughOutcome::Failed => 3,
        }
    }
    if rank(right) > rank(left) {
        right
    } else {
        left
    }
}

fn apply_to_index(index: &NotesIndex, changes: &NotesIndexChanges) -> WriteThroughOutcome {
    let mut paths = BTreeSet::new();
    let mut needs_full_refresh = false;

    for file in &changes.files {
        if let Some(normalized) = normalize(file) {
            paths.insert(normalized);
        }
    }
    for directory in &changes.directories {
        let Some(normalized) = normalize(directory) else { continue };
        if !expand_directory(index, &normalized, &mut paths) {
            needs_full_refresh = true;
            break;
        }
    }

    if needs_full_refresh {
        return match index.refresh() {
            Ok(()) => WriteThroughOutcome::FullRefresh,
            Err(_) => WriteThroughOutcome::Failed,
        };
    }
    if paths.is_empty() {
        // A directory that held no Markdown before or after: nothing indexed
        // could have changed.
        return WriteThroughOutcome::Incremental;
    }

    let batch = paths.into_iter().collect::<Vec<_>>();
    match index.refresh_changed(&batch) {
        Ok(()) => WriteThroughOutcome::Incremental,
        // An incremental batch is refused for a reason the caller cannot fix
        // here (an ambiguous hint, a root that moved). Falling back to a full
        // rebuild keeps the snapshot correct, which matters more than the cost.
        Err(_) => match index.refresh() {
            Ok(()) => WriteThroughOutcome::FullRefresh,
            Err(_) => WriteThroughOutcome::Failed,
        },
    }
}

/// Collect the documents a directory holds now and the ones the snapshot still
/// thinks it holds. Returns `false` when the union outgrows one incremental
/// batch, which asks the caller for a full rebuild instead.
fn expand_directory(index: &NotesIndex, directory: &str, paths: &mut BTreeSet<String>) -> bool {
    for path in index.snapshot_paths_under(directory) {
        paths.insert(path);
        if paths.len() > MAX_CHANGED_PATHS {
            return false;
        }
    }

    let absolute = directory.split('/').fold(index.root().to_path_buf(), |mut path, component| {
        path.push(component);
        path
    });
    collect_markdown_paths(&absolute, directory, index.options().skip_symlinks, paths)
}

fn collect_markdown_paths(
    directory: &Path,
    relative_directory: &str,
    skip_symlinks: bool,
    paths: &mut BTreeSet<String>,
) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        // Unreadable or gone: whatever the snapshot held for it is already in
        // the batch, and the incremental refresh drops what no longer exists.
        return true;
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if skip_symlinks && file_type.is_symlink() {
            continue;
        }
        let basename = entry.file_name().to_string_lossy().into_owned();
        let relative_path = format!("{relative_directory}/{basename}");
        if file_type.is_dir() {
            if !collect_markdown_paths(&entry.path(), &relative_path, skip_symlinks, paths) {
                return false;
            }
        } else if basename.ends_with(".md") {
            paths.insert(relative_path);
            if paths.len() > MAX_CHANGED_PATHS {
                return false;
            }
        }
    }
    true
}

/// Accept only paths the incremental refresh can act on: root-relative, with
/// no escaping or empty component. A default-root write to an absolute path
/// outside the notes tree (the scratchpad files) arrives here as `..`-prefixed
/// and is simply not indexed, which is correct — it never was.
fn normalize(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty()
        || trimmed.contains('\0')
        || trimmed
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return None;
    }
    Some(trimmed.to_string())
}
