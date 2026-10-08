//! Commit-range resolution without spawning git for the ref work.
//!
//! Base-ref resolution is the part with real branching logic — five candidate
//! refs, two modes, and a fallback that has to announce itself — so every one
//! of those paths gets a temp repository built to trigger exactly it. The
//! patch processing is covered by the shared backend tests in `git_patch`.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::range::{
    count_commits_ahead, default_remote_branch, merge_base, resolve_base_ref, upstream_branch,
    BaseMode,
};
use tempfile::TempDir;

/// The parentless tree every git repository has, used to build a commit with no
/// history in common with the rest of the repo.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn git(repo: &Path, values: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git {values:?} failed");
}

fn git_stdout(repo: &Path, values: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .output()
        .expect("git should be on PATH for these tests");
    assert!(
        output.status.success(),
        "git {values:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("git output should be UTF-8").trim().to_string()
}

fn init(dir: &Path) {
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.email", "ralph@example.com"]);
    git(dir, &["config", "user.name", "Ralph"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn write(repo: &Path, name: &str, contents: &str) {
    let path = repo.join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("parent directory should be creatable");
    }
    std::fs::write(path, contents).expect("file should be writable");
}

fn commit(repo: &Path, name: &str, contents: &str, message: &str) -> String {
    write(repo, name, contents);
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-m", message]);
    git_stdout(repo, &["rev-parse", "HEAD"])
}

/// A repository on `main` with three commits and no remote refs at all.
fn repo_with_history() -> (TempDir, String) {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    let first = commit(dir.path(), "a.txt", "one\n", "first");
    commit(dir.path(), "b.txt", "two\n", "second");
    commit(dir.path(), "c.txt", "three\n", "third");
    (dir, first)
}

/// Point a remote-tracking ref at a commit without needing a real remote.
fn set_remote_ref(repo: &Path, name: &str, target: &str) {
    git(repo, &["update-ref", &format!("refs/remotes/{name}"), target]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default branch detection
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn default_branch_prefers_origin_main() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);
    set_remote_ref(dir.path(), "origin/master", &first);

    let found = default_remote_branch(dir.path()).expect("resolves").expect("has a default");
    assert_eq!(found.name, "origin/main");
    assert!(found.from_remote);
}

#[test]
fn default_branch_falls_back_to_origin_master() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/master", &first);

    let found = default_remote_branch(dir.path()).expect("resolves").expect("has a default");
    assert_eq!(found.name, "origin/master");
    assert!(found.from_remote);
}

#[test]
fn default_branch_reads_symbolic_origin_head() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/develop", &first);
    git(dir.path(), &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"]);

    let found = default_remote_branch(dir.path()).expect("resolves").expect("has a default");
    assert_eq!(found.name, "origin/develop");
    assert!(found.from_remote);
}

#[test]
fn default_branch_ignores_a_non_symbolic_origin_head() {
    let (dir, first) = repo_with_history();
    // `git symbolic-ref` exits non-zero on a ref pointing straight at an object,
    // so the TypeScript fell through to the local branches here.
    set_remote_ref(dir.path(), "origin/HEAD", &first);

    let found = default_remote_branch(dir.path()).expect("resolves").expect("has a default");
    assert_eq!(found.name, "main");
    assert!(!found.from_remote);
}

#[test]
fn default_branch_falls_back_to_local_main() {
    let (dir, _) = repo_with_history();

    let found = default_remote_branch(dir.path()).expect("resolves").expect("has a default");
    assert_eq!(found.name, "main");
    // The TypeScript cached the three remote answers and deliberately did not
    // cache this one; `from_remote` is how the caller still tells them apart.
    assert!(!found.from_remote);
}

#[test]
fn default_branch_falls_back_to_local_master() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    commit(dir.path(), "a.txt", "one\n", "first");
    git(dir.path(), &["branch", "-m", "main", "master"]);

    let found = default_remote_branch(dir.path()).expect("resolves").expect("has a default");
    assert_eq!(found.name, "master");
    assert!(!found.from_remote);
}

#[test]
fn default_branch_is_absent_when_nothing_matches() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    commit(dir.path(), "a.txt", "one\n", "first");
    git(dir.path(), &["branch", "-m", "main", "trunk"]);

    assert_eq!(default_remote_branch(dir.path()).expect("resolves"), None);
}

#[test]
fn default_branch_fails_on_a_path_that_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = default_remote_branch(dir.path()).expect_err("a bare directory is not a repo");
    assert!(
        error.to_string().starts_with("git rev-parse --verify origin/main failed:"),
        "unexpected message: {error}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upstream detection
// ─────────────────────────────────────────────────────────────────────────────

/// Give `main` a tracking branch the way `--set-upstream-to` does.
fn set_upstream(repo: &Path, branch: &str, remote_branch: &str) {
    git(repo, &["remote", "add", "origin", "https://example.invalid/repo.git"]);
    git(repo, &["branch", &format!("--set-upstream-to={remote_branch}"), branch]);
}

#[test]
fn upstream_is_the_tracking_branch_when_configured() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/feature", &first);
    set_upstream(dir.path(), "main", "origin/feature");

    assert_eq!(upstream_branch(dir.path()).expect("resolves"), Some("origin/feature".to_string()));
}

#[test]
fn upstream_is_absent_without_tracking_configuration() {
    let (dir, _) = repo_with_history();
    assert_eq!(upstream_branch(dir.path()).expect("resolves"), None);
}

#[test]
fn upstream_is_absent_on_a_detached_head() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);
    set_upstream(dir.path(), "main", "origin/main");
    git(dir.path(), &["update-ref", "--no-deref", "HEAD", &first]);

    assert_eq!(upstream_branch(dir.path()).expect("resolves"), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// Base ref resolution — every GitRangeBaseMode
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn default_branch_mode_resolves_to_the_default_branch() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);

    let resolved = resolve_base_ref(dir.path(), BaseMode::DefaultBranch).expect("resolves");
    assert_eq!(resolved.base_ref, Some("origin/main".to_string()));
    assert_eq!(resolved.base_mode, BaseMode::DefaultBranch);
    assert!(!resolved.base_mode_fallback);
}

#[test]
fn default_branch_mode_ignores_a_configured_upstream() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);
    set_remote_ref(dir.path(), "origin/feature", &first);
    set_upstream(dir.path(), "main", "origin/feature");

    let resolved = resolve_base_ref(dir.path(), BaseMode::DefaultBranch).expect("resolves");
    assert_eq!(resolved.base_ref, Some("origin/main".to_string()));
    assert_eq!(resolved.base_mode, BaseMode::DefaultBranch);
}

#[test]
fn default_branch_mode_has_no_base_ref_when_there_is_no_default_branch() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    commit(dir.path(), "a.txt", "one\n", "first");
    git(dir.path(), &["branch", "-m", "main", "trunk"]);

    let resolved = resolve_base_ref(dir.path(), BaseMode::DefaultBranch).expect("resolves");
    assert_eq!(resolved.base_ref, None);
    assert_eq!(resolved.base_mode, BaseMode::DefaultBranch);
    assert!(!resolved.base_mode_fallback);
}

#[test]
fn upstream_mode_resolves_to_the_upstream() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);
    set_remote_ref(dir.path(), "origin/feature", &first);
    set_upstream(dir.path(), "main", "origin/feature");

    let resolved = resolve_base_ref(dir.path(), BaseMode::Upstream).expect("resolves");
    assert_eq!(resolved.base_ref, Some("origin/feature".to_string()));
    assert_eq!(resolved.base_mode, BaseMode::Upstream);
    assert!(!resolved.base_mode_fallback);
}

#[test]
fn upstream_mode_degrades_to_the_default_branch_and_says_so() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);

    let resolved = resolve_base_ref(dir.path(), BaseMode::Upstream).expect("resolves");
    assert_eq!(resolved.base_ref, Some("origin/main".to_string()));
    // The mode reported back is the one used, not the one asked for.
    assert_eq!(resolved.base_mode, BaseMode::DefaultBranch);
    assert!(resolved.base_mode_fallback);
}

#[test]
fn upstream_mode_degrades_to_nothing_when_there_is_no_default_branch_either() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    commit(dir.path(), "a.txt", "one\n", "first");
    git(dir.path(), &["branch", "-m", "main", "trunk"]);

    let resolved = resolve_base_ref(dir.path(), BaseMode::Upstream).expect("resolves");
    assert_eq!(resolved.base_ref, None);
    assert_eq!(resolved.base_mode, BaseMode::DefaultBranch);
    assert!(resolved.base_mode_fallback);
}

#[test]
fn base_mode_round_trips_through_its_typescript_spelling() {
    assert_eq!(BaseMode::from_name("upstream"), BaseMode::Upstream);
    assert_eq!(BaseMode::from_name("default-branch"), BaseMode::DefaultBranch);
    // The route already tolerates a misspelled `?base=`; so does this.
    assert_eq!(BaseMode::from_name("nonsense"), BaseMode::DefaultBranch);
    assert_eq!(BaseMode::Upstream.as_str(), "upstream");
    assert_eq!(BaseMode::DefaultBranch.as_str(), "default-branch");
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge base
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn merge_base_matches_git() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);

    let found = merge_base(dir.path(), "HEAD", "origin/main").expect("resolves");
    assert_eq!(found, Some(git_stdout(dir.path(), &["merge-base", "HEAD", "origin/main"])));
    assert_eq!(found, Some(first));
}

#[test]
fn merge_base_is_absent_for_unrelated_histories() {
    let (dir, _) = repo_with_history();
    let orphan = git_stdout(dir.path(), &["commit-tree", EMPTY_TREE, "-m", "unrelated"]);
    set_remote_ref(dir.path(), "origin/main", &orphan);

    assert_eq!(merge_base(dir.path(), "HEAD", "origin/main").expect("resolves"), None);
}

#[test]
fn merge_base_is_absent_for_a_revision_that_names_nothing() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);

    assert_eq!(merge_base(dir.path(), "HEAD", "origin/nope").expect("resolves"), None);
}

// ─────────────────────────────────────────────────────────────────────────────
// Commits ahead
// ─────────────────────────────────────────────────────────────────────────────

/// What `git rev-list --count <base>..<head>` says, for a differential check.
fn git_count(repo: &Path, base: &str, head: &str) -> u32 {
    git_stdout(repo, &["rev-list", "--count", &format!("{base}..{head}")]).parse().expect("a count")
}

#[test]
fn ahead_count_matches_rev_list() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);

    let counted = count_commits_ahead(dir.path(), "origin/main", "HEAD").expect("resolves");
    assert_eq!(counted, git_count(dir.path(), "origin/main", "HEAD"));
    assert_eq!(counted, 2);
}

#[test]
fn ahead_count_is_zero_when_the_base_is_head() {
    let (dir, _) = repo_with_history();
    let head = git_stdout(dir.path(), &["rev-parse", "HEAD"]);
    set_remote_ref(dir.path(), "origin/main", &head);

    assert_eq!(count_commits_ahead(dir.path(), "origin/main", "HEAD").expect("resolves"), 0);
}

#[test]
fn ahead_count_is_zero_for_a_revision_that_names_nothing() {
    let (dir, _) = repo_with_history();
    assert_eq!(count_commits_ahead(dir.path(), "origin/nope", "HEAD").expect("resolves"), 0);
}

#[test]
fn ahead_count_covers_a_whole_unrelated_history() {
    let (dir, _) = repo_with_history();
    let orphan = git_stdout(dir.path(), &["commit-tree", EMPTY_TREE, "-m", "unrelated"]);
    set_remote_ref(dir.path(), "origin/main", &orphan);

    let counted = count_commits_ahead(dir.path(), "origin/main", "HEAD").expect("resolves");
    assert_eq!(counted, git_count(dir.path(), "origin/main", "HEAD"));
    assert_eq!(counted, 3);
}
