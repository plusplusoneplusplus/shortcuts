//! The git command runner: output shaping, the timeout and buffer caps, and the
//! `git <args> failed: <stderr>` error text the UI shows verbatim.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::{
    run_git, GitCommandOptions, GitErrorKind, DEFAULT_MAX_BUFFER_BYTES, DEFAULT_TIMEOUT_MS,
};
use tempfile::TempDir;

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

fn git(repo: &Path, values: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git {values:?} failed");
}

/// A repo with one commit, deterministic identity, and no dependence on the
/// developer's global git config.
fn repo_with_commit() -> TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path();
    git(path, &["init", "--initial-branch=main"]);
    git(path, &["config", "user.email", "ralph@example.com"]);
    git(path, &["config", "user.name", "Ralph"]);
    git(path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("README.md"), "hello\n").expect("write");
    git(path, &["add", "."]);
    git(path, &["commit", "-m", "initial commit"]);
    dir
}

#[test]
fn defaults_match_the_typescript_helper() {
    let options = GitCommandOptions::default();
    assert_eq!(options.timeout_ms, DEFAULT_TIMEOUT_MS);
    assert_eq!(options.max_buffer_bytes, DEFAULT_MAX_BUFFER_BYTES);
    assert_eq!(DEFAULT_TIMEOUT_MS, 30_000);
    assert_eq!(DEFAULT_MAX_BUFFER_BYTES, 50 * 1024 * 1024);
    assert!(options.cwd.is_none());
}

#[test]
fn returns_stdout_with_one_trailing_newline_removed() {
    let repo = repo_with_commit();
    let output =
        run_git(repo.path(), &args(&["log", "--format=%s"]), &GitCommandOptions::default())
            .expect("log should succeed");
    assert_eq!(output, "initial commit");
}

#[test]
fn keeps_interior_and_extra_trailing_blank_lines() {
    let repo = repo_with_commit();
    // `echo` writes "a\n\n\n"; only the last newline is the line terminator, so
    // the two blank lines in between have to survive.
    let output = run_git(
        repo.path(),
        &args(&["-c", "alias.blanks=!printf 'a\\n\\n\\n'", "blanks"]),
        &GitCommandOptions::default(),
    )
    .expect("alias should run");
    assert_eq!(output, "a\n\n");
}

#[test]
fn arguments_with_spaces_survive_without_quoting() {
    let repo = repo_with_commit();
    std::fs::write(repo.path().join("a file with spaces.md"), "x\n").expect("write");
    git(repo.path(), &["add", "."]);
    git(repo.path(), &["commit", "-m", "a subject with spaces"]);

    let output = run_git(
        repo.path(),
        &args(&["log", "-1", "--format=%s", "--", "a file with spaces.md"]),
        &GitCommandOptions::default(),
    )
    .expect("log should succeed");
    assert_eq!(output, "a subject with spaces");
}

#[test]
fn non_utf8_output_is_replaced_rather_than_failing() {
    let repo = repo_with_commit();
    let output = run_git(
        repo.path(),
        &args(&["-c", "alias.raw=!printf 'a\\377b\\n'", "raw"]),
        &GitCommandOptions::default(),
    )
    .expect("alias should run");
    assert_eq!(output, "a\u{fffd}b");
}

#[test]
fn a_nonzero_exit_reports_the_args_and_stderr() {
    let repo = repo_with_commit();
    let error = run_git(
        repo.path(),
        &args(&["rev-parse", "definitely-not-a-ref"]),
        &GitCommandOptions::default(),
    )
    .expect_err("an unknown ref should fail");

    assert!(matches!(error.kind, GitErrorKind::Exit(Some(_))));
    assert_eq!(error.args, args(&["rev-parse", "definitely-not-a-ref"]));
    let message = error.to_string();
    assert!(
        message.starts_with("git rev-parse definitely-not-a-ref failed: "),
        "unexpected message: {message}"
    );
    assert!(message.contains("definitely-not-a-ref"), "stderr should be included: {message}");
}

#[test]
fn a_path_that_is_not_a_repository_fails_with_stderr() {
    let dir = tempfile::tempdir().expect("tempdir");
    let error = run_git(dir.path(), &args(&["status"]), &GitCommandOptions::default())
        .expect_err("a bare directory is not a repository");
    assert!(matches!(error.kind, GitErrorKind::Exit(Some(_))));
    assert!(error.to_string().starts_with("git status failed: "));
    assert!(!error.stderr.is_empty(), "git should have explained itself");
}

#[test]
fn a_path_that_does_not_exist_fails_rather_than_hanging() {
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("no-such-directory");
    let error = run_git(&missing, &args(&["status"]), &GitCommandOptions::default())
        .expect_err("a missing directory cannot be a repository");
    assert!(error.to_string().starts_with("git status failed: "));
}

#[test]
fn a_command_past_its_timeout_is_killed() {
    let repo = repo_with_commit();
    let options = GitCommandOptions { timeout_ms: 200, ..GitCommandOptions::default() };
    let error = run_git(repo.path(), &args(&["-c", "alias.nap=!sleep 30", "nap"]), &options)
        .expect_err("a 30 s sleep should not survive a 200 ms timeout");

    assert_eq!(error.kind, GitErrorKind::Timeout);
    assert_eq!(error.to_string(), "git -c alias.nap=!sleep 30 nap failed: ");
}

#[test]
fn a_timeout_of_zero_means_no_limit() {
    let repo = repo_with_commit();
    let options = GitCommandOptions { timeout_ms: 0, ..GitCommandOptions::default() };
    let output = run_git(repo.path(), &args(&["log", "--format=%s"]), &options)
        .expect("no limit should not mean instant timeout");
    assert_eq!(output, "initial commit");
}

#[test]
fn output_past_the_buffer_cap_fails() {
    let repo = repo_with_commit();
    let options = GitCommandOptions { max_buffer_bytes: 8, ..GitCommandOptions::default() };
    let error = run_git(repo.path(), &args(&["log", "--format=%H %s"]), &options)
        .expect_err("a 8-byte cap cannot hold a commit line");
    assert_eq!(error.kind, GitErrorKind::MaxBuffer);
    assert!(error.to_string().starts_with("git log --format=%H %s failed: "));
}

#[test]
fn output_exactly_at_the_buffer_cap_still_succeeds() {
    let repo = repo_with_commit();
    // "initial commit\n" is 15 bytes on the wire; the cap covers the newline.
    let options = GitCommandOptions { max_buffer_bytes: 15, ..GitCommandOptions::default() };
    let output = run_git(repo.path(), &args(&["log", "--format=%s"]), &options)
        .expect("a cap that exactly fits is not an overflow");
    assert_eq!(output, "initial commit");
}

#[test]
fn concurrent_calls_against_one_repo_all_succeed() {
    let repo = repo_with_commit();
    let path = repo.path().to_path_buf();
    let handles: Vec<_> = (0..16)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                run_git(&path, &args(&["rev-parse", "HEAD"]), &GitCommandOptions::default())
            })
        })
        .collect();

    let heads: Vec<String> = handles
        .into_iter()
        .map(|handle| handle.join().expect("thread").expect("rev-parse"))
        .collect();
    assert_eq!(heads.len(), 16);
    assert!(heads.iter().all(|head| head == &heads[0]), "every read should see one HEAD");
    assert_eq!(heads[0].len(), 40);
}

#[test]
fn cwd_overrides_the_child_working_directory() {
    let repo = repo_with_commit();
    let elsewhere = tempfile::tempdir().expect("tempdir");
    let options = GitCommandOptions {
        cwd: Some(elsewhere.path().to_path_buf()),
        ..GitCommandOptions::default()
    };
    // `-C` still decides which repository answers, so the result is unchanged.
    let output = run_git(repo.path(), &args(&["log", "--format=%s"]), &options)
        .expect("a cwd elsewhere must not change which repo -C selects");
    assert_eq!(output, "initial commit");
}
