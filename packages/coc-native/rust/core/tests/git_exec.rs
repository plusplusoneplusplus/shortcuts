//! The git command runner: output shaping, the timeout and buffer caps, and the
//! `git <args> failed: <stderr>` error text the UI shows verbatim.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::{
    run_git, run_git_global, GitCommandOptions, GitErrorKind, DEFAULT_MAX_BUFFER_BYTES,
    DEFAULT_TIMEOUT_MS,
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
    // Empty, so every command keeps the "non-zero is a failure" rule until a
    // caller says otherwise.
    assert!(options.success_exit_codes.is_empty());
}

#[test]
fn a_non_zero_exit_is_a_failure_unless_the_caller_named_it() {
    // `git diff --no-index` reports "the files differ" as exit 1, which is its
    // answer rather than an error — the one command in the capability that
    // needs this, and the reason the field exists.
    let repo = repo_with_commit();
    std::fs::write(repo.path().join("a.txt"), "one\n").expect("write");
    std::fs::write(repo.path().join("b.txt"), "two\n").expect("write");
    let command =
        args(&["diff", "--no-ext-diff", "--no-index", "--no-prefix", "--", "a.txt", "b.txt"]);

    let rejected = run_git(repo.path(), &command, &GitCommandOptions::default())
        .expect_err("exit 1 is a failure by default");
    assert_eq!(rejected.kind, GitErrorKind::Exit(Some(1)));

    let options = GitCommandOptions { success_exit_codes: vec![1], ..GitCommandOptions::default() };
    let accepted = run_git(repo.path(), &command, &options).expect("a named code is accepted");
    assert!(accepted.starts_with("diff --git "), "stdout comes back in full: {accepted}");
    assert!(accepted.contains("-one"), "{accepted}");
}

#[test]
fn naming_one_success_code_does_not_accept_the_others() {
    let repo = repo_with_commit();
    let options = GitCommandOptions { success_exit_codes: vec![1], ..GitCommandOptions::default() };
    let error = run_git(repo.path(), &args(&["cat-file", "-p", "does-not-exist"]), &options)
        .expect_err("a missing object is still a failure");
    assert_eq!(error.kind, GitErrorKind::Exit(Some(128)));
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

// ─────────────────────────────────────────────────────────────────────────────
// Environment overrides
//
// The mutating half of `BranchService` steers git entirely through these:
// `GIT_TERMINAL_PROMPT` so a push fails instead of blocking on a prompt nobody
// can answer, `GIT_EDITOR` and `GIT_SEQUENCE_EDITOR` so a rebase, an amend or
// an `am` accepts a pre-written message and todo list without opening one.
// ─────────────────────────────────────────────────────────────────────────────

fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
}

#[test]
fn defaults_pass_no_environment_overrides() {
    assert!(GitCommandOptions::default().env.is_empty());
}

#[test]
fn an_override_reaches_the_child() {
    let repo = repo_with_commit();
    let options = GitCommandOptions {
        env: env(&[("GIT_AUTHOR_NAME", "Env Author"), ("GIT_AUTHOR_EMAIL", "env@example.com")]),
        ..GitCommandOptions::default()
    };
    std::fs::write(repo.path().join("second.txt"), "second\n").expect("write");
    run_git(repo.path(), &args(&["add", "."]), &options).expect("add");
    run_git(repo.path(), &args(&["commit", "-m", "authored by the env"]), &options)
        .expect("commit");

    let author =
        run_git(repo.path(), &args(&["log", "-1", "--format=%an <%ae>"]), &options).expect("log");
    assert_eq!(author, "Env Author <env@example.com>");
}

#[test]
fn the_rest_of_the_environment_is_inherited() {
    let repo = repo_with_commit();
    // A push over SSH finds its agent through inherited variables; nothing here
    // names PATH, and git is still found.
    let options = GitCommandOptions {
        env: env(&[("GIT_TERMINAL_PROMPT", "0")]),
        ..GitCommandOptions::default()
    };
    let output =
        run_git(repo.path(), &args(&["log", "--format=%s"]), &options).expect("log should run");
    assert_eq!(output, "initial commit");
}

#[test]
fn a_later_entry_wins_over_an_earlier_one() {
    let repo = repo_with_commit();
    let options = GitCommandOptions {
        env: env(&[("GIT_AUTHOR_NAME", "First"), ("GIT_AUTHOR_NAME", "Second")]),
        ..GitCommandOptions::default()
    };
    std::fs::write(repo.path().join("second.txt"), "second\n").expect("write");
    run_git(repo.path(), &args(&["add", "."]), &options).expect("add");
    run_git(repo.path(), &args(&["commit", "-m", "last writer wins"]), &options).expect("commit");

    let author =
        run_git(repo.path(), &args(&["log", "-1", "--format=%an"]), &options).expect("log");
    assert_eq!(author, "Second");
}

#[test]
fn a_sequence_editor_drives_a_non_interactive_rebase() {
    let repo = repo_with_commit();
    for subject in ["second", "third"] {
        std::fs::write(repo.path().join(format!("{subject}.txt")), "x\n").expect("write");
        git(repo.path(), &["add", "."]);
        git(repo.path(), &["commit", "-m", subject]);
    }
    let head = run_git(repo.path(), &args(&["rev-parse", "HEAD"]), &GitCommandOptions::default())
        .expect("rev-parse");
    let short = &head[..7];

    let script = repo.path().join("seq-editor.sh");
    std::fs::write(
        &script,
        // Not `sed -i`: GNU takes the suffix as an optional attached argument
        // and BSD takes it as the next word, so the one spelling that edits in
        // place on Linux eats the file name on macOS. Rewriting through a temp
        // file is the same edit in plain POSIX.
        format!(
            "#!/bin/sh\nsed \"s/^pick {short}/drop {short}/\" \"$1\" > \"$1.tmp\" && mv \"$1.tmp\" \"$1\"\n"
        ),
    )
    .expect("write script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("chmod script");
    }

    let options = GitCommandOptions {
        timeout_ms: 600_000,
        env: env(&[("GIT_SEQUENCE_EDITOR", script.to_str().expect("utf-8 path"))]),
        ..GitCommandOptions::default()
    };
    run_git(repo.path(), &args(&["rebase", "-i", "HEAD~2"]), &options)
        .expect("a scripted sequence editor should finish the rebase without an interactive one");

    let subjects =
        run_git(repo.path(), &args(&["log", "--format=%s"]), &GitCommandOptions::default())
            .expect("log");
    assert_eq!(subjects.lines().collect::<Vec<_>>(), vec!["second", "initial commit"]);
}

#[test]
fn the_global_runner_needs_no_repository() {
    // The whole difference from `run_git` is the missing `-C <repo_root>`, and
    // the point of it is a `--global` config read, which has no repository to
    // be pointed at.
    let version = run_git_global(&args(&["--version"]), &GitCommandOptions::default())
        .expect("git --version needs no repository");

    assert!(version.starts_with("git version"), "unexpected output: {version}");
}

#[test]
fn the_global_runner_reports_the_args_it_was_given() {
    let error = run_git_global(&args(&["not-a-subcommand"]), &GitCommandOptions::default())
        .expect_err("an unknown subcommand should fail");

    assert_eq!(error.kind, GitErrorKind::Exit(Some(1)));
    assert!(
        error.to_string().starts_with("git not-a-subcommand failed:"),
        "unexpected message: {error}"
    );
}
