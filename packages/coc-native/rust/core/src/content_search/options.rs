//! Query modes and the caps that bound one search.

/// Maximum matches one search returns, across all files.
pub const DEFAULT_MAX_RESULTS: usize = 500;
/// Maximum matches one search returns from a single file.
pub const DEFAULT_MAX_PER_FILE: usize = 20;
/// Files larger than this are skipped without being read.
pub const DEFAULT_MAX_FILE_SIZE_BYTES: u64 = 1024 * 1024;
/// Lines of context returned on each side of a match.
pub const DEFAULT_CONTEXT_LINES: usize = 1;

/// How much of one line is returned.
///
/// A minified bundle can hold a single multi-megabyte line, and shipping it
/// would blow out both the response and the panel. A match's own span is never
/// cut off, so `start_column`/`end_column` stay valid indices into `text`.
pub const MAX_LINE_UTF16: usize = 1_000;

/// One content search's mode toggles, scoping, and caps.
///
/// `Default` is the state the Explorer's search box starts in: whole repo,
/// case-insensitive literal, ignored files hidden, every cap at its documented
/// value.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentSearchOptions {
    /// Repo-relative subfolder to search. `None` or empty means the whole repo.
    pub path: Option<String>,
    /// Match case exactly. Off by default.
    pub case_sensitive: bool,
    /// Require word boundaries around the query. Off by default.
    pub whole_word: bool,
    /// Treat the query as a regular expression rather than a literal.
    pub regex: bool,
    /// Search files `.gitignore` excludes — the explorer's `showIgnored` flag.
    pub show_ignored: bool,
    /// Whitelist globs. When non-empty, a file matching none of them is skipped.
    pub include: Vec<String>,
    /// Globs whose matches are skipped.
    pub exclude: Vec<String>,
    pub max_results: usize,
    pub max_per_file: usize,
    pub max_file_size_bytes: u64,
    pub context_lines: usize,
}

impl Default for ContentSearchOptions {
    fn default() -> Self {
        Self {
            path: None,
            case_sensitive: false,
            whole_word: false,
            regex: false,
            show_ignored: false,
            include: Vec::new(),
            exclude: Vec::new(),
            max_results: DEFAULT_MAX_RESULTS,
            max_per_file: DEFAULT_MAX_PER_FILE,
            max_file_size_bytes: DEFAULT_MAX_FILE_SIZE_BYTES,
            context_lines: DEFAULT_CONTEXT_LINES,
        }
    }
}
