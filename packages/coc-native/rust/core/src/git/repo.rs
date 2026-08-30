//! Finding the working-tree root that contains a path, without spawning git.
//!
//! `git rev-parse --show-toplevel` walks up from its working directory looking
//! for a `.git`, which is exactly what `gix::discover` does — so the answer
//! comes out of the repository `gix` opens rather than out of a child process.
//! This was the last `git` child process left in `coc/src/server/git/`, and the
//! only *synchronous* one: it ran through `execFileSync`, so every lookup
//! blocked the event loop for the length of a process spawn.
//!
//! The port is faithful rather than tidy, because the caller reads every
//! failure as a plain "not a repository":
//!
//! * A path that does not exist answers `None`. It has to be checked, not left
//!   to discovery — discovery walks *up*, so `<repo>/does/not/exist` would find
//!   the repository above it and report a root for a path that is not there,
//!   where the `fs.statSync` this replaces threw and answered `None`.
//! * A file answers for the directory holding it, the way `git -C $(dirname …)`
//!   was invoked.
//! * A bare repository answers `None`, because `--show-toplevel` fails outside
//!   a work tree.
//!
//! WSL is absent here as everywhere in this module: a repo inside a distro is
//! routed through `wsl.exe` by the TypeScript caller and never reaches Rust.

use std::path::Path;

use super::{GitError, GitErrorKind};

/// The arguments the error text names. Nothing is spawned, but a caller that
/// sees a failure should see the command whose job this is doing.
const ARGS: [&str; 2] = ["rev-parse", "--show-toplevel"];

/// Turn a `gix` failure into the shared `git <args> failed: <stderr>` shape.
fn repo_error(error: impl std::fmt::Display) -> GitError {
    GitError::from_parts(
        GitErrorKind::Repository,
        &ARGS.iter().map(|arg| (*arg).to_string()).collect::<Vec<_>>(),
        error.to_string(),
    )
}

/// The working-tree root containing `path`, or `None` when there is not one.
///
/// `None` covers every case the caller treats alike: the path is missing, it is
/// outside any repository, or the repository it is in is bare. An `Err` is
/// reserved for a repository that exists and could not be read.
pub fn discover_workdir(path: &Path) -> Result<Option<String>, GitError> {
    // Discovery walks upward, so a missing path would otherwise be answered by
    // whatever repository happens to sit above it.
    let Ok(metadata) = std::fs::metadata(path) else {
        return Ok(None);
    };

    let start = if metadata.is_dir() {
        path
    } else {
        // `git -C <dirname> rev-parse` is how the file case was always run.
        match path.parent() {
            Some(parent) => parent,
            None => return Ok(None),
        }
    };

    let repo = match gix::discover(start) {
        Ok(repo) => repo,
        // Walking to the filesystem root without finding a `.git` is the
        // ordinary "not a repository" answer, not a failure to report.
        Err(gix::discover::Error::Discover(_)) => return Ok(None),
        Err(error) => return Err(repo_error(error)),
    };

    // Bare repositories have no work tree, and `--show-toplevel` fails in one.
    let Some(workdir) = repo.workdir() else {
        return Ok(None);
    };

    // Trailing separator: `gix` reports the work tree as a directory path and
    // `git` prints it without one.
    let text = workdir.to_string_lossy();
    let trimmed = text.trim_end_matches(std::path::MAIN_SEPARATOR);
    let root = if trimmed.is_empty() { text.as_ref() } else { trimmed };

    Ok(Some(root.to_string()))
}
