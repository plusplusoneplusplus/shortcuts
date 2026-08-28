//! Branches: which one is checked out, how far it has drifted from its
//! upstream, and what the branch list looks like.
//!
//! Everything here is a read, so everything here is `gix` — with one
//! exception. `repository_status` runs `git status --porcelain=v2 --branch`,
//! because the answer it wants includes whether the working tree is dirty, and
//! deciding that means the same index refresh and `.gitignore` walk git already
//! does. The rest — HEAD resolution, upstream tracking, ahead/behind counts,
//! the branch list — used to be four to six child processes per Git tab render
//! and now costs one opened repository.
//!
//! Two habits carried over from [`super::status`] and [`super::range`]: no
//! absolute path is ever built here, and no list is ever sorted by a locale.
//! Branch lists *are* sorted, but by full refname bytes, which is what git's
//! own `refname` ordering does.

use std::path::Path;

use super::log::relative_date;
use super::{run_git, GitCommandOptions, GitError, GitErrorKind};

/// Repository metadata from one `git status --porcelain=v2 --branch` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryStatus {
    /// Current branch name, or `HEAD` when detached.
    pub branch: String,
    pub is_detached: bool,
    /// Whether the index or working tree holds any change at all.
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub tracking_branch: Option<String>,
    /// Whether the repository has no commits yet.
    pub unborn: bool,
}

/// The checked-out branch and its drift from upstream.
///
/// `hasUncommittedChanges` is deliberately absent: the caller already knows it
/// from a separate question and passes it in, so asking git again here would be
/// a spawn nobody needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchStatus {
    /// Empty when HEAD is detached, matching what the TypeScript returned.
    pub name: String,
    pub is_detached: bool,
    /// The commit HEAD points at; only set when detached.
    pub detached_hash: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub tracking_branch: Option<String>,
}

/// One branch as the branch list renders it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchEntry {
    /// Short name — `main` for a local branch, `origin/main` for a remote one.
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    /// The part before the first `/` of a remote branch's name.
    pub remote_name: Option<String>,
    pub last_commit_subject: String,
    /// `%(committerdate:relative)`, e.g. `3 days ago`.
    pub last_commit_date: String,
}

/// One page of the branch list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchPage {
    pub branches: Vec<BranchEntry>,
    /// Matching branches in the whole repository, not just on this page.
    pub total_count: u32,
    pub has_more: bool,
}

/// Which slice of the branch list to read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BranchQuery {
    /// Remote branches instead of local ones.
    pub remote: bool,
    /// Branches to return. Zero returns a count with no rows, which is how the
    /// count-only callers ask their question.
    pub limit: u32,
    pub offset: u32,
    /// Case-insensitive substring the branch *name* must contain.
    pub search: Option<String>,
}

/// Turn a `gix` failure into the error shape the rest of the capability uses.
fn repo_error(args: &[&str], error: impl std::fmt::Display) -> GitError {
    GitError::from_parts(
        GitErrorKind::Repository,
        &args.iter().map(|arg| (*arg).to_string()).collect::<Vec<_>>(),
        error.to_string(),
    )
}

/// Open a repository the way `git -C <path>` finds one — by discovery.
fn open(repo_root: &Path, args: &[&str]) -> Result<gix::Repository, GitError> {
    let mut repo = gix::discover(repo_root).map_err(|error| repo_error(args, error))?;
    // The ahead/behind walk and the branch list both touch the same commits
    // repeatedly. Only set it when the repository's own config is silent.
    repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
    Ok(repo)
}

/// Per-repository object cache, sized like log's and range's.
const OBJECT_CACHE_BYTES: usize = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// git status --porcelain=v2 --branch
// ─────────────────────────────────────────────────────────────────────────────

/// Read `# branch.ab +<ahead> -<behind>`.
///
/// Mirrors the TypeScript's `/^\+(\d+)\s+-(\d+)$/` against the trimmed value:
/// anything else leaves both counts at zero rather than half-reading the line.
fn parse_ahead_behind(value: &str) -> Option<(u32, u32)> {
    let mut parts = value.split_whitespace();
    let ahead = parts.next()?.strip_prefix('+')?;
    let behind = parts.next()?.strip_prefix('-')?;
    if parts.next().is_some() {
        return None;
    }
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(ahead) || !digits(behind) {
        return None;
    }
    Some((ahead.parse().ok()?, behind.parse().ok()?))
}

/// Parse `git status --porcelain=v2 --branch` without inspecting file names.
///
/// Git emits branch metadata in `# branch.*` headers and one non-header record
/// per staged, unstaged, conflicted or untracked path — so "is anything dirty"
/// is just "did any line not start with `# `", which is why this never has to
/// understand a change record.
pub fn parse_porcelain_v2_branch_status(output: &str) -> RepositoryStatus {
    let mut branch = "HEAD".to_string();
    let mut tracking_branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut unborn = false;
    let mut dirty = false;

    for raw_line in output.split('\n') {
        let raw_line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if raw_line.is_empty() {
            continue;
        }
        let Some(line) = raw_line.strip_prefix("# ") else {
            dirty = true;
            continue;
        };

        if let Some(value) = line.strip_prefix("branch.oid ") {
            unborn = value.trim() == "(initial)";
        } else if let Some(value) = line.strip_prefix("branch.head ") {
            let head = value.trim();
            branch = if head == "(detached)" || head.is_empty() {
                "HEAD".to_string()
            } else {
                head.to_string()
            };
        } else if let Some(value) = line.strip_prefix("branch.upstream ") {
            let upstream = value.trim();
            tracking_branch = (!upstream.is_empty()).then(|| upstream.to_string());
        } else if let Some(value) = line.strip_prefix("branch.ab ") {
            if let Some((parsed_ahead, parsed_behind)) = parse_ahead_behind(value.trim()) {
                ahead = parsed_ahead;
                behind = parsed_behind;
            }
        }
    }

    RepositoryStatus {
        is_detached: branch == "HEAD",
        branch,
        dirty,
        ahead,
        behind,
        tracking_branch,
        unborn,
    }
}

/// Read branch, tracking and working-tree metadata with one git command.
pub fn repository_status(repo_root: &Path) -> Result<RepositoryStatus, GitError> {
    let args = ["status", "--porcelain=v2", "--branch", "--untracked-files=all"]
        .map(str::to_string)
        .to_vec();
    let options =
        GitCommandOptions { timeout_ms: super::status::STATUS_TIMEOUT_MS, ..Default::default() };
    Ok(parse_porcelain_v2_branch_status(&run_git(repo_root, &args, &options)?))
}

// ─────────────────────────────────────────────────────────────────────────────
// HEAD and upstream
// ─────────────────────────────────────────────────────────────────────────────

/// Shorten a full ref name the way `rev-parse --abbrev-ref` does.
fn shorten_ref(full_name: &str) -> String {
    full_name
        .strip_prefix("refs/remotes/")
        .or_else(|| full_name.strip_prefix("refs/heads/"))
        .unwrap_or(full_name)
        .to_string()
}

/// The current branch's upstream, but only when the ref it names exists.
///
/// The existence check is what keeps this equal to the command it replaces:
/// `rev-parse --abbrev-ref <branch>@{upstream}` exits non-zero for a branch
/// configured to track a ref that was never fetched, and the caller read that
/// as "no tracking branch" rather than as a failure.
fn find_upstream(repo: &gix::Repository) -> Option<String> {
    let head_ref = repo.head_ref().ok()??;
    let upstream = head_ref.remote_tracking_ref_name(gix::remote::Direction::Fetch)?.ok()?;
    let full_name = upstream.as_ref().as_bstr().to_string();
    repo.find_reference(full_name.as_str()).ok()?;
    Some(shorten_ref(&full_name))
}

/// How many commits `head` has that `base` does not.
///
/// The right half of `git rev-list --left-right --count <base>...<head>`.
/// Nothing reads the walk order, so the cheapest sorting wins.
fn count_ahead(repo: &gix::Repository, base: gix::ObjectId, head: gix::ObjectId) -> u32 {
    let walk = repo
        .rev_walk(Some(head))
        .with_hidden(Some(base))
        .sorting(gix::revision::walk::Sorting::BreadthFirst)
        .all();
    match walk {
        Ok(walk) => walk.filter(Result::is_ok).count() as u32,
        Err(_) => 0,
    }
}

/// Read the checked-out branch, its upstream, and how far the two have drifted.
///
/// `None` means HEAD resolves to nothing — an unborn branch, or a path that is
/// not a repository at all. That is the same `null` the TypeScript returned
/// when `rev-parse HEAD` came back empty.
pub fn branch_status(repo_root: &Path) -> Result<Option<BranchStatus>, GitError> {
    let args = ["rev-parse", "HEAD"];
    let repo = open(repo_root, &args)?;

    let Ok(head_id) = repo.head_id() else {
        return Ok(None);
    };

    // A detached HEAD has no branch name and no upstream to be ahead of, so
    // the three walks below are not just unnecessary — they have no operands.
    let Some(head_ref) = repo.head_ref().map_err(|error| repo_error(&args, error))? else {
        return Ok(Some(BranchStatus {
            name: String::new(),
            is_detached: true,
            detached_hash: Some(head_id.detach().to_string()),
            ahead: 0,
            behind: 0,
            tracking_branch: None,
        }));
    };

    let name = shorten_ref(&head_ref.name().as_bstr().to_string());
    let Some(tracking_branch) = find_upstream(&repo) else {
        return Ok(Some(BranchStatus {
            name,
            is_detached: false,
            detached_hash: None,
            ahead: 0,
            behind: 0,
            tracking_branch: None,
        }));
    };

    let Ok(upstream_id) = repo.rev_parse_single(tracking_branch.as_str()) else {
        return Ok(Some(BranchStatus {
            name,
            is_detached: false,
            detached_hash: None,
            ahead: 0,
            behind: 0,
            tracking_branch: Some(tracking_branch),
        }));
    };

    let head = head_id.detach();
    let upstream = upstream_id.detach();
    Ok(Some(BranchStatus {
        name,
        is_detached: false,
        detached_hash: None,
        ahead: count_ahead(&repo, upstream, head),
        behind: count_ahead(&repo, head, upstream),
        tracking_branch: Some(tracking_branch),
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch listing
// ─────────────────────────────────────────────────────────────────────────────

/// Describe the commit a branch points at.
///
/// A ref that cannot be peeled or decoded yields empty strings rather than
/// dropping the branch: the TypeScript read `%(subject)` and
/// `%(committerdate:relative)` out of split parts and fell back to `''` for a
/// missing field, and a branch missing from the list is worse than a blank
/// column.
fn describe_tip(
    repo: &gix::Repository,
    reference: gix::Reference<'_>,
    now: i64,
) -> (String, String) {
    let Ok(id) = reference.into_fully_peeled_id() else {
        return (String::new(), String::new());
    };
    let Ok(commit) = repo.find_commit(id.detach()) else {
        return (String::new(), String::new());
    };
    // `%(subject)` folds a multi-line subject onto one line, exactly as
    // `summary()` does.
    let subject = commit.message().map(|message| message.summary().to_string()).unwrap_or_default();
    let date = commit
        .committer()
        .ok()
        .and_then(|committer| committer.time().ok())
        .map(|time| relative_date(time.seconds, now))
        .unwrap_or_default();
    (subject, date)
}

/// Read every branch in one namespace, in git's `refname` order.
fn collect_branches(
    repo: &gix::Repository,
    remote: bool,
    now: i64,
) -> Result<Vec<BranchEntry>, GitError> {
    let args: &[&str] = if remote { &["branch", "-r"] } else { &["branch"] };
    let platform = repo.references().map_err(|error| repo_error(args, error))?;
    let iter = if remote {
        platform.remote_branches().map_err(|error| repo_error(args, error))?
    } else {
        platform.local_branches().map_err(|error| repo_error(args, error))?
    };

    let current = repo.head_ref().ok().flatten().map(|head| head.name().as_bstr().to_string());

    let mut entries: Vec<(String, BranchEntry)> = Vec::new();
    for reference in iter.flatten() {
        let full_name = reference.name().as_bstr().to_string();
        let name = shorten_ref(&full_name);
        if name.is_empty() {
            continue;
        }
        // `origin/HEAD` is a symbolic ref, not a branch anyone can check out.
        // The TypeScript dropped any line holding `HEAD` anywhere; matching on
        // the name keeps that, including its willingness to drop a branch
        // genuinely called `HEADer`.
        if remote && name.contains("HEAD") {
            continue;
        }
        let is_current = current.as_deref() == Some(full_name.as_str());
        let remote_name = remote
            .then(|| name.split_once('/').map(|(remote_name, _)| remote_name.to_string()))
            .flatten();
        let (last_commit_subject, last_commit_date) = describe_tip(repo, reference, now);
        entries.push((
            full_name,
            BranchEntry {
                name,
                is_current,
                is_remote: remote,
                remote_name,
                last_commit_subject,
                last_commit_date,
            },
        ));
    }

    // `git branch` sorts by full refname. Sorting here rather than trusting the
    // ref iterator's order keeps the list stable whether a ref is loose or
    // packed.
    entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}

/// Read a page of the branch list.
///
/// The search matches the branch *name*, case-insensitively — which is what
/// the count has always done, and what the Windows path has always done. The
/// Unix path used to pipe the formatted line through `grep -i`, so a commit
/// subject or a relative date could match and make the page disagree with its
/// own total.
pub fn list_branches(
    repo_root: &Path,
    query: &BranchQuery,
    now: i64,
) -> Result<BranchPage, GitError> {
    let args: &[&str] = if query.remote { &["branch", "-r"] } else { &["branch"] };
    let repo = open(repo_root, args)?;
    let mut branches = collect_branches(&repo, query.remote, now)?;

    if let Some(search) = query.search.as_ref().filter(|search| !search.is_empty()) {
        let needle = search.to_lowercase();
        branches.retain(|branch| branch.name.to_lowercase().contains(&needle));
    }

    let total_count = branches.len() as u32;
    let offset = query.offset.min(total_count) as usize;
    let end = offset.saturating_add(query.limit as usize).min(branches.len());
    let page: Vec<BranchEntry> = branches.drain(offset..end).collect();

    let has_more = offset as u32 + (page.len() as u32) < total_count;
    Ok(BranchPage { branches: page, total_count, has_more })
}

/// Every local branch's short name, in git's `refname` order.
///
/// `git branch --format="%(refname:short)"` with nothing else attached. It is
/// separate from [`list_branches`] on purpose: that one describes each tip,
/// which costs a commit lookup and a date format per branch, and the caller
/// here shows a bare list of names.
///
/// The `HEAD` filter and the ten-name cap stay in the caller — they are what
/// that one list chose to show, not what the repository contains.
pub fn local_branch_names(repo_root: &Path) -> Result<Vec<String>, GitError> {
    let args = ["branch", "--format=%(refname:short)"];
    let repo = open(repo_root, &args)?;
    let platform = repo.references().map_err(|error| repo_error(&args, error))?;
    let iter = platform.local_branches().map_err(|error| repo_error(&args, error))?;

    let mut names: Vec<(String, String)> = Vec::new();
    for reference in iter.flatten() {
        let full_name = reference.name().as_bstr().to_string();
        let name = shorten_ref(&full_name);
        if name.is_empty() {
            continue;
        }
        names.push((full_name, name));
    }

    // Sorted here rather than trusted from the ref iterator, so a loose and a
    // packed ref land in the same place — the same reason `collect_branches`
    // does it.
    names.sort_by(|(left, _), (right, _)| left.cmp(right));
    Ok(names.into_iter().map(|(_, name)| name).collect())
}
