//! Everything `GitLogService` asks about one commit that is not the commit
//! itself: the parent it is diffed against, the files it touched, its diff, and
//! the blobs and refs a review view resolves.
//!
//! The split follows the same rule the range module settled on. Anything that
//! only reads objects and refs — the parent, a file's content, whether a ref
//! names a commit — goes through `gix` and spawns nothing. The two `diff-tree`
//! runs and the `diff` stay on the CLI, because their rename detection and line
//! counts follow git's own diff drivers and `.gitattributes`, and numbers that
//! are close but not identical would show up as a wrong file list in the UI.
//!
//! One thing here is deliberately *not* a port. The TypeScript read file
//! content with `git show <rev>:<path>` and handed back the child's stdout, so
//! the content arrived with its trailing newline intact. Every command that now
//! crosses the boundary loses one, which for a diff is invisible and for a
//! file's bytes is not — so [`file_bytes_at_commit`] reads the blob out of the
//! object database instead and returns exactly the bytes git stored.
//! [`file_content_at_commit`] is the lossy-UTF-8 view of the same read, for the
//! callers that want a string; a caller writing the result back to disk takes
//! the bytes.

use std::collections::HashMap;
use std::path::Path;

use super::status::ChangeStatus;
use super::{run_git, GitCommandOptions, GitError, GitErrorKind};

/// git's empty tree, the stand-in parent a root commit is diffed against.
///
/// The same well-known constant `GitLogService.EMPTY_TREE_HASH` held: a commit
/// with no parent still needs something on the left of `git diff`.
pub const EMPTY_TREE_HASH: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// One file a commit touched.
///
/// `commitHash`, `parentHash` and `repositoryRoot` are absent for the reason
/// they are absent everywhere in this capability: they are the caller's own
/// values, and the caller attaches them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitFile {
    pub path: String,
    /// Source path of a rename or copy; `None` for everything else.
    pub original_path: Option<String>,
    pub status: ChangeStatus,
    /// `None` rather than zero when `--numstat` had nothing to say — a binary
    /// file, or a path the two `diff-tree` runs spelled differently. The
    /// TypeScript left the fields `undefined` there and the UI renders a blank
    /// column rather than a misleading `0`.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// A commit's file list, and the parent the list was computed against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitFiles {
    pub parent_hash: String,
    pub files: Vec<CommitFile>,
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
    gix::discover(repo_root).map_err(|error| repo_error(args, error))
}

/// Borrowed argument list to the owned one [`run_git`] takes.
fn to_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_string()).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// The parent a commit is diffed against
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve `<rev>~1`, falling back to the empty tree.
///
/// Never fails, because the TypeScript it replaces never did: `git rev-parse
/// <rev>~1` exits non-zero for a root commit, for a revision that names
/// nothing and for a path that is not a repository, and all three answered with
/// the empty tree so the diff still had a left-hand side.
pub fn parent_hash(repo_root: &Path, rev: &str) -> String {
    let Ok(repo) = gix::discover(repo_root) else {
        return EMPTY_TREE_HASH.to_string();
    };
    let spec = format!("{rev}~1");
    match repo.rev_parse_single(spec.as_str()) {
        Ok(id) => id.detach().to_string(),
        Err(_) => EMPTY_TREE_HASH.to_string(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The files a commit touched
// ─────────────────────────────────────────────────────────────────────────────

/// Read a leading run of decimal digits the way JavaScript's `parseInt` does.
///
/// `parseInt('12abc', 10)` is 12 and `parseInt('abc', 10)` is `NaN`; Rust's
/// `str::parse` rejects both. Only the second case matters in practice — a
/// binary file's `-` is filtered before this — but a numstat column that is not
/// a number has always dropped the row rather than counted as zero.
fn parse_int_prefix(text: &str) -> Option<u32> {
    let digits: String = text.trim_start().chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

/// `^(.*)\{.* => (.*)\}(.*)$` — the brace form of a `--numstat` rename path.
///
/// A literal port, backtracking order included: the leading `(.*)` is greedy so
/// the *last* `{` that can work wins, then the arrow is taken as late as
/// possible, then the closing brace as late as possible. `src/{a.ts => b.ts}`
/// becomes `src/b.ts`, which is the destination path `--name-status` reports
/// and therefore what the two outputs join on.
fn match_brace_form(path: &str) -> Option<String> {
    for open in (0..path.len()).rev() {
        if !path.is_char_boundary(open) || !path[open..].starts_with('{') {
            continue;
        }
        let prefix = &path[..open];
        let rest = &path[open + 1..];

        let mut arrow_limit = rest.len();
        while let Some(arrow) = rest[..arrow_limit].rfind(" => ") {
            let after = arrow + 4;
            if let Some(offset) = rest[after..].rfind('}') {
                let close = after + offset;
                return Some(format!("{prefix}{}{}", &rest[after..close], &rest[close + 1..]));
            }
            arrow_limit = arrow;
        }
    }
    None
}

/// `^.* => (.*)$` — the plain form, where the destination is simply everything
/// after the last arrow.
fn match_arrow_form(path: &str) -> Option<String> {
    path.rfind(" => ").map(|arrow| path[arrow + 4..].to_string())
}

/// Pull the destination path out of a `--numstat` rename entry.
///
/// Unlike the range module's reader — which is a port of a regex that is
/// genuinely broken, see `AGENTS.md` — this one is correct for both forms git
/// emits, so it is written to stay that way rather than to preserve a bug.
fn rename_destination(path: &str) -> Option<String> {
    match_brace_form(path).or_else(|| match_arrow_form(path))
}

/// Index `git diff-tree --numstat` output by destination path.
///
/// Binary files report `-` for both counts and are left out entirely, so the
/// file they belong to keeps `None` for both fields rather than claiming zero
/// changed lines.
fn parse_numstat(numstat: &str) -> HashMap<String, (u32, u32)> {
    let mut stats = HashMap::new();
    if numstat.trim().is_empty() {
        return stats;
    }

    for line in numstat.trim().split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        if parts[0] == "-" || parts[1] == "-" {
            continue;
        }
        let (Some(additions), Some(deletions)) =
            (parse_int_prefix(parts[0]), parse_int_prefix(parts[1]))
        else {
            continue;
        };

        // The path is the remaining columns rejoined: a path holding a tab was
        // split by the same `split('\t')` that separated the counts.
        let mut path = parts[2..].join("\t");
        if path.contains(" => ") {
            if let Some(destination) = rename_destination(&path) {
                path = destination;
            }
        }
        stats.insert(path, (additions, deletions));
    }
    stats
}

/// Join `--name-status` and `--numstat` output into a commit's file list.
///
/// `--name-status` drives the list — it is the one that reports every path and
/// its rename source — and `--numstat` only decorates it. That is the opposite
/// of the range module, where numstat drives, and it is why a file missing from
/// numstat keeps its real status here instead of falling back to `modified`.
///
/// Order is git's, and the list is not sorted: what the commit view shows is
/// `diff-tree`'s own ordering.
pub fn parse_commit_files(name_status: &str, numstat: &str) -> Vec<CommitFile> {
    if name_status.trim().is_empty() {
        return Vec::new();
    }
    let stats = parse_numstat(numstat);

    let mut files = Vec::new();
    for line in name_status.trim().split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }

        let code = parts[0];
        let status = ChangeStatus::from_code(code);
        // A rename or a copy names both ends; everything else names one path.
        let (path, original_path) =
            if (code.starts_with('R') || code.starts_with('C')) && parts.len() >= 3 {
                (parts[2].to_string(), Some(parts[1].to_string()))
            } else {
                (parts[1].to_string(), None)
            };

        let (additions, deletions) = match stats.get(&path) {
            Some((additions, deletions)) => (Some(*additions), Some(*deletions)),
            None => (None, None),
        };
        files.push(CommitFile { path, original_path, status, additions, deletions });
    }
    files
}

/// Read the files a commit touched, with their line counts.
///
/// Two `diff-tree` runs, exactly as before. A failing `--numstat` is swallowed:
/// the counts are decoration the TypeScript already treated as optional, and
/// losing them is not worth losing the file list over.
pub fn commit_files(
    repo_root: &Path,
    commit: &str,
    options: &GitCommandOptions,
) -> Result<CommitFiles, GitError> {
    let name_status = run_git(
        repo_root,
        &to_args(&["diff-tree", "--no-commit-id", "--name-status", "-r", "-M", "-C", commit]),
        options,
    )?;
    let numstat = run_git(
        repo_root,
        &to_args(&["diff-tree", "--no-commit-id", "--numstat", "-r", "-M", "-C", commit]),
        options,
    );

    Ok(CommitFiles {
        parent_hash: parent_hash(repo_root, commit),
        files: parse_commit_files(&name_status, numstat.as_deref().unwrap_or("")),
    })
}

/// Read a commit's diff against its parent.
///
/// The parent comes from `gix`, so the two children the TypeScript spawned for
/// this are down to one.
pub fn commit_diff(
    repo_root: &Path,
    commit: &str,
    options: &GitCommandOptions,
) -> Result<String, GitError> {
    let parent = parent_hash(repo_root, commit);
    run_git(repo_root, &to_args(&["diff", &parent, commit]), options)
}

// ─────────────────────────────────────────────────────────────────────────────
// Objects at a commit
// ─────────────────────────────────────────────────────────────────────────────

/// Split a repository-relative path into the components a tree lookup walks.
///
/// The caller normalises to forward slashes before it gets here, so splitting
/// on `/` is enough and — unlike `Path::components` — means a Windows host and
/// a Unix host walk a stored path the same way.
fn components(path: &str) -> impl Iterator<Item = &[u8]> {
    path.split('/').filter(|part| !part.is_empty()).map(str::as_bytes)
}

/// Find the tree entry `<rev>:<path>` names, if there is one.
fn lookup_entry<'repo>(
    repo: &'repo gix::Repository,
    rev: &str,
    path: &str,
) -> Option<gix::object::tree::Entry<'repo>> {
    let id = repo.rev_parse_single(rev).ok()?;
    let object = repo.find_object(id.detach()).ok()?;
    let commit = object.peel_to_kind(gix::object::Kind::Commit).ok()?.into_commit();
    let tree = commit.tree().ok()?;
    tree.lookup_entry(components(path)).ok()?
}

/// Read a file's stored bytes as they stood at a commit.
///
/// The blob verbatim: no decoding, no trailing newline removed. A caller that
/// needs to write the result back to disk — the notes sync mirror reads a whole
/// commit's tree this way, and it carries images as well as markdown — cannot
/// go through a `String`, because a lossy decode rewrites every byte sequence
/// that is not valid UTF-8 into U+FFFD and there is no way back.
///
/// A path that names a directory answers `None`. `git show` prints a tree
/// listing there, which was never file content and which no caller has ever
/// been able to use.
pub fn file_bytes_at_commit(
    repo_root: &Path,
    rev: &str,
    path: &str,
) -> Result<Option<Vec<u8>>, GitError> {
    let spec = format!("{rev}:{path}");
    let repo = open(repo_root, &["show", &spec])?;
    let Some(entry) = lookup_entry(&repo, rev, path) else {
        return Ok(None);
    };
    if entry.mode().is_tree() {
        return Ok(None);
    }
    let Ok(blob) = entry.object() else {
        return Ok(None);
    };
    Ok(Some(blob.data.clone()))
}

/// Read a file's content as it stood at a commit.
///
/// Returns the blob's bytes verbatim — trailing newline included — which is
/// what `git show <rev>:<path>` printed and what the TypeScript handed back.
/// Invalid UTF-8 is replaced rather than rejected, matching what Node did when
/// it decoded the child's stdout as UTF-8. A caller that cannot afford that
/// replacement wants [`file_bytes_at_commit`] instead.
pub fn file_content_at_commit(
    repo_root: &Path,
    rev: &str,
    path: &str,
) -> Result<Option<String>, GitError> {
    Ok(file_bytes_at_commit(repo_root, rev, path)?
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
}

/// Whether `<rev>:<path>` names anything at all.
///
/// True for a directory as well as a file, because `git cat-file -e` asks
/// whether the object exists and a tree is an object.
pub fn file_exists_at_commit(repo_root: &Path, rev: &str, path: &str) -> Result<bool, GitError> {
    let spec = format!("{rev}:{path}");
    let repo = open(repo_root, &["cat-file", "-e", &spec])?;
    Ok(lookup_entry(&repo, rev, path).is_some())
}

/// Resolve a ref and return its hash when — and only when — it names a commit.
///
/// A port of `rev-parse --verify <ref>` followed by `cat-file -t <hash>`, quirk
/// included: neither command peels, so an *annotated* tag resolves to the tag
/// object, reads back as `tag` rather than `commit`, and answers `None`. A
/// lightweight tag points straight at the commit and validates.
pub fn validate_ref(repo_root: &Path, rev: &str) -> Result<Option<String>, GitError> {
    let repo = open(repo_root, &["rev-parse", "--verify", rev])?;
    let Ok(id) = repo.rev_parse_single(rev) else {
        return Ok(None);
    };
    let id = id.detach();
    let Ok(header) = repo.find_header(id) else {
        return Ok(None);
    };
    Ok((header.kind() == gix::object::Kind::Commit).then(|| id.to_string()))
}
