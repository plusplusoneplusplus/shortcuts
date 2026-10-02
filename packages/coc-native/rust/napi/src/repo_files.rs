//! N-API bindings for the repository-file backend: one `RepoFiles` handle per
//! resolved repository root, with every filesystem call on a libuv worker.

use std::path::PathBuf;

use coc_native_core::repo_files::{
    list_directory, list_files, read_blob, replace_content, write_blob, BlobEncoding, ReplaceFile,
    ReplaceOptions, ReplaceTarget, RepoFilesError, TreeEntry,
};
use napi::bindgen_prelude::{AsyncTask, Error, Status};
use napi_derive::napi;

use crate::task::{blocking, Blocking};

/// File content as the blob route returns it.
#[napi(object)]
pub struct RepoBlob {
    /// UTF-8 text, or base64 when the file looks binary.
    pub content: String,
    #[napi(ts_type = "'utf-8' | 'base64'")]
    pub encoding: String,
    pub mime_type: String,
}

/// One row of a directory listing.
#[napi(object, js_name = "RepoTreeEntry")]
pub struct JsTreeEntry {
    pub name: String,
    #[napi(js_name = "type", ts_type = "'dir' | 'file'")]
    pub kind: String,
    pub size: Option<f64>,
    pub path: String,
    pub children: Option<Vec<JsTreeEntry>>,
}

impl From<TreeEntry> for JsTreeEntry {
    fn from(entry: TreeEntry) -> Self {
        Self {
            name: entry.name,
            kind: if entry.is_dir { "dir" } else { "file" }.to_owned(),
            size: entry.size.map(|s| s as f64),
            path: entry.path,
            children: entry.children.map(|c| c.into_iter().map(Self::from).collect()),
        }
    }
}

#[napi(object)]
pub struct RepoTreeListing {
    pub entries: Vec<JsTreeEntry>,
    pub truncated: bool,
}

#[napi(object)]
pub struct RepoFileListing {
    pub files: Vec<String>,
    pub truncated: bool,
}

/// Listing options; `maxEntries` caps each directory (or the file walk).
#[napi(object)]
pub struct RepoListOptions {
    pub show_ignored: bool,
    pub max_entries: u32,
    /// Directory levels to list; 1 when omitted.
    pub depth: Option<u32>,
}

/// One span to rewrite, as the search reported it (UTF-16 columns).
#[napi(object)]
pub struct RepoReplaceTarget {
    pub line: f64,
    pub text: String,
    pub start_column: f64,
    pub end_column: f64,
}

#[napi(object)]
pub struct RepoReplaceFile {
    pub path: String,
    pub targets: Vec<RepoReplaceTarget>,
}

#[napi(object)]
pub struct RepoReplaceOptions {
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub regex: Option<bool>,
    pub preserve_case: Option<bool>,
}

#[napi(object)]
pub struct RepoReplaceSkip {
    pub path: String,
    #[napi(ts_type = "'stale' | 'missing' | 'unreadable'")]
    pub reason: String,
    pub message: String,
}

#[napi(object)]
pub struct RepoReplaceResult {
    pub replaced_matches: u32,
    pub replaced_files: u32,
    pub skipped: Vec<RepoReplaceSkip>,
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
    ) -> AsyncTask<Blocking<RepoTreeListing>> {
        let root = self.root.clone();
        blocking(move || {
            let (o, depth) = (&options, options.depth.unwrap_or(1));
            let (entries, truncated) =
                list_directory(&root, &path, depth, o.show_ignored, o.max_entries as usize)
                    .map_err(to_napi_error)?;
            let entries = entries.into_iter().map(JsTreeEntry::from).collect();
            Ok(RepoTreeListing { entries, truncated })
        })
    }

    /// Every file under a subdirectory, depth-first in locale order.
    #[napi(ts_return_type = "Promise<RepoFileListing>")]
    pub fn list_files(
        &self,
        path: String,
        options: RepoListOptions,
    ) -> AsyncTask<Blocking<RepoFileListing>> {
        let root = self.root.clone();
        blocking(move || {
            let o = &options;
            let (files, truncated) =
                list_files(&root, &path, o.show_ignored, o.max_entries as usize)
                    .map_err(to_napi_error)?;
            Ok(RepoFileListing { files, truncated })
        })
    }

    /// Read a file: text or base64, MIME type, 1 MiB cap.
    #[napi(ts_return_type = "Promise<RepoBlob>")]
    pub fn read_blob(&self, path: String) -> AsyncTask<Blocking<RepoBlob>> {
        let root = self.root.clone();
        blocking(move || {
            let blob = read_blob(&root, &path).map_err(to_napi_error)?;
            let encoding = match blob.encoding {
                BlobEncoding::Utf8 => "utf-8",
                BlobEncoding::Base64 => "base64",
            };
            Ok(RepoBlob {
                content: blob.content,
                encoding: encoding.to_owned(),
                mime_type: blob.mime_type.to_owned(),
            })
        })
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
    ) -> AsyncTask<Blocking<RepoReplaceResult>> {
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
        let files: Vec<ReplaceFile> = files
            .into_iter()
            .map(|f| ReplaceFile {
                path: f.path,
                targets: f
                    .targets
                    .into_iter()
                    .map(|t| ReplaceTarget {
                        line: t.line,
                        text: t.text,
                        start_column: t.start_column,
                        end_column: t.end_column,
                    })
                    .collect(),
            })
            .collect();
        blocking(move || {
            let summary = replace_content(&root, &query, &replacement, &files, options)
                .map_err(to_napi_error)?;
            let skipped = summary.skipped.into_iter().map(|s| RepoReplaceSkip {
                path: s.path,
                reason: s.reason.to_owned(),
                message: s.message,
            });
            Ok(RepoReplaceResult {
                replaced_matches: summary.replaced_matches,
                replaced_files: summary.replaced_files,
                skipped: skipped.collect(),
            })
        })
    }
}
