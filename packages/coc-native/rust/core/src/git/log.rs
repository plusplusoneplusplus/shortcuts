//! Reading commit history with `gix`, so a page of the Git tab costs no
//! processes at all.
//!
//! This is the first read path that leaves the `git` CLI behind entirely. The
//! TypeScript `GitLogService.getCommits` spawned three children for one page —
//! `git log`, `git rev-parse --abbrev-ref @{upstream}` and a second `git log`
//! for the unpushed set — and the spawn overhead, not the reading, is what this
//! move exists to remove.
//!
//! The cost of dropping the CLI is that `--pretty=format:` no longer formats
//! anything for us, so the three placeholders the UI actually renders are
//! reimplemented here: `%aI` (delegated to `gix`), `%ar` (a literal port of
//! git's `show_date_relative`) and `%D` (ref decoration). Each is covered by a
//! differential test that compares this module against the real `git log` on a
//! temp repository, because "close enough" in a commit list is a visible bug.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use gix::prelude::ObjectIdExt;

use super::{GitError, GitErrorKind};

/// One commit, field-for-field the `GitCommit` the Git tab renders.
///
/// `repositoryRoot` and `repositoryName` are deliberately absent: they are
/// `repoRoot` and `path.basename(repoRoot)`, and building paths stays in Node
/// for the same reason it does in [`super::status`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commit {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    /// `%b` — the message after the title, trimmed. Empty when there is none.
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    /// `%aI` — ISO 8601 strict, in the author's own timezone offset.
    pub date: String,
    /// `%ar` — "3 days ago".
    pub relative_date: String,
    /// `%P` — space-separated, empty for a root commit.
    pub parent_hashes: String,
    /// `%D` — decoration names, already split and trimmed.
    pub refs: Vec<String>,
    /// Whether the commit is on `HEAD` but not on its upstream.
    ///
    /// `None` when nobody asked: reading a single commit never computed this,
    /// and the field arrived in JavaScript as `undefined` rather than `false`.
    pub is_ahead_of_remote: Option<bool>,
}

/// One page of history, plus whether asking for the next one is worthwhile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitPage {
    pub commits: Vec<Commit>,
    pub has_more: bool,
}

/// Turn a `gix` failure into the error shape the rest of the capability uses.
///
/// The command name is a stand-in — nothing was spawned — but it keeps the
/// `git <args> failed: <stderr>` text that routes and the UI display verbatim,
/// so a reader cannot tell which backend produced the failure.
fn repo_error(args: &[&str], error: impl std::fmt::Display) -> GitError {
    GitError::from_parts(
        GitErrorKind::Repository,
        &args.iter().map(|arg| (*arg).to_string()).collect::<Vec<_>>(),
        error.to_string(),
    )
}

/// Open a repository the way `git -C <path>` finds one — by discovery, so a
/// path inside the working tree resolves to the tree that contains it.
fn open(repo_root: &Path) -> Result<gix::Repository, GitError> {
    let mut repo = gix::discover(repo_root).map_err(|error| repo_error(&["log"], error))?;
    // Reading a page touches each commit object more than once — the walk, the
    // decode, and the `%h` abbreviation search all reach into the object
    // database — and a page of 200 measured slower than the `git log` it
    // replaced without this. Only set it when the repository's own config is
    // silent, so a user who tuned it keeps their value.
    repo.object_cache_size_if_unset(OBJECT_CACHE_BYTES);
    Ok(repo)
}

/// Per-repository object cache. Big enough to hold a page's commits and the
/// objects the abbreviation search walks past, small enough to be free.
const OBJECT_CACHE_BYTES: usize = 8 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// %ar — relative dates
// ─────────────────────────────────────────────────────────────────────────────

/// Pick the singular or plural spelling, the way git's `Q_()` does.
fn plural(count: u64, unit: &str) -> String {
    if count == 1 {
        format!("1 {unit} ago")
    } else {
        format!("{count} {unit}s ago")
    }
}

/// Format `%ar` for a commit `time` observed at `now`, both unix seconds.
///
/// A literal port of `show_date_relative` in git's `date.c`, rounding steps
/// included — the `+ 30` before dividing by 60 and the `+ 12` before dividing
/// by 24 are what make git say "2 hours ago" where a truncating conversion
/// would say "1 hour ago". Getting those wrong is invisible until a commit list
/// disagrees with `git log` by one unit.
pub fn relative_date(time: i64, now: i64) -> String {
    if now < time {
        return "in the future".to_string();
    }
    let mut diff = (now - time) as u64;

    if diff < 90 {
        return plural(diff, "second");
    }
    // Round to the nearest minute, then the nearest hour.
    diff = (diff + 30) / 60;
    if diff < 90 {
        return plural(diff, "minute");
    }
    diff = (diff + 30) / 60;
    if diff < 36 {
        return plural(diff, "hour");
    }

    // Days from here on.
    diff = (diff + 12) / 24;
    if diff < 14 {
        return plural(diff, "day");
    }
    // Weeks for the past ten weeks or so.
    if diff < 70 {
        return plural((diff + 3) / 7, "week");
    }
    // Months for the past year or so.
    if diff < 365 {
        return plural((diff + 15) / 30, "month");
    }
    // Years and months for the past five years or so.
    if diff < 1825 {
        let total_months = (diff * 12 * 2 + 365) / (365 * 2);
        let years = total_months / 12;
        let months = total_months % 12;
        if months > 0 {
            let years_text =
                if years == 1 { "1 year".to_string() } else { format!("{years} years") };
            let months_text =
                if months == 1 { "1 month".to_string() } else { format!("{months} months") };
            return format!("{years_text}, {months_text} ago");
        }
        return plural(years, "year");
    }
    plural((diff + 183) / 365, "year")
}

// ─────────────────────────────────────────────────────────────────────────────
// %D — ref decoration
// ─────────────────────────────────────────────────────────────────────────────

/// The object a ref decorates, resolved without decoding the objects that do
/// not need decoding.
///
/// Equivalent to `reference.peel_to_id()` for every input, and the single
/// biggest cost in this module before it existed. `peel_to_id` reads the object
/// behind every ref so it can peel a tag; but peeling *stops* at the first
/// non-tag, so for a ref pointing straight at a commit — which is what every
/// branch and every remote-tracking ref is — the id it hands back is the one
/// already sitting in the ref file. [`gix::Repository::find_header`] is the
/// cheap `cat-file -t`: it answers the object's kind without decoding it, so
/// only the refs that really are tags pay for a peel.
///
/// The kind is checked rather than the namespace, because git's own decoration
/// peels any ref whose object is a tag, wherever it lives. `git update-ref`
/// refuses to point a `refs/heads/` ref at one, but it allows it under
/// `refs/remotes/`, and git decorates the commit beneath such a ref. Trusting
/// `refs/tags/` instead measured 0.35 ms faster and would have made that ref
/// decorate the tag object, which no commit in the walk is.
///
/// `None` means the ref decorates nothing, which is the missing-object case a
/// full peel reports by failing.
fn decorated_id(
    repo: &gix::Repository,
    reference: &mut gix::Reference<'_>,
) -> Option<gix::ObjectId> {
    if let Some(id) = reference.target().try_id().map(ToOwned::to_owned) {
        match repo.find_header(id) {
            Ok(header) if header.kind() != gix::object::Kind::Tag => return Some(id),
            // A tag has to be peeled, and a header that cannot be read is a
            // broken ref — let the full peel decide, as it always did.
            _ => {}
        }
    }
    reference.peel_to_id().ok().map(|id| id.detach())
}

/// The decoration names for every commit that carries one.
///
/// Built once per page rather than per commit: the ref database is read in a
/// single pass and indexed by the object each ref resolves to. Tags are peeled,
/// so an annotated tag decorates the commit it points at rather than the tag
/// object, and they carry git's `tag: ` prefix.
///
/// Ordering follows git's, which is subtler than it looks: git builds its
/// decoration list by prepending each ref as `for_each_ref` yields it, so the
/// list it prints is *reverse* full-refname order — `origin/main` before
/// `origin/HEAD`, and a remote branch before the local branch of the same name.
/// `HEAD` is added last of all and therefore prints first, as `HEAD -> <branch>`
/// when it is symbolic and its branch is on the same commit.
///
/// This is where a commit-log read spends most of its time — see
/// [`decorated_id`] for why, and for what it does about it.
fn decorations(repo: &gix::Repository) -> HashMap<gix::ObjectId, Vec<String>> {
    let mut by_commit: HashMap<gix::ObjectId, Vec<(String, String)>> = HashMap::new();

    let platform = match repo.references() {
        Ok(platform) => platform,
        Err(_) => return HashMap::new(),
    };
    let iter = match platform.all() {
        Ok(iter) => iter,
        Err(_) => return HashMap::new(),
    };

    for mut reference in iter.flatten() {
        let full_name = reference.name().as_bstr().to_string();
        let display = if let Some(tag) = full_name.strip_prefix("refs/tags/") {
            format!("tag: {tag}")
        } else if let Some(branch) = full_name.strip_prefix("refs/heads/") {
            branch.to_string()
        } else if let Some(remote) = full_name.strip_prefix("refs/remotes/") {
            remote.to_string()
        } else {
            // refs/stash, refs/notes and anything else git does not decorate.
            continue;
        };

        let Some(id) = decorated_id(repo, &mut reference) else { continue };
        by_commit.entry(id).or_default().push((full_name, display));
    }

    // The symbolic branch HEAD is on, if any, so it can be rewritten in place.
    let head_branch = repo.head_name().ok().flatten().map(|name| name.as_bstr().to_string());
    let head_id = repo.head_id().ok().map(|id| id.detach());

    // A detached HEAD decorates its commit even when no ref points there, so
    // the commit needs an entry to decorate before the loop below runs.
    if let Some(id) = head_id {
        by_commit.entry(id).or_default();
    }

    let mut result = HashMap::new();
    for (id, mut names) in by_commit {
        names.sort_by(|left, right| right.0.cmp(&left.0));
        let mut decorated: Vec<String> = Vec::with_capacity(names.len() + 1);

        if head_id == Some(id) {
            match &head_branch {
                Some(branch) => {
                    let short = branch.strip_prefix("refs/heads/").unwrap_or(branch);
                    decorated.push(format!("HEAD -> {short}"));
                    names.retain(|(full, _)| full != branch);
                }
                None => decorated.push("HEAD".to_string()),
            }
        }

        decorated.extend(names.into_iter().map(|(_, display)| display));
        result.insert(id, decorated);
    }
    result
}

// ─────────────────────────────────────────────────────────────────────────────
// Commit reading
// ─────────────────────────────────────────────────────────────────────────────

/// Read one commit into the shape the UI wants.
fn describe(
    repo: &gix::Repository,
    id: gix::ObjectId,
    decorations: &HashMap<gix::ObjectId, Vec<String>>,
    now: i64,
) -> Result<Commit, GitError> {
    let commit = repo.find_commit(id).map_err(|error| repo_error(&["log"], error))?;
    let author = commit.author().map_err(|error| repo_error(&["log"], error))?;
    let message = commit.message().map_err(|error| repo_error(&["log"], error))?;
    let time = author.time().map_err(|error| repo_error(&["log"], error))?;

    // `%s` is the summary: the first paragraph, with newlines folded to spaces.
    let subject = message.summary().to_string();
    // `%b` is everything after the blank line that ends the title. `gix` has
    // already dropped the separating newlines; the trim is the `.trim()` the
    // commits route applies to `%b` before rendering it, kept so the two agree
    // byte for byte. A message with no body reads as an empty string, which is
    // what that route's `lines.slice(7).join('\n').trim()` yields for one.
    let body = message.body.map(|body| body.to_string().trim().to_string()).unwrap_or_default();

    Ok(Commit {
        hash: id.to_string(),
        short_hash: id.attach(repo).shorten_or_id().to_string(),
        subject,
        body,
        author_name: author.name.to_string(),
        author_email: author.email.to_string(),
        date: time
            .format(gix::date::time::format::ISO8601_STRICT)
            .map_err(|error| repo_error(&["log"], error))?,
        relative_date: relative_date(time.seconds, now),
        parent_hashes: commit
            .parent_ids()
            .map(|parent| parent.detach().to_string())
            .collect::<Vec<_>>()
            .join(" "),
        refs: decorations.get(&id).cloned().unwrap_or_default(),
        is_ahead_of_remote: None,
    })
}

/// Describe a page's commits in walk order.
///
/// Deliberately sequential. Describing a commit is independent work, so this
/// looks like an obvious `rayon` fan-out — but the per-commit cost here is
/// `%h`, whose object-database lookup serialises internally, so a parallel
/// version measured within noise of this one. It is also not where a page's
/// time goes: the fixed cost of [`decorations`] dwarfs it. See `AGENTS.md`.
fn describe_all(
    repo: &gix::Repository,
    ids: &[gix::ObjectId],
    decorations: &HashMap<gix::ObjectId, Vec<String>>,
    ahead: &HashSet<gix::ObjectId>,
    now: i64,
) -> Result<Vec<Commit>, GitError> {
    ids.iter()
        .map(|id| {
            let mut commit = describe(repo, *id, decorations, now)?;
            commit.is_ahead_of_remote = Some(ahead.contains(id));
            Ok(commit)
        })
        .collect()
}

/// The commits on `HEAD` that its upstream does not have.
///
/// Mirrors `git log <upstream>..HEAD --pretty=%H`. A missing upstream, an
/// unborn branch or a detached HEAD all mean "nothing is unpushed" rather than
/// an error, exactly as the TypeScript did by swallowing the `rev-parse
/// @{upstream}` failure.
fn ahead_of_upstream(repo: &gix::Repository) -> HashSet<gix::ObjectId> {
    let empty = HashSet::new();

    let Ok(Some(head_ref)) = repo.head_ref() else { return empty };
    let Some(Ok(upstream_name)) = head_ref.remote_tracking_ref_name(gix::remote::Direction::Fetch)
    else {
        return empty;
    };
    let Ok(mut upstream) = repo.find_reference(upstream_name.as_ref().as_bstr()) else {
        return empty;
    };
    let Ok(upstream_id) = upstream.peel_to_id() else { return empty };
    let Ok(head_id) = repo.head_id() else { return empty };

    let walk = repo
        .rev_walk(Some(head_id.detach()))
        .with_hidden(Some(upstream_id.detach()))
        .sorting(gix::revision::walk::Sorting::ByCommitTime(Default::default()))
        .all();

    match walk {
        Ok(walk) => walk.filter_map(Result::ok).map(|info| info.id).collect(),
        Err(_) => empty,
    }
}

/// Whether a commit's message matches `--grep=<needle> --regexp-ignore-case`.
///
/// The TypeScript passed the needle through `JSON.stringify`, so a user's input
/// reached git as a quoted literal and any regex metacharacter in it was still
/// live. Matching case-insensitive substrings instead is the behaviour a search
/// box implies and the behaviour it had for every input without a
/// metacharacter; a stray `(` now finds nothing instead of failing the page.
fn matches_search(message: &str, needle_lowercase: &str) -> bool {
    message.to_lowercase().contains(needle_lowercase)
}

/// Read a page of history, newest first.
///
/// `max_count` and `skip` page exactly as `git log -n <count> --skip <skip>`
/// does; `has_more` comes from reading one commit past the page, which is what
/// the TypeScript's `requestCount = maxCount + 1` was for.
pub fn get_commits(
    repo_root: &Path,
    max_count: usize,
    skip: usize,
    search: Option<&str>,
    now: i64,
) -> Result<CommitPage, GitError> {
    let repo = open(repo_root)?;

    // An unborn branch has no history at all; git log exits non-zero there and
    // the caller showed an empty list, so do that without an error.
    let Ok(head_id) = repo.head_id() else {
        return Ok(CommitPage { commits: Vec::new(), has_more: false });
    };

    let decorations = decorations(&repo);
    let ahead = ahead_of_upstream(&repo);
    let needle = search.map(str::to_lowercase);

    let walk = repo
        .rev_walk(Some(head_id.detach()))
        .sorting(gix::revision::walk::Sorting::ByCommitTime(Default::default()))
        .all()
        .map_err(|error| repo_error(&["log"], error))?;

    // Reserve for the page, but never trust `max_count` as an allocation size:
    // callers pass "everything" as a huge number, and reserving for four
    // billion commits aborts the process before the walk reads one.
    // Walk first and describe afterwards. The walk is inherently sequential,
    // and describing is what scales with the page: `%h` asks the object
    // database for the shortest unambiguous prefix of every hash, which costs
    // more than decoding the commit itself.
    let mut ids = Vec::with_capacity(max_count.min(1024));
    let mut skipped = 0usize;
    let mut has_more = false;

    for info in walk {
        let info = info.map_err(|error| repo_error(&["log"], error))?;
        let id = info.id;

        if let Some(needle) = &needle {
            let commit = repo.find_commit(id).map_err(|error| repo_error(&["log"], error))?;
            let message = commit.message_raw_sloppy().to_string();
            if !matches_search(&message, needle) {
                continue;
            }
        }

        if skipped < skip {
            skipped += 1;
            continue;
        }
        if ids.len() == max_count {
            // One commit past the page is all "is there another page" needs.
            has_more = true;
            break;
        }
        ids.push(id);
    }

    let commits = describe_all(&repo, &ids, &decorations, &ahead, now)?;
    Ok(CommitPage { commits, has_more })
}

/// Read a single commit by any revision spec git would accept.
///
/// Returns `None` for a spec that resolves to nothing, matching the
/// `getCommit` that returned `undefined` when `git log -n 1 <hash>` failed.
pub fn get_commit(repo_root: &Path, rev: &str, now: i64) -> Result<Option<Commit>, GitError> {
    let repo = open(repo_root)?;
    let Ok(id) = repo.rev_parse_single(rev) else { return Ok(None) };
    let id = id.detach();
    if repo.find_commit(id).is_err() {
        return Ok(None);
    }

    let decorations = decorations(&repo);
    Ok(Some(describe(&repo, id, &decorations, now)?))
}
