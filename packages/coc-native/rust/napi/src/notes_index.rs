//! N-API bindings for the Notes content index: thin `AsyncTask` wrappers
//! around core's `notes_index::NotesIndex`.

use std::path::{Path, PathBuf};

use coc_native_core::notes_index::{
    NotesIndex as CoreNotesIndex, NotesIndexOptions as CoreNotesIndexOptions,
    NotesSearchResponse as CoreNotesSearchResponse,
};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;
use napi_derive::napi;

/// Filesystem policy for one resolved Notes root.
#[napi(object)]
pub struct NotesIndexBuildOptions {
    /// Skip every symbolic-link entry. External and task-derived Notes roots
    /// enable this to prevent reads outside the resolved root.
    pub skip_symlinks: Option<bool>,
}

/// One filename or content-line match.
#[napi(object)]
pub struct NotesMatch {
    /// Zero for a filename match, otherwise the one-based content line.
    pub line: u32,
    /// The original basename or line text, without lowercase normalization.
    pub text: String,
}

/// All matches for one root-relative Markdown path.
#[napi(object)]
pub struct NotesSearchResult {
    /// Root-relative path with `/` separators on every platform.
    pub path: String,
    /// Filename match first, followed by content matches in line order.
    pub matches: Vec<NotesMatch>,
}

/// The bounded response from one Notes index search.
#[napi(object)]
pub struct NotesSearchResponse {
    pub results: Vec<NotesSearchResult>,
    pub truncated: bool,
}

/// An in-memory content index for one already-authorized Notes root.
#[napi]
pub struct NotesIndex {
    index: CoreNotesIndex,
}

fn build_options(options: Option<NotesIndexBuildOptions>) -> CoreNotesIndexOptions {
    CoreNotesIndexOptions {
        skip_symlinks: options.and_then(|value| value.skip_symlinks).unwrap_or(false),
    }
}

fn to_napi_error(operation: &str, root: &Path, error: std::io::Error) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("failed to {operation} Notes index for {}: {error}", root.display()),
    )
}

impl From<CoreNotesSearchResponse> for NotesSearchResponse {
    fn from(response: CoreNotesSearchResponse) -> Self {
        Self {
            results: response
                .results
                .into_iter()
                .map(|result| NotesSearchResult {
                    path: result.path,
                    matches: result
                        .matches
                        .into_iter()
                        .map(|item| NotesMatch { line: item.line as u32, text: item.text })
                        .collect(),
                })
                .collect(),
            truncated: response.truncated,
        }
    }
}

pub struct BuildNotesIndexTask {
    root: PathBuf,
    options: CoreNotesIndexOptions,
}

impl Task for BuildNotesIndexTask {
    type Output = CoreNotesIndex;
    type JsValue = NotesIndex;

    fn compute(&mut self) -> Result<Self::Output> {
        CoreNotesIndex::build(self.root.clone(), self.options)
            .map_err(|error| to_napi_error("build", &self.root, error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NotesIndex { index: output })
    }
}

pub struct RefreshNotesIndexTask {
    index: CoreNotesIndex,
}

impl Task for RefreshNotesIndexTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.index.refresh().map_err(|error| to_napi_error("refresh", self.index.root(), error))
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

pub struct RefreshChangedNotesIndexTask {
    index: CoreNotesIndex,
    changed_paths: Vec<String>,
}

impl Task for RefreshChangedNotesIndexTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.index
            .refresh_changed(&self.changed_paths)
            .map_err(|error| to_napi_error("incrementally refresh", self.index.root(), error))
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

pub struct SearchNotesTask {
    index: CoreNotesIndex,
    query: String,
}

impl Task for SearchNotesTask {
    type Output = NotesSearchResponse;
    type JsValue = NotesSearchResponse;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(self.index.search(&self.query).into())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Recursively build a complete immutable snapshot for one resolved Notes root.
#[napi(ts_return_type = "Promise<NotesIndex>")]
pub fn build_notes_index(
    root: String,
    options: Option<NotesIndexBuildOptions>,
) -> AsyncTask<BuildNotesIndexTask> {
    AsyncTask::new(BuildNotesIndexTask {
        root: PathBuf::from(root),
        options: build_options(options),
    })
}

#[napi]
impl NotesIndex {
    /// Search the current complete snapshot and return at most 50 matching
    /// files and 100 total filename/content matches.
    #[napi(ts_return_type = "Promise<NotesSearchResponse>")]
    pub fn search(&self, query: String) -> AsyncTask<SearchNotesTask> {
        AsyncTask::new(SearchNotesTask { index: self.index.clone(), query })
    }

    /// Rebuild the complete root and atomically replace the searchable
    /// snapshot. A failed rebuild retains the last complete snapshot.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn refresh(&self) -> AsyncTask<RefreshNotesIndexTask> {
        AsyncTask::new(RefreshNotesIndexTask { index: self.index.clone() })
    }

    /// Apply at most 1,024 normalized, root-relative changed file paths and
    /// atomically replace the searchable snapshot. Missing files are removed;
    /// existing lowercase-Markdown files are upserted from disk.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn refresh_changed(
        &self,
        changed_paths: Vec<String>,
    ) -> AsyncTask<RefreshChangedNotesIndexTask> {
        AsyncTask::new(RefreshChangedNotesIndexTask { index: self.index.clone(), changed_paths })
    }
}
