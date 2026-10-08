//! Repository ref resolution and ahead counts; patch metadata belongs to `patch`.

use std::path::Path;

use super::{GitError, GitErrorKind};

/// Which ref a range is measured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseMode {
    /// The repository's default remote branch.
    DefaultBranch,
    /// The current branch's `@{upstream}`, so only unpushed commits count.
    Upstream,
}

impl BaseMode {
    /// The `GitRangeBaseMode` string union member this maps to in TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DefaultBranch => "default-branch",
            Self::Upstream => "upstream",
        }
    }

    /// Read a `GitRangeBaseMode` member. Anything else is the default branch,
    /// matching the route's own tolerance for a misspelled `?base=`.
    pub fn from_name(value: &str) -> Self {
        match value {
            "upstream" => Self::Upstream,
            _ => Self::DefaultBranch,
        }
    }
}

/// The repository's default branch, and where it was found.
///
/// `from_remote` exists for the caller's cache: the TypeScript memoised the
/// three remote-derived answers for a minute and deliberately did not memoise
/// the local `main`/`master` fallbacks, and that difference is only visible
/// from here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultBranch {
    pub name: String,
    pub from_remote: bool,
}

/// Which ref a range was measured against, and whether that was the ref asked
/// for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseRefResolution {
    /// `None` when the repository has no default branch to fall back to.
    pub base_ref: Option<String>,
    /// The mode actually used, which is not always the mode requested.
    pub base_mode: BaseMode,
    /// Set when `upstream` was asked for but the branch has no upstream.
    pub base_mode_fallback: bool,
}

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
fn open(repo_root: &Path, args: &[&str]) -> Result<gix::Repository, GitError> {
    let mut repo = gix::discover(repo_root).map_err(|error| repo_error(args, error))?;
    // Merge-base and the ahead count both walk history, touching the same
    // commit objects repeatedly. Only set it when the repository's own config
    // is silent, so a user who tuned it keeps their value.
    repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
    Ok(repo)
}

/// Per-repository object cache, sized like the one the log walk uses.
const OBJECT_CACHE_BYTES: usize = 8 * 1024 * 1024;

/// Shorten a full ref name the way `rev-parse --abbrev-ref` does for the two
/// namespaces a base ref can live in.
fn shorten_ref(full_name: &str) -> String {
    full_name
        .strip_prefix("refs/remotes/")
        .or_else(|| full_name.strip_prefix("refs/heads/"))
        .unwrap_or(full_name)
        .to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Base ref resolution
// ─────────────────────────────────────────────────────────────────────────────

/// Whether a ref exists, without caring what it points at.
fn has_ref(repo: &gix::Repository, full_name: &str) -> bool {
    repo.find_reference(full_name).is_ok()
}

/// Find the repository's default branch in an already-open repository.
///
/// The order is the TypeScript's, unchanged: `origin/main`, then
/// `origin/master`, then whatever `refs/remotes/origin/HEAD` points at, then
/// local `main`, then local `master`. Each step used to be a `rev-parse
/// --verify` child process; they are ref lookups now.
fn find_default_branch(repo: &gix::Repository) -> Option<DefaultBranch> {
    for candidate in ["main", "master"] {
        if has_ref(repo, &format!("refs/remotes/origin/{candidate}")) {
            return Some(DefaultBranch { name: format!("origin/{candidate}"), from_remote: true });
        }
    }

    // `git symbolic-ref` fails on a ref that resolves straight to an object, so
    // a non-symbolic `origin/HEAD` is not an answer here either.
    if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let gix::refs::TargetRef::Symbolic(name) = reference.target() {
            let full_name = name.as_bstr().to_string();
            let short = full_name.strip_prefix("refs/remotes/").unwrap_or(&full_name);
            return Some(DefaultBranch { name: short.to_string(), from_remote: true });
        }
    }

    for candidate in ["main", "master"] {
        if has_ref(repo, &format!("refs/heads/{candidate}")) {
            return Some(DefaultBranch { name: candidate.to_string(), from_remote: false });
        }
    }

    None
}

/// The current branch's upstream in an already-open repository.
fn find_upstream(repo: &gix::Repository) -> Option<String> {
    let head_ref = repo.head_ref().ok()??;
    let upstream = head_ref.remote_tracking_ref_name(gix::remote::Direction::Fetch)?.ok()?;
    Some(shorten_ref(&upstream.as_ref().as_bstr().to_string()))
}

/// Find the repository's default branch.
pub fn default_remote_branch(repo_root: &Path) -> Result<Option<DefaultBranch>, GitError> {
    let repo = open(repo_root, &["rev-parse", "--verify", "origin/main"])?;
    Ok(find_default_branch(&repo))
}

/// The current branch's upstream, e.g. `origin/my-feature`.
///
/// `None` for a branch with no upstream configured and for a detached HEAD —
/// both are the "no tracking branch" the caller already treated as absent
/// rather than as a failure.
pub fn upstream_branch(repo_root: &Path) -> Result<Option<String>, GitError> {
    let args = ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"];
    let repo = open(repo_root, &args)?;
    Ok(find_upstream(&repo))
}

/// Resolve the ref a range should be measured against.
///
/// `upstream` degrades to the default branch when the branch has no upstream,
/// and says so through `base_mode_fallback` — the range view uses that to keep
/// its base-mode toggle honest rather than silently showing a different range.
pub fn resolve_base_ref(
    repo_root: &Path,
    base_mode: BaseMode,
) -> Result<BaseRefResolution, GitError> {
    let repo = open(repo_root, &["rev-parse", "--verify", "origin/main"])?;

    if base_mode == BaseMode::Upstream {
        if let Some(upstream) = find_upstream(&repo) {
            return Ok(BaseRefResolution {
                base_ref: Some(upstream),
                base_mode: BaseMode::Upstream,
                base_mode_fallback: false,
            });
        }
        return Ok(BaseRefResolution {
            base_ref: find_default_branch(&repo).map(|branch| branch.name),
            base_mode: BaseMode::DefaultBranch,
            base_mode_fallback: true,
        });
    }

    Ok(BaseRefResolution {
        base_ref: find_default_branch(&repo).map(|branch| branch.name),
        base_mode: BaseMode::DefaultBranch,
        base_mode_fallback: false,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Range measurement
// ─────────────────────────────────────────────────────────────────────────────

/// The best merge base between two revisions, or `None` when there is none.
///
/// A revision that names nothing is `None` too: `git merge-base` exited
/// non-zero for it and the caller logged and carried on with a null.
pub fn merge_base(repo_root: &Path, one: &str, two: &str) -> Result<Option<String>, GitError> {
    let repo = open(repo_root, &["merge-base", one, two])?;
    let (Ok(one), Ok(two)) = (repo.rev_parse_single(one), repo.rev_parse_single(two)) else {
        return Ok(None);
    };
    Ok(repo.merge_base(one.detach(), two.detach()).ok().map(|id| id.detach().to_string()))
}

/// How many commits `head_ref` has that `base_ref` does not.
///
/// Mirrors `git rev-list --count <base>..<head>`. An unresolvable ref counts
/// zero, matching the TypeScript's `parseInt(...) || 0` on a failed command.
pub fn count_commits_ahead(
    repo_root: &Path,
    base_ref: &str,
    head_ref: &str,
) -> Result<u32, GitError> {
    let repo = open(repo_root, &["rev-list", "--count", &format!("{base_ref}..{head_ref}")])?;
    let (Ok(base), Ok(head)) = (repo.rev_parse_single(base_ref), repo.rev_parse_single(head_ref))
    else {
        return Ok(0);
    };

    // Counting only, so the cheapest ordering wins — nothing here looks at the
    // sequence the commits come back in.
    let walk = repo
        .rev_walk(Some(head.detach()))
        .with_hidden(Some(base.detach()))
        .sorting(gix::revision::walk::Sorting::BreadthFirst)
        .all();

    let Ok(walk) = walk else { return Ok(0) };
    Ok(walk.filter(Result::is_ok).count() as u32)
}
