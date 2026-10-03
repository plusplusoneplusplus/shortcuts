//! N-API bindings for the repository-file backend: one `RepoFiles` handle per
//! resolved repository root, with every filesystem call on a libuv worker.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use coc_native_core::repo_files::{
    list_directory, list_files, prepare_content_candidates, read_blob, replace_content,
    search_content, validate_content_root, write_blob, Blob, ContentCandidateCommand, FileListing,
    ReplaceFile as RepoReplaceFile, ReplaceOptions, ReplaceSummary, RepoFilesError, RepoIndexes,
    TreeListing,
};
use coc_native_core::repo_index::{FuzzyMatcher, Hit};
use napi::bindgen_prelude::{AsyncTask, Error, FnArgs, Function, Status};
use napi_derive::napi;

use crate::task::Blocking;
use coc_native_core::content_search::{ContentSearchOptions, ContentSearchResult};

// Results and replace targets are core's own types (core's `napi` feature
// derives their JS shape); only option bags with optional fields live here.

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
    let message = if matches!(error, RepoFilesError::TrackedUnavailable(_)) {
        format!("[repo-files:tracked-unavailable] {error}")
    } else {
        error.to_string()
    };
    Error::new(status, message)
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
        AsyncTask::new(self.task(job))
    }

    fn task<T, F>(&self, job: F) -> Blocking<T>
    where
        F: FnOnce(&Arc<RepoIndexes>, &Path) -> Result<T, RepoFilesError> + Send + 'static,
    {
        let indexes = Arc::clone(&self.indexes);
        Blocking::new(move || {
            indexes.root().and_then(|root| job(&indexes, root)).map_err(to_napi_error)
        })
    }
}

#[napi]
impl RepoFiles {
    /// Git argv and limits for Node's WSL execution adapter. Checks disposal;
    /// validates the root on a worker before the adapter executes Git.
    #[napi(ts_return_type = "Promise<ContentCandidateCommand>")]
    pub fn prepare_content_candidates(
        &self,
        include_untracked: bool,
    ) -> AsyncTask<Blocking<ContentCandidateCommand>> {
        self.run(move |_, root| {
            validate_content_root(root)?;
            Ok(prepare_content_candidates(include_untracked))
        })
    }

    /// Fresh content search with native Git eligibility. For WSL, pass the
    /// prepared ls-files stdout (including an empty string); host Git is then
    /// suppressed. Tracked enumeration errors carry the internal prefix
    /// [repo-files:tracked-unavailable] for the REST adapter to map and strip.
    #[napi(ts_return_type = "Promise<ContentSearchResult>")]
    pub fn search_content(
        &self,
        query: String,
        options: Option<SearchContentOptions>,
        tracked: Option<bool>,
        include_untracked: Option<bool>,
        wsl_output: Option<String>,
    ) -> AsyncTask<Blocking<ContentSearchResult>> {
        let options = search_options(options);
        self.run(move |_, root| {
            search_content(
                root,
                &query,
                options,
                tracked.unwrap_or(false),
                include_untracked.unwrap_or(false),
                wsl_output.as_deref(),
            )
        })
    }

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
        let diagnostic_query = query.clone();
        let task = self.task(move |indexes, root| {
            let result = replace_content(root, &query, &replacement, &files, options);
            if !matches!(&result, Ok(s) if s.replaced_files == 0)
                && !matches!(result, Err(RepoFilesError::InvalidArg(_)))
            {
                indexes.invalidate();
            }
            result
        });
        AsyncTask::new(task.map_error(move |env, mut error| {
            if error.status == Status::InvalidArg
                && error.reason.starts_with("Invalid regular expression: ")
            {
                let pattern = if options.whole_word {
                    format!("\\b(?:{diagnostic_query})\\b")
                } else {
                    diagnostic_query
                };
                // Only diagnostics use Node's engine; matching stays in core on the worker.
                // Pass the pattern as data, never interpolate it into JavaScript source.
                let diagnostic = env
                    .run_script::<_, Function<FnArgs<(String, String)>, Option<String>>>(
                        "((pattern, flags) => { try { new RegExp(pattern, flags); return null; } catch (e) { return e.message; } })",
                    )
                    .and_then(|get| get.call((pattern, if options.case_sensitive { "g" } else { "gi" }.into()).into()));
                if let Ok(Some(message)) = diagnostic {
                    error.reason = format!("Invalid regular expression: {message}");
                }
            }
            error
        }))
    }
}
