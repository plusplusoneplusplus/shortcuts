//! Reading a repository's remotes without spawning git.
//!
//! `git remote` and `git remote get-url` only ever read configuration — there
//! is no history walk and no object lookup behind them — so `gix` answers both
//! from the config it already parsed when the repository was opened. That takes
//! the primary-remote lookup from one to three child processes down to zero.
//!
//! The lookups go through `gix`'s remote API rather than reading
//! `remote.<name>.url` out of the config directly, because `git remote get-url`
//! expands `url.<base>.insteadOf` rewrites and reading the raw key would not.
//! The round trip back to a string is pinned against the real `git remote
//! get-url` in `tests/git_remote.rs`, for every URL form the callers persist a
//! hash of.

use std::path::Path;

use gix::bstr::BStr;
use gix::remote::Direction;

use super::{GitError, GitErrorKind};

/// The remote `detect_remote_url` prefers before falling back to the first one.
const DEFAULT_REMOTE: &str = "origin";

/// Turn a `gix` failure into the error shape the rest of the capability uses.
///
/// Nothing was spawned, so the command name is a stand-in — but the text stays
/// `git <args> failed: <stderr>`, which is what routes and the UI display.
fn repo_error(args: &[&str], error: impl std::fmt::Display) -> GitError {
    GitError::from_parts(
        GitErrorKind::Repository,
        &args.iter().map(|arg| (*arg).to_string()).collect::<Vec<_>>(),
        error.to_string(),
    )
}

/// Open a repository the way `git -C <path>` finds one — by discovery, so a
/// path inside the working tree resolves to the tree that contains it.
///
/// No object cache is set: nothing here reads an object.
fn open(repo_root: &Path, args: &[&str]) -> Result<gix::Repository, GitError> {
    gix::discover(repo_root).map_err(|error| repo_error(args, error))
}

/// The fetch URL configured for `remote`, or `None` when the remote does not
/// exist or carries no URL.
///
/// Both misses collapse to `None` on purpose: `git remote get-url` exits
/// non-zero for either, and the caller has always turned that single failure
/// into a single "no remote" answer.
///
/// The configured bytes are preferred over `gix`'s re-rendering of them,
/// because parsing normalises: `https://Org.visualstudio.com/…` comes back out
/// of `to_bstring()` with a lowercased host. That would be invisible to the
/// hashes — they lowercase first — but not to the sidebar's grouping key, which
/// is built from this string with its casing intact, so an Azure DevOps clone
/// re-read after the move would group apart from one read before it.
///
/// Whether the raw value is safe to hand back is decided by parsing it and
/// comparing: equal to what the remote resolved to means nothing was rewritten
/// and no second URL was in play, so the bytes are what git would have printed.
/// A `url.<base>.insteadOf` rewrite, or a remote carrying more than one URL,
/// makes them differ — and then the resolved URL is the correct answer and gets
/// rendered.
fn configured_url(repo: &gix::Repository, remote: &str) -> Option<String> {
    let found = repo.try_find_remote(remote)?.ok()?;
    let url = found.url(Direction::Fetch)?;

    let key = format!("remote.{remote}.url");
    if let Some(raw) = repo.config_snapshot().string(key.as_str()) {
        if gix::url::parse(BStr::new(raw.as_slice())).is_ok_and(|parsed| &parsed == url) {
            return Some(String::from_utf8_lossy(raw.as_slice()).into_owned());
        }
    }

    Some(String::from_utf8_lossy(&url.to_bstring()).into_owned())
}

/// `git remote get-url <remote>` without the child process.
///
/// `Ok(None)` is the "no such remote" answer rather than an error, because the
/// caller reports a missing remote as an absent value and only a repository it
/// cannot open as a failure.
pub fn remote_url(repo_root: &Path, remote: &str) -> Result<Option<String>, GitError> {
    let args = ["remote", "get-url", remote];
    let repo = open(repo_root, &args)?;
    Ok(configured_url(&repo, remote))
}

/// `git remote` — every configured remote name.
///
/// `gix` hands these back from a `BTreeSet`, so they arrive sorted by name
/// bytes, which is the order `git remote` prints them in.
pub fn remote_names(repo_root: &Path) -> Result<Vec<String>, GitError> {
    let args = ["remote"];
    let repo = open(repo_root, &args)?;
    Ok(repo
        .remote_names()
        .into_iter()
        .map(|name| String::from_utf8_lossy(name.as_ref()).into_owned())
        .collect())
}

/// The repository's primary remote URL: `origin` when it is configured, the
/// first remote by name otherwise.
///
/// The fallback only runs when `origin` is *absent*. A configured `origin`
/// whose URL is empty answers the question — the TypeScript this replaces read
/// that as "no remote" and never went looking for a second one, because only a
/// failed `get-url` reached its fallback branch.
pub fn detect_remote_url(repo_root: &Path) -> Result<Option<String>, GitError> {
    let args = ["remote", "get-url", DEFAULT_REMOTE];
    let repo = open(repo_root, &args)?;

    if let Some(url) = configured_url(&repo, DEFAULT_REMOTE) {
        return Ok(non_empty(url));
    }

    let names = repo.remote_names();
    let Some(first) = names.into_iter().next() else {
        return Ok(None);
    };
    let first = String::from_utf8_lossy(first.as_ref()).into_owned();
    Ok(configured_url(&repo, &first).and_then(non_empty))
}

/// Drop an empty URL, the way the caller's `url || undefined` always has.
fn non_empty(url: String) -> Option<String> {
    (!url.is_empty()).then_some(url)
}
