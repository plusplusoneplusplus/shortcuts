//! N-API bindings for the quick-open file index: thin `AsyncTask` wrappers
//! around core's `repo_index::RepoIndex`, which owns the refresh/swap state.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use coc_native_core::repo_index::{FuzzyMatcher, RepoIndex, WalkOptions};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;
use napi_derive::napi;

/// How to build (and later refresh) an index.
#[napi(object)]
pub struct BuildOptions {
    /// Include gitignored files — the `showIgnored` flag from the explorer.
    pub include_ignored: Option<bool>,
    /// Safety cap on indexed paths. Omit for no cap.
    pub max_entries: Option<u32>,
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

/// An in-memory, gitignore-aware index of one repository's file paths.
#[napi]
pub struct FileIndex {
    index: RepoIndex,
}

fn walk_options(options: Option<BuildOptions>) -> WalkOptions {
    let options = options.unwrap_or(BuildOptions { include_ignored: None, max_entries: None });
    WalkOptions {
        include_ignored: options.include_ignored.unwrap_or(false),
        max_entries: options.max_entries.map(|m| m as usize),
    }
}

fn to_napi_error(root: &Path, err: std::io::Error) -> Error {
    Error::new(Status::GenericFailure, format!("failed to index {}: {err}", root.display()))
}

pub struct BuildTask {
    root: PathBuf,
    options: WalkOptions,
}

impl Task for BuildTask {
    type Output = RepoIndex;
    type JsValue = FileIndex;

    fn compute(&mut self) -> Result<Self::Output> {
        RepoIndex::build(self.root.clone(), self.options).map_err(|e| to_napi_error(&self.root, e))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(FileIndex { index: output })
    }
}

pub struct RefreshTask {
    index: RepoIndex,
}

impl Task for RefreshTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.index.refresh().map_err(|e| to_napi_error(self.index.root(), e))
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

pub struct SearchTask {
    matcher: Arc<FuzzyMatcher>,
    query: String,
    limit: u32,
}

impl Task for SearchTask {
    type Output = Vec<FileMatch>;
    type JsValue = Vec<FileMatch>;

    fn compute(&mut self) -> Result<Self::Output> {
        let snapshot = self.matcher.snapshot();
        Ok(self
            .matcher
            .search(&self.query, self.limit as usize)
            .into_iter()
            .map(|hit| FileMatch {
                path: snapshot.path_at(hit.index).to_owned(),
                score: hit.score,
                indices: hit.indices,
            })
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Walk `root` in parallel and resolve with a ready-to-search index.
#[napi(ts_return_type = "Promise<FileIndex>")]
pub fn build_file_index(root: String, options: Option<BuildOptions>) -> AsyncTask<BuildTask> {
    AsyncTask::new(BuildTask { root: PathBuf::from(root), options: walk_options(options) })
}

#[napi]
impl FileIndex {
    /// Number of indexed paths.
    #[napi]
    #[allow(clippy::len_without_is_empty)]
    pub fn len(&self) -> u32 {
        self.index.snapshot().len() as u32
    }

    /// True when the walk hit the configured `maxEntries` cap.
    #[napi]
    pub fn truncated(&self) -> bool {
        self.index.snapshot().truncated()
    }

    /// A window of the raw path list, in index order.
    #[napi]
    pub fn files(&self, offset: u32, limit: u32) -> Vec<String> {
        self.index.snapshot().files(offset as usize, limit as usize)
    }

    /// Score every indexed path and resolve with the best `limit` matches.
    #[napi(ts_return_type = "Promise<FileMatch[]>")]
    pub fn search(&self, query: String, limit: u32) -> AsyncTask<SearchTask> {
        AsyncTask::new(SearchTask { matcher: self.index.searcher(), query, limit })
    }

    /// Re-walk the root and atomically swap in the new path list.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn refresh(&self) -> AsyncTask<RefreshTask> {
        AsyncTask::new(RefreshTask { index: self.index.clone() })
    }
}
