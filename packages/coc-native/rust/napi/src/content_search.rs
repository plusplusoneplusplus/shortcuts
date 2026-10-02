//! N-API bindings for repository content search: a thin worker-task wrapper
//! around core's `content_search::search`, which owns every cap and mode.
//!
//! There is no index object here, unlike the file index — each query is a fresh
//! walk, so there is nothing to keep warm between calls.

use std::path::PathBuf;

use coc_native_core::content_search::{
    search, ContentSearchOptions, ContentSearchResult, SearchError,
};
use napi::bindgen_prelude::{AsyncTask, Error, Status};
use napi_derive::napi;

use crate::task::{blocking, Blocking};

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
    /// Exact repo-relative paths eligible for this search.
    pub files: Option<Vec<String>>,
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

pub(crate) fn search_options(options: Option<SearchContentOptions>) -> ContentSearchOptions {
    let Some(options) = options else { return ContentSearchOptions::default() };
    let defaults = ContentSearchOptions::default();
    ContentSearchOptions {
        path: options.path,
        case_sensitive: options.case_sensitive.unwrap_or(defaults.case_sensitive),
        whole_word: options.whole_word.unwrap_or(defaults.whole_word),
        regex: options.regex.unwrap_or(defaults.regex),
        show_ignored: options.show_ignored.unwrap_or(defaults.show_ignored),
        files: options.files,
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
/// A bad regex, a bad path or a bad glob is the caller's mistake and becomes
/// `InvalidArg`, which the route turns into a 400; everything else is a genuine
/// failure.
fn to_napi_error(error: SearchError) -> Error {
    let status = match error {
        SearchError::InvalidRegex(_)
        | SearchError::InvalidPath(_)
        | SearchError::InvalidGlob(_) => Status::InvalidArg,
        SearchError::Io(_) => Status::GenericFailure,
    };
    Error::new(status, error.to_string())
}

/// Walk `root` in parallel and resolve with every line matching `query`.
///
/// An empty query resolves with an empty result rather than every line.
#[napi(ts_return_type = "Promise<ContentSearchResult>")]
pub fn search_content(
    root: String,
    query: String,
    options: Option<SearchContentOptions>,
) -> AsyncTask<Blocking<ContentSearchResult>> {
    let (root, options) = (PathBuf::from(root), search_options(options));
    blocking(move || search(&root, &query, &options).map_err(to_napi_error))
}
