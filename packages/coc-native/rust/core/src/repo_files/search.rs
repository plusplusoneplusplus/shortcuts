//! Repository search policy composed with the shared fresh content matcher.

use std::io;
use std::path::Path;

use super::{tracked_content_candidates, RepoFilesError};
use crate::content_search::{
    self, ContentSearchOptions, ContentSearchResult, SearchError, DEFAULT_MAX_RESULTS,
};

/// Search the working tree, optionally restricting eligibility to Git paths.
/// WSL command output is supplied by Node's workspace execution adapter; even
/// an empty supplied output suppresses host Git execution.
pub fn search_content(
    root: &Path,
    query: &str,
    mut options: ContentSearchOptions,
    tracked: bool,
    include_untracked: bool,
    wsl_output: Option<&str>,
) -> Result<ContentSearchResult, RepoFilesError> {
    if !std::fs::metadata(root).is_ok_and(|metadata| metadata.is_dir()) {
        return Err(io::Error::other(format!("Repo not found on disk: {}", root.display())).into());
    }
    options.max_results = options.max_results.clamp(1, DEFAULT_MAX_RESULTS);
    // Match the REST adapter's leading-separator and single './' treatment;
    // the shared matcher still validates traversal and subfolder existence.
    options.path = options.path.and_then(|path| {
        let path = path.trim_start_matches(['/', '\\']);
        let path = if path == "." { "" } else { path.strip_prefix("./").unwrap_or(path) };
        (!path.is_empty()).then(|| path.to_owned())
    });
    if tracked {
        options.files =
            Some(tracked_content_candidates(root, query, &options, include_untracked, wsl_output)?);
    }
    content_search::search(root, query, &options).map_err(|error| match error {
        SearchError::Io(error) => RepoFilesError::Io(error),
        other => RepoFilesError::InvalidArg(other.to_string()),
    })
}
