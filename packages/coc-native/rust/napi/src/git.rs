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

use std::collections::HashMap;
use std::path::PathBuf;

use coc_native_core::git::branch::{
    branch_status, list_branches, local_branch_names, parse_porcelain_v2_branch_status,
    repository_status, BranchEntry, BranchPage, BranchQuery, BranchStatus, RepositoryStatus,
};
use coc_native_core::git::commit::{
    commit_diff, commit_files, file_bytes_at_commit, file_content_at_commit, file_exists_at_commit,
    validate_ref, CommitFile, CommitFiles,
};
use coc_native_core::git::config::{global_config_add, global_config_get_all};
use coc_native_core::git::log::{get_commit, get_commits, Commit, CommitPage};
use coc_native_core::git::range::{
    changed_files, count_commits_ahead, default_remote_branch, diff_stats, merge_base,
    parse_changed_files, parse_diff_shortstat, resolve_base_ref, upstream_branch, BaseMode,
    BaseRefResolution, DefaultBranch, DiffStats, RangeFile,
};
use coc_native_core::git::remote::{detect_remote_url, remote_url};
use coc_native_core::git::repo::discover_workdir;
use coc_native_core::git::status::{
    parse_porcelain, status_entries, StatusEntry, STATUS_TIMEOUT_MS,
};
use coc_native_core::git::{run_git, GitCommandOptions, GitError, DEFAULT_TIMEOUT_MS};
use napi::bindgen_prelude::{AsyncTask, Buffer, Error, Result, Status, Task};
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
    /// Environment overrides layered on top of the environment Node already
    /// has. `GIT_TERMINAL_PROMPT`, `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` are
    /// what callers set; `PATH`, `HOME` and `SSH_AUTH_SOCK` are inherited, so
    /// `push` and `pull` still reach the user's credential helper and agent.
    pub env: Option<HashMap<String, String>>,
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
            env: options.env.map(|env| env.into_iter().collect()).unwrap_or_default(),
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
    /// The message after the title (`%b`), trimmed; empty when there is none.
    pub body: String,
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
            body: commit.body,
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

// ─────────────────────────────────────────────────────────────────────────────
// Commit detail
// ─────────────────────────────────────────────────────────────────────────────

/// One file a commit touched.
///
/// `commitHash`, `parentHash` and `repositoryRoot` are absent for the reason
/// they are absent on a status entry and a range file: they are the caller's
/// own values, and the caller attaches them.
#[napi(object)]
pub struct GitCommitFile {
    pub path: String,
    /// Source path of a rename or copy; absent otherwise.
    pub original_path: Option<String>,
    /// A `GitChangeStatus` string union member.
    pub status: String,
    /// Absent rather than zero when `--numstat` had nothing to say — a binary
    /// file, above all. The UI renders a blank column there rather than a
    /// misleading `0`.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

impl From<CommitFile> for GitCommitFile {
    fn from(file: CommitFile) -> Self {
        Self {
            path: file.path,
            original_path: file.original_path,
            status: file.status.as_str().to_string(),
            additions: file.additions,
            deletions: file.deletions,
        }
    }
}

/// A commit's file list, and the parent the list was computed against.
#[napi(object)]
pub struct GitCommitFiles {
    /// The commit's first parent, or git's empty tree for a root commit.
    pub parent_hash: String,
    pub files: Vec<GitCommitFile>,
}

pub struct GitCommitFilesTask {
    repo_root: PathBuf,
    commit: String,
    options: GitCommandOptions,
}

impl Task for GitCommitFilesTask {
    type Output = CommitFiles;
    type JsValue = GitCommitFiles;

    fn compute(&mut self) -> Result<Self::Output> {
        commit_files(&self.repo_root, &self.commit, &self.options).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(GitCommitFiles {
            parent_hash: output.parent_hash,
            files: output.files.into_iter().map(GitCommitFile::from).collect(),
        })
    }
}

/// Read the files a commit touched, with their line counts and its parent.
///
/// Three children become one crossing: the parent comes from `gix`, and the
/// two `diff-tree` runs are joined in Rust rather than crossing as text. A root
/// commit has no file list at all — `diff-tree` compares against parents — but
/// still reports the empty tree as its parent.
#[napi(ts_return_type = "Promise<GitCommitFiles>")]
pub fn git_commit_files(
    repo_root: String,
    commit: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitCommitFilesTask> {
    AsyncTask::new(GitCommitFilesTask {
        repo_root: PathBuf::from(repo_root),
        commit,
        options: resolve_options(options),
    })
}

pub struct GitCommitDiffTask {
    repo_root: PathBuf,
    commit: String,
    options: GitCommandOptions,
}

impl Task for GitCommitDiffTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        commit_diff(&self.repo_root, &self.commit, &self.options).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Read a commit's diff against its parent.
///
/// The parent resolution is `gix`, so the two children this used to cost are
/// down to the one `git diff` that still does the real work.
#[napi(ts_return_type = "Promise<string>")]
pub fn git_commit_diff(
    repo_root: String,
    commit: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitCommitDiffTask> {
    AsyncTask::new(GitCommitDiffTask {
        repo_root: PathBuf::from(repo_root),
        commit,
        options: resolve_options(options),
    })
}

pub struct GitFileContentAtCommitTask {
    repo_root: PathBuf,
    rev: String,
    path: String,
}

impl Task for GitFileContentAtCommitTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        file_content_at_commit(&self.repo_root, &self.rev, &self.path).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Read a file's content as it stood at a commit.
///
/// The blob comes out of the object database rather than off `git show`'s
/// stdout, which is what keeps the trailing newline: every command that crosses
/// this boundary loses one, and a file's bytes cannot afford to.
///
/// Resolves with `null` for a missing path, a revision that names nothing, and
/// a path that names a directory. Only a path that is not a repository rejects.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_file_content_at_commit(
    repo_root: String,
    rev: String,
    path: String,
) -> AsyncTask<GitFileContentAtCommitTask> {
    AsyncTask::new(GitFileContentAtCommitTask { repo_root: PathBuf::from(repo_root), rev, path })
}

pub struct GitFileBytesAtCommitTask {
    repo_root: PathBuf,
    rev: String,
    path: String,
}

impl Task for GitFileBytesAtCommitTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;

    fn compute(&mut self) -> Result<Self::Output> {
        file_bytes_at_commit(&self.repo_root, &self.rev, &self.path).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(Buffer::from))
    }
}

/// Read a file's stored bytes as they stood at a commit.
///
/// The byte-exact twin of {@link git_file_content_at_commit}, for a caller that
/// writes the result back to disk instead of showing it. Decoding to a string
/// first would rewrite every byte sequence that is not valid UTF-8 into U+FFFD,
/// so an image in the notes sync mirror would come back corrupted.
///
/// Resolves with `null` for a missing path, a revision that names nothing, and
/// a path that names a directory. Only a path that is not a repository rejects.
#[napi(ts_return_type = "Promise<Buffer | null>")]
pub fn git_file_bytes_at_commit(
    repo_root: String,
    rev: String,
    path: String,
) -> AsyncTask<GitFileBytesAtCommitTask> {
    AsyncTask::new(GitFileBytesAtCommitTask { repo_root: PathBuf::from(repo_root), rev, path })
}

pub struct GitFileExistsAtCommitTask {
    repo_root: PathBuf,
    rev: String,
    path: String,
}

impl Task for GitFileExistsAtCommitTask {
    type Output = bool;
    type JsValue = bool;

    fn compute(&mut self) -> Result<Self::Output> {
        file_exists_at_commit(&self.repo_root, &self.rev, &self.path).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Whether `<rev>:<path>` names anything at a commit.
///
/// True for a directory as well as a file, because the `git cat-file -e` this
/// replaces asks whether the object exists and a tree is an object.
#[napi(ts_return_type = "Promise<boolean>")]
pub fn git_file_exists_at_commit(
    repo_root: String,
    rev: String,
    path: String,
) -> AsyncTask<GitFileExistsAtCommitTask> {
    AsyncTask::new(GitFileExistsAtCommitTask { repo_root: PathBuf::from(repo_root), rev, path })
}

pub struct GitValidateRefTask {
    repo_root: PathBuf,
    rev: String,
}

impl Task for GitValidateRefTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        validate_ref(&self.repo_root, &self.rev).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Resolve a ref and report its hash when it names a commit.
///
/// `rev-parse --verify` followed by `cat-file -t` in one crossing and no
/// children. Resolves with `null` for a ref that names nothing *and* for one
/// that names a non-commit — an annotated tag among them, because neither
/// command peeled and neither does this.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_validate_ref(repo_root: String, rev: String) -> AsyncTask<GitValidateRefTask> {
    AsyncTask::new(GitValidateRefTask { repo_root: PathBuf::from(repo_root), rev })
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit ranges
// ─────────────────────────────────────────────────────────────────────────────

/// The repository's default branch, and whether it came from a remote ref.
///
/// `fromRemote` is what lets the caller keep memoising exactly the answers it
/// always memoised: the TypeScript cached `origin/main`, `origin/master` and
/// `origin/HEAD` for a minute and deliberately left the local `main`/`master`
/// fallbacks uncached.
#[napi(object)]
pub struct GitRangeDefaultBranch {
    pub name: String,
    pub from_remote: bool,
}

/// Which ref a range is measured against, and whether that was the ref asked for.
#[napi(object)]
pub struct GitRangeBaseRef {
    /// Absent when the repository has no default branch to fall back to.
    pub base_ref: Option<String>,
    /// The `GitRangeBaseMode` actually used — not always the one requested.
    pub base_mode: String,
    /// True when `upstream` was asked for but the branch has no upstream.
    pub base_mode_fallback: bool,
}

/// One file in a commit range, minus the `repositoryRoot` the caller owns.
#[napi(object)]
pub struct GitRangeFile {
    pub path: String,
    /// A `GitChangeStatus` string union member.
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    /// Source path of a rename or copy; absent otherwise.
    pub old_path: Option<String>,
}

impl From<RangeFile> for GitRangeFile {
    fn from(file: RangeFile) -> Self {
        Self {
            path: file.path,
            status: file.status.as_str().to_string(),
            additions: file.additions,
            deletions: file.deletions,
            old_path: file.old_path,
        }
    }
}

/// Added and removed line totals across a range.
#[napi(object)]
pub struct GitRangeDiffStats {
    pub additions: u32,
    pub deletions: u32,
}

impl From<DiffStats> for GitRangeDiffStats {
    fn from(stats: DiffStats) -> Self {
        Self { additions: stats.additions, deletions: stats.deletions }
    }
}

pub struct GitRangeDefaultBranchTask {
    repo_root: PathBuf,
}

impl Task for GitRangeDefaultBranchTask {
    type Output = Option<DefaultBranch>;
    type JsValue = Option<GitRangeDefaultBranch>;

    fn compute(&mut self) -> Result<Self::Output> {
        default_remote_branch(&self.repo_root).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(|branch| GitRangeDefaultBranch {
            name: branch.name,
            from_remote: branch.from_remote,
        }))
    }
}

/// Find the repository's default branch: `origin/main`, `origin/master`,
/// whatever `origin/HEAD` points at, then local `main` or `master`.
///
/// Five ref lookups through `gix` where the TypeScript spawned up to five
/// `rev-parse --verify` children. Resolves with `null` when none of them exist.
#[napi(ts_return_type = "Promise<GitRangeDefaultBranch | null>")]
pub fn git_range_default_branch(repo_root: String) -> AsyncTask<GitRangeDefaultBranchTask> {
    AsyncTask::new(GitRangeDefaultBranchTask { repo_root: PathBuf::from(repo_root) })
}

pub struct GitRangeUpstreamTask {
    repo_root: PathBuf,
}

impl Task for GitRangeUpstreamTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        upstream_branch(&self.repo_root).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// The current branch's upstream, e.g. `origin/my-feature`.
///
/// Resolves with `null` for a branch with no upstream and for a detached HEAD,
/// both of which the caller already read as "no tracking branch".
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_range_upstream_branch(repo_root: String) -> AsyncTask<GitRangeUpstreamTask> {
    AsyncTask::new(GitRangeUpstreamTask { repo_root: PathBuf::from(repo_root) })
}

pub struct GitRangeBaseRefTask {
    repo_root: PathBuf,
    base_mode: BaseMode,
}

impl Task for GitRangeBaseRefTask {
    type Output = BaseRefResolution;
    type JsValue = GitRangeBaseRef;

    fn compute(&mut self) -> Result<Self::Output> {
        resolve_base_ref(&self.repo_root, self.base_mode).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(GitRangeBaseRef {
            base_ref: output.base_ref,
            base_mode: output.base_mode.as_str().to_string(),
            base_mode_fallback: output.base_mode_fallback,
        })
    }
}

/// Resolve the ref a range should be measured against.
///
/// `baseMode` is a `GitRangeBaseMode` member; anything else reads as
/// `default-branch`, matching what the route does with a misspelled `?base=`.
/// Asking for `upstream` on a branch with no upstream resolves to the default
/// branch with `baseModeFallback` set, rather than to nothing.
#[napi(ts_return_type = "Promise<GitRangeBaseRef>")]
pub fn git_range_resolve_base_ref(
    repo_root: String,
    base_mode: String,
) -> AsyncTask<GitRangeBaseRefTask> {
    AsyncTask::new(GitRangeBaseRefTask {
        repo_root: PathBuf::from(repo_root),
        base_mode: BaseMode::from_name(&base_mode),
    })
}

pub struct GitRangeMergeBaseTask {
    repo_root: PathBuf,
    one: String,
    two: String,
}

impl Task for GitRangeMergeBaseTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        merge_base(&self.repo_root, &self.one, &self.two).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// The best merge base between two revisions.
///
/// Resolves with `null` for unrelated histories and for a revision that names
/// nothing — both of which `git merge-base` reported by exiting non-zero, and
/// the caller turned into a null.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_range_merge_base(
    repo_root: String,
    one: String,
    two: String,
) -> AsyncTask<GitRangeMergeBaseTask> {
    AsyncTask::new(GitRangeMergeBaseTask { repo_root: PathBuf::from(repo_root), one, two })
}

pub struct GitRangeCountAheadTask {
    repo_root: PathBuf,
    base_ref: String,
    head_ref: String,
}

impl Task for GitRangeCountAheadTask {
    type Output = u32;
    type JsValue = u32;

    fn compute(&mut self) -> Result<Self::Output> {
        count_commits_ahead(&self.repo_root, &self.base_ref, &self.head_ref).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// How many commits `headRef` has that `baseRef` does not.
///
/// `git rev-list --count <base>..<head>` as a `gix` walk. A revision that names
/// nothing counts zero, which is what the TypeScript's `parseInt(...) || 0`
/// produced from the failed command.
#[napi(ts_return_type = "Promise<number>")]
pub fn git_range_count_ahead(
    repo_root: String,
    base_ref: String,
    head_ref: String,
) -> AsyncTask<GitRangeCountAheadTask> {
    AsyncTask::new(GitRangeCountAheadTask {
        repo_root: PathBuf::from(repo_root),
        base_ref,
        head_ref,
    })
}

pub struct GitRangeChangedFilesTask {
    repo_root: PathBuf,
    base_ref: String,
    head_ref: String,
    options: GitCommandOptions,
}

impl Task for GitRangeChangedFilesTask {
    type Output = Vec<RangeFile>;
    type JsValue = Vec<GitRangeFile>;

    fn compute(&mut self) -> Result<Self::Output> {
        changed_files(&self.repo_root, &self.base_ref, &self.head_ref, &self.options)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(GitRangeFile::from).collect())
    }
}

/// Read the files changed between two refs, in git's own order.
///
/// Runs `diff --numstat` and `diff --name-status -M -C` over the three-dot
/// range and joins them, so neither output crosses the boundary as text. The
/// list is not sorted: the caller orders it with `localeCompare`, which is not
/// a byte comparison and is what the range view already shows.
#[napi(ts_return_type = "Promise<GitRangeFile[]>")]
pub fn git_range_changed_files(
    repo_root: String,
    base_ref: String,
    head_ref: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitRangeChangedFilesTask> {
    AsyncTask::new(GitRangeChangedFilesTask {
        repo_root: PathBuf::from(repo_root),
        base_ref,
        head_ref,
        options: resolve_options(options),
    })
}

pub struct ParseGitRangeChangedFilesTask {
    numstat: String,
    name_status: String,
}

impl Task for ParseGitRangeChangedFilesTask {
    type Output = Vec<RangeFile>;
    type JsValue = Vec<GitRangeFile>;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(parse_changed_files(&self.numstat, &self.name_status))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(GitRangeFile::from).collect())
    }
}

/// Join `--numstat` and `--name-status` text that was produced somewhere else.
///
/// The WSL twin of {@link git_range_changed_files}, for the same reason
/// {@link parse_git_status_porcelain} exists: a repository inside a WSL distro
/// runs git through `wsl.exe` in TypeScript, and the parser must still be the
/// single one in the codebase.
#[napi(ts_return_type = "Promise<GitRangeFile[]>")]
pub fn parse_git_range_changed_files(
    numstat: String,
    name_status: String,
) -> AsyncTask<ParseGitRangeChangedFilesTask> {
    AsyncTask::new(ParseGitRangeChangedFilesTask { numstat, name_status })
}

pub struct GitRangeDiffStatsTask {
    repo_root: PathBuf,
    base_ref: String,
    head_ref: String,
    options: GitCommandOptions,
}

impl Task for GitRangeDiffStatsTask {
    type Output = DiffStats;
    type JsValue = GitRangeDiffStats;

    fn compute(&mut self) -> Result<Self::Output> {
        diff_stats(&self.repo_root, &self.base_ref, &self.head_ref, &self.options)
            .map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

/// Read the added and removed line totals between two refs.
#[napi(ts_return_type = "Promise<GitRangeDiffStats>")]
pub fn git_range_diff_stats(
    repo_root: String,
    base_ref: String,
    head_ref: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitRangeDiffStatsTask> {
    AsyncTask::new(GitRangeDiffStatsTask {
        repo_root: PathBuf::from(repo_root),
        base_ref,
        head_ref,
        options: resolve_options(options),
    })
}

pub struct ParseGitDiffShortstatTask {
    text: String,
}

impl Task for ParseGitDiffShortstatTask {
    type Output = DiffStats;
    type JsValue = GitRangeDiffStats;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(parse_diff_shortstat(&self.text))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

/// Parse `git diff --shortstat` text that was produced somewhere else.
///
/// The WSL twin of {@link git_range_diff_stats}.
#[napi(ts_return_type = "Promise<GitRangeDiffStats>")]
pub fn parse_git_diff_shortstat(text: String) -> AsyncTask<ParseGitDiffShortstatTask> {
    AsyncTask::new(ParseGitDiffShortstatTask { text })
}

// ─────────────────────────────────────────────────────────────────────────────
// Branches
// ─────────────────────────────────────────────────────────────────────────────

/// Repository metadata from one `git status --porcelain=v2 --branch` call.
#[napi(object)]
pub struct GitRepositoryStatus {
    /// Current branch name, or `HEAD` when detached.
    pub branch: String,
    pub is_detached: bool,
    /// Whether the index or working tree holds any change at all.
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    /// Configured upstream branch; absent when there is none.
    pub tracking_branch: Option<String>,
    /// Whether the repository has no commits yet.
    pub unborn: bool,
}

impl From<RepositoryStatus> for GitRepositoryStatus {
    fn from(status: RepositoryStatus) -> Self {
        Self {
            branch: status.branch,
            is_detached: status.is_detached,
            dirty: status.dirty,
            ahead: status.ahead,
            behind: status.behind,
            tracking_branch: status.tracking_branch,
            unborn: status.unborn,
        }
    }
}

/// The checked-out branch and its drift from upstream.
///
/// `hasUncommittedChanges` is missing on purpose: the caller already has that
/// answer and merges it in, rather than paying for a second status read here.
#[napi(object)]
pub struct GitBranchStatus {
    /// Empty when HEAD is detached.
    pub name: String,
    pub is_detached: bool,
    /// The commit HEAD points at; only present when detached.
    pub detached_hash: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Remote tracking branch, e.g. `origin/main`; absent when unconfigured.
    pub tracking_branch: Option<String>,
}

impl From<BranchStatus> for GitBranchStatus {
    fn from(status: BranchStatus) -> Self {
        Self {
            name: status.name,
            is_detached: status.is_detached,
            detached_hash: status.detached_hash,
            ahead: status.ahead,
            behind: status.behind,
            tracking_branch: status.tracking_branch,
        }
    }
}

/// One branch as the branch list renders it.
#[napi(object)]
pub struct GitBranchEntry {
    /// Short name — `main` locally, `origin/main` for a remote branch.
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    /// The part before the first `/` of a remote branch's name.
    pub remote_name: Option<String>,
    pub last_commit_subject: String,
    /// `%(committerdate:relative)`, e.g. `3 days ago`.
    pub last_commit_date: String,
}

impl From<BranchEntry> for GitBranchEntry {
    fn from(branch: BranchEntry) -> Self {
        Self {
            name: branch.name,
            is_current: branch.is_current,
            is_remote: branch.is_remote,
            remote_name: branch.remote_name,
            last_commit_subject: branch.last_commit_subject,
            last_commit_date: branch.last_commit_date,
        }
    }
}

/// One page of the branch list.
#[napi(object)]
pub struct GitBranchPage {
    pub branches: Vec<GitBranchEntry>,
    /// Matching branches in the whole repository, not just on this page.
    pub total_count: u32,
    pub has_more: bool,
}

/// Which slice of the branch list to read.
#[napi(object)]
pub struct GitBranchListOptions {
    /// Remote branches instead of local ones.
    pub remote: bool,
    /// Branches to return. Zero returns the total with no rows, which is how
    /// the count-only callers ask their question.
    pub limit: u32,
    pub offset: u32,
    /// Case-insensitive substring the branch *name* must contain.
    pub search: Option<String>,
}

pub struct GitRepositoryStatusTask {
    repo_root: PathBuf,
}

impl Task for GitRepositoryStatusTask {
    type Output = RepositoryStatus;
    type JsValue = GitRepositoryStatus;

    fn compute(&mut self) -> Result<Self::Output> {
        repository_status(&self.repo_root).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

/// Read branch, tracking and working-tree metadata with one git command.
///
/// Still the CLI rather than `gix`: the answer includes whether the tree is
/// dirty, and deciding that means the index refresh and `.gitignore` walk git
/// already does.
#[napi(ts_return_type = "Promise<GitRepositoryStatus>")]
pub fn git_repository_status(repo_root: String) -> AsyncTask<GitRepositoryStatusTask> {
    AsyncTask::new(GitRepositoryStatusTask { repo_root: PathBuf::from(repo_root) })
}

pub struct ParseGitBranchStatusTask {
    output: String,
}

impl Task for ParseGitBranchStatusTask {
    type Output = RepositoryStatus;
    type JsValue = GitRepositoryStatus;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(parse_porcelain_v2_branch_status(&self.output))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

/// Parse `--porcelain=v2 --branch` text produced somewhere else.
///
/// The WSL twin of {@link git_repository_status}: those repositories run git
/// through `wsl.exe` in TypeScript, and this keeps the parser a single
/// implementation rather than two that drift.
#[napi(ts_return_type = "Promise<GitRepositoryStatus>")]
pub fn parse_git_branch_status(output: String) -> AsyncTask<ParseGitBranchStatusTask> {
    AsyncTask::new(ParseGitBranchStatusTask { output })
}

pub struct GitBranchStatusTask {
    repo_root: PathBuf,
}

impl Task for GitBranchStatusTask {
    type Output = Option<BranchStatus>;
    type JsValue = Option<GitBranchStatus>;

    fn compute(&mut self) -> Result<Self::Output> {
        branch_status(&self.repo_root).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(GitBranchStatus::from))
    }
}

/// Read the checked-out branch, its upstream, and the drift between them.
///
/// One opened repository in place of the four `rev-parse` / `symbolic-ref` /
/// `rev-list` children the Git tab used to spawn for this. Resolves with `null`
/// when HEAD names nothing — an unborn branch — which the caller has always
/// treated as an absent status rather than a failure.
#[napi(ts_return_type = "Promise<GitBranchStatus | null>")]
pub fn git_branch_status(repo_root: String) -> AsyncTask<GitBranchStatusTask> {
    AsyncTask::new(GitBranchStatusTask { repo_root: PathBuf::from(repo_root) })
}

pub struct GitListBranchesTask {
    repo_root: PathBuf,
    query: BranchQuery,
}

impl Task for GitListBranchesTask {
    type Output = BranchPage;
    type JsValue = GitBranchPage;

    fn compute(&mut self) -> Result<Self::Output> {
        list_branches(&self.repo_root, &self.query, now_seconds()).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(GitBranchPage {
            branches: output.branches.into_iter().map(GitBranchEntry::from).collect(),
            total_count: output.total_count,
            has_more: output.has_more,
        })
    }
}

/// Read a page of the branch list, in git's own `refname` order.
///
/// Backed by `gix`, so a page costs no child processes — and no shell either:
/// the TypeScript built a `git branch | grep | tail | head` pipeline whose
/// Windows half had to be spelled with `findstr` instead.
#[napi(ts_return_type = "Promise<GitBranchPage>")]
pub fn git_list_branches(
    repo_root: String,
    options: GitBranchListOptions,
) -> AsyncTask<GitListBranchesTask> {
    AsyncTask::new(GitListBranchesTask {
        repo_root: PathBuf::from(repo_root),
        query: BranchQuery {
            remote: options.remote,
            limit: options.limit,
            offset: options.offset,
            search: options.search,
        },
    })
}

pub struct GitLocalBranchNamesTask {
    repo_root: PathBuf,
}

impl Task for GitLocalBranchNamesTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        local_branch_names(&self.repo_root).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Read every local branch's short name, in git's `refname` order.
///
/// `git branch --format="%(refname:short)"` without the per-branch commit
/// lookup {@link git_list_branches} pays for its subject and date columns. The
/// caller's own filtering and its ten-name cap stay in TypeScript: they are
/// what one list chose to show, not what the repository holds.
#[napi(ts_return_type = "Promise<string[]>")]
pub fn git_local_branch_names(repo_root: String) -> AsyncTask<GitLocalBranchNamesTask> {
    AsyncTask::new(GitLocalBranchNamesTask { repo_root: PathBuf::from(repo_root) })
}

pub struct GitRemoteUrlTask {
    repo_root: PathBuf,
    remote: String,
}

impl Task for GitRemoteUrlTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        remote_url(&self.repo_root, &self.remote).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Read `git remote get-url <remote>` from configuration, with no child
/// process at all.
///
/// Resolves with `null` when the remote is not configured or carries no URL —
/// the two cases `get-url` reported as one non-zero exit, and the caller as one
/// absent value. Only a path that is not a repository rejects.
///
/// The bytes come back as configured: `gix` lowercases a host when it renders a
/// parsed URL, and this string is what the sidebar's grouping key is built
/// from, so the raw value wins wherever it and the resolved URL agree.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_remote_url(repo_root: String, remote: String) -> AsyncTask<GitRemoteUrlTask> {
    AsyncTask::new(GitRemoteUrlTask { repo_root: PathBuf::from(repo_root), remote })
}

pub struct GitDetectRemoteUrlTask {
    repo_root: PathBuf,
}

impl Task for GitDetectRemoteUrlTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        detect_remote_url(&self.repo_root).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// The repository's primary remote URL: `origin`, or the first remote by name
/// when `origin` is not configured.
///
/// One call over one opened repository, where the TypeScript spawned between
/// one and three children to ask the same question. Resolves with `null` for a
/// repository with no remotes; rejects only when the path is not a repository,
/// which the caller reads as `undefined` too.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_detect_remote_url(repo_root: String) -> AsyncTask<GitDetectRemoteUrlTask> {
    AsyncTask::new(GitDetectRemoteUrlTask { repo_root: PathBuf::from(repo_root) })
}

// ─────────────────────────────────────────────────────────────────────────────
// Global configuration
// ─────────────────────────────────────────────────────────────────────────────

pub struct GitGlobalConfigGetAllTask {
    key: String,
    options: GitCommandOptions,
}

impl Task for GitGlobalConfigGetAllTask {
    type Output = Vec<String>;
    type JsValue = Vec<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        global_config_get_all(&self.key, &self.options).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Every value `git config --global --get-all <key>` prints, one per element.
///
/// No repository is involved, so there is no `repoRoot` parameter: this reads
/// the user's own config file, which is exactly what the `safe.directory` check
/// needs — a repository-local entry is not what Git for Windows consults before
/// agreeing to open a repo on the WSL share.
///
/// Rejects with `git config --global --get-all <key> failed:` when the key is
/// unset or the global config file does not exist; the caller reads both as
/// "not configured".
#[napi(ts_return_type = "Promise<string[]>")]
pub fn git_global_config_get_all(
    key: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitGlobalConfigGetAllTask> {
    let options = resolve_options(options);
    AsyncTask::new(GitGlobalConfigGetAllTask { key, options })
}

pub struct GitGlobalConfigAddTask {
    key: String,
    value: String,
    options: GitCommandOptions,
}

impl Task for GitGlobalConfigAddTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        global_config_add(&self.key, &self.value, &self.options).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

/// Append a value to a multi-valued key in the global config file.
///
/// `--add`, not a set: `safe.directory` is a list of every repository the user
/// has approved, and replacing it would revoke the rest.
#[napi(ts_return_type = "Promise<void>")]
pub fn git_global_config_add(
    key: String,
    value: String,
    options: Option<GitExecOptions>,
) -> AsyncTask<GitGlobalConfigAddTask> {
    let options = resolve_options(options);
    AsyncTask::new(GitGlobalConfigAddTask { key, value, options })
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository discovery
// ─────────────────────────────────────────────────────────────────────────────

pub struct GitDiscoverRepoRootTask {
    path: PathBuf,
}

impl Task for GitDiscoverRepoRootTask {
    type Output = Option<String>;
    type JsValue = Option<String>;

    fn compute(&mut self) -> Result<Self::Output> {
        discover_workdir(&self.path).map_err(to_napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// The working-tree root containing `path` — `git rev-parse --show-toplevel`
/// without the child process.
///
/// Resolves with `null` for every case the caller reads as "not a repository":
/// a path that does not exist, a path outside any repository, and a bare
/// repository, where `--show-toplevel` fails because there is no work tree.
/// `path` is expected absolute; the caller resolves relative paths with Node's
/// `path.resolve` so the process's own working directory keeps deciding what a
/// relative path means.
#[napi(ts_return_type = "Promise<string | null>")]
pub fn git_discover_repo_root(path: String) -> AsyncTask<GitDiscoverRepoRootTask> {
    AsyncTask::new(GitDiscoverRepoRootTask { path: PathBuf::from(path) })
}
