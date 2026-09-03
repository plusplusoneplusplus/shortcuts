//! N-API bindings for repository content search: a thin `AsyncTask` wrapper
//! around core's `content_search::search`, which owns every cap and mode.
//!
//! There is no index object here, unlike the file index — each query is a fresh
//! walk, so there is nothing to keep warm between calls.

use std::path::PathBuf;

use coc_native_core::content_search::{search, ContentSearchOptions, SearchError};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;
use napi_derive::napi;

/// Query modes, scoping and caps for one content search.
///
/// Every field is optional; omitting all of them searches the whole repo for a
/// case-insensitive literal with the documented caps.
#[napi(object)]
pub struct SearchContentOptions {
    /// Repo-relative subfolder to search. Omit for the whole repo.
    pub path: Option<String>,
    /// Match case exactly. Defaults to false.
    pub case_sensitive: Option<bool>,
    /// Require word boundaries around the query. Defaults to false.
    pub whole_word: Option<bool>,
    /// Treat the query as a regular expression rather than a literal.
    pub regex: Option<bool>,
    /// Search files `.gitignore` excludes — the explorer's `showIgnored` flag.
    pub show_ignored: Option<bool>,
    /// Whitelist globs. When non-empty, a file matching none of them is skipped.
    pub include: Option<Vec<String>>,
    /// Globs whose matches are skipped.
    pub exclude: Option<Vec<String>>,
    /// Cap on total matches. Defaults to 500.
    pub max_results: Option<u32>,
    /// Cap on matches from any one file. Defaults to 20.
    pub max_per_file: Option<u32>,
    /// Files larger than this are skipped. Defaults to 1 MiB.
    pub max_file_size_bytes: Option<u32>,
    /// Lines of context on each side of a match. Defaults to 1.
    pub context_lines: Option<u32>,
}

/// One matching line, with its position inside the line and its neighbours.
#[napi(object)]
pub struct ContentMatch {
    /// Repo-relative path with `/` separators on every platform.
    pub path: String,
    /// One-based line number.
    pub line: u32,
    /// The matching line without its trailing newline, possibly truncated.
    pub text: String,
    /// UTF-16 offset of the match within `text` — the same offset a JavaScript
    /// string index would use, so highlight and match cannot disagree.
    pub start_column: u32,
    /// UTF-16 offset one past the end of the match within `text`.
    pub end_column: u32,
    /// Present when this line is one piece of a match that crossed a line
    /// break; every piece of that match shares the id, and it is unique within
    /// a path. Absent for an ordinary single-line match.
    pub group: Option<u32>,
    /// Lines preceding `line`, in file order.
    pub before: Vec<String>,
    /// Lines following `line`, in file order.
    pub after: Vec<String>,
}

/// The bounded response from one content search.
#[napi(object)]
pub struct ContentSearchResult {
    /// Matches sorted by path, then by line.
    pub matches: Vec<ContentMatch>,
    /// True when any cap bit: the total cap, a per-file cap, or a file skipped
    /// for exceeding `maxFileSizeBytes`.
    pub truncated: bool,
}

fn search_options(options: Option<SearchContentOptions>) -> ContentSearchOptions {
    let Some(options) = options else { return ContentSearchOptions::default() };
    let defaults = ContentSearchOptions::default();
    ContentSearchOptions {
        path: options.path,
        case_sensitive: options.case_sensitive.unwrap_or(defaults.case_sensitive),
        whole_word: options.whole_word.unwrap_or(defaults.whole_word),
        regex: options.regex.unwrap_or(defaults.regex),
        show_ignored: options.show_ignored.unwrap_or(defaults.show_ignored),
        include: options.include.unwrap_or_default(),
        exclude: options.exclude.unwrap_or_default(),
        max_results: options.max_results.map_or(defaults.max_results, |m| m as usize),
        max_per_file: options.max_per_file.map_or(defaults.max_per_file, |m| m as usize),
        max_file_size_bytes: options
            .max_file_size_bytes
            .map_or(defaults.max_file_size_bytes, u64::from),
        context_lines: options.context_lines.map_or(defaults.context_lines, |m| m as usize),
    }
}

/// Map a search failure onto an N-API status the server can branch on.
///
/// A bad regex or a bad path is the caller's mistake and becomes `InvalidArg`,
/// which the route turns into a 400; everything else is a genuine failure.
fn to_napi_error(error: SearchError) -> Error {
    let status = match error {
        SearchError::InvalidRegex(_) | SearchError::InvalidPath(_) => Status::InvalidArg,
        SearchError::Io(_) => Status::GenericFailure,
    };
    Error::new(status, error.to_string())
}

pub struct SearchContentTask {
    root: PathBuf,
    query: String,
    options: ContentSearchOptions,
}

impl Task for SearchContentTask {
    type Output = ContentSearchResult;
    type JsValue = ContentSearchResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = search(&self.root, &self.query, &self.options).map_err(to_napi_error)?;
        Ok(ContentSearchResult {
            truncated: result.truncated,
            matches: result
                .matches
                .into_iter()
                .map(|hit| ContentMatch {
                    path: hit.path,
                    line: hit.line as u32,
                    text: hit.text,
                    start_column: hit.start_column,
                    end_column: hit.end_column,
                    group: hit.group,
                    before: hit.before,
                    after: hit.after,
                })
                .collect(),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Walk `root` in parallel and resolve with every line matching `query`.
///
/// An empty query resolves with an empty result rather than every line.
#[napi(ts_return_type = "Promise<ContentSearchResult>")]
pub fn search_content(
    root: String,
    query: String,
    options: Option<SearchContentOptions>,
) -> AsyncTask<SearchContentTask> {
    AsyncTask::new(SearchContentTask {
        root: PathBuf::from(root),
        query,
        options: search_options(options),
    })
}
