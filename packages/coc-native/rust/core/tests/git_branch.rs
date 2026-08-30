//! Branch reading: what HEAD is, how far it has drifted, and what the list
//! looks like.
//!
//! The porcelain-v2 parser is tested as a pure function, header by header. The
//! `gix`-backed halves are tested differentially against the commands they
//! replace — `git status --porcelain=v2 --branch`, `git rev-list --left-right
//! --count` and `git branch --format` — because a branch list that is *nearly*
//! git's is exactly the kind of wrong that only shows up in a screenshot.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::branch::{
    branch_status, list_branches, local_branch_names, parse_porcelain_v2_branch_status,
    repository_status, BranchQuery,
};
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
    String::from_utf8(output.stdout).expect("git output should be UTF-8").trim_end().to_string()
}

fn init(dir: &Path) {
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.email", "ralph@example.com"]);
    git(dir, &["config", "user.name", "Ralph"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn write(repo: &Path, name: &str, contents: &str) {
    std::fs::write(repo.join(name), contents).expect("file should be writable");
}

fn commit(repo: &Path, name: &str, contents: &str, message: &str) -> String {
    write(repo, name, contents);
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-m", message]);
    git_stdout(repo, &["rev-parse", "HEAD"])
}

/// Rewrite HEAD's author and committer dates, so a test can pin how old the
/// tip looks to both git and to us.
fn backdate_head(repo: &Path, date: &str) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["commit", "--amend", "--no-edit", "--date", date])
        .env("GIT_COMMITTER_DATE", date)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git commit --amend --date {date} failed");
}

/// A repository on `main` with three commits and no remotes.
fn repo_with_history() -> TempDir {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    commit(dir.path(), "a.txt", "one\n", "first");
    commit(dir.path(), "b.txt", "two\n", "second");
    commit(dir.path(), "c.txt", "three\n", "third");
    dir
}

/// A clone of `origin` sitting on `main`, tracking `origin/main`.
fn repo_with_upstream() -> (TempDir, TempDir) {
    let origin = repo_with_history();
    let clone = TempDir::new().expect("temp dir");
    let target = clone.path().join("work");
    let status = Command::new("git")
        .arg("clone")
        .arg(origin.path())
        .arg(&target)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git clone failed");
    git(&target, &["config", "user.email", "ralph@example.com"]);
    git(&target, &["config", "user.name", "Ralph"]);
    git(&target, &["config", "commit.gpgsign", "false"]);
    (origin, clone)
}

// ─────────────────────────────────────────────────────────────────────────────
// parse_porcelain_v2_branch_status
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn parses_a_clean_tracking_branch() {
    let status = parse_porcelain_v2_branch_status(
        "# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n",
    );
    assert_eq!(status.branch, "main");
    assert!(!status.is_detached);
    assert!(!status.dirty);
    assert_eq!(status.ahead, 2);
    assert_eq!(status.behind, 3);
    assert_eq!(status.tracking_branch.as_deref(), Some("origin/main"));
    assert!(!status.unborn);
}

#[test]
fn treats_any_non_header_line_as_dirt() {
    for record in ["1 .M N... 100644 100644 100644 aaa bbb file.txt", "? untracked.txt", "#"] {
        let status = parse_porcelain_v2_branch_status(&format!(
            "# branch.oid abc\n# branch.head main\n{record}\n"
        ));
        assert!(status.dirty, "expected {record:?} to count as a change");
    }
}

#[test]
fn parses_an_unborn_branch_without_an_upstream() {
    let status = parse_porcelain_v2_branch_status("# branch.oid (initial)\n# branch.head trunk\n");
    assert_eq!(status.branch, "trunk");
    assert!(status.unborn);
    assert!(!status.is_detached);
    assert_eq!(status.tracking_branch, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
}

#[test]
fn reads_detached_head_as_the_branch_name_head() {
    let status = parse_porcelain_v2_branch_status("# branch.oid abc\n# branch.head (detached)\n");
    assert_eq!(status.branch, "HEAD");
    assert!(status.is_detached);
}

#[test]
fn ignores_malformed_ahead_behind_headers() {
    for value in ["unknown", "+2", "2 -3", "+2 3", "+a -b", "+2 -3 -4", ""] {
        let status = parse_porcelain_v2_branch_status(&format!(
            "# branch.oid abc\n# branch.head main\n# branch.ab {value}\n"
        ));
        assert_eq!(
            (status.ahead, status.behind),
            (0, 0),
            "expected `# branch.ab {value}` to leave both counts at zero"
        );
    }
}

#[test]
fn reads_an_empty_upstream_header_as_absent() {
    let status = parse_porcelain_v2_branch_status(
        "# branch.oid abc\n# branch.head main\n# branch.upstream    \n",
    );
    assert_eq!(status.tracking_branch, None);
}

#[test]
fn tolerates_crlf_line_endings() {
    let status = parse_porcelain_v2_branch_status(
        "# branch.oid abc\r\n# branch.head main\r\n# branch.ab +1 -0\r\n",
    );
    assert_eq!(status.branch, "main");
    assert!(!status.dirty);
    assert_eq!((status.ahead, status.behind), (1, 0));
}

#[test]
fn defaults_to_head_for_empty_output() {
    let status = parse_porcelain_v2_branch_status("");
    assert_eq!(status.branch, "HEAD");
    assert!(status.is_detached);
    assert!(!status.dirty);
    assert!(!status.unborn);
}

// ─────────────────────────────────────────────────────────────────────────────
// repository_status
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn repository_status_matches_the_command_it_parses() {
    let repo = repo_with_history();
    write(repo.path(), "d.txt", "four\n");
    let status = repository_status(repo.path()).expect("status should read");
    let expected = parse_porcelain_v2_branch_status(&git_stdout(
        repo.path(),
        &["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
    ));
    assert_eq!(status, expected);
    assert_eq!(status.branch, "main");
    assert!(status.dirty);
}

#[test]
fn repository_status_reports_a_clean_tree_as_clean() {
    let repo = repo_with_history();
    let status = repository_status(repo.path()).expect("status should read");
    assert!(!status.dirty);
    assert!(!status.unborn);
}

#[test]
fn repository_status_reports_an_unborn_branch() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    let status = repository_status(dir.path()).expect("status should read");
    assert!(status.unborn);
    assert_eq!(status.branch, "main");
}

#[test]
fn repository_status_fails_outside_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = repository_status(dir.path()).expect_err("a plain directory is not a repository");
    assert!(
        error
            .to_string()
            .starts_with("git status --porcelain=v2 --branch --untracked-files=all failed:"),
        "unexpected message: {error}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// branch_status
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn branch_status_reads_a_branch_without_an_upstream() {
    let repo = repo_with_history();
    let status = branch_status(repo.path()).expect("status should read").expect("HEAD resolves");
    assert_eq!(status.name, "main");
    assert!(!status.is_detached);
    assert_eq!(status.detached_hash, None);
    assert_eq!(status.tracking_branch, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
}

#[test]
fn branch_status_reads_the_upstream_of_a_clone() {
    let (_origin, clone) = repo_with_upstream();
    let work = clone.path().join("work");
    let status = branch_status(&work).expect("status should read").expect("HEAD resolves");
    assert_eq!(status.tracking_branch.as_deref(), Some("origin/main"));
    assert_eq!((status.ahead, status.behind), (0, 0));
}

#[test]
fn branch_status_counts_ahead_and_behind_like_rev_list() {
    let (origin, clone) = repo_with_upstream();
    let work = clone.path().join("work");

    // Two commits only the clone has, one only the origin has.
    commit(&work, "local-1.txt", "1\n", "local one");
    commit(&work, "local-2.txt", "2\n", "local two");
    commit(origin.path(), "remote-1.txt", "1\n", "remote one");
    git(&work, &["fetch", "origin"]);

    let status = branch_status(&work).expect("status should read").expect("HEAD resolves");
    let expected =
        git_stdout(&work, &["rev-list", "--left-right", "--count", "origin/main...main"]);
    let mut counts = expected.split_whitespace();
    let behind: u32 = counts.next().expect("behind").parse().expect("number");
    let ahead: u32 = counts.next().expect("ahead").parse().expect("number");

    assert_eq!((status.ahead, status.behind), (ahead, behind));
    assert_eq!((status.ahead, status.behind), (2, 1));
}

#[test]
fn branch_status_reports_a_detached_head() {
    let repo = repo_with_history();
    let head = git_stdout(repo.path(), &["rev-parse", "HEAD"]);
    git(repo.path(), &["checkout", "--detach", "HEAD"]);

    let status = branch_status(repo.path()).expect("status should read").expect("HEAD resolves");
    assert_eq!(status.name, "");
    assert!(status.is_detached);
    assert_eq!(status.detached_hash.as_deref(), Some(head.as_str()));
    assert_eq!((status.ahead, status.behind), (0, 0));
    assert_eq!(status.tracking_branch, None);
}

#[test]
fn branch_status_is_absent_for_an_unborn_branch() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    assert_eq!(branch_status(dir.path()).expect("status should read"), None);
}

#[test]
fn branch_status_fails_outside_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = branch_status(dir.path()).expect_err("a plain directory is not a repository");
    assert!(error.to_string().starts_with("git rev-parse HEAD failed:"), "unexpected: {error}");
}

#[test]
fn branch_status_ignores_an_upstream_whose_ref_is_missing() {
    let repo = repo_with_history();
    // Configure tracking against a remote ref that was never fetched, which is
    // what `rev-parse --abbrev-ref main@{upstream}` exits non-zero for.
    git(repo.path(), &["remote", "add", "origin", "https://example.invalid/repo.git"]);
    git(repo.path(), &["config", "branch.main.remote", "origin"]);
    git(repo.path(), &["config", "branch.main.merge", "refs/heads/main"]);

    let status = branch_status(repo.path()).expect("status should read").expect("HEAD resolves");
    assert_eq!(status.tracking_branch, None);
    assert_eq!((status.ahead, status.behind), (0, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// list_branches
// ─────────────────────────────────────────────────────────────────────────────

fn all(remote: bool) -> BranchQuery {
    BranchQuery { remote, limit: u32::MAX, offset: 0, search: None }
}

/// Far enough ahead of any commit these tests make that every relative date
/// reads as the past — `relative_date` says "in the future" for a clock behind
/// the commit, which is correct but useless to assert against.
const NOW: i64 = 4_000_000_000;

#[test]
fn lists_local_branches_in_gits_own_order() {
    let repo = repo_with_history();
    for name in ["zeta", "alpha", "feature/one"] {
        git(repo.path(), &["branch", name]);
    }

    let page = list_branches(repo.path(), &all(false), NOW).expect("branches should list");
    let expected: Vec<String> = git_stdout(repo.path(), &["branch", "--format=%(refname:short)"])
        .lines()
        .map(str::to_string)
        .collect();

    assert_eq!(page.branches.iter().map(|b| b.name.clone()).collect::<Vec<_>>(), expected);
    assert_eq!(page.total_count, 4);
    assert!(!page.has_more);
}

#[test]
fn local_branches_carry_subject_current_flag_and_relative_date() {
    let repo = repo_with_history();
    git(repo.path(), &["branch", "side"]);

    let page = list_branches(repo.path(), &all(false), NOW).expect("branches should list");
    let main = page.branches.iter().find(|b| b.name == "main").expect("main is listed");
    let side = page.branches.iter().find(|b| b.name == "side").expect("side is listed");

    assert!(main.is_current);
    assert!(!side.is_current);
    assert!(!main.is_remote);
    assert_eq!(main.remote_name, None);
    assert_eq!(main.last_commit_subject, "third");
    assert_eq!(side.last_commit_subject, "third");
    // Every commit was made now, so `NOW` is far in the future for all of them.
    assert!(main.last_commit_date.ends_with("ago"), "unexpected: {}", main.last_commit_date);
}

#[test]
fn subjects_match_what_git_branch_format_prints() {
    let repo = repo_with_history();
    commit(repo.path(), "multi.txt", "x\n", "a subject\nspanning\nlines");
    git(repo.path(), &["branch", "wrapped"]);

    let page = list_branches(repo.path(), &all(false), NOW).expect("branches should list");
    let expected = git_stdout(repo.path(), &["branch", "--format=%(refname:short)|%(subject)"]);
    let actual: Vec<String> = page
        .branches
        .iter()
        .map(|branch| format!("{}|{}", branch.name, branch.last_commit_subject))
        .collect();
    assert_eq!(actual.join("\n"), expected);
}

#[test]
fn relative_dates_match_git_branch_format() {
    let repo = repo_with_history();
    // A commit made *now* sits on a knife edge: our formatter reads the clock
    // before `list_branches` runs and git reads it again a few milliseconds
    // later, so one says "0 seconds ago" and the other "1 second ago" whenever
    // a second boundary falls in between. Backdating the tip to a fixed date
    // puts both readings deep inside the same year-scale bucket, where no
    // plausible skew between the two clock reads can change the spelling.
    backdate_head(repo.path(), "2000-01-01T00:00:00+00:00");
    git(repo.path(), &["branch", "side"]);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_secs() as i64;

    let page = list_branches(repo.path(), &all(false), now).expect("branches should list");
    let expected =
        git_stdout(repo.path(), &["branch", "--format=%(refname:short)|%(committerdate:relative)"]);
    let actual: Vec<String> = page
        .branches
        .iter()
        .map(|branch| format!("{}|{}", branch.name, branch.last_commit_date))
        .collect();
    assert_eq!(actual.join("\n"), expected);
}

#[test]
fn lists_remote_branches_with_their_remote_name() {
    let (_origin, clone) = repo_with_upstream();
    let work = clone.path().join("work");

    let page = list_branches(&work, &all(true), NOW).expect("branches should list");
    let main = page.branches.iter().find(|b| b.name == "origin/main").expect("origin/main listed");
    assert!(main.is_remote);
    assert!(!main.is_current);
    assert_eq!(main.remote_name.as_deref(), Some("origin"));
    assert_eq!(main.last_commit_subject, "third");
}

#[test]
fn drops_remote_head_from_the_list() {
    let (_origin, clone) = repo_with_upstream();
    let work = clone.path().join("work");
    // Worth pinning, because it is why the TypeScript's `HEAD` filter missed
    // this ref: `%(refname:short)` does not leave `refs/remotes/origin/HEAD`
    // under a name ending in `HEAD` — git 2.43 and later shorten it all the way
    // to `origin`, older git stops at `origin/HEAD` — so the branch list
    // carried a phantom row that the branch *count*, which read
    // `git branch -r --list` where the line does say `HEAD`, always excluded.
    // Both spellings make the point; which one shows up is the git version.
    let raw = git_stdout(&work, &["branch", "-r", "--format=%(refname:short)"]);
    assert!(
        raw.lines().any(|line| line == "origin" || line == "origin/HEAD"),
        "git lists the remote HEAD under a name of its own: {raw}",
    );

    // Rust shortens by stripping `refs/remotes/`, so the ref keeps the name the
    // filter is looking for and the page now agrees with the total.
    let page = list_branches(&work, &all(true), NOW).expect("branches should list");
    assert_eq!(page.branches.iter().map(|b| b.name.clone()).collect::<Vec<_>>(), ["origin/main"]);
    assert_eq!(page.total_count, 1);
}

#[test]
fn local_branches_never_drop_a_name_holding_head() {
    let repo = repo_with_history();
    git(repo.path(), &["branch", "HEADer"]);
    let page = list_branches(repo.path(), &all(false), NOW).expect("branches should list");
    assert!(page.branches.iter().any(|branch| branch.name == "HEADer"));
}

#[test]
fn paginates_with_an_offset_and_a_limit() {
    let repo = repo_with_history();
    for name in ["b1", "b2", "b3", "b4"] {
        git(repo.path(), &["branch", name]);
    }

    let query = BranchQuery { remote: false, limit: 2, offset: 1, search: None };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert_eq!(page.branches.iter().map(|b| b.name.clone()).collect::<Vec<_>>(), ["b2", "b3"]);
    assert_eq!(page.total_count, 5);
    assert!(page.has_more);
}

#[test]
fn a_page_that_reaches_the_end_reports_no_more() {
    let repo = repo_with_history();
    git(repo.path(), &["branch", "b1"]);

    let query = BranchQuery { remote: false, limit: 10, offset: 1, search: None };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert_eq!(page.branches.len(), 1);
    assert_eq!(page.total_count, 2);
    assert!(!page.has_more);
}

#[test]
fn an_offset_past_the_end_returns_an_empty_page() {
    let repo = repo_with_history();
    let query = BranchQuery { remote: false, limit: 10, offset: 50, search: None };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert!(page.branches.is_empty());
    assert_eq!(page.total_count, 1);
    assert!(!page.has_more);
}

#[test]
fn a_zero_limit_answers_the_count_only() {
    let repo = repo_with_history();
    for name in ["b1", "b2"] {
        git(repo.path(), &["branch", name]);
    }

    let query = BranchQuery { remote: false, limit: 0, offset: 0, search: None };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert!(page.branches.is_empty());
    assert_eq!(page.total_count, 3);
    assert!(page.has_more);
}

#[test]
fn search_matches_the_name_case_insensitively() {
    let repo = repo_with_history();
    for name in ["Feature-One", "feature-two", "bugfix"] {
        git(repo.path(), &["branch", name]);
    }

    let query = BranchQuery {
        remote: false,
        limit: u32::MAX,
        offset: 0,
        search: Some("FEATURE".to_string()),
    };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert_eq!(
        page.branches.iter().map(|b| b.name.clone()).collect::<Vec<_>>(),
        ["Feature-One", "feature-two"]
    );
    assert_eq!(page.total_count, 2);
}

#[test]
fn search_ignores_the_commit_subject() {
    let repo = repo_with_history();
    commit(repo.path(), "note.txt", "x\n", "mentions bugfix in the subject");
    git(repo.path(), &["branch", "unrelated"]);

    let query = BranchQuery {
        remote: false,
        limit: u32::MAX,
        offset: 0,
        search: Some("bugfix".to_string()),
    };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert_eq!(page.total_count, 0);
    assert!(page.branches.is_empty());
}

#[test]
fn an_empty_search_is_no_filter() {
    let repo = repo_with_history();
    git(repo.path(), &["branch", "side"]);
    let query =
        BranchQuery { remote: false, limit: u32::MAX, offset: 0, search: Some(String::new()) };
    let page = list_branches(repo.path(), &query, NOW).expect("branches should list");
    assert_eq!(page.total_count, 2);
}

#[test]
fn a_repository_with_no_commits_lists_no_branches() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    let page = list_branches(dir.path(), &all(false), NOW).expect("branches should list");
    assert!(page.branches.is_empty());
    assert_eq!(page.total_count, 0);
    assert!(!page.has_more);
}

#[test]
fn a_repository_with_no_remote_lists_no_remote_branches() {
    let repo = repo_with_history();
    let page = list_branches(repo.path(), &all(true), NOW).expect("branches should list");
    assert!(page.branches.is_empty());
    assert_eq!(page.total_count, 0);
}

#[test]
fn listing_fails_outside_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error =
        list_branches(dir.path(), &all(false), NOW).expect_err("a plain directory is not a repo");
    assert!(error.to_string().starts_with("git branch failed:"), "unexpected: {error}");
}

#[test]
fn a_branch_name_with_a_slash_keeps_its_full_short_name() {
    let repo = repo_with_history();
    git(repo.path(), &["branch", "feature/deep/name"]);
    let page = list_branches(repo.path(), &all(false), NOW).expect("branches should list");
    assert!(page.branches.iter().any(|branch| branch.name == "feature/deep/name"));
}

#[test]
fn a_detached_head_leaves_every_branch_uncurrent() {
    let repo = repo_with_history();
    git(repo.path(), &["branch", "side"]);
    git(repo.path(), &["checkout", "--detach", "HEAD"]);
    let page = list_branches(repo.path(), &all(false), NOW).expect("branches should list");
    assert!(page.branches.iter().all(|branch| !branch.is_current));
}

// ─────────────────────────────────────────────────────────────────────────────
// Bare branch names
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn bare_names_match_git_branch_format_refname_short() {
    let repo = repo_with_history();
    for name in ["zeta", "alpha", "feature/deep"] {
        git(repo.path(), &["branch", name]);
    }

    let legacy: Vec<String> = git_stdout(repo.path(), &["branch", "--format=%(refname:short)"])
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(local_branch_names(repo.path()).expect("names should list"), legacy);
}

#[test]
fn bare_names_exclude_remote_branches() {
    let (local, _remote) = repo_with_upstream();
    let names = local_branch_names(local.path()).expect("names should list");
    assert!(
        names.iter().all(|name| !name.contains('/') || !name.starts_with("origin/")),
        "{names:?}"
    );
    assert!(names.contains(&"main".to_string()), "{names:?}");
}

#[test]
fn bare_names_are_empty_for_an_unborn_branch() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    assert!(local_branch_names(dir.path()).expect("names should list").is_empty());
}

#[test]
fn bare_names_fail_outside_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = local_branch_names(dir.path()).expect_err("a plain directory is not a repo");
    assert!(error.to_string().starts_with("git branch"), "unexpected: {error}");
}
