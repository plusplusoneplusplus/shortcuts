//! N-API addon exposing the quick-open file index to Node.
//!
//! Every method that touches the filesystem or scans the path list returns a
//! real promise backed by an `AsyncTask`, so the work happens on a libuv worker
//! and the Node event loop is never blocked.

#![deny(clippy::all)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use coc_native_core::{IndexState, WalkOptions};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;

#[macro_use]
extern crate napi_derive;

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
    root: PathBuf,
    options: WalkOptions,
    /// The current snapshot. Refresh swaps the `Arc` wholesale, so a search
    /// holds either the old list or the new one and never sees a torn state.
    state: Arc<RwLock<Arc<IndexState>>>,
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
    type Output = IndexState;
    type JsValue = FileIndex;

    fn compute(&mut self) -> Result<Self::Output> {
        IndexState::build(&self.root, &self.options).map_err(|e| to_napi_error(&self.root, e))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(FileIndex {
            root: self.root.clone(),
            options: self.options,
            state: Arc::new(RwLock::new(Arc::new(output))),
        })
    }
}

pub struct RefreshTask {
    root: PathBuf,
    options: WalkOptions,
    state: Arc<RwLock<Arc<IndexState>>>,
}

impl Task for RefreshTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        let rebuilt = IndexState::build(&self.root, &self.options)
            .map_err(|e| to_napi_error(&self.root, e))?;
        // Swap under the shortest possible write lock; readers cloned their Arc
        // before this point and keep reading the old snapshot safely.
        let mut slot = self.state.write().map_err(|_| {
            Error::new(Status::GenericFailure, "file index lock poisoned".to_owned())
        })?;
        *slot = Arc::new(rebuilt);
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

pub struct SearchTask {
    snapshot: Arc<IndexState>,
    query: String,
    limit: u32,
}

impl Task for SearchTask {
    type Output = Vec<FileMatch>;
    type JsValue = Vec<FileMatch>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(self
            .snapshot
            .search(&self.query, self.limit as usize)
            .into_iter()
            .map(|hit| FileMatch {
                path: self.snapshot.path_at(hit.index).to_owned(),
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
        self.snapshot().len() as u32
    }

    /// True when the walk hit the configured `maxEntries` cap.
    #[napi]
    pub fn truncated(&self) -> bool {
        self.snapshot().truncated()
    }

    /// A window of the raw path list, in index order.
    #[napi]
    pub fn files(&self, offset: u32, limit: u32) -> Vec<String> {
        self.snapshot().files(offset as usize, limit as usize)
    }

    /// Score every indexed path and resolve with the best `limit` matches.
    #[napi(ts_return_type = "Promise<FileMatch[]>")]
    pub fn search(&self, query: String, limit: u32) -> AsyncTask<SearchTask> {
        AsyncTask::new(SearchTask { snapshot: self.snapshot(), query, limit })
    }

    /// Re-walk the root and atomically swap in the new path list.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn refresh(&self) -> AsyncTask<RefreshTask> {
        AsyncTask::new(RefreshTask {
            root: self.root.clone(),
            options: self.options,
            state: Arc::clone(&self.state),
        })
    }

    fn snapshot(&self) -> Arc<IndexState> {
        // A poisoned lock still holds a valid snapshot — the write side only
        // panics between a successful walk and the swap, which cannot happen.
        Arc::clone(&self.state.read().unwrap_or_else(|e| e.into_inner()))
    }
}
