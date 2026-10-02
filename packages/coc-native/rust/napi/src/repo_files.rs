//! N-API bindings for the repository-file backend: one `RepoFiles` handle per
//! resolved repository root, with every filesystem call on a libuv worker.

use std::path::PathBuf;

use coc_native_core::repo_files::{
    list_directory, list_files, read_blob, write_blob, BlobEncoding, RepoFilesError, TreeEntry,
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

/// A path escaping the root is the caller's mistake (`InvalidArg`); the
/// message is the route contract either way.
fn to_napi_error(error: RepoFilesError) -> Error {
    let status = match error {
        RepoFilesError::PathTraversal => Status::InvalidArg,
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
}
