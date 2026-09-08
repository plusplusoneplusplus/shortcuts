//! N-API bindings for the Notes filesystem core: `AsyncTask` wrappers around
//! `coc_native_core::notes_fs`.
//!
//! Every one of these touches the filesystem, so every one runs on a libuv
//! worker. The marshalling has two jobs beyond moving fields across:
//!
//! - **HTTP status codes survive the crossing.** The core's error enums carry
//!   the exact 400/403/404/409/500 body the routes already return, and the SPA
//!   matches on some of those strings. N-API can only carry a `Status` and a
//!   reason, so the reason is prefixed with `[notes-fs:<code>] ` and the
//!   TypeScript capability parses it back into `{ statusCode, message }`. An
//!   unprefixed failure decodes as a 500 with its message intact.
//! - **Result unions become discriminated objects.** `#[napi(object)]` has no
//!   union, so an autosave answers `{ status: 'written' | 'conflict', … }` and
//!   the safe-path resolver answers the same shape the TypeScript helper
//!   returned — success fields or `{ error, statusCode }` — because its callers
//!   branch on the result rather than catching.

use std::path::PathBuf;

use coc_native_core::notes_fs::{
    self, ContentError, ContentOptions, CreateKind, CreatedEntry as CoreCreatedEntry,
    DeleteOutcome as CoreDeleteOutcome, EntryError, EntryOptions, NoteContent as CoreNoteContent,
    NotesTree as CoreNotesTree, PathSafetyError, RenameOutcome as CoreRenameOutcome,
    SafePathOptions, TreeEntry as CoreTreeEntry, TreeOptions, WriteOutcome,
};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;
use napi_derive::napi;

// ── Error encoding ───────────────────────────────────────────────────────────

/// Encode one typed failure as an N-API error whose reason carries the status.
///
/// The prefix is machine-readable on purpose: `src/notes-fs.ts` strips it and
/// the route answers `res.status(code).json({ error: message })`, which is byte
/// for byte what the TypeScript implementation sent.
fn typed_error(status_code: u16, message: String) -> Error {
    Error::new(Status::GenericFailure, format!("[notes-fs:{status_code}] {message}"))
}

fn content_error(error: ContentError) -> Error {
    match error {
        ContentError::Denied(denied) => typed_error(denied.status_code, denied.error),
        ContentError::NotFound => typed_error(404, "File not found".to_string()),
        ContentError::Io(io) => typed_error(500, io.to_string()),
    }
}

fn entry_error(error: EntryError) -> Error {
    typed_error(error.status_code(), error.message())
}

// ── Options ──────────────────────────────────────────────────────────────────

/// Which regime a tree scan runs under.
#[napi(object)]
pub struct NotesTreeOptions {
    /// The managed default root trusts its own contents. Any other root skips
    /// symlinks and routes even the `.order.json` read through containment.
    pub is_default_root: bool,
}

/// Which regime a content read or write runs under.
#[napi(object)]
pub struct NotesContentOptions {
    /// The managed default root, with the absolute-path escape hatch.
    pub is_default_root: bool,
    /// Directories an absolute path may live under when `isDefaultRoot`.
    /// Computed in Node, which knows the workspace data dir, the home
    /// directory and the workspace root. Ignored for a selected root.
    pub allowed_prefixes: Option<Vec<String>>,
}

/// Which regime a create, rename, delete or order write runs under.
#[napi(object)]
pub struct NotesEntryOptions {
    /// Only the managed default root protects system folders and resolves with
    /// plain containment instead of the strict resolver.
    pub is_default_root: bool,
    /// Folder names the default root refuses to rename or delete. Passed in so
    /// `SYSTEM_FOLDER_NAMES` stays a single list in TypeScript.
    pub system_folder_names: Option<Vec<String>>,
}

/// The second argument of the TypeScript `resolveSafeNotesPath` helper.
#[napi(object)]
pub struct NotesSafePathOptions {
    /// Permit the empty path, meaning the root directory itself.
    pub allow_root: Option<bool>,
    /// Reject a path with any symlink between the root and the target.
    pub reject_symlinks: Option<bool>,
}

// ── Results ──────────────────────────────────────────────────────────────────

/// One entry in the Notes tree, in raw readdir order.
///
/// Nothing here is sorted: sibling order is `localeCompare` plus `applyOrder`,
/// and both stay in Node so the ICU collation the SPA has always shown does not
/// drift into a Rust reimplementation.
#[napi(object)]
pub struct NotesTreeEntry {
    pub name: String,
    /// Root-relative path with `/` separators on every platform.
    pub path: String,
    /// `notebook`, `section` or `page`.
    pub kind: String,
    /// ISO-8601 mtime, present only for a page.
    pub last_modified_at: Option<String>,
    /// Present, possibly empty, exactly for a directory.
    pub children: Option<Vec<NotesTreeEntry>>,
    /// The directory's `.order.json` list. Present exactly for a directory.
    pub explicit_order: Option<Vec<String>>,
}

/// The scan of one Notes root.
#[napi(object)]
pub struct NotesTreeResult {
    pub entries: Vec<NotesTreeEntry>,
    /// The root's own `.order.json` list.
    pub explicit_order: Vec<String>,
}

/// A note's text and the mtime the client sends back as its optimistic lock.
#[napi(object)]
pub struct NotesFileContent {
    pub content: String,
    pub mtime_ms: f64,
}

/// The two ways an autosave can end, as one object.
#[napi(object)]
pub struct NotesWriteResult {
    /// `written` or `conflict`.
    pub status: String,
    /// The new mtime, on `written`.
    pub mtime_ms: Option<f64>,
    /// The mtime on disk, on `conflict`.
    pub current_mtime: Option<f64>,
    /// The content on disk, on `conflict`, so the SPA can offer a merge.
    pub current_content: Option<String>,
}

/// The path a create actually used — for a page, with `.md` appended.
#[napi(object)]
pub struct NotesCreatedEntry {
    pub path: String,
    /// `notebook`, `section` or `page`.
    pub kind: String,
}

/// Everything the rename route needs for the chat-binding cascade.
#[napi(object)]
pub struct NotesRenameResult {
    /// `file` or `dir`, absent when the renamed entry could not be stat'd
    /// afterwards. The route then skips the cascade, as it always has.
    pub kind: Option<String>,
    pub old_rel: String,
    pub new_rel: String,
    /// The destination with `.md` appended when the source was a file.
    pub effective_new_path: String,
}

/// Everything the delete route needs for the chat-binding cascade.
#[napi(object)]
pub struct NotesDeleteResult {
    /// `file` or `dir`.
    pub kind: String,
    pub rel: String,
}

/// Success fields or `{ error, statusCode }` — the union the TypeScript helper
/// returned, kept intact because every caller branches rather than catches.
#[napi(object)]
pub struct NotesSafePathResult {
    /// Lexical path to use for the filesystem operation, on success.
    pub absolute_path: Option<String>,
    /// Forward-slash path relative to the root, on success.
    pub relative_path: Option<String>,
    /// The 403 body, on refusal.
    pub error: Option<String>,
    /// Always 403 when `error` is set.
    pub status_code: Option<u16>,
}

// ── Conversions ──────────────────────────────────────────────────────────────

impl From<CoreTreeEntry> for NotesTreeEntry {
    fn from(entry: CoreTreeEntry) -> Self {
        Self {
            name: entry.name,
            path: entry.path,
            kind: entry.kind.as_str().to_string(),
            last_modified_at: entry.last_modified_at,
            children: entry
                .children
                .map(|children| children.into_iter().map(NotesTreeEntry::from).collect()),
            explicit_order: entry.explicit_order,
        }
    }
}

impl From<CoreNotesTree> for NotesTreeResult {
    fn from(tree: CoreNotesTree) -> Self {
        Self {
            entries: tree.entries.into_iter().map(NotesTreeEntry::from).collect(),
            explicit_order: tree.explicit_order,
        }
    }
}

impl From<CoreNoteContent> for NotesFileContent {
    fn from(content: CoreNoteContent) -> Self {
        Self { content: content.content, mtime_ms: content.mtime_ms }
    }
}

impl From<WriteOutcome> for NotesWriteResult {
    fn from(outcome: WriteOutcome) -> Self {
        match outcome {
            WriteOutcome::Written { mtime_ms } => Self {
                status: "written".to_string(),
                mtime_ms: Some(mtime_ms),
                current_mtime: None,
                current_content: None,
            },
            WriteOutcome::Conflict { current_mtime, current_content } => Self {
                status: "conflict".to_string(),
                mtime_ms: None,
                current_mtime: Some(current_mtime),
                current_content: Some(current_content),
            },
        }
    }
}

impl From<CoreCreatedEntry> for NotesCreatedEntry {
    fn from(entry: CoreCreatedEntry) -> Self {
        Self { path: entry.path, kind: entry.kind.as_str().to_string() }
    }
}

impl From<CoreRenameOutcome> for NotesRenameResult {
    fn from(outcome: CoreRenameOutcome) -> Self {
        Self {
            kind: outcome.kind.map(|kind| kind.as_str().to_string()),
            old_rel: outcome.old_rel,
            new_rel: outcome.new_rel,
            effective_new_path: outcome.effective_new_path,
        }
    }
}

impl From<CoreDeleteOutcome> for NotesDeleteResult {
    fn from(outcome: CoreDeleteOutcome) -> Self {
        Self { kind: outcome.kind.as_str().to_string(), rel: outcome.rel }
    }
}

impl From<PathSafetyError> for NotesSafePathResult {
    fn from(error: PathSafetyError) -> Self {
        Self {
            absolute_path: None,
            relative_path: None,
            error: Some(error.error),
            status_code: Some(error.status_code),
        }
    }
}

fn allowed_prefixes(options: &NotesContentOptions) -> Vec<PathBuf> {
    options
        .allowed_prefixes
        .as_ref()
        .map(|values| values.iter().map(PathBuf::from).collect())
        .unwrap_or_default()
}

fn system_folder_names(options: &NotesEntryOptions) -> Vec<String> {
    options.system_folder_names.clone().unwrap_or_default()
}

// ── Tasks ────────────────────────────────────────────────────────────────────

pub struct NotesTreeTask {
    root: PathBuf,
    options: TreeOptions,
}

impl Task for NotesTreeTask {
    type Output = NotesTreeResult;
    type JsValue = NotesTreeResult;

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::scan_notes_tree(&self.root, self.options).map(NotesTreeResult::from).map_err(
            |error| {
                typed_error(
                    500,
                    format!("Failed to read notes at {}: {error}", self.root.display()),
                )
            },
        )
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct ReadNoteTask {
    root: PathBuf,
    path: String,
    is_default_root: bool,
    allowed_prefixes: Vec<PathBuf>,
}

impl Task for ReadNoteTask {
    type Output = NotesFileContent;
    type JsValue = NotesFileContent;

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::read_note(
            &self.root,
            &self.path,
            ContentOptions {
                is_default_root: self.is_default_root,
                allowed_prefixes: &self.allowed_prefixes,
            },
        )
        .map(NotesFileContent::from)
        .map_err(content_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct WriteNoteTask {
    root: PathBuf,
    path: String,
    content: String,
    expected_mtime: Option<f64>,
    is_default_root: bool,
    allowed_prefixes: Vec<PathBuf>,
}

impl Task for WriteNoteTask {
    type Output = NotesWriteResult;
    type JsValue = NotesWriteResult;

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::write_note(
            &self.root,
            &self.path,
            &self.content,
            self.expected_mtime,
            ContentOptions {
                is_default_root: self.is_default_root,
                allowed_prefixes: &self.allowed_prefixes,
            },
        )
        .map(NotesWriteResult::from)
        .map_err(content_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct CreateEntryTask {
    root: PathBuf,
    path: String,
    kind: CreateKind,
    is_default_root: bool,
    system_folder_names: Vec<String>,
}

impl Task for CreateEntryTask {
    type Output = NotesCreatedEntry;
    type JsValue = NotesCreatedEntry;

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::create_entry(
            &self.root,
            &self.path,
            self.kind,
            EntryOptions {
                is_default_root: self.is_default_root,
                system_folder_names: &self.system_folder_names,
            },
        )
        .map(NotesCreatedEntry::from)
        .map_err(entry_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct RenameEntryTask {
    root: PathBuf,
    old_path: String,
    new_path: String,
    is_default_root: bool,
    system_folder_names: Vec<String>,
}

impl Task for RenameEntryTask {
    type Output = NotesRenameResult;
    type JsValue = NotesRenameResult;

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::rename_entry(
            &self.root,
            &self.old_path,
            &self.new_path,
            EntryOptions {
                is_default_root: self.is_default_root,
                system_folder_names: &self.system_folder_names,
            },
        )
        .map(NotesRenameResult::from)
        .map_err(entry_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct DeleteEntryTask {
    root: PathBuf,
    path: String,
    is_default_root: bool,
    system_folder_names: Vec<String>,
}

impl Task for DeleteEntryTask {
    type Output = NotesDeleteResult;
    type JsValue = NotesDeleteResult;

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::delete_entry(
            &self.root,
            &self.path,
            EntryOptions {
                is_default_root: self.is_default_root,
                system_folder_names: &self.system_folder_names,
            },
        )
        .map(NotesDeleteResult::from)
        .map_err(entry_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

pub struct WriteOrderTask {
    root: PathBuf,
    parent_path: String,
    order: Vec<String>,
    is_default_root: bool,
    system_folder_names: Vec<String>,
}

impl Task for WriteOrderTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        notes_fs::write_order(
            &self.root,
            &self.parent_path,
            &self.order,
            EntryOptions {
                is_default_root: self.is_default_root,
                system_folder_names: &self.system_folder_names,
            },
        )
        .map_err(entry_error)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

pub struct ResolveSafeNotesPathTask {
    root: PathBuf,
    path: String,
    options: SafePathOptions,
}

impl Task for ResolveSafeNotesPathTask {
    type Output = NotesSafePathResult;
    type JsValue = NotesSafePathResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(match notes_fs::resolve_safe_notes_path(&self.root, &self.path, self.options) {
            Ok(resolved) => NotesSafePathResult {
                absolute_path: Some(resolved.absolute_path.to_string_lossy().into_owned()),
                relative_path: Some(resolved.relative_path),
                error: None,
                status_code: None,
            },
            Err(error) => error.into(),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

// ── Exports ──────────────────────────────────────────────────────────────────

/// Scan a Notes root recursively, unsorted, with each directory's
/// `.order.json` alongside its children.
#[napi(ts_return_type = "Promise<NotesTreeResult>")]
pub fn notes_tree(root: String, options: NotesTreeOptions) -> AsyncTask<NotesTreeTask> {
    AsyncTask::new(NotesTreeTask {
        root: PathBuf::from(root),
        options: TreeOptions { is_default_root: options.is_default_root },
    })
}

/// Read one note's text and mtime. Rejects with a 404 when it is missing.
#[napi(ts_return_type = "Promise<NotesFileContent>")]
pub fn read_note(
    root: String,
    path: String,
    options: NotesContentOptions,
) -> AsyncTask<ReadNoteTask> {
    let prefixes = allowed_prefixes(&options);
    AsyncTask::new(ReadNoteTask {
        root: PathBuf::from(root),
        path,
        is_default_root: options.is_default_root,
        allowed_prefixes: prefixes,
    })
}

/// Autosave one note through a `.tmp` sibling and a rename, so no reader ever
/// observes a half-written file. Resolves with a `conflict` result rather than
/// rejecting when `expectedMtime` no longer matches disk.
#[napi(ts_return_type = "Promise<NotesWriteResult>")]
pub fn write_note(
    root: String,
    path: String,
    content: String,
    expected_mtime: Option<f64>,
    options: NotesContentOptions,
) -> AsyncTask<WriteNoteTask> {
    let prefixes = allowed_prefixes(&options);
    AsyncTask::new(WriteNoteTask {
        root: PathBuf::from(root),
        path,
        content,
        expected_mtime,
        is_default_root: options.is_default_root,
        allowed_prefixes: prefixes,
    })
}

/// Create a notebook, section, or page. `kind` is `notebook`, `section` or
/// `page`; a page gets `.md` appended when it is missing.
#[napi(ts_return_type = "Promise<NotesCreatedEntry>")]
pub fn create_notes_entry(
    root: String,
    path: String,
    kind: String,
    options: NotesEntryOptions,
) -> Result<AsyncTask<CreateEntryTask>> {
    let parsed = CreateKind::from_name(&kind)
        .ok_or_else(|| typed_error(400, format!("Invalid entry type: {kind}")))?;
    let names = system_folder_names(&options);
    Ok(AsyncTask::new(CreateEntryTask {
        root: PathBuf::from(root),
        path,
        kind: parsed,
        is_default_root: options.is_default_root,
        system_folder_names: names,
    }))
}

/// Rename or move an entry, carrying its `.comments.json` sidecar and its place
/// in the parent's `.order.json` with it.
#[napi(ts_return_type = "Promise<NotesRenameResult>")]
pub fn rename_notes_entry(
    root: String,
    old_path: String,
    new_path: String,
    options: NotesEntryOptions,
) -> AsyncTask<RenameEntryTask> {
    let names = system_folder_names(&options);
    AsyncTask::new(RenameEntryTask {
        root: PathBuf::from(root),
        old_path,
        new_path,
        is_default_root: options.is_default_root,
        system_folder_names: names,
    })
}

/// Delete an entry, its comments sidecar, and its place in the parent's order.
#[napi(ts_return_type = "Promise<NotesDeleteResult>")]
pub fn delete_notes_entry(
    root: String,
    path: String,
    options: NotesEntryOptions,
) -> AsyncTask<DeleteEntryTask> {
    let names = system_folder_names(&options);
    AsyncTask::new(DeleteEntryTask {
        root: PathBuf::from(root),
        path,
        is_default_root: options.is_default_root,
        system_folder_names: names,
    })
}

/// Persist one directory's custom sibling order. An empty `parentPath` means
/// the root itself.
#[napi(ts_return_type = "Promise<void>")]
pub fn write_notes_order(
    root: String,
    parent_path: String,
    order: Vec<String>,
    options: NotesEntryOptions,
) -> AsyncTask<WriteOrderTask> {
    let names = system_folder_names(&options);
    AsyncTask::new(WriteOrderTask {
        root: PathBuf::from(root),
        parent_path,
        order,
        is_default_root: options.is_default_root,
        system_folder_names: names,
    })
}

/// Resolve a client path under one selected non-default Notes root.
///
/// Resolves with the union rather than rejecting: this is the containment check
/// every Notes route makes before touching a file, and its callers branch on
/// the result.
#[napi(ts_return_type = "Promise<NotesSafePathResult>")]
pub fn resolve_safe_notes_path(
    root: String,
    path: String,
    options: Option<NotesSafePathOptions>,
) -> AsyncTask<ResolveSafeNotesPathTask> {
    let options =
        options.unwrap_or(NotesSafePathOptions { allow_root: None, reject_symlinks: None });
    AsyncTask::new(ResolveSafeNotesPathTask {
        root: PathBuf::from(root),
        path,
        options: SafePathOptions {
            allow_root: options.allow_root.unwrap_or(false),
            reject_symlinks: options.reject_symlinks.unwrap_or(false),
        },
    })
}
