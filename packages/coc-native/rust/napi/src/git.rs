//! N-API bindings for running git: a thin `AsyncTask` wrapper around core's
//! `git::run_git`, so every invocation happens on a libuv worker rather than by
//! spawning a child process from Node's event-loop thread.
//!
//! There is no index object here — git owns the state, and each call reads or
//! mutates the repository directly.

use std::path::PathBuf;

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
