//! Parsing `git status --porcelain` into the working tree's change list.
//!
//! This is a port of the `parsePorcelain` that used to live in
//! `forge/src/git/working-tree-service.ts`, kept deliberately literal: the same
//! short-line skip, the same ` -> ` split for renames and copies, the same rule
//! that a single line can yield two changes when both columns are dirty, and
//! the same silent drop of ignored entries. The Git tab renders whatever comes
//! out of here, so a "cleaner" parse would be a visible behaviour change.
//!
//! Entries carry the path exactly as git printed it — repository-relative, or
//! quoted when `core.quotePath` is on. Turning that into an absolute path is
//! left to the TypeScript caller, because `path.join` and `path.basename` are
//! what shaped every path the UI has ever shown, and their Windows separator
//! handling is not worth re-deriving here.

use std::path::Path;

use super::{run_git, GitCommandOptions, GitError};

/// Timeout the working-tree read path has always used — shorter than the
/// 30 s default, because a status that slow is a hang the UI should not wait on.
pub const STATUS_TIMEOUT_MS: u64 = 15_000;

/// What happened to a file, as the porcelain status letters describe it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Conflict,
}

impl ChangeStatus {
    /// The `GitChangeStatus` string union member this maps to in TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Modified => "modified",
            Self::Added => "added",
            Self::Deleted => "deleted",
            Self::Renamed => "renamed",
            Self::Copied => "copied",
            Self::Untracked => "untracked",
            Self::Ignored => "ignored",
            Self::Conflict => "conflict",
        }
    }

    /// Map a `--name-status` code letter, ignoring the similarity score on an
    /// `R100` or a `C075`.
    ///
    /// An unrecognised letter becomes `Modified` rather than dropping the file:
    /// a row missing from a diff is worse than a row with a dull status. That
    /// is the opposite of [`Self::from_column`], which drops, and the
    /// difference is deliberate — porcelain columns include letters that mean
    /// "not a change at all".
    pub fn from_code(code: &str) -> Self {
        match code.chars().next().map(|letter| letter.to_ascii_uppercase()) {
            Some('M') => Self::Modified,
            Some('A') => Self::Added,
            Some('D') => Self::Deleted,
            Some('R') => Self::Renamed,
            Some('C') => Self::Copied,
            Some('U') => Self::Conflict,
            _ => Self::Modified,
        }
    }

    /// Map one porcelain status column. Unknown letters yield `None`, which
    /// drops the change rather than inventing a status for it.
    fn from_column(column: u8) -> Option<Self> {
        match column {
            b'M' => Some(Self::Modified),
            b'A' => Some(Self::Added),
            b'D' => Some(Self::Deleted),
            b'R' => Some(Self::Renamed),
            b'C' => Some(Self::Copied),
            b'U' => Some(Self::Conflict),
            b'?' => Some(Self::Untracked),
            b'!' => Some(Self::Ignored),
            _ => None,
        }
    }
}

/// Which of the three lists in the Git tab a change belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeStage {
    Staged,
    Unstaged,
    Untracked,
}

impl ChangeStage {
    /// The `GitChangeStage` string union member this maps to in TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Staged => "staged",
            Self::Unstaged => "unstaged",
            Self::Untracked => "untracked",
        }
    }
}

/// One row of the working-tree change list, with git's own path spelling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    /// The changed path. For a rename or copy this is the *destination*.
    pub path: String,
    /// The source path of a rename or copy; `None` for everything else.
    pub original_path: Option<String>,
    pub status: ChangeStatus,
    pub stage: ChangeStage,
}

/// Parse `git status --porcelain` output.
///
/// A line is `XY <path>`, or `XY <old> -> <new>` for a rename or copy, where
/// `X` is the index column and `Y` the worktree column. Both columns can be
/// dirty at once (`MM`), and that produces two entries for the one path — the
/// staged and unstaged lists are shown separately, so the file appears in both.
pub fn parse_porcelain(output: &str) -> Vec<StatusEntry> {
    let mut changes = Vec::new();

    for raw_line in output.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        // "XY " plus at least one path character. Anything shorter is the blank
        // tail of the output, not a change.
        if line.len() < 4 {
            continue;
        }
        let bytes = line.as_bytes();
        let index_column = bytes[0];
        let worktree_column = bytes[1];
        // bytes[2] is always a space; the first three columns are ASCII, so
        // slicing at 3 always lands on a character boundary.
        let rest = &line[3..];

        let (path, original_path) = match rest.find(" -> ") {
            Some(at) => (rest[at + 4..].to_string(), Some(rest[..at].to_string())),
            None => (rest.to_string(), None),
        };

        // Untracked: both columns are '?'. It is one entry in its own list, and
        // carries no original path even if the name happens to contain " -> ".
        if index_column == b'?' && worktree_column == b'?' {
            changes.push(StatusEntry {
                path,
                original_path: None,
                status: ChangeStatus::Untracked,
                stage: ChangeStage::Untracked,
            });
            continue;
        }

        // Ignored files are never shown, so they never become changes.
        if index_column == b'!' && worktree_column == b'!' {
            continue;
        }

        if index_column != b' ' && index_column != b'?' {
            if let Some(status) = ChangeStatus::from_column(index_column) {
                changes.push(StatusEntry {
                    path: path.clone(),
                    original_path: original_path.clone(),
                    status,
                    stage: ChangeStage::Staged,
                });
            }
        }

        if worktree_column != b' ' && worktree_column != b'?' {
            if let Some(status) = ChangeStatus::from_column(worktree_column) {
                changes.push(StatusEntry {
                    path,
                    original_path,
                    status,
                    stage: ChangeStage::Unstaged,
                });
            }
        }
    }

    changes
}

/// Read the working tree's full change list from a repository.
///
/// `--untracked-files=all` lists every untracked file individually instead of
/// collapsing a fully-untracked directory into one trailing-slash entry
/// (`Plans/`). Collapsed entries give the client's file-tree builder an empty
/// leaf name, and leave the delete-untracked action with nothing per-file to
/// act on.
pub fn status_entries(
    repo_root: &Path,
    options: &GitCommandOptions,
) -> Result<Vec<StatusEntry>, GitError> {
    let args: Vec<String> = ["status", "--porcelain", "--untracked-files=all"]
        .iter()
        .map(|arg| arg.to_string())
        .collect();
    let output = run_git(repo_root, &args, options)?;
    Ok(parse_porcelain(&output))
}
