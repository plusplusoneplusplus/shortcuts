//! Finding a working-tree root through `gix::discover` instead of spawning
//! `git rev-parse --show-toplevel`.
//!
//! The interesting cases are all the ones that answer *nothing*. Discovery
//! walks upward by design, so the failures the TypeScript reported by throwing
//! — a missing path, a bare repository, a directory outside any repository —
//! have to be turned back into `None` deliberately, and each of them is a path
//! where answering the repository above would be actively wrong.
//!
//! The positive cases are asserted differentially against the real `git
//! rev-parse --show-toplevel`, canonicalised on both sides: git prints the
//! physical path and `gix` reports the path discovery walked, which differ
//! wherever a symlink is in play (`/tmp` on macOS is the everyday one), and the
//! caller normalises with `fs.realpath` before comparing too.

use std::path::{Path, PathBuf};
use std::process::Command;

use coc_native_core::git::repo::discover_workdir;
use tempfile::TempDir;

fn git(repo: &Path, values: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git {values:?} failed");
}

/// What the real `git rev-parse --show-toplevel` says, run from `cwd`.
fn cli_toplevel(cwd: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .expect("git should be on PATH for these tests");
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim_end_matches(['\n', '\r']).to_string())
}

/// Resolve symlinks so the two backends are compared on the path they mean
/// rather than on the route each took to it.
fn real(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn found(path: &Path) -> String {
    discover_workdir(path).expect("discovery should not fail").expect("a work tree was expected")
}

/// `GitError` carries no `PartialEq`, so the empty answer is unwrapped rather
/// than compared as a whole `Result`.
fn nothing_found(path: &Path) -> bool {
    discover_workdir(path).expect("discovery should not fail").is_none()
}

/// A repository with one commit and a nested directory holding a file.
fn repo() -> TempDir {
    let dir = TempDir::new().expect("temp dir");
    git(dir.path(), &["init", "--initial-branch=main"]);
    git(dir.path(), &["config", "user.email", "ralph@example.com"]);
    git(dir.path(), &["config", "user.name", "Ralph"]);
    git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::create_dir_all(dir.path().join("src/deep")).expect("dirs should be creatable");
    std::fs::write(dir.path().join("src/deep/a.txt"), "one\n").expect("file should be writable");
    git(dir.path(), &["add", "-A"]);
    git(dir.path(), &["commit", "-m", "first"]);
    dir
}

// ============================================================================
// The root itself
// ============================================================================

#[test]
fn finds_the_root_from_the_root() {
    let dir = repo();
    assert_eq!(real(&found(dir.path())), real(dir.path().to_str().unwrap()));
}

#[test]
fn matches_the_cli_from_the_root() {
    let dir = repo();
    let cli = cli_toplevel(dir.path()).expect("git should report a toplevel");
    assert_eq!(real(&found(dir.path())), real(&cli));
}

#[test]
fn reports_no_trailing_separator() {
    let dir = repo();
    let root = found(dir.path());
    assert!(!root.ends_with(std::path::MAIN_SEPARATOR), "{root:?} should not end in a separator");
}

// ============================================================================
// Walking up
// ============================================================================

#[test]
fn finds_the_root_from_a_nested_directory() {
    let dir = repo();
    let nested = dir.path().join("src/deep");
    assert_eq!(real(&found(&nested)), real(dir.path().to_str().unwrap()));
}

#[test]
fn matches_the_cli_from_a_nested_directory() {
    let dir = repo();
    let nested = dir.path().join("src/deep");
    let cli = cli_toplevel(&nested).expect("git should report a toplevel");
    assert_eq!(real(&found(&nested)), real(&cli));
}

#[test]
fn finds_the_root_from_a_file() {
    let dir = repo();
    let file = dir.path().join("src/deep/a.txt");
    assert_eq!(real(&found(&file)), real(dir.path().to_str().unwrap()));
}

#[test]
fn finds_the_root_from_an_untracked_file() {
    let dir = repo();
    let file = dir.path().join("src/deep/untracked.txt");
    std::fs::write(&file, "new\n").expect("file should be writable");
    assert_eq!(real(&found(&file)), real(dir.path().to_str().unwrap()));
}

// ============================================================================
// The answers that must stay empty
// ============================================================================

#[test]
fn a_directory_outside_any_repository_finds_nothing() {
    let dir = TempDir::new().expect("temp dir");
    assert!(nothing_found(dir.path()));
}

/// The reason the existence check cannot be left to discovery: without it the
/// walk continues upward and answers with the repository that contains the
/// missing path's parent.
#[test]
fn a_missing_path_inside_a_repository_finds_nothing() {
    let dir = repo();
    let missing = dir.path().join("src/deep/does-not-exist/deeper");
    assert!(nothing_found(&missing));
}

#[test]
fn a_missing_path_outside_any_repository_finds_nothing() {
    let missing = Path::new("/nonexistent/path/that/does/not/exist");
    assert!(nothing_found(missing));
}

/// `--show-toplevel` fails in a bare repository ("this operation must be run in
/// a work tree"), and the caller read that failure as "no root".
#[test]
fn a_bare_repository_finds_nothing() {
    let dir = TempDir::new().expect("temp dir");
    let bare = dir.path().join("bare.git");
    let status = Command::new("git")
        .args(["init", "--bare"])
        .arg(&bare)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git init --bare failed");

    assert_eq!(cli_toplevel(&bare), None, "the CLI is expected to fail here");
    assert!(nothing_found(&bare));
}

// ============================================================================
// Repositories that are not a plain `.git` directory
// ============================================================================

/// A linked worktree's `.git` is a file pointing into the main repository, and
/// the root that matters is the worktree's own.
#[test]
fn a_linked_worktree_reports_its_own_root() {
    let dir = repo();
    let linked = dir.path().join("linked");
    git(dir.path(), &["worktree", "add", "linked", "-b", "side"]);

    let cli = cli_toplevel(&linked).expect("git should report a toplevel");
    assert_eq!(real(&found(&linked)), real(&cli));
    assert_eq!(real(&found(&linked)), real(linked.to_str().unwrap()));
}

#[test]
fn a_nested_repository_reports_the_inner_root() {
    let outer = repo();
    let inner = outer.path().join("inner");
    std::fs::create_dir_all(&inner).expect("dirs should be creatable");
    git(&inner, &["init", "--initial-branch=main"]);

    assert_eq!(real(&found(&inner)), real(inner.to_str().unwrap()));
}
