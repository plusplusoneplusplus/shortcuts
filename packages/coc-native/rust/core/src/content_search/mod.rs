//! Full-text search across a repository's non-ignored files.
//!
//! Built on ripgrep's own `grep-searcher` / `grep-regex` over the same
//! `ignore`-crate walk the Explorer tree and path search use, so "the files
//! this repo has" means one thing across the whole feature. Every query is a
//! fresh parallel walk — there is no persistent content index — which the caps
//! below are what make affordable.
//!
//! Nothing here is incremental and nothing here is cancellable: the caps are
//! the entire bound on how much work one query can cost.

mod options;
mod sink;

pub use options::{
    ContentSearchOptions, DEFAULT_MAX_FILE_SIZE_BYTES, DEFAULT_MAX_PER_FILE, DEFAULT_MAX_RESULTS,
    MAX_LINE_UTF16,
};

use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, SearcherBuilder};
use ignore::overrides::OverrideBuilder;
use ignore::WalkState;

use crate::repo_index::walk::{to_posix, walk_builder};
use sink::MatchSink;

/// One matching line, with its position inside the line and its neighbours.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentMatch {
    /// Repo-relative path with `/` separators on every platform.
    pub path: String,
    /// One-based line number.
    pub line: u64,
    /// The matching line without its trailing newline, possibly truncated.
    pub text: String,
    /// UTF-16 offset of the match within `text` — a JavaScript string index,
    /// so the client's highlight cannot disagree with what matched.
    pub start_column: u32,
    /// UTF-16 offset one past the end of the match within `text`.
    pub end_column: u32,
    /// Up to `context_lines` lines preceding `line`, in file order.
    pub before: Vec<String>,
    /// Up to `context_lines` lines following `line`, in file order.
    pub after: Vec<String>,
}

/// Each file's matches, keyed by path, in whatever order the walk produced —
/// sorted into the deterministic order the caller sees once the walk is done.
type FileMatches = Vec<(String, Vec<ContentMatch>)>;

/// The bounded response from one content search.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ContentSearchResult {
    /// Matches sorted by path, then by line — deterministic across platforms
    /// and across runs, which the parallel walk's own order is not.
    pub matches: Vec<ContentMatch>,
    /// True when any cap bit: the total cap, a per-file cap, or a file skipped
    /// for being larger than `max_file_size_bytes`.
    pub truncated: bool,
}

/// Why a search could not run.
///
/// Split by cause rather than collapsed into one string because the server maps
/// the first two to 400 and the last to 500.
#[derive(Debug)]
pub enum SearchError {
    /// `regex: true` with a pattern the engine could not parse. Carries the
    /// engine's own parse message, which is what the user needs to see.
    InvalidRegex(String),
    /// A `path` that escapes the root, is not a directory, or does not exist.
    InvalidPath(String),
    /// The root could not be read, or a glob in `include`/`exclude` is malformed.
    Io(io::Error),
}

impl fmt::Display for SearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRegex(message) => write!(f, "invalid regular expression: {message}"),
            Self::InvalidPath(message) => write!(f, "invalid search path: {message}"),
            Self::Io(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for SearchError {}

impl From<io::Error> for SearchError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Search every non-ignored file under `root` (or under `options.path`) for
/// `query`, returning at most `options.max_results` matches.
///
/// An empty query returns an empty result rather than matching every line.
pub fn search(
    root: &Path,
    query: &str,
    options: &ContentSearchOptions,
) -> Result<ContentSearchResult, SearchError> {
    let metadata = std::fs::metadata(root)?;
    if !metadata.is_dir() {
        return Err(SearchError::InvalidPath(format!("not a directory: {}", root.display())));
    }
    if query.is_empty() {
        return Ok(ContentSearchResult::default());
    }

    let scope = resolve_scope(root, options.path.as_deref())?;
    let matcher = build_matcher(query, options)?;

    // The walk yields paths relative to `scope`, but every path the client sees
    // is relative to the repo root, so re-root them by this prefix.
    let prefix = to_posix(scope.strip_prefix(root).unwrap_or(Path::new("")));

    let mut builder = walk_builder(&scope, options.show_ignored);
    if !options.include.is_empty() || !options.exclude.is_empty() {
        builder.overrides(build_overrides(&scope, options)?);
    }

    let files: Arc<Mutex<FileMatches>> = Arc::new(Mutex::new(Vec::new()));
    // Read by every worker to decide whether more work is worth doing, so it is
    // approximate by design: the exact cap is applied once, after the walk.
    let found = Arc::new(AtomicUsize::new(0));
    let truncated = Arc::new(AtomicBool::new(false));

    builder.build_parallel().run(|| {
        let files = Arc::clone(&files);
        let found = Arc::clone(&found);
        let truncated = Arc::clone(&truncated);
        let matcher = matcher.clone();
        let prefix = prefix.clone();
        let scope = scope.clone();
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            // Stop at the first NUL rather than emitting the garbage that
            // matching inside a binary file produces.
            .binary_detection(BinaryDetection::quit(0))
            // One match per line keeps `start_column`/`end_column` meaningful.
            .multi_line(false)
            .before_context(options.context_lines)
            .after_context(options.context_lines)
            .build();
        let max_per_file = options.max_per_file;
        let max_file_size = options.max_file_size_bytes;
        let context_lines = options.context_lines;

        Box::new(move |result| {
            if found.load(Ordering::Relaxed) >= options.max_results {
                truncated.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            // Unreadable directories and broken symlinks are skipped, as in the
            // path walk, rather than failing the whole search.
            let Ok(entry) = result else { return WalkState::Continue };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            if entry.metadata().is_ok_and(|m| m.len() > max_file_size) {
                truncated.store(true, Ordering::Relaxed);
                return WalkState::Continue;
            }
            let Ok(relative) = entry.path().strip_prefix(&scope) else {
                return WalkState::Continue;
            };
            let path = join_posix(&prefix, &to_posix(relative));

            let mut sink = MatchSink::new(&matcher, &path, context_lines, max_per_file);
            // A file that cannot be read or decoded is skipped; one bad file
            // must not sink a whole-repo query.
            if searcher.search_path(&matcher, entry.path(), &mut sink).is_err() {
                return WalkState::Continue;
            }
            if sink.hit_per_file_cap() {
                truncated.store(true, Ordering::Relaxed);
            }
            let matches = sink.into_matches();
            if matches.is_empty() {
                return WalkState::Continue;
            }
            found.fetch_add(matches.len(), Ordering::Relaxed);
            files.lock().unwrap_or_else(|e| e.into_inner()).push((path, matches));
            WalkState::Continue
        })
    });

    let mut files = Arc::try_unwrap(files)
        .map(|m| m.into_inner().unwrap_or_else(|e| e.into_inner()))
        .unwrap_or_else(|arc| arc.lock().unwrap_or_else(|e| e.into_inner()).clone());
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let mut matches: Vec<ContentMatch> = files.into_iter().flat_map(|(_, m)| m).collect();
    let mut truncated = truncated.load(Ordering::Relaxed);
    if matches.len() > options.max_results {
        matches.truncate(options.max_results);
        truncated = true;
    }
    Ok(ContentSearchResult { matches, truncated })
}

/// The directory the walk starts from: the root, or `path` beneath it.
///
/// A `path` that climbs out of the root is an error rather than a silent
/// whole-repo search, so a traversal attempt cannot read the disk at large.
fn resolve_scope(root: &Path, path: Option<&str>) -> Result<PathBuf, SearchError> {
    let Some(path) = path.filter(|p| !p.is_empty()) else { return Ok(root.to_path_buf()) };
    let relative = Path::new(path);
    if relative.is_absolute() {
        return Err(SearchError::InvalidPath(format!("must be relative to the repo: {path}")));
    }
    for component in relative.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => {
                return Err(SearchError::InvalidPath(format!("escapes the repo: {path}")));
            }
        }
    }
    let scope = root.join(relative);
    match std::fs::metadata(&scope) {
        Ok(metadata) if metadata.is_dir() => Ok(scope),
        Ok(_) => Err(SearchError::InvalidPath(format!("not a directory: {path}"))),
        Err(_) => Err(SearchError::InvalidPath(format!("no such directory: {path}"))),
    }
}

/// Translate the query and the three mode toggles into one regex matcher.
fn build_matcher(query: &str, options: &ContentSearchOptions) -> Result<RegexMatcher, SearchError> {
    RegexMatcherBuilder::new()
        .case_insensitive(!options.case_sensitive)
        // With `fixed_strings`, the engine escapes the pattern itself, so a
        // literal query containing regex metacharacters searches for exactly
        // the characters typed.
        .fixed_strings(!options.regex)
        // Word boundaries wrap whatever the pattern turned out to be, so this
        // composes with both literal and regex mode.
        .word(options.whole_word)
        .line_terminator(Some(b'\n'))
        .build(query)
        .map_err(|error| SearchError::InvalidRegex(error.to_string()))
}

/// Turn `include`/`exclude` globs into the walk's override set.
///
/// `include` entries whitelist: once any is present, a file matching none of
/// them is skipped. `exclude` entries are the same globs negated.
fn build_overrides(
    scope: &Path,
    options: &ContentSearchOptions,
) -> Result<ignore::overrides::Override, SearchError> {
    let mut builder = OverrideBuilder::new(scope);
    for glob in &options.include {
        builder
            .add(glob)
            .map_err(|e| SearchError::Io(io::Error::new(io::ErrorKind::InvalidInput, e)))?;
    }
    for glob in &options.exclude {
        builder
            .add(&format!("!{glob}"))
            .map_err(|e| SearchError::Io(io::Error::new(io::ErrorKind::InvalidInput, e)))?;
    }
    builder.build().map_err(|e| SearchError::Io(io::Error::new(io::ErrorKind::InvalidInput, e)))
}

/// Join a scope prefix onto a scope-relative path, both already `/`-separated.
fn join_posix(prefix: &str, relative: &str) -> String {
    if prefix.is_empty() {
        relative.to_owned()
    } else {
        format!("{prefix}/{relative}")
    }
}
