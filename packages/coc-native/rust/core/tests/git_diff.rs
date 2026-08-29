//! `git diff --no-index` of two in-memory contents, and the header rewrite that
//! turns git's temp-file names back into the file the diff is about.
//!
//! Two things here are unlike the rest of the capability. The command's
//! ordinary answer is exit code 1 — "the files differ" — which every other
//! command in this crate renders as a failure, so the acceptance is tested
//! against the plain runner rejecting the very same invocation. And the
//! rendering is git's own, so the spawn half is differential: the same two
//! contents go through real `git diff --no-index` and the results are compared
//! byte for byte. The rewrite half is tested directly, on output real git
//! produced, because a differential that applied the rewrite to both sides
//! could not see it.

use std::process::Command;
use std::sync::RwLock;

use coc_native_core::git::diff::{diff_no_index, rewrite_no_index_headers};
use coc_native_core::git::{run_git_global, GitCommandOptions, GitErrorKind};

/// The labels the one production caller passes.
const BEFORE_LABEL: &str = "a/src/main.rs";
const AFTER_LABEL: &str = "b/src/main.rs";
const ABSENT: &str = "/dev/null";

/// Serialises the temp-directory cleanup test against every test that creates
/// one. Nothing else in the crate uses the `codex-file-diff-` prefix, so a
/// write lock here is exclusive over every directory the assertion counts,
/// while the ordinary tests share a read lock and still run in parallel.
static TEMP_DIRS: RwLock<()> = RwLock::new(());

fn options() -> GitCommandOptions {
    GitCommandOptions::default()
}

/// What real `git diff --no-index` prints for these two contents, verbatim.
fn real_git_diff(before: &str, after: &str) -> String {
    let dir = tempfile::tempdir().expect("tempdir");
    let before_path = dir.path().join("before");
    let after_path = dir.path().join("after");
    std::fs::write(&before_path, before).expect("write");
    std::fs::write(&after_path, after).expect("write");
    let output = Command::new("git")
        .args(["diff", "--no-ext-diff", "--no-index", "--no-prefix", "--"])
        .arg(&before_path)
        .arg(&after_path)
        .output()
        .expect("git should be on PATH for these tests");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Real git's answer, put through the same trailing-newline strip and the same
/// rewrite the port applies — the byte-exact expectation for a spawn that
/// worked.
fn expected(before: &str, after: &str, before_label: &str, after_label: &str) -> String {
    let raw = real_git_diff(before, after);
    let raw = raw.strip_suffix('\n').unwrap_or(&raw);
    let raw = raw.strip_suffix('\r').unwrap_or(raw);
    rewrite_no_index_headers(raw, before_label, after_label)
}

// ─────────────────────────────────────────────────────────────────────────────
// The rewrite
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn rewrites_the_three_header_lines() {
    let real = real_git_diff("one\ntwo\n", "one\nTWO\nthree\n");
    let rewritten = rewrite_no_index_headers(&real, BEFORE_LABEL, AFTER_LABEL);
    let lines: Vec<&str> = rewritten.lines().collect();

    assert_eq!(lines[0], format!("diff --git {BEFORE_LABEL} {AFTER_LABEL}"));
    assert!(lines[1].starts_with("index "), "the index line is left alone: {}", lines[1]);
    assert_eq!(lines[2], format!("--- {BEFORE_LABEL}"));
    assert_eq!(lines[3], format!("+++ {AFTER_LABEL}"));
    // Nothing anywhere mentions where the two files really were. Checked
    // against the temp root rather than a literal `/before`, which on Windows
    // would be spelled with a backslash and pass without testing anything.
    let temp_root = std::env::temp_dir();
    assert!(
        !rewritten.contains(temp_root.to_string_lossy().as_ref()),
        "temp paths should not survive: {rewritten}"
    );
}

#[test]
fn rewrites_only_the_first_of_each_header() {
    // A removed line whose content begins `-- ` reaches the hunk body as
    // `--- signature`, at column zero, indistinguishable from a file header by
    // prefix alone. The first-only flags are what keep it intact.
    let real = real_git_diff("keep\n-- signature\n++ plus\n", "keep\n");
    assert!(real.contains("\n--- signature\n"), "fixture should produce the collision: {real}");

    let rewritten = rewrite_no_index_headers(&real, BEFORE_LABEL, AFTER_LABEL);
    assert!(rewritten.contains("\n--- signature\n"), "content must survive: {rewritten}");
    assert!(rewritten.contains("\n-++ plus\n"), "content must survive: {rewritten}");
    assert_eq!(rewritten.matches(BEFORE_LABEL).count(), 2, "one diff header, one `---`");
    assert_eq!(rewritten.matches(AFTER_LABEL).count(), 2, "one diff header, one `+++`");
}

#[test]
fn leaves_a_diff_without_headers_alone() {
    let body = "@@ -1 +1 @@\n-one\n+two";
    assert_eq!(rewrite_no_index_headers(body, BEFORE_LABEL, AFTER_LABEL), body);
}

#[test]
fn empty_input_stays_empty() {
    assert_eq!(rewrite_no_index_headers("", BEFORE_LABEL, AFTER_LABEL), "");
}

#[test]
fn drops_a_carriage_return_that_ended_a_line() {
    // Ported quirk: the TypeScript split on `/\r?\n/` and rejoined with `\n`,
    // so a CRLF file's content loses its `\r` in the rendered diff.
    let rewritten = rewrite_no_index_headers("@@ -1 +1 @@\r\n-one\r\n+two\r\n", "a", "b");
    assert_eq!(rewritten, "@@ -1 +1 @@\n-one\n+two\n");
}

#[test]
fn keeps_a_carriage_return_that_ended_the_input() {
    // `/\r?\n/` needs the newline, so a trailing `\r` with nothing after it is
    // content and stays. Splitting on `\r` as well would eat it.
    assert_eq!(rewrite_no_index_headers("+one\r", "a", "b"), "+one\r");
}

#[test]
fn header_matching_needs_the_trailing_space() {
    // `---` alone is the end of an email-style body, not a file header, and
    // `+++` alone is nothing. Both are left as they are.
    let body = "---\n+++\n";
    assert_eq!(rewrite_no_index_headers(body, BEFORE_LABEL, AFTER_LABEL), body);
}

// ─────────────────────────────────────────────────────────────────────────────
// The command
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn identical_contents_produce_nothing() {
    let _guard = TEMP_DIRS.read().unwrap();
    let rendered =
        diff_no_index("same\n", "same\n", BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    assert_eq!(rendered, "");
}

#[test]
fn renders_a_modification_exactly_as_git_does() {
    let _guard = TEMP_DIRS.read().unwrap();
    let before = "one\ntwo\nthree\n";
    let after = "one\nTWO\nthree\nfour\n";
    let rendered =
        diff_no_index(before, after, BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    assert_eq!(rendered, expected(before, after, BEFORE_LABEL, AFTER_LABEL));
    assert!(rendered.starts_with(&format!("diff --git {BEFORE_LABEL} {AFTER_LABEL}\n")));
    assert!(rendered.contains("\n-two\n+TWO\n"), "{rendered}");
}

#[test]
fn accepts_the_exit_code_that_means_the_files_differ() {
    let _guard = TEMP_DIRS.read().unwrap();
    // The port works only because exit 1 is accepted. Prove the acceptance is
    // load-bearing by running the same command through the plain runner, whose
    // `success_exit_codes` is empty.
    let dir = tempfile::tempdir().expect("tempdir");
    let before_path = dir.path().join("before");
    let after_path = dir.path().join("after");
    std::fs::write(&before_path, "one\n").expect("write");
    std::fs::write(&after_path, "two\n").expect("write");
    let args = vec![
        "diff".to_string(),
        "--no-ext-diff".to_string(),
        "--no-index".to_string(),
        "--no-prefix".to_string(),
        "--".to_string(),
        before_path.to_string_lossy().into_owned(),
        after_path.to_string_lossy().into_owned(),
    ];

    let rejected = run_git_global(&args, &options()).expect_err("the plain runner rejects exit 1");
    assert_eq!(rejected.kind, GitErrorKind::Exit(Some(1)));

    let accepted = diff_no_index("one\n", "two\n", BEFORE_LABEL, AFTER_LABEL, &options())
        .expect("the diff accepts it");
    assert!(accepted.contains("\n-one\n+two"), "{accepted}");
}

#[test]
fn a_higher_exit_code_is_still_a_failure() {
    let _guard = TEMP_DIRS.read().unwrap();
    // Only the code the caller named is accepted; anything else still fails.
    let mut options = options();
    options.success_exit_codes = vec![1];
    let error = run_git_global(&["diff".to_string(), "--not-an-option".to_string()], &options)
        .expect_err("an unknown option is a failure");
    assert!(!matches!(error.kind, GitErrorKind::Exit(Some(1))), "{:?}", error.kind);
}

#[test]
fn labels_a_file_that_did_not_exist_from_dev_null() {
    let _guard = TEMP_DIRS.read().unwrap();
    let rendered = diff_no_index("", "created\n", ABSENT, AFTER_LABEL, &options()).expect("diff");
    assert_eq!(rendered, expected("", "created\n", ABSENT, AFTER_LABEL));
    assert!(rendered.starts_with(&format!("diff --git {ABSENT} {AFTER_LABEL}\n")));
    assert!(rendered.contains(&format!("\n--- {ABSENT}\n")), "{rendered}");
    assert!(rendered.contains("\n+created"), "{rendered}");
}

#[test]
fn labels_a_deleted_file_to_dev_null() {
    let _guard = TEMP_DIRS.read().unwrap();
    let rendered = diff_no_index("gone\n", "", BEFORE_LABEL, ABSENT, &options()).expect("diff");
    assert_eq!(rendered, expected("gone\n", "", BEFORE_LABEL, ABSENT));
    assert!(rendered.contains(&format!("\n+++ {ABSENT}\n")), "{rendered}");
    assert!(rendered.contains("\n-gone"), "{rendered}");
}

#[test]
fn preserves_the_no_newline_marker() {
    let _guard = TEMP_DIRS.read().unwrap();
    // The one place a missing trailing newline is information rather than
    // formatting — and the boundary's own newline strip must not eat the
    // marker, which is a line of its own.
    let rendered =
        diff_no_index("one\ntwo", "one\nTWO", BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    assert_eq!(rendered, expected("one\ntwo", "one\nTWO", BEFORE_LABEL, AFTER_LABEL));
    assert_eq!(rendered.matches("\\ No newline at end of file").count(), 2, "{rendered}");
    assert!(rendered.ends_with("\\ No newline at end of file"), "{rendered}");
}

#[test]
fn non_ascii_content_crosses_intact() {
    let _guard = TEMP_DIRS.read().unwrap();
    let before = "café\n";
    let after = "caffè ☕\n";
    let rendered =
        diff_no_index(before, after, BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    assert_eq!(rendered, expected(before, after, BEFORE_LABEL, AFTER_LABEL));
    assert!(rendered.contains("-café"), "{rendered}");
    assert!(rendered.contains("+caffè ☕"), "{rendered}");
}

#[test]
fn a_removed_line_shaped_like_a_header_survives_the_round_trip() {
    let _guard = TEMP_DIRS.read().unwrap();
    let before = "keep\n-- signature\n";
    let after = "keep\n";
    let rendered =
        diff_no_index(before, after, BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    assert_eq!(rendered, expected(before, after, BEFORE_LABEL, AFTER_LABEL));
    assert!(rendered.ends_with("\n--- signature"), "{rendered}");
}

#[test]
fn binary_content_keeps_gits_own_sentence() {
    let _guard = TEMP_DIRS.read().unwrap();
    // A NUL byte makes git call the input binary, and its one-line verdict
    // names the two files it was handed — which here are the temp files. Ported
    // as it was: only the `diff --git` header is a header, so only that line is
    // rewritten. Recorded rather than fixed, because the TypeScript did this
    // too and the result is display metadata.
    let rendered =
        diff_no_index("a\0b\n", "a\0c\n", BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    assert!(rendered.starts_with(&format!("diff --git {BEFORE_LABEL} {AFTER_LABEL}\n")));
    assert!(rendered.contains("Binary files "), "{rendered}");
    // Both temp names, checked one at a time: git quotes a path that contains
    // backslashes, so on Windows the sentence reads `"...\before" and
    // "...\after"` and there is no unquoted `before and ` to find.
    assert!(rendered.contains("before"), "the before temp name leaks: {rendered}");
    assert!(rendered.contains("after"), "the after temp name leaks: {rendered}");
}

#[test]
fn a_failure_still_reads_as_git_diff_failed() {
    let _guard = TEMP_DIRS.read().unwrap();
    let mut options = options();
    options.max_buffer_bytes = 8;
    let error = diff_no_index("one\n", "two\n", BEFORE_LABEL, AFTER_LABEL, &options)
        .expect_err("eight bytes cannot hold a diff");
    assert_eq!(error.kind, GitErrorKind::MaxBuffer);
    let text = error.to_string();
    assert!(text.starts_with("git diff --no-ext-diff --no-index --no-prefix -- "), "{text}");
    assert!(text.contains(" failed: "), "{text}");
}

#[test]
fn removes_its_temp_directory_on_success_and_on_failure() {
    let _guard = TEMP_DIRS.write().unwrap();
    let before = count_temp_dirs();

    diff_no_index("one\n", "two\n", BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    diff_no_index("same\n", "same\n", BEFORE_LABEL, AFTER_LABEL, &options()).expect("diff");
    let mut capped = options();
    capped.max_buffer_bytes = 8;
    diff_no_index("one\n", "two\n", BEFORE_LABEL, AFTER_LABEL, &capped).expect_err("capped");

    assert_eq!(count_temp_dirs(), before, "every temp directory should be gone");
}

/// How many `codex-file-diff-*` directories exist under the system temp dir.
fn count_temp_dirs() -> usize {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("codex-file-diff-"))
        .count()
}
