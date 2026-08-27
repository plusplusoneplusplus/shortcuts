//! Resolving a feature branch's commit range: which ref to compare against,
//! how far ahead of it HEAD is, and what changed in between.
//!
//! `detectCommitRange` in TypeScript spawned seven children for one answer —
//! `rev-parse --abbrev-ref HEAD`, `rev-parse --verify origin/main`,
//! `merge-base`, `rev-list --count`, and three `diff` runs. Four of those only
//! read refs and walk commits, which `gix` does in-process, so they are gone.
//! The three `diff` runs stay on the CLI: `--numstat` and `--shortstat` line
//! counts follow git's own diff drivers, `.gitattributes` and binary detection,
//! and a reimplementation that is close but not identical would show up as
//! wrong numbers in a review UI.
//!
//! Two things this module deliberately does not do, both for the reason
//! [`super::status`] gives: it never builds an absolute path, and it never
//! sorts the file list. The TypeScript caller sorts with `localeCompare`, which
//! puts `docs/x.md` before `README.md` where a byte comparison does the
//! opposite — the Git tab's ordering is Node's collation, not ours.

use std::collections::HashMap;
use std::path::Path;

use super::status::ChangeStatus;
use super::{run_git, GitCommandOptions, GitError, GitErrorKind};

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

/// One file in a commit range.
///
/// `repositoryRoot` is absent for the same reason it is on a status entry: it
/// is the caller's own `repoRoot` value, not something to rebuild here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RangeFile {
    pub path: String,
    pub status: ChangeStatus,
    pub additions: u32,
    pub deletions: u32,
    /// Source path of a rename or copy; `None` for everything else.
    pub old_path: Option<String>,
}

/// Total added and removed lines across a range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DiffStats {
    pub additions: u32,
    pub deletions: u32,
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

// ─────────────────────────────────────────────────────────────────────────────
// Changed files
// ─────────────────────────────────────────────────────────────────────────────

/// Map a `--name-status` code letter to a status.
///
/// Only the first character is read, so the similarity score on `R100` or
/// `C075` is ignored, and an unrecognised letter becomes `modified` rather than
/// dropping the file.
fn status_from_code(code: &str) -> ChangeStatus {
    match code.chars().next().map(|c| c.to_ascii_uppercase()) {
        Some('M') => ChangeStatus::Modified,
        Some('A') => ChangeStatus::Added,
        Some('D') => ChangeStatus::Deleted,
        Some('R') => ChangeStatus::Renamed,
        Some('C') => ChangeStatus::Copied,
        Some('U') => ChangeStatus::Conflict,
        _ => ChangeStatus::Modified,
    }
}

/// Pull the destination path out of a `--numstat` rename entry.
///
/// A literal port of the TypeScript's
/// `/(?:{[^}]*? => ([^}]+)}|.* => (.+))/`, alternation order and all, because
/// the file list this produces is what the range view already shows. It is not
/// a faithful reader of git's `{old => new}` form and never was: the second
/// alternative matches from position 0 whenever the first cannot, so
/// `src/{old => new}/file.ts` yields `new}/file.ts` and the row falls through
/// to `modified` with a mangled path. See `AGENTS.md` — fixing it changes what
/// the UI renders, which is not this port's business.
fn extract_rename_target(path: &str) -> Option<String> {
    for start in 0..path.len() {
        if !path.is_char_boundary(start) {
            continue;
        }
        let rest = &path[start..];
        if let Some(found) = match_brace_form(rest) {
            return Some(found);
        }
        if let Some(found) = match_arrow_form(rest) {
            return Some(found);
        }
    }
    None
}

/// `{[^}]*? => ([^}]+)}` anchored at the start of `text`.
///
/// The `*?` is lazy, so the first ` => ` before the closing brace wins; the `+`
/// is greedy but bounded by that brace, which leaves exactly one candidate.
fn match_brace_form(text: &str) -> Option<String> {
    let body = text.strip_prefix('{')?;
    let close = body.find('}')?;
    let arrow = body[..close].find(" => ")?;
    let target = &body[arrow + 4..close];
    (!target.is_empty()).then(|| target.to_string())
}

/// `.* => (.+)` anchored at the start of `text`.
///
/// The leading `.*` is greedy, so the *last* ` => ` with something after it is
/// the separator.
fn match_arrow_form(text: &str) -> Option<String> {
    let arrow = text.rfind(" => ")?;
    let target = &text[arrow + 4..];
    (!target.is_empty()).then(|| target.to_string())
}

/// Parse paired `--numstat` and `--name-status` output into a file list.
///
/// `--numstat` carries the line counts and `--name-status -M -C` carries the
/// statuses and rename sources; the two are joined on the destination path.
/// A numstat row whose path is not in the name-status map falls back to
/// `modified`, which is how a rename with a mangled path has always been shown.
///
/// Order is git's, not sorted: the caller sorts with `localeCompare`.
pub fn parse_changed_files(numstat: &str, name_status: &str) -> Vec<RangeFile> {
    // The TypeScript returned early on empty name-status output rather than
    // emitting numstat rows with invented statuses. Keep that.
    if name_status.is_empty() {
        return Vec::new();
    }

    let mut statuses: HashMap<&str, (ChangeStatus, Option<&str>)> = HashMap::new();
    for line in name_status.split('\n').filter(|line| !line.trim().is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let code = parts[0];
        let status = status_from_code(code);
        if code.starts_with('R') || code.starts_with('C') {
            if parts.len() >= 3 {
                statuses.insert(parts[2], (status, Some(parts[1])));
            }
        } else {
            statuses.insert(parts[1], (status, None));
        }
    }

    let mut files = Vec::new();
    for line in numstat.split('\n').filter(|line| !line.trim().is_empty()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        // A binary file reports `-` for both counts and contributes zero lines.
        let additions = if parts[0] == "-" { 0 } else { parts[0].parse().unwrap_or(0) };
        let deletions = if parts[1] == "-" { 0 } else { parts[1].parse().unwrap_or(0) };

        let mut path = parts[2].to_string();
        if path.contains(" => ") {
            if let Some(target) = extract_rename_target(&path) {
                path = target;
            }
        }

        let (status, old_path) = statuses
            .get(path.as_str())
            .map(|(status, old)| (*status, old.map(str::to_string)))
            .unwrap_or((ChangeStatus::Modified, None));

        files.push(RangeFile { path, status, additions, deletions, old_path });
    }
    files
}

/// Read the files changed between two refs.
///
/// Two `diff` runs, exactly as before: `--numstat` for line counts and
/// `--name-status -M -C` for statuses and rename sources. Both use the
/// three-dot form, so the comparison is against the merge base rather than
/// against `base_ref` itself.
pub fn changed_files(
    repo_root: &Path,
    base_ref: &str,
    head_ref: &str,
    options: &GitCommandOptions,
) -> Result<Vec<RangeFile>, GitError> {
    let range = format!("{base_ref}...{head_ref}");
    let numstat = run_git(repo_root, &to_args(&["diff", "--numstat", &range]), options)?;
    let name_status =
        run_git(repo_root, &to_args(&["diff", "--name-status", "-M", "-C", &range]), options)?;
    Ok(parse_changed_files(&numstat, &name_status))
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff statistics
// ─────────────────────────────────────────────────────────────────────────────

/// Read the number in `<n> insertion` / `<n> deletion` out of `--shortstat`.
///
/// A port of the TypeScript's two `match` calls: the digits are separated from
/// the word by exactly one space, and the first occurrence that qualifies wins.
fn shortstat_count(text: &str, word: &str) -> u32 {
    let needle = format!(" {word}");
    let mut from = 0usize;
    while let Some(offset) = text[from..].find(&needle) {
        let digits_end = from + offset;
        let before = text[..digits_end].trim_end_matches(|c: char| c.is_ascii_digit());
        if before.len() < digits_end {
            if let Ok(count) = text[before.len()..digits_end].parse() {
                return count;
            }
        }
        from = digits_end + needle.len();
    }
    0
}

/// Parse `git diff --shortstat` output into added and removed line totals.
///
/// Empty output means an empty range, which is zero of each rather than a
/// failure.
pub fn parse_diff_shortstat(text: &str) -> DiffStats {
    if text.is_empty() {
        return DiffStats::default();
    }
    DiffStats {
        additions: shortstat_count(text, "insertion"),
        deletions: shortstat_count(text, "deletion"),
    }
}

/// Read the added and removed line totals between two refs.
pub fn diff_stats(
    repo_root: &Path,
    base_ref: &str,
    head_ref: &str,
    options: &GitCommandOptions,
) -> Result<DiffStats, GitError> {
    let range = format!("{base_ref}...{head_ref}");
    let output = run_git(repo_root, &to_args(&["diff", "--shortstat", &range]), options)?;
    Ok(parse_diff_shortstat(&output))
}

/// Borrowed argument list to the owned one [`run_git`] takes.
fn to_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_string()).collect()
}
