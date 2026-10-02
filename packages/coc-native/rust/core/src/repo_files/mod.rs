//! The repository-file backend behind the Explorer: path containment and blob
//! I/O for one registered repository root.
//!
//! Workspace resolution stays in Node; everything here takes an already
//! resolved root. Error messages are part of the REST contract — the routes
//! branch on `Path traversal` and `not found` — so they must not be reworded.

mod blob;
mod listing;

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use crate::notes_fs::resolve_lexically;

pub use blob::{mime_type, read_blob, write_blob, Blob, BlobEncoding, MAX_BLOB_SIZE};
pub use listing::{list_directory, list_files, locale_compare, TreeEntry};

#[derive(Debug)]
pub enum RepoFilesError {
    /// The request path escapes the repository root.
    PathTraversal,
    /// The target does not exist; carries the request path.
    NotFound(String),
    /// The target exists but is not a regular file.
    NotAFile(String),
    /// A listing target does not exist; carries the request path.
    PathMissing(String),
    /// A listing target exists but is not a directory.
    NotADirectory(String),
    /// The target exceeds [`MAX_BLOB_SIZE`].
    TooLarge(String),
    Io(io::Error),
}

impl fmt::Display for RepoFilesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PathTraversal => f.write_str("Path traversal detected: path escapes repo root"),
            Self::NotFound(path) => write!(f, "File not found: {path}"),
            Self::NotAFile(path) => write!(f, "Not a file: {path}"),
            Self::PathMissing(path) => write!(f, "Path does not exist: {path}"),
            Self::NotADirectory(path) => write!(f, "Not a directory: {path}"),
            Self::TooLarge(path) => {
                write!(f, "File exceeds maximum size of {MAX_BLOB_SIZE} bytes: {path}")
            }
            Self::Io(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for RepoFilesError {}

impl From<io::Error> for RepoFilesError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// `path.resolve(root, relative)` with leading separators stripped first, so
/// `/src` means `<root>/src` rather than the filesystem root. Containment is a
/// lexical, case-sensitive check; symlinks inside the root are followed.
pub fn resolve_in_root(root: &Path, relative: &str) -> Result<PathBuf, RepoFilesError> {
    let stripped = relative.trim_start_matches(['/', '\\']);
    let root = resolve_lexically(root);
    let target = resolve_lexically(&root.join(if stripped.is_empty() { "." } else { stripped }));
    if target.starts_with(&root) {
        Ok(target)
    } else {
        Err(RepoFilesError::PathTraversal)
    }
}
