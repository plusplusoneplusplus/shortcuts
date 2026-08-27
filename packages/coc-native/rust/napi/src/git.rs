//! N-API bindings for the git capability: thin `AsyncTask` wrappers around
//! core, so every call happens on a libuv worker rather than on Node's
//! event-loop thread.
//!
//! Two backends sit behind these exports. Running a command goes through
//! core's `git::run_git`, which spawns the CLI. Reading history goes through
//! `git::log`, which is `gix`-backed and spawns nothing at all. Which one a
//! given export uses is an implementation detail — the failures they produce
//! wear the same `git <args> failed: <stderr>` text either way.
//!
//! There is no index object here — git owns the state, and each call reads or
//! mutates the repository directly.

use std::path::PathBuf;

use coc_native_core::git::log::{get_commit, get_commits, Commit, CommitPage};
use coc_native_core::git::status::{
    parse_porcelain, status_entries, StatusEntry, STATUS_TIMEOUT_MS,
};
use coc_native_core::git::{run_git, GitCommandOptions, GitError, DEFAULT_TIMEOUT_MS};
use napi::bindgen_prelude::{AsyncTask, Error, Result, Status, Task};
use napi::Env;
use napi_derive::napi;

/// Per-call overrides for one git invocation. Every field is optional;
/// omitting all of them uses a 30 s timeout and a 50 MiB output cap.
#[napi(object)]
pub struct GitExecOptions {
    /// Bytes of stdout (and of stderr) kept before the call fails.
    /// Defaults to 50 MiB.
    pub max_buffer: Option<u32>,
    /// Milliseconds before the child is killed. Defaults to 30 000.
    pub timeout: Option<u32>,
    /// Working directory for the child. `-C` already points git at the repo, so
    /// this is rarely needed.
    pub cwd: Option<String>,
}

/// Render a failure the way routes and the UI already display it.
///
/// The `git <args> failed: <stderr>` text crosses the boundary unchanged, so a
/// caller that used to read the message off a Node `execFile` rejection still
/// reads the same words off the N-API rejection.
fn to_napi_error(error: GitError) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

pub struct ExecGitTask {
    repo_root: PathBuf,
    args: Vec<String>,
    options: GitCommandOptions,
}

impl Task for ExecGitTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        run_git(&self.repo_root, &self.args, &self.options).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Run `git -C <repoRoot> <args>` and resolve with its trimmed stdout.
///
/// No shell is involved, so arguments containing spaces need no quoting. A
/// non-zero exit, a timeout, or output past the buffer cap all reject with
/// `git <args> failed: <stderr>`.
#[napi(ts_return_type = "Promise<string>")]
pub fn exec_git(
    args: Vec<String>,
    repo_root: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<ExecGitTask> {
    let options = resolve_options(options);
    AsyncTask::new(ExecGitTask { repo_root: PathBuf::from(repo_root), args, options })
}

/// Fill an optional JavaScript options object in with the command defaults.
fn resolve_options(options: Option<GitExecOptions>) -> GitCommandOptions {
    let defaults = GitCommandOptions::default();
    match options {
        Some(options) => GitCommandOptions {
            timeout_ms: options.timeout.map_or(defaults.timeout_ms, u64::from),
            max_buffer_bytes: options
                .max_buffer
                .map_or(defaults.max_buffer_bytes, |bytes| bytes as usize),
            cwd: options.cwd.map(PathBuf::from),
        },
        None => defaults,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Working-tree status
// ─────────────────────────────────────────────────────────────────────────────

/// One working-tree change, with the path spelled exactly as git printed it.
///
/// `status` and `stage` are the `GitChangeStatus` and `GitChangeStage` string
/// unions verbatim, so the TypeScript side casts rather than translates. The
/// path stays repository-relative: `path.join` and `path.basename` decide what
/// the UI shows, and their separator handling belongs in Node.
#[napi(object)]
pub struct GitStatusEntry {
    pub path: String,
    /// Source path of a rename or copy; absent otherwise.
    pub original_path: Option<String>,
    pub status: String,
    pub stage: String,
}

impl From<StatusEntry> for GitStatusEntry {
    fn from(entry: StatusEntry) -> Self {
        Self {
            path: entry.path,
            original_path: entry.original_path,
            status: entry.status.as_str().to_string(),
            stage: entry.stage.as_str().to_string(),
        }
    }
}

pub struct GitStatusEntriesTask {
    repo_root: PathBuf,
    options: GitCommandOptions,
}

impl Task for GitStatusEntriesTask {
    type Output = Vec<StatusEntry>;
    type JsValue = Vec<GitStatusEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        status_entries(&self.repo_root, &self.options).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(GitStatusEntry::from).collect())
    }
}

/// Read the full working-tree change list for a repository.
///
/// Runs `git status --porcelain --untracked-files=all` and parses it, so the
/// output never crosses the boundary as text. Defaults to the 15 s timeout the
/// working-tree read path has always used, rather than the 30 s command default.
#[napi(ts_return_type = "Promise<GitStatusEntry[]>")]
pub fn git_status_entries(
    repo_root: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitStatusEntriesTask> {
    let mut resolved = resolve_options(options);
    if resolved.timeout_ms == DEFAULT_TIMEOUT_MS {
        resolved.timeout_ms = STATUS_TIMEOUT_MS;
    }
    AsyncTask::new(GitStatusEntriesTask { repo_root: PathBuf::from(repo_root), options: resolved })
}

pub struct ParseGitStatusTask {
    output: String,
}

impl Task for ParseGitStatusTask {
    type Output = Vec<StatusEntry>;
    type JsValue = Vec<GitStatusEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(parse_porcelain(&self.output))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(GitStatusEntry::from).collect())
    }
}

/// Parse porcelain text that was produced somewhere else.
///
/// This exists for repositories inside a WSL distro: those run git through
/// `wsl.exe` in TypeScript and never reach {@link git_status_entries}, but the
/// parser must still be the single one in the codebase. The work stays on a
/// worker thread because a large repository's status output runs to megabytes.
#[napi(ts_return_type = "Promise<GitStatusEntry[]>")]
pub fn parse_git_status_porcelain(output: String) -> AsyncTask<ParseGitStatusTask> {
    AsyncTask::new(ParseGitStatusTask { output })
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit history
// ─────────────────────────────────────────────────────────────────────────────

/// One commit, field-for-field the `GitCommit` the Git tab renders — minus
/// `repositoryRoot` and `repositoryName`, which the TypeScript caller fills in
/// because building paths is `path.join`'s job and stays in Node.
#[napi(object)]
pub struct GitLogCommit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    /// ISO 8601 strict, in the author's own timezone offset (`%aI`).
    pub date: String,
    /// "3 days ago" (`%ar`).
    pub relative_date: String,
    /// Space-separated parent hashes (`%P`); empty for a root commit.
    pub parent_hashes: String,
    /// Decoration names (`%D`), already split and trimmed.
    pub refs: Vec<String>,
    /// Whether the commit is on `HEAD` but not on its upstream. Absent when
    /// nobody asked — reading a single commit never computed it.
    pub is_ahead_of_remote: Option<bool>,
}

impl From<Commit> for GitLogCommit {
    fn from(commit: Commit) -> Self {
        Self {
            hash: commit.hash,
            short_hash: commit.short_hash,
            subject: commit.subject,
            author_name: commit.author_name,
            author_email: commit.author_email,
            date: commit.date,
            relative_date: commit.relative_date,
            parent_hashes: commit.parent_hashes,
            refs: commit.refs,
            is_ahead_of_remote: commit.is_ahead_of_remote,
        }
    }
}

/// One page of history, plus whether asking for the next one is worthwhile.
#[napi(object)]
pub struct GitLogPage {
    pub commits: Vec<GitLogCommit>,
    pub has_more: bool,
}

/// Which slice of history to read — the `CommitLoadOptions` the service takes.
#[napi(object)]
pub struct GitLogOptions {
    /// Commits per page.
    pub max_count: u32,
    /// Commits to skip before the page starts.
    pub skip: u32,
    /// Case-insensitive substring the commit message must contain.
    pub search: Option<String>,
}

/// Seconds since the epoch, for rendering `%ar`.
///
/// Read once per call rather than per commit, so every row on a page is
/// described against the same instant.
fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0)
}

pub struct GitLogCommitsTask {
    repo_root: PathBuf,
    options: GitLogOptions,
}

impl Task for GitLogCommitsTask {
    type Output = CommitPage;
    type JsValue = GitLogPage;

    fn compute(&mut self) -> Result<Self::Output> {
        get_commits(
            &self.repo_root,
            self.options.max_count as usize,
            self.options.skip as usize,
            self.options.search.as_deref(),
            now_seconds(),
        )
        .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(GitLogPage {
            commits: output.commits.into_iter().map(GitLogCommit::from).collect(),
            has_more: output.has_more,
        })
    }
}

/// Read a page of commit history, newest first.
///
/// Backed by `gix`, so a page costs no child processes: the walk, the ref
/// decoration and the unpushed-commit set all come out of one open repository.
/// An unborn branch resolves to an empty page rather than rejecting, matching
/// what the Git tab showed for a repository with no commits.
#[napi(ts_return_type = "Promise<GitLogPage>")]
pub fn git_log_commits(repo_root: String, options: GitLogOptions) -> AsyncTask<GitLogCommitsTask> {
    AsyncTask::new(GitLogCommitsTask { repo_root: PathBuf::from(repo_root), options })
}

pub struct GitLogCommitTask {
    repo_root: PathBuf,
    rev: String,
}

impl Task for GitLogCommitTask {
    type Output = Option<Commit>;
    type JsValue = Option<GitLogCommit>;

    fn compute(&mut self) -> Result<Self::Output> {
        get_commit(&self.repo_root, &self.rev, now_seconds()).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(GitLogCommit::from))
    }
}

/// Read one commit by any revision spec git would accept.
///
/// Resolves with `null` for a spec that names nothing, because the caller has
/// always treated "no such commit" as an absent value rather than a failure.
#[napi(ts_return_type = "Promise<GitLogCommit | null>")]
pub fn git_log_commit(repo_root: String, rev: String) -> AsyncTask<GitLogCommitTask> {
    AsyncTask::new(GitLogCommitTask { repo_root: PathBuf::from(repo_root), rev })
}
