//! N-API bindings for running git: a thin `AsyncTask` wrapper around core's
//! `git::run_git`, so every invocation happens on a libuv worker rather than by
//! spawning a child process from Node's event-loop thread.
//!
//! There is no index object here — git owns the state, and each call reads or
//! mutates the repository directly.

use std::path::PathBuf;

use coc_native_core::git::{run_git, GitCommandOptions, GitError};
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
    let defaults = GitCommandOptions::default();
    let options = match options {
        Some(options) => GitCommandOptions {
            timeout_ms: options.timeout.map_or(defaults.timeout_ms, u64::from),
            max_buffer_bytes: options
                .max_buffer
                .map_or(defaults.max_buffer_bytes, |bytes| bytes as usize),
            cwd: options.cwd.map(PathBuf::from),
        },
        None => defaults,
    };
    AsyncTask::new(ExecGitTask { repo_root: PathBuf::from(repo_root), args, options })
}
