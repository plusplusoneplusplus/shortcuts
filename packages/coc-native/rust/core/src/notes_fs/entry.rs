//! Creating, renaming, and deleting a notes entry.
//!
//! A port of the `POST /notes/page`, `PATCH /notes/path`, `DELETE /notes/path`
//! and `PUT /notes/order` bodies in `notes-write-handler.ts`.
//!
//! What does *not* live here is the chat-binding cascade: those rows are in the
//! shared `processes.db`, so the route applies them afterwards using the
//! [`RenameOutcome`] / [`DeleteOutcome`] this module hands back. Everything the
//! filesystem is involved in — including the `.comments.json` sidecar and the
//! parent's `.order.json` — happens on this side, so there is one implementation
//! of each rule.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::index_sync;
use super::order::{order_file_path, remove_from_order, update_order_on_rename, write_order_file};
use super::path_safety::{
    is_same_or_within_directory, lexical_relative, resolve_lexically, resolve_safe_notes_path,
    PathSafetyError, SafePathOptions, PATH_SAFETY_STATUS_CODE,
};

/// The sidecar that carries a page's inline comments. It rides along on rename
/// and dies with the page on delete; losing it would silently drop review
/// threads.
const COMMENTS_SIDECAR_SUFFIX: &str = ".comments.json";

/// Which regime the request runs under.
#[derive(Debug, Clone, Copy)]
pub struct EntryOptions<'a> {
    /// The managed default root. Only it protects system folders, and only it
    /// resolves paths with plain `path.resolve` + a containment check instead of
    /// the strict safe-path resolver.
    pub is_default_root: bool,
    /// Folder names the default root refuses to rename or delete. Passed in
    /// rather than hardcoded so `SYSTEM_FOLDER_NAMES` stays a single list in
    /// TypeScript.
    pub system_folder_names: &'a [String],
}

/// What `POST /notes/page` can be asked to create.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateKind {
    Notebook,
    Section,
    Page,
}

impl CreateKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CreateKind::Notebook => "notebook",
            CreateKind::Section => "section",
            CreateKind::Page => "page",
        }
    }

    /// Parse the route's `type` field. The route validates it too, so an
    /// unknown value here means the two got out of sync.
    pub fn from_name(value: &str) -> Option<Self> {
        match value {
            "notebook" => Some(CreateKind::Notebook),
            "section" => Some(CreateKind::Section),
            "page" => Some(CreateKind::Page),
            _ => None,
        }
    }
}

/// What a rename or delete turned out to be operating on. The chat-binding
/// cascade needs it: a directory moves a whole prefix of bindings, a file moves
/// exactly one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
}

impl EntryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryKind::File => "file",
            EntryKind::Dir => "dir",
        }
    }
}

/// The stage a 500 came from. The prefixes are the ones the routes already
/// return, and the SPA surfaces them verbatim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IoStage {
    Create,
    Rename,
    Delete,
    WriteOrder,
    CheckDestination,
}

impl IoStage {
    pub fn message_prefix(self) -> &'static str {
        match self {
            IoStage::Create => "Failed to create: ",
            IoStage::Rename => "Failed to rename: ",
            IoStage::Delete => "Failed to delete: ",
            IoStage::WriteOrder => "Failed to write order: ",
            IoStage::CheckDestination => "Failed to check destination path: ",
        }
    }
}

/// Why an entry operation could not be completed. Each variant maps onto one
/// status code the routes already return.
#[derive(Debug)]
pub enum EntryError {
    /// 400, message verbatim.
    BadRequest(String),
    /// 403, carrying the message the client sees verbatim.
    Denied(PathSafetyError),
    /// 404, message verbatim.
    NotFound(String),
    /// 409, message verbatim.
    Conflict(String),
    /// 500; the route prefixes the underlying message with the stage's prefix.
    Io(IoStage, io::Error),
}

impl EntryError {
    fn denied(message: &str) -> Self {
        EntryError::Denied(PathSafetyError {
            error: message.to_string(),
            status_code: PATH_SAFETY_STATUS_CODE,
        })
    }

    pub fn status_code(&self) -> u16 {
        match self {
            EntryError::BadRequest(_) => 400,
            EntryError::Denied(error) => error.status_code,
            EntryError::NotFound(_) => 404,
            EntryError::Conflict(_) => 409,
            EntryError::Io(_, _) => 500,
        }
    }

    /// The exact body the route sends.
    pub fn message(&self) -> String {
        match self {
            EntryError::BadRequest(message)
            | EntryError::NotFound(message)
            | EntryError::Conflict(message) => message.clone(),
            EntryError::Denied(error) => error.error.clone(),
            EntryError::Io(stage, error) => format!("{}{}", stage.message_prefix(), error),
        }
    }
}

impl From<PathSafetyError> for EntryError {
    fn from(error: PathSafetyError) -> Self {
        EntryError::Denied(error)
    }
}

/// The result of `POST /notes/page`, echoing back the path actually used —
/// which for a page is the request path with `.md` appended when it was
/// missing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedEntry {
    pub path: String,
    pub kind: CreateKind,
}

/// Everything the rename route needs after the filesystem work is done.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameOutcome {
    /// `None` when the renamed entry could not be stat'd afterwards (a race
    /// with an external delete). The route then skips the binding cascade,
    /// exactly as the TypeScript's swallowed `catch` did.
    pub kind: Option<EntryKind>,
    pub old_rel: String,
    pub new_rel: String,
    /// The destination path with `.md` appended when the source was a file.
    pub effective_new_path: String,
}

/// Everything the delete route needs for the binding cascade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteOutcome {
    pub kind: EntryKind,
    pub rel: String,
}

// ── Shared resolution ────────────────────────────────────────────────────────

/// Resolve a client path for a create/rename/delete.
///
/// The default root keeps its historic behaviour — `path.resolve` and a plain
/// containment check, so a path with `..` in it is fine as long as it lands
/// inside. A selected root goes through the strict resolver, which rejects `..`
/// outright and follows symlinks before deciding.
fn resolve_entry_path(
    notes_root: &Path,
    requested_path: &str,
    options: EntryOptions<'_>,
) -> Result<PathBuf, EntryError> {
    if !options.is_default_root {
        let safe = resolve_safe_notes_path(notes_root, requested_path, SafePathOptions::default())?;
        return Ok(safe.absolute_path);
    }
    let resolved = resolve_lexically(&resolve_lexically(notes_root).join(requested_path));
    if !is_same_or_within_directory(&resolved, notes_root) {
        return Err(EntryError::denied("Access denied: path is outside notes directory"));
    }
    Ok(resolved)
}

/// On a selected root every `.order.json` we are about to touch is itself run
/// through the resolver, so a symlinked directory cannot redirect the write.
fn guard_order_file(
    notes_root: &Path,
    directory: &Path,
    options: EntryOptions<'_>,
) -> Result<(), EntryError> {
    if options.is_default_root {
        return Ok(());
    }
    let relative = lexical_relative(notes_root, &order_file_path(directory));
    resolve_safe_notes_path(notes_root, &relative.to_string_lossy(), SafePathOptions::default())?;
    Ok(())
}

fn is_system_folder(notes_root: &Path, resolved: &Path, options: EntryOptions<'_>) -> bool {
    if !options.is_default_root {
        return false;
    }
    let root = resolve_lexically(notes_root);
    options.system_folder_names.iter().any(|name| resolved == root.join(name))
}

/// `notePath.endsWith('.md') ? notePath : notePath + '.md'` — a plain suffix
/// test, so `NOTE.MD` still gets a second extension. That is what the SPA and
/// the tree filter already agree on.
fn ensure_markdown_extension(note_path: &str) -> String {
    if note_path.ends_with(".md") {
        note_path.to_string()
    } else {
        format!("{note_path}.md")
    }
}

/// `path.relative(notesRoot, abs)` with forward slashes — the shape the chat
/// binding rows are keyed by on every platform.
fn relative_note_path(notes_root: &Path, absolute: &Path) -> String {
    lexical_relative(notes_root, absolute)
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = OsString::from(path.as_os_str());
    name.push(suffix);
    PathBuf::from(name)
}

/// `ENOENT` and `ENOTDIR` both mean "nothing is there"; a component of the path
/// being a file is still an absent destination, not a failure.
fn is_missing(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory)
}

fn ignore_missing(result: io::Result<()>) -> io::Result<()> {
    match result {
        Err(error) if is_missing(&error) => Ok(()),
        other => other,
    }
}

// ── Create ───────────────────────────────────────────────────────────────────

/// Create a notebook, section, or page.
///
/// The notes root itself is created first: the strict resolver canonicalizes
/// the root, so on a brand-new selected collection every path would otherwise
/// be refused as unresolvable.
pub fn create_entry(
    notes_root: &Path,
    requested_path: &str,
    kind: CreateKind,
    options: EntryOptions<'_>,
) -> Result<CreatedEntry, EntryError> {
    fs::create_dir_all(notes_root).map_err(|error| EntryError::Io(IoStage::Create, error))?;

    let effective_path = match kind {
        CreateKind::Page => ensure_markdown_extension(requested_path),
        CreateKind::Notebook | CreateKind::Section => requested_path.to_string(),
    };
    let resolved = resolve_entry_path(notes_root, &effective_path, options)?;

    match kind {
        CreateKind::Notebook | CreateKind::Section => {
            fs::create_dir_all(&resolved)
                .map_err(|error| EntryError::Io(IoStage::Create, error))?;
        }
        CreateKind::Page => {
            if let Some(parent) = resolved.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| EntryError::Io(IoStage::Create, error))?;
            }
            fs::write(&resolved, "").map_err(|error| EntryError::Io(IoStage::Create, error))?;
            index_sync::file_changed(notes_root, &resolved);
        }
    }

    Ok(CreatedEntry { path: effective_path, kind })
}

// ── Rename ───────────────────────────────────────────────────────────────────

/// Rename or move an entry, carrying its sidecar and its place in the parent's
/// `.order.json` with it.
pub fn rename_entry(
    notes_root: &Path,
    old_path: &str,
    new_path: &str,
    options: EntryOptions<'_>,
) -> Result<RenameOutcome, EntryError> {
    let resolved_old = resolve_entry_path(notes_root, old_path, options)?;
    if is_system_folder(notes_root, &resolved_old, options) {
        return Err(EntryError::denied("Cannot rename a system folder"));
    }

    let old_metadata = fs::metadata(&resolved_old)
        .map_err(|_| EntryError::NotFound("Source path not found".to_string()))?;

    let effective_new_path = if old_metadata.is_file() {
        ensure_markdown_extension(new_path)
    } else {
        new_path.to_string()
    };
    let resolved_new = resolve_entry_path(notes_root, &effective_new_path, options)?;

    if resolved_old == resolved_new {
        return Err(EntryError::Conflict("Destination path already exists".to_string()));
    }

    // On a case-insensitive filesystem a case-only rename makes the destination
    // look occupied, because it resolves to the source itself. Allow that alias
    // through; keep rejecting a genuinely different entry.
    let destination_exists = path_exists(&resolved_new)
        .map_err(|error| EntryError::Io(IoStage::CheckDestination, error))?;
    if destination_exists {
        let same = paths_refer_to_same_existing_entry(&resolved_old, &resolved_new)
            .map_err(|error| EntryError::Io(IoStage::CheckDestination, error))?;
        if !same {
            return Err(EntryError::Conflict("Destination path already exists".to_string()));
        }
    }

    let old_parent = parent_of(&resolved_old);
    guard_order_file(notes_root, &old_parent, options)?;

    let rename = || -> io::Result<()> {
        if let Some(parent) = resolved_new.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&resolved_old, &resolved_new)?;

        ignore_missing(fs::rename(
            sibling_with_suffix(&resolved_old, COMMENTS_SIDECAR_SUFFIX),
            sibling_with_suffix(&resolved_new, COMMENTS_SIDECAR_SUFFIX),
        ))?;

        let new_parent = parent_of(&resolved_new);
        let old_name = file_name_of(&resolved_old);
        if old_parent == new_parent {
            update_order_on_rename(&old_parent, &old_name, &file_name_of(&resolved_new))
        } else {
            // A move out of the directory: drop it from the old parent's order
            // and leave the new parent's alone, so the entry lands in the
            // fallback sort there.
            remove_from_order(&old_parent, &old_name)
        }
    };
    rename().map_err(|error| EntryError::Io(IoStage::Rename, error))?;

    // Both ends move in one batch, so the index never shows the note under two
    // paths — the removal and the insertion land in the same snapshot swap.
    if old_metadata.is_file() {
        index_sync::changed(notes_root, &[&resolved_old, &resolved_new], &[]);
    } else {
        index_sync::changed(notes_root, &[], &[&resolved_old, &resolved_new]);
    }

    Ok(RenameOutcome {
        kind: fs::metadata(&resolved_new).ok().map(|meta| {
            if meta.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            }
        }),
        old_rel: relative_note_path(notes_root, &resolved_old),
        new_rel: relative_note_path(notes_root, &resolved_new),
        effective_new_path,
    })
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.to_path_buf())
}

fn file_name_of(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Follows symlinks, like the `access()` it replaces — a dangling link at the
/// destination counts as absent, and the rename will replace it.
fn path_exists(path: &Path) -> io::Result<bool> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if is_missing(&error) => Ok(false),
        Err(error) => Err(error),
    }
}

/// Whether two paths name the same entry on disk.
///
/// Canonical paths settle it on filesystems that correct casing. macOS does
/// not: `realpath` there returns whichever casing was asked for, so a case-only
/// rename needs the device/inode comparison underneath. Windows never reaches
/// that branch — its `realpath` does return the on-disk casing, so two paths
/// that differ only by case already compared equal above, and anything left is
/// a different entry.
fn paths_refer_to_same_existing_entry(left: &Path, right: &Path) -> io::Result<bool> {
    let left_real = fs::canonicalize(left)?;
    let right_real = fs::canonicalize(right)?;
    if left_real == right_real {
        return Ok(true);
    }
    if !equal_ignoring_case(left, right) {
        return Ok(false);
    }
    same_device_and_inode(left, right)
}

fn equal_ignoring_case(left: &Path, right: &Path) -> bool {
    resolve_lexically(left).to_string_lossy().to_lowercase()
        == resolve_lexically(right).to_string_lossy().to_lowercase()
}

#[cfg(unix)]
fn same_device_and_inode(left: &Path, right: &Path) -> io::Result<bool> {
    use std::os::unix::fs::MetadataExt;
    let left_meta = fs::metadata(left)?;
    let right_meta = fs::metadata(right)?;
    Ok(left_meta.dev() == right_meta.dev() && left_meta.ino() == right_meta.ino())
}

#[cfg(not(unix))]
fn same_device_and_inode(left: &Path, right: &Path) -> io::Result<bool> {
    // Both must still exist for the answer to mean anything, and the canonical
    // comparison above has already decided the case-alias question here.
    fs::metadata(left)?;
    fs::metadata(right)?;
    Ok(false)
}

// ── Delete ───────────────────────────────────────────────────────────────────

/// Delete an entry, its comments sidecar, and its place in the parent's order.
pub fn delete_entry(
    notes_root: &Path,
    requested_path: &str,
    options: EntryOptions<'_>,
) -> Result<DeleteOutcome, EntryError> {
    let resolved = resolve_entry_path(notes_root, requested_path, options)?;
    if is_system_folder(notes_root, &resolved, options) {
        return Err(EntryError::denied("Cannot delete a system folder"));
    }

    let parent = parent_of(&resolved);
    guard_order_file(notes_root, &parent, options)?;

    let metadata =
        fs::metadata(&resolved).map_err(|_| EntryError::NotFound("Path not found".to_string()))?;
    let kind = if metadata.is_dir() { EntryKind::Dir } else { EntryKind::File };

    let remove = || -> io::Result<()> {
        if kind == EntryKind::Dir {
            fs::remove_dir_all(&resolved)?;
        } else {
            fs::remove_file(&resolved)?;
            ignore_missing(fs::remove_file(sibling_with_suffix(
                &resolved,
                COMMENTS_SIDECAR_SUFFIX,
            )))?;
        }
        remove_from_order(&parent, &file_name_of(&resolved))
    };
    remove().map_err(|error| EntryError::Io(IoStage::Delete, error))?;

    if kind == EntryKind::Dir {
        index_sync::directory_changed(notes_root, &resolved);
    } else {
        index_sync::file_changed(notes_root, &resolved);
    }

    Ok(DeleteOutcome { kind, rel: relative_note_path(notes_root, &resolved) })
}

// ── Order ────────────────────────────────────────────────────────────────────

/// Persist a directory's custom sibling order.
///
/// `parent_path` may be empty, meaning the root itself.
pub fn write_order(
    notes_root: &Path,
    parent_path: &str,
    order: &[String],
    options: EntryOptions<'_>,
) -> Result<(), EntryError> {
    let target_dir = if !options.is_default_root {
        resolve_safe_notes_path(
            notes_root,
            parent_path,
            SafePathOptions { allow_root: true, ..SafePathOptions::default() },
        )?
        .absolute_path
    } else {
        let root = resolve_lexically(notes_root);
        let resolved = if parent_path.is_empty() {
            root.clone()
        } else {
            resolve_lexically(&root.join(parent_path))
        };
        if !is_same_or_within_directory(&resolved, &root) {
            return Err(EntryError::denied("Access denied: parentPath is outside notes directory"));
        }
        resolved
    };

    guard_order_file(notes_root, &target_dir, options)?;

    let metadata = fs::metadata(&target_dir)
        .map_err(|_| EntryError::NotFound("parentPath directory not found".to_string()))?;
    if !metadata.is_dir() {
        return Err(EntryError::BadRequest("parentPath must be a directory".to_string()));
    }

    write_order_file(&target_dir, order).map_err(|error| EntryError::Io(IoStage::WriteOrder, error))
}
