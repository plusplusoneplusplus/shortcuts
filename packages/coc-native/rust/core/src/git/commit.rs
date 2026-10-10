//! Everything `GitLogService` asks about one commit that is not the commit
//! itself: the parent it is diffed against, the files it touched, its diff, and
//! the blobs and refs a review view resolves.
//!
//! Object/ref reads use `gix`. Metadata and patches share the first-parent/root
//! Git CLI plan from `git::patch`; metadata uses NUL-delimited name-status and
//! numstat output so literal paths survive transport and joins.
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
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "GitCommitFile")
)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitFile {
    pub path: String,
    /// Source path of a rename or copy; `None` for everything else.
    pub original_path: Option<String>,
    #[cfg_attr(feature = "napi", napi(ts_type = "string"))]
    pub status: ChangeStatus,
    /// Binary files and missing numstat rows have absent counts, not zero.
    /// JavaScript omits these fields so the UI renders a blank column.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// A commit's file list, and the parent the list was computed against.
#[cfg_attr(
    feature = "napi",
    napi_derive::napi(object, object_from_js = false, js_name = "GitCommitFiles")
)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitFiles {
    /// The commit's first parent, or git's empty tree for a root commit.
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

/// Join NUL-delimited metadata without interpreting literal tabs, newlines,
/// quotes or rename arrows inside paths. Name-status preserves Git ordering;
/// binary and missing numstat rows keep absent counts.
pub fn parse_commit_files(name_status: &str, numstat: &str) -> Vec<CommitFile> {
    let mut stats = HashMap::new();
    let mut rows = numstat.split('\0');
    while let Some(row) = rows.next() {
        let mut columns = row.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (columns.next(), columns.next(), columns.next())
        else {
            continue;
        };
        let path = if path.is_empty() {
            let (Some(_old), Some(new)) = (rows.next(), rows.next()) else { break };
            new
        } else {
            path
        };
        if let (Ok(add), Ok(del)) = (add.parse::<u32>(), del.parse::<u32>()) {
            stats.insert(path, (add, del));
        }
    }
    let mut rows = name_status.split('\0');
    let mut files = Vec::new();
    while let Some(code) = rows.next().filter(|code| !code.is_empty()) {
        let Some(first) = rows.next().filter(|path| !path.is_empty()) else { break };
        let (path, original_path) = if code.starts_with('R') || code.starts_with('C') {
            let Some(new) = rows.next().filter(|path| !path.is_empty()) else { break };
            (new, Some(first.to_string()))
        } else {
            (first, None)
        };
        let counts = stats.get(path);
        files.push(CommitFile {
            path: path.to_string(),
            original_path,
            status: ChangeStatus::from_code(code),
            additions: counts.map(|counts| counts.0),
            deletions: counts.map(|counts| counts.1),
        });
    }
    files
}

/// Metadata and patches share first-parent/root comparison and path options.
/// The complete batch is also supplied to the external WSL transport.
pub fn commit_files_args(commit: &str) -> Vec<Vec<String>> {
    let mut batch: Vec<Vec<String>> = ["--name-status", "--numstat"]
        .iter()
        .map(|format| {
            let mut args = super::patch::commit_patch_args(commit, None, None);
            args.retain(|arg| arg != "-p");
            args.splice(2..2, [format.to_string(), "-z".into()]);
            args
        })
        .collect();
    batch.push(
        ["log", "-1", "--format=%P", "--no-show-signature", "--end-of-options", commit, "--"]
            .into_iter()
            .map(String::from)
            .collect(),
    );
    batch
}

/// Parent output is empty for roots and ordered first-parent first for merges.
pub fn process_commit_metadata(name_status: &str, numstat: &str, parents: &str) -> CommitFiles {
    CommitFiles {
        parent_hash: parents.split_whitespace().next().unwrap_or(EMPTY_TREE_HASH).to_string(),
        files: parse_commit_files(name_status, numstat),
    }
}

pub fn commit_files(
    repo_root: &Path,
    commit: &str,
    options: &GitCommandOptions,
) -> Result<CommitFiles, GitError> {
    let args = commit_files_args(commit);
    let name_status = run_git(repo_root, &args[0], options)?;
    let numstat = run_git(repo_root, &args[1], options)?;
    let parents = run_git(repo_root, &args[2], options)?;
    Ok(process_commit_metadata(&name_status, &numstat, &parents))
}

/// Read a commit's diff against its parent.
///
/// Uses the same first-parent/root CLI plan as the patch backend.
pub fn commit_diff(
    repo_root: &Path,
    commit: &str,
    options: &GitCommandOptions,
) -> Result<String, GitError> {
    run_git(repo_root, &super::patch::commit_patch_args(commit, None, None), options)
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
