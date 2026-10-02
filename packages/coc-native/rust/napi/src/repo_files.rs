//! N-API bindings for the repository-file backend: one `RepoFiles` handle per
//! resolved repository root, with every filesystem call on a libuv worker.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use coc_native_core::repo_files::{
    list_directory, list_files, read_blob, replace_content, write_blob, Blob, FileListing,
    ReplaceFile as RepoReplaceFile, ReplaceOptions, ReplaceSummary, RepoFilesError, RepoIndexes,
    TreeListing,
};
use coc_native_core::repo_index::{FuzzyMatcher, Hit};
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

/// A scored path plus the positions the client highlights.
#[napi(object)]
pub struct FileMatch {
    pub path: String,
    pub score: u32,
    /// Matched UTF-16 offsets within `path`, ascending — the same offsets a
    /// JavaScript string index would use.
    pub indices: Vec<u32>,
}

/// Native ordering keys for merging matches from multiple repositories.
#[napi(object)]
pub struct FileMatchRanking {
    /// 2 when the basename matched, 1 when only the full path matched.
    pub tier: u32,
    /// UTF-16 length of the basename for tier 2, or the full path for tier 1.
    pub target_len: u32,
    /// UTF-16 length of the full path.
    pub path_len: u32,
    /// Position in the index snapshot, used for stable within-repo ties.
    pub snapshot_index: u32,
}

/// A file match with the complete native ordering tuple.
#[napi(object)]
pub struct RankedFileMatch {
    pub path: String,
    pub score: u32,
    /// Matched UTF-16 offsets within `path`, ascending.
    pub indices: Vec<u32>,
    pub ranking: FileMatchRanking,
}

fn search_ranked(matcher: &FuzzyMatcher, query: &str, limit: usize) -> Vec<RankedFileMatch> {
    let snapshot = matcher.snapshot();
    let ranked = |hit: Hit| RankedFileMatch {
        path: snapshot.path_at(hit.index).to_owned(),
        score: hit.score,
        indices: hit.indices,
        ranking: FileMatchRanking {
            tier: u32::from(hit.tier),
            target_len: hit.target_len,
            path_len: hit.path_len,
            snapshot_index: hit.index,
        },
    };
    matcher.search(query, limit).into_iter().map(ranked).collect()
}

/// A path escaping the root is the caller's mistake (`InvalidArg`); the
/// message is the route contract either way.
fn to_napi_error(error: RepoFilesError) -> Error {
    let status = match error {
        RepoFilesError::PathTraversal | RepoFilesError::InvalidArg(_) => Status::InvalidArg,
        RepoFilesError::Disposed => Status::Closing,
        _ => Status::GenericFailure,
    };
    Error::new(status, error.to_string())
}

/// The repository-file backend for one resolved root. It owns that root's
/// file indexes until `dispose`; Node opens one per workspace root.
#[napi]
pub struct RepoFiles {
    indexes: Arc<RepoIndexes>,
}

/// Open the backend for an already-resolved repository root. Indexes older
/// than `ttlMs` (default 10 s) are re-walked in the background on next use.
#[napi]
pub fn open_repo_files(root: String, ttl_ms: Option<u32>) -> RepoFiles {
    let ttl = Duration::from_millis(ttl_ms.unwrap_or(10_000).into());
    RepoFiles { indexes: RepoIndexes::new(PathBuf::from(root), ttl) }
}

impl RepoFiles {
    /// Run `job` on a worker against the live root.
    fn run<T, F>(&self, job: F) -> AsyncTask<Blocking<T>>
    where
        T: napi::bindgen_prelude::ToNapiValue + napi::bindgen_prelude::TypeName + Send + 'static,
        F: FnOnce(&Arc<RepoIndexes>, &Path) -> Result<T, RepoFilesError> + Send + 'static,
    {
        let indexes = Arc::clone(&self.indexes);
        blocking(move || indexes.root().and_then(|root| job(&indexes, root)).map_err(to_napi_error))
    }
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
        self.run(move |_, root| {
            let (o, depth) = (&options, options.depth.unwrap_or(1));
            list_directory(root, &path, depth, o.show_ignored, o.max_entries as usize)
        })
    }

    /// Every file under a subdirectory, depth-first in locale order.
    #[napi(ts_return_type = "Promise<RepoFileListing>")]
    pub fn list_files(
        &self,
        path: String,
        options: RepoListOptions,
    ) -> AsyncTask<Blocking<FileListing>> {
        self.run(move |_, root| {
            list_files(root, &path, options.show_ignored, options.max_entries as usize)
        })
    }

    /// The first `maxEntries` paths of the whole-root index, in index order.
    /// The index itself is uncapped, so search still reaches every file.
    #[napi(ts_return_type = "Promise<RepoFileListing>")]
    pub fn index_files(&self, options: RepoListOptions) -> AsyncTask<Blocking<FileListing>> {
        self.run(move |indexes, _| {
            let snapshot = indexes.index(options.show_ignored)?.snapshot();
            let max = options.max_entries as usize;
            Ok(FileListing { files: snapshot.files(0, max), truncated: snapshot.len() > max })
        })
    }

    /// Fuzzy-search the whole-root index; the best `limit` matches first.
    #[napi(ts_return_type = "Promise<FileMatch[]>")]
    pub fn search_files(
        &self,
        query: String,
        limit: u32,
        show_ignored: bool,
    ) -> AsyncTask<Blocking<Vec<FileMatch>>> {
        self.run(move |indexes, _| {
            let matcher = indexes.index(show_ignored)?.searcher();
            Ok(search_ranked(&matcher, &query, limit as usize)
                .into_iter()
                .map(|hit| FileMatch { path: hit.path, score: hit.score, indices: hit.indices })
                .collect())
        })
    }

    /// `searchFiles` plus the native ordering tuple for server-side merging.
    #[napi(ts_return_type = "Promise<RankedFileMatch[]>")]
    pub fn search_files_ranked(
        &self,
        query: String,
        limit: u32,
        show_ignored: bool,
    ) -> AsyncTask<Blocking<Vec<RankedFileMatch>>> {
        self.run(move |indexes, _| {
            let matcher = indexes.index(show_ignored)?.searcher();
            Ok(search_ranked(&matcher, &query, limit as usize))
        })
    }

    /// Re-walk the built indexes after an outside change, queued behind any
    /// scan in flight. Resolves `false` when a walk failed and the previous
    /// snapshot was kept.
    #[napi(ts_return_type = "Promise<boolean>")]
    pub fn invalidate(&self) -> AsyncTask<Blocking<bool>> {
        self.run(|indexes, _| Ok(indexes.invalidate()))
    }

    /// Close the handle: later calls reject, background work publishes nothing.
    #[napi]
    pub fn dispose(&self) {
        self.indexes.dispose();
    }

    /// Read a file: text or base64, MIME type, 1 MiB cap.
    #[napi(ts_return_type = "Promise<RepoBlob>")]
    pub fn read_blob(&self, path: String) -> AsyncTask<Blocking<Blob>> {
        self.run(move |_, root| read_blob(root, &path))
    }

    /// Write text to a file, creating missing parent directories, then
    /// refresh the indexes so search sees it. A failed refresh keeps the old
    /// snapshot but does not fail the committed write.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn write_blob(&self, path: String, content: String) -> AsyncTask<Blocking<()>> {
        self.run(move |indexes, root| {
            write_blob(root, &path, &content)?;
            indexes.invalidate();
            Ok(())
        })
    }

    /// Rewrite exactly the supplied spans; stale files are skipped whole and
    /// reported. A bad query rejects with `InvalidArg` before any write.
    /// Indexes are refreshed whenever a file may have been written, including
    /// a request that failed part way through.
    #[napi(ts_return_type = "Promise<RepoReplaceResult>")]
    pub fn replace_content(
        &self,
        query: String,
        replacement: String,
        files: Vec<RepoReplaceFile>,
        options: Option<RepoReplaceOptions>,
    ) -> AsyncTask<Blocking<ReplaceSummary>> {
        let flag = |get: fn(&RepoReplaceOptions) -> Option<bool>| {
            options.as_ref().and_then(get).unwrap_or(false)
        };
        let options = ReplaceOptions {
            case_sensitive: flag(|o| o.case_sensitive),
            whole_word: flag(|o| o.whole_word),
            regex: flag(|o| o.regex),
            preserve_case: flag(|o| o.preserve_case),
        };
        self.run(move |indexes, root| {
            let result = replace_content(root, &query, &replacement, &files, options);
            if !matches!(&result, Ok(s) if s.replaced_files == 0)
                && !matches!(result, Err(RepoFilesError::InvalidArg(_)))
            {
                indexes.invalidate();
            }
            result
        })
    }
}
