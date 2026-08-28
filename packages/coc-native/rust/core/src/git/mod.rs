//! Running `git` from Rust, on a worker thread instead of a Node child process.
//!
//! This is the foundation every other git capability sits on: read paths will
//! grow `gix`-backed implementations beside it, but mutating and network
//! operations (`push`, `pull`, `fetch`, `clone`, merge, rebase) always come
//! through here, so credential helpers, SSH agents and 2FA keep working exactly
//! as they do when a human runs git.
//!
//! The runner is a faithful port of what `execGitAsync` did in TypeScript:
//! `git -C <repo_root> <args>` with no shell, the same 30 s timeout and 50 MiB
//! output cap, one trailing newline stripped, and failures rendered as
//! `git <args> failed: <stderr>` — routes and the UI show that string to users
//! verbatim, so the shape is part of the contract rather than an implementation
//! detail.
//!
//! WSL is deliberately absent. When a repo lives inside a WSL distro the
//! TypeScript caller routes through `wsl.exe` itself and never reaches this
//! module; Rust only ever runs git on the native host.

pub mod branch;
pub mod config;
pub mod log;
pub mod range;
pub mod remote;
pub mod repo;
pub mod status;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Timeout applied when the caller does not pick one.
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;

/// Cap on captured stdout/stderr when the caller does not pick one.
pub const DEFAULT_MAX_BUFFER_BYTES: usize = 50 * 1024 * 1024;

/// Per-call overrides for one git invocation.
#[derive(Debug, Clone)]
pub struct GitCommandOptions {
    /// Milliseconds before the child is killed. Zero means "no limit".
    pub timeout_ms: u64,
    /// Bytes of stdout (and of stderr) kept before the call fails.
    pub max_buffer_bytes: usize,
    /// Working directory for the child. `-C` already points git at the repo,
    /// so this only matters for the few commands that resolve paths relative
    /// to the process's own directory.
    pub cwd: Option<PathBuf>,
    /// Environment overrides layered on top of the inherited environment,
    /// applied in order so a later entry wins.
    ///
    /// Layered rather than replacing, because the interesting variables are
    /// the ones nobody names here: `PATH`, `HOME`, `SSH_AUTH_SOCK` and the
    /// credential helper's own configuration are what let `push`, `pull` and
    /// `fetch` reach the user's agent and 2FA prompt exactly as they do when
    /// a human runs git. Callers set `GIT_TERMINAL_PROMPT`, `GIT_EDITOR` and
    /// `GIT_SEQUENCE_EDITOR` here.
    pub env: Vec<(String, String)>,
}

impl Default for GitCommandOptions {
    fn default() -> Self {
        Self {
            timeout_ms: DEFAULT_TIMEOUT_MS,
            max_buffer_bytes: DEFAULT_MAX_BUFFER_BYTES,
            cwd: None,
            env: Vec::new(),
        }
    }
}

/// Why a git invocation did not produce output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitErrorKind {
    /// The child ran and exited non-zero. Carries the exit code when the
    /// platform reports one (a signal death leaves it `None`).
    Exit(Option<i32>),
    /// The child outlived `timeout_ms` and was killed.
    Timeout,
    /// Output passed `max_buffer_bytes`.
    MaxBuffer,
    /// The child never started — no `git` on PATH, or a `cwd` that is gone.
    Spawn,
    /// No child was involved: a `gix`-backed read path could not open the
    /// repository or decode an object.
    Repository,
}

/// A failed git invocation, rendered the way the UI already expects.
#[derive(Debug, Clone)]
pub struct GitError {
    pub kind: GitErrorKind,
    /// The sub-command and arguments, without the `-C <repo_root>` prefix —
    /// the error text has always shown what the caller asked for, not how the
    /// repository was addressed.
    pub args: Vec<String>,
    /// Trimmed stderr. Empty for a spawn failure, matching what Node's
    /// `execFile` left on an `ENOENT` error object.
    pub stderr: String,
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "git {} failed: {}", self.args.join(" "), self.stderr)
    }
}

impl std::error::Error for GitError {}

impl GitError {
    /// Build an error for a failure that did not come from a child process.
    ///
    /// The `gix` read paths use this so their failures reach routes and the UI
    /// wearing the same `git <args> failed: <stderr>` text as a CLI failure —
    /// which backend produced the message is not something a caller should have
    /// to care about.
    pub fn from_parts(kind: GitErrorKind, args: &[String], stderr: impl Into<String>) -> Self {
        Self::new(kind, args, stderr)
    }

    fn new(kind: GitErrorKind, args: &[String], stderr: impl Into<String>) -> Self {
        Self { kind, args: args.to_vec(), stderr: stderr.into().trim().to_string() }
    }
}

/// Strip exactly one trailing line ending, as `String.replace(/\r?\n$/, '')` does.
///
/// One, not all: `git log` separators and `git show` bodies can legitimately
/// end in a blank line, and trimming greedily would silently reshape them.
fn strip_one_trailing_newline(text: &str) -> &str {
    let text = text.strip_suffix('\n').unwrap_or(text);
    text.strip_suffix('\r').unwrap_or(text)
}

/// One captured stream: the bytes kept, and whether the cap was hit.
struct Captured {
    bytes: Vec<u8>,
    overflowed: bool,
}

/// Read to EOF, keeping at most `cap` bytes and discarding the rest.
///
/// Reading past the cap rather than stopping keeps the child from blocking on
/// a full pipe while its sibling stream is still being drained; the discarded
/// tail costs nothing, since the call is about to fail anyway.
fn read_capped(mut stream: impl Read, cap: usize) -> Captured {
    let mut bytes = Vec::new();
    let mut overflowed = false;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                if bytes.len() + read > cap {
                    overflowed = true;
                    let room = cap.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&chunk[..room]);
                } else {
                    bytes.extend_from_slice(&chunk[..read]);
                }
            }
            Err(_) => break,
        }
    }
    Captured { bytes, overflowed }
}

enum StreamResult {
    Stdout(Captured),
    Stderr(Captured),
}

/// Wait for both pipes to close, killing the child if `timeout` elapses first.
///
/// Blocking on the readers rather than polling `try_wait` is what keeps a fast
/// command fast: the pipes close when git exits, so a 10 ms `git status`
/// returns in 10 ms rather than at the next poll tick.
fn drain_with_timeout(
    child: &mut Child,
    rx: mpsc::Receiver<StreamResult>,
    timeout: Option<Duration>,
) -> (Captured, Captured, bool) {
    let deadline = timeout.map(|t| Instant::now() + t);
    let mut stdout = None;
    let mut stderr = None;
    let mut timed_out = false;

    while stdout.is_none() || stderr.is_none() {
        let received = match deadline {
            Some(deadline) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                rx.recv_timeout(remaining).map_err(|_| ())
            }
            None => rx.recv().map_err(|_| ()),
        };
        match received {
            Ok(StreamResult::Stdout(captured)) => stdout = Some(captured),
            Ok(StreamResult::Stderr(captured)) => stderr = Some(captured),
            Err(()) => {
                // Either the deadline passed or a reader thread died. Both mean
                // we stop waiting; killing an already-exited child is a no-op.
                timed_out = deadline.is_some_and(|d| Instant::now() >= d);
                break;
            }
        }
    }

    if timed_out {
        let _ = child.kill();
    }

    let empty = || Captured { bytes: Vec::new(), overflowed: false };
    (stdout.unwrap_or_else(empty), stderr.unwrap_or_else(empty), timed_out)
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW — the equivalent of Node's `windowsHide: true`.
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

/// Run `git -C <repo_root> <args>` and return its trimmed stdout.
///
/// No shell is involved, so arguments holding spaces — repository paths above
/// all — need no quoting and cannot be re-split.
pub fn run_git(
    repo_root: &Path,
    args: &[String],
    options: &GitCommandOptions,
) -> Result<String, GitError> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root).args(args);
    run_command(command, args, options)
}

/// Run `git <args>` with no repository attached, and return its trimmed stdout.
///
/// The `-C <repo_root>` prefix is the whole difference from `run_git`. A
/// `--global` configuration read has no repository to point git at, and naming
/// one would change which files git consults — a repository-local
/// `safe.directory` is not the entry Git for Windows checks before it agrees to
/// open the repository in the first place.
///
/// Everything else is shared: the timeout, the output cap, and the
/// `git <args> failed: <stderr>` text a caller reads off the rejection.
pub fn run_git_global(args: &[String], options: &GitCommandOptions) -> Result<String, GitError> {
    let mut command = Command::new("git");
    command.args(args);
    run_command(command, args, options)
}

/// Spawn a prepared `git` command, drain both pipes, and render the outcome.
///
/// `args` is carried separately from the command because it is what the error
/// text shows — the caller asked for `config --global --get-all safe.directory`
/// and should read that back, not the `-C <path>` prefix that addressed the
/// repository.
fn run_command(
    mut command: Command,
    args: &[String],
    options: &GitCommandOptions,
) -> Result<String, GitError> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }
    for (key, value) in &options.env {
        command.env(key, value);
    }
    hide_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return Err(GitError::new(GitErrorKind::Spawn, args, "")),
    };

    let (tx, rx) = mpsc::channel();
    let cap = options.max_buffer_bytes;
    if let Some(stream) = child.stdout.take() {
        let tx = tx.clone();
        std::thread::spawn(move || tx.send(StreamResult::Stdout(read_capped(stream, cap))));
    }
    if let Some(stream) = child.stderr.take() {
        let tx = tx.clone();
        std::thread::spawn(move || tx.send(StreamResult::Stderr(read_capped(stream, cap))));
    }
    drop(tx);

    let timeout = (options.timeout_ms > 0).then(|| Duration::from_millis(options.timeout_ms));
    let (stdout, stderr, timed_out) = drain_with_timeout(&mut child, rx, timeout);
    let status = child.wait();

    let stderr_text = String::from_utf8_lossy(&stderr.bytes).into_owned();

    if timed_out {
        return Err(GitError::new(GitErrorKind::Timeout, args, stderr_text));
    }
    if stdout.overflowed || stderr.overflowed {
        return Err(GitError::new(GitErrorKind::MaxBuffer, args, stderr_text));
    }
    match status {
        Ok(status) if status.success() => {
            let text = String::from_utf8_lossy(&stdout.bytes).into_owned();
            Ok(strip_one_trailing_newline(&text).to_string())
        }
        Ok(status) => Err(GitError::new(GitErrorKind::Exit(status.code()), args, stderr_text)),
        Err(_) => Err(GitError::new(GitErrorKind::Spawn, args, stderr_text)),
    }
}
