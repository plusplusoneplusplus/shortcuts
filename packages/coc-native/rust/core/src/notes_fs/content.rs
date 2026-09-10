//! Reading and autosaving a single note.
//!
//! A port of the `GET /notes/content` body in `notes-read-handler.ts` and the
//! `PUT /notes/content` body in `notes-write-handler.ts`.
//!
//! The two routes share their path resolution, and it is not the same rule as
//! the rest of the Notes API: the **default** managed root accepts absolute
//! paths (the scratchpad and session-state files the SPA edits live outside the
//! notes tree) and checks them against an allow-list of prefixes the caller
//! computes — workspace data dir, `~/.copilot`, the workspace root. A
//! **selected** root has no such escape hatch and goes through
//! [`resolve_safe_notes_path`].

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::index_sync;
use super::path_safety::{
    is_absolute_request, is_same_or_within_directory, lexical_relative, resolve_lexically,
    resolve_safe_notes_path, PathSafetyError, SafePathOptions, PATH_SAFETY_STATUS_CODE,
};
use super::timestamp::{js_round, unix_millis_f64};

/// Which regime the request runs under, and what the default root is allowed to
/// reach.
#[derive(Debug, Clone, Copy)]
pub struct ContentOptions<'a> {
    /// The managed default root, with the absolute-path escape hatch.
    pub is_default_root: bool,
    /// Directories an absolute (or root-relative) path may live under when
    /// `is_default_root`. Computed in Node — it knows the data dir, the home
    /// directory and the workspace root. Ignored for a selected root.
    pub allowed_prefixes: &'a [PathBuf],
}

/// Why a content operation could not be completed. The variants map one-to-one
/// onto the status codes the routes already return.
#[derive(Debug)]
pub enum ContentError {
    /// 403, carrying the message the client sees verbatim.
    Denied(PathSafetyError),
    /// 404 `File not found`.
    NotFound,
    /// 500; the route prefixes the message with `Failed to read/write file: `.
    Io(io::Error),
}

impl ContentError {
    fn denied(message: &str) -> Self {
        ContentError::Denied(PathSafetyError {
            error: message.to_string(),
            status_code: PATH_SAFETY_STATUS_CODE,
        })
    }
}

impl From<PathSafetyError> for ContentError {
    fn from(error: PathSafetyError) -> Self {
        ContentError::Denied(error)
    }
}

/// A note as the read route returns it.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteContent {
    pub content: String,
    pub mtime_ms: f64,
}

/// The two ways an autosave can end.
#[derive(Debug, Clone, PartialEq)]
pub enum WriteOutcome {
    Written {
        mtime_ms: f64,
    },
    /// Optimistic-locking failure: the file moved under the client. The route
    /// answers 409 with both fields so the SPA can offer a merge.
    Conflict {
        current_mtime: f64,
        current_content: String,
    },
}

/// The message the default root returns when a path lands outside every
/// allowed prefix. It says *workspace data directory* rather than naming the
/// prefix that failed, and that wording is what the SPA matches on.
const OUTSIDE_WORKSPACE: &str = "Access denied: path is outside workspace data directory";

/// Resolve a client-supplied content path to the file to touch.
///
/// Shared by both routes deliberately: a path that reads must be the same path
/// that writes, or the conflict check would guard a different file than the one
/// the rename lands on.
pub fn resolve_content_path(
    notes_root: &Path,
    requested_path: &str,
    options: ContentOptions<'_>,
) -> Result<PathBuf, ContentError> {
    let resolved = if options.is_default_root && is_absolute_request(requested_path) {
        resolve_lexically(Path::new(requested_path))
    } else if !options.is_default_root {
        resolve_safe_notes_path(notes_root, requested_path, SafePathOptions::default())?
            .absolute_path
    } else {
        resolve_lexically(&resolve_lexically(notes_root).join(requested_path))
    };

    if options.is_default_root && !is_allowed_path(&resolved, options.allowed_prefixes) {
        return Err(ContentError::denied(OUTSIDE_WORKSPACE));
    }
    Ok(resolved)
}

fn is_allowed_path(resolved: &Path, allowed_prefixes: &[PathBuf]) -> bool {
    allowed_prefixes.iter().any(|prefix| is_same_or_within_directory(resolved, prefix))
}

/// Read a note.
///
/// Invalid UTF-8 is replaced rather than rejected, because Node's
/// `readFile(path, 'utf-8')` substitutes U+FFFD and the SPA has always been
/// able to open a mis-encoded file (and re-save it clean).
pub fn read_note(
    notes_root: &Path,
    requested_path: &str,
    options: ContentOptions<'_>,
) -> Result<NoteContent, ContentError> {
    let resolved = resolve_content_path(notes_root, requested_path, options)?;

    let bytes = fs::read(&resolved).map_err(read_error)?;
    let metadata = fs::metadata(&resolved).map_err(read_error)?;
    Ok(NoteContent {
        content: String::from_utf8_lossy(&bytes).into_owned(),
        mtime_ms: modified_millis(&metadata),
    })
}

/// Autosave a note.
///
/// `expected_mtime` is the optimistic lock. Both sides are rounded to whole
/// milliseconds before comparing: the client got its value as a JSON number and
/// filesystems disagree about sub-millisecond precision, so an exact comparison
/// would report phantom conflicts. A missing file is never a conflict — that is
/// the first save of a new note.
///
/// The write itself goes to a `.tmp` sibling and is renamed into place, so a
/// reader (the search indexer, the git autocommit, another tab) never observes
/// a half-written note.
pub fn write_note(
    notes_root: &Path,
    requested_path: &str,
    content: &str,
    expected_mtime: Option<f64>,
    options: ContentOptions<'_>,
) -> Result<WriteOutcome, ContentError> {
    let resolved = resolve_content_path(notes_root, requested_path, options)?;

    if let Some(expected) = expected_mtime {
        match fs::metadata(&resolved) {
            Ok(metadata) => {
                let current = modified_millis(&metadata);
                if js_round(current) != js_round(expected) {
                    let bytes = fs::read(&resolved).map_err(ContentError::Io)?;
                    return Ok(WriteOutcome::Conflict {
                        current_mtime: current,
                        current_content: String::from_utf8_lossy(&bytes).into_owned(),
                    });
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(ContentError::Io(error)),
        }
    }

    let temp_path = temp_sibling(notes_root, &resolved, options)?;
    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(ContentError::Io)?;
    }
    fs::write(&temp_path, content).map_err(ContentError::Io)?;
    fs::rename(&temp_path, &resolved).map_err(ContentError::Io)?;

    let metadata = fs::metadata(&resolved).map_err(ContentError::Io)?;
    index_sync::file_changed(notes_root, &resolved);
    Ok(WriteOutcome::Written { mtime_ms: modified_millis(&metadata) })
}

/// `<resolved>.tmp`. On a selected root the concatenated name is re-checked,
/// because the suffix is glued onto the string: if the target were a symlinked
/// directory entry the sibling could land somewhere the original never could.
fn temp_sibling(
    notes_root: &Path,
    resolved: &Path,
    options: ContentOptions<'_>,
) -> Result<PathBuf, ContentError> {
    let mut name = OsString::from(resolved.as_os_str());
    name.push(".tmp");
    let temp_path = PathBuf::from(name);
    if options.is_default_root {
        return Ok(temp_path);
    }
    let relative = lexical_relative(notes_root, &temp_path);
    let safe = resolve_safe_notes_path(
        notes_root,
        &relative.to_string_lossy(),
        SafePathOptions::default(),
    )?;
    Ok(safe.absolute_path)
}

fn modified_millis(metadata: &fs::Metadata) -> f64 {
    metadata.modified().map(unix_millis_f64).unwrap_or(0.0)
}

/// Only a missing file is a 404. Everything else — `EISDIR`, `ENOTDIR`,
/// permissions — is a 500, matching the read route's single `ENOENT` test.
fn read_error(error: io::Error) -> ContentError {
    if error.kind() == io::ErrorKind::NotFound {
        return ContentError::NotFound;
    }
    ContentError::Io(error)
}
