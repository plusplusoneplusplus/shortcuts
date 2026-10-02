//! N-API bindings for the repository-file backend: one `RepoFiles` handle per
//! resolved repository root, with every filesystem call on a libuv worker.

use std::path::PathBuf;

use coc_native_core::repo_files::{
    list_directory, list_files, read_blob, replace_content, write_blob, Blob, FileListing,
    ReplaceFile as RepoReplaceFile, ReplaceOptions, ReplaceSummary, RepoFilesError, TreeListing,
};
use napi::bindgen_prelude::{AsyncTask, Error, Status};
use napi_derive::napi;

use crate::task::{blocking, Blocking};

// Results and replace targets are core's own types (core's `napi` feature
// derives their JS shape); only option bags with optional fields live here.

/// Listing options; `maxEntries` caps each directory (or the file walk).
#[napi(object)]
pub struct RepoListOptions {
    pub show_ignored: bool,
    pub max_entries: u32,
    /// Directory levels to list; 1 when omitted.
    pub depth: Option<u32>,
}

#[napi(object)]
pub struct RepoReplaceOptions {
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub regex: Option<bool>,
    pub preserve_case: Option<bool>,
}

/// A path escaping the root is the caller's mistake (`InvalidArg`); the
/// message is the route contract either way.
fn to_napi_error(error: RepoFilesError) -> Error {
    let status = match error {
        RepoFilesError::PathTraversal | RepoFilesError::InvalidArg(_) => Status::InvalidArg,
        _ => Status::GenericFailure,
    };
    Error::new(status, error.to_string())
}

/// The repository-file backend for one resolved root.
#[napi]
pub struct RepoFiles {
    root: PathBuf,
}

/// Open the backend for an already-resolved repository root.
#[napi]
pub fn open_repo_files(root: String) -> RepoFiles {
    RepoFiles { root: PathBuf::from(root) }
}

#[napi]
impl RepoFiles {
    /// List a directory: dirs first, locale order, per-directory cap.
    #[napi(ts_return_type = "Promise<RepoTreeListing>")]
    pub fn list_directory(
        &self,
        path: String,
        options: RepoListOptions,
    ) -> AsyncTask<Blocking<TreeListing>> {
        let root = self.root.clone();
        blocking(move || {
            let (o, depth) = (&options, options.depth.unwrap_or(1));
            list_directory(&root, &path, depth, o.show_ignored, o.max_entries as usize)
                .map_err(to_napi_error)
        })
    }

    /// Every file under a subdirectory, depth-first in locale order.
    #[napi(ts_return_type = "Promise<RepoFileListing>")]
    pub fn list_files(
        &self,
        path: String,
        options: RepoListOptions,
    ) -> AsyncTask<Blocking<FileListing>> {
        let root = self.root.clone();
        blocking(move || {
            list_files(&root, &path, options.show_ignored, options.max_entries as usize)
                .map_err(to_napi_error)
        })
    }

    /// Read a file: text or base64, MIME type, 1 MiB cap.
    #[napi(ts_return_type = "Promise<RepoBlob>")]
    pub fn read_blob(&self, path: String) -> AsyncTask<Blocking<Blob>> {
        let root = self.root.clone();
        blocking(move || read_blob(&root, &path).map_err(to_napi_error))
    }

    /// Write text to a file, creating missing parent directories.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn write_blob(&self, path: String, content: String) -> AsyncTask<Blocking<()>> {
        let root = self.root.clone();
        blocking(move || write_blob(&root, &path, &content).map_err(to_napi_error))
    }

    /// Rewrite exactly the supplied spans; stale files are skipped whole and
    /// reported. A bad query rejects with `InvalidArg` before any write.
    #[napi(ts_return_type = "Promise<RepoReplaceResult>")]
    pub fn replace_content(
        &self,
        query: String,
        replacement: String,
        files: Vec<RepoReplaceFile>,
        options: Option<RepoReplaceOptions>,
    ) -> AsyncTask<Blocking<ReplaceSummary>> {
        let root = self.root.clone();
        let flag = |get: fn(&RepoReplaceOptions) -> Option<bool>| {
            options.as_ref().and_then(get).unwrap_or(false)
        };
        let options = ReplaceOptions {
            case_sensitive: flag(|o| o.case_sensitive),
            whole_word: flag(|o| o.whole_word),
            regex: flag(|o| o.regex),
            preserve_case: flag(|o| o.preserve_case),
        };
        blocking(move || {
            replace_content(&root, &query, &replacement, &files, options).map_err(to_napi_error)
        })
    }
}
