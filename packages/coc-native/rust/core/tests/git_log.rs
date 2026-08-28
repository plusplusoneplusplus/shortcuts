//! Reading commit history without spawning git.
//!
//! Half of this file is a differential suite: it builds a temp repository, asks
//! the real `git log` for the same page with the `--pretty=format:` string the
//! TypeScript service used, and requires the two to agree field for field. That
//! is the only test that can catch the failure this port actually risks — a
//! `%h`, `%aI`, `%ar` or `%D` that is *nearly* right.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use coc_native_core::git::log::{get_commit, get_commits, relative_date};
use tempfile::TempDir;

/// The exact format string `GitLogService` passed to `git log`.
const FORMAT: &str = "%H|%h|%s|%an|%ae|%aI|%ar|%P|%D";

fn git(repo: &Path, values: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .status()
        .expect("git should be on PATH for these tests");
    assert!(status.success(), "git {values:?} failed");
}

/// Run git with fixed author and committer timestamps, so `%aI` and `%ar` are
/// reproducible rather than "whenever the test happened to run".
fn git_at(repo: &Path, when: &str, values: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .env("GIT_AUTHOR_DATE", when)
        .env("GIT_COMMITTER_DATE", when)
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
    String::from_utf8(output.stdout).expect("git output should be UTF-8")
}

fn init(dir: &Path) {
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.email", "ralph@example.com"]);
    git(dir, &["config", "user.name", "Ralph"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

/// Seconds since the epoch, the clock both sides of a differential test share.
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock should be after 1970")
        .as_secs() as i64
}

/// A commit timestamp `days` in the past, formatted the way git parses it.
///
/// Whole days keep `%ar` in the middle of its bucket, so the sub-second drift
/// between git's clock and ours can never tip the rendering to a neighbouring
/// value mid-test.
fn days_ago(days: i64) -> String {
    let seconds = now() - days * 86_400;
    format!("{seconds} +0000")
}

fn commit(dir: &Path, name: &str, message: &str, days: i64) {
    std::fs::write(dir.join(name), format!("{name}\n")).expect("write");
    git(dir, &["add", "."]);
    git_at(dir, &days_ago(days), &["commit", "-m", message]);
}

/// A repository with a merge, a tag, a second branch and a non-ASCII author —
/// the cases where a hand-rolled formatter drifts from git's.
fn interesting_repo() -> TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path();
    init(path);

    commit(path, "one.txt", "first commit", 40);
    // Two names on one commit, so the decoration ordering is actually exercised:
    // git prints these in reverse ref-name order, not the order they sort in.
    git(path, &["tag", "v0.9.0"]);
    git(path, &["branch", "legacy"]);

    commit(path, "two.txt", "second commit\n\nwith a body paragraph", 30);
    git(path, &["tag", "v1.0.0"]);

    git(path, &["checkout", "-b", "feature"]);
    commit(path, "feature.txt", "a feature", 20);

    git(path, &["checkout", "main"]);
    commit(path, "three.txt", "third commit", 15);

    git(path, &["config", "user.name", "Renée Ünicode"]);
    git(path, &["config", "user.email", "renée@example.com"]);
    git_at(path, &days_ago(10), &["merge", "--no-ff", "-m", "merge feature", "feature"]);

    dir
}

/// One `git log` line, split into the nine `FORMAT` fields.
#[derive(Debug, PartialEq, Eq)]
struct Row {
    hash: String,
    short_hash: String,
    subject: String,
    author_name: String,
    author_email: String,
    date: String,
    relative_date: String,
    parent_hashes: String,
    refs: Vec<String>,
}

fn split_refs(text: &str) -> Vec<String> {
    text.split(',').map(str::trim).filter(|part| !part.is_empty()).map(str::to_string).collect()
}

/// Ask the real git for a page, parsed exactly as the TypeScript parsed it.
fn git_rows(repo: &Path, max_count: usize, skip: usize) -> Vec<Row> {
    let output = git_stdout(
        repo,
        &[
            "log",
            &format!("--pretty=format:{FORMAT}"),
            "-n",
            &max_count.to_string(),
            "--skip",
            &skip.to_string(),
        ],
    );
    if output.trim().is_empty() {
        return Vec::new();
    }
    output
        .trim()
        .lines()
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            Row {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                subject: parts[2].to_string(),
                author_name: parts[3].to_string(),
                author_email: parts[4].to_string(),
                date: parts[5].to_string(),
                relative_date: parts[6].to_string(),
                parent_hashes: parts[7].to_string(),
                refs: split_refs(parts.get(8).copied().unwrap_or("")),
            }
        })
        .collect()
}

/// The same page, read natively.
fn native_rows(repo: &Path, max_count: usize, skip: usize) -> Vec<Row> {
    get_commits(repo, max_count, skip, None, now())
        .expect("native log should succeed")
        .commits
        .into_iter()
        .map(|commit| Row {
            hash: commit.hash,
            short_hash: commit.short_hash,
            subject: commit.subject,
            author_name: commit.author_name,
            author_email: commit.author_email,
            date: commit.date,
            relative_date: commit.relative_date,
            parent_hashes: commit.parent_hashes,
            refs: commit.refs,
        })
        .collect()
}

// ── relative_date ───────────────────────────────────────────────────────────

#[test]
fn seconds_are_reported_verbatim_below_ninety() {
    assert_eq!(relative_date(100, 100), "0 seconds ago");
    assert_eq!(relative_date(99, 100), "1 second ago");
    assert_eq!(relative_date(98, 100), "2 seconds ago");
    assert_eq!(relative_date(0, 89), "89 seconds ago");
}

#[test]
fn a_future_commit_says_so_rather_than_underflowing() {
    assert_eq!(relative_date(200, 100), "in the future");
}

#[test]
fn minutes_round_to_the_nearest_rather_than_truncating() {
    // 90 s is a minute and a half, and git rounds it up to two.
    assert_eq!(relative_date(0, 90), "2 minutes ago");
    // Sixty seconds is still under the ninety-second cutoff.
    assert_eq!(relative_date(0, 60), "60 seconds ago");
    assert_eq!(relative_date(0, 91), "2 minutes ago");
    // 89 minutes is the last value still counted in minutes.
    assert_eq!(relative_date(0, 89 * 60), "89 minutes ago");
}

#[test]
fn hours_take_over_at_ninety_minutes() {
    assert_eq!(relative_date(0, 90 * 60), "2 hours ago");
    assert_eq!(relative_date(0, 35 * 3600), "35 hours ago");
}

#[test]
fn days_take_over_at_thirty_six_hours() {
    assert_eq!(relative_date(0, 36 * 3600), "2 days ago");
    assert_eq!(relative_date(0, 24 * 3600), "24 hours ago");
    // A day is only reported once the hour count passes thirty-six.
    assert_eq!(relative_date(0, 48 * 3600), "2 days ago");
    assert_eq!(relative_date(0, 13 * 86_400), "13 days ago");
}

#[test]
fn weeks_cover_the_next_ten_or_so() {
    assert_eq!(relative_date(0, 14 * 86_400), "2 weeks ago");
    assert_eq!(relative_date(0, 69 * 86_400), "10 weeks ago");
}

#[test]
fn months_cover_the_rest_of_the_year() {
    assert_eq!(relative_date(0, 70 * 86_400), "2 months ago");
    assert_eq!(relative_date(0, 364 * 86_400), "12 months ago");
}

#[test]
fn years_and_months_are_spelled_out_up_to_five_years() {
    assert_eq!(relative_date(0, 365 * 86_400), "1 year ago");
    assert_eq!(relative_date(0, 400 * 86_400), "1 year, 1 month ago");
    assert_eq!(relative_date(0, 800 * 86_400), "2 years, 2 months ago");
}

#[test]
fn beyond_five_years_only_whole_years_are_reported() {
    assert_eq!(relative_date(0, 1825 * 86_400), "5 years ago");
    assert_eq!(relative_date(0, 3650 * 86_400), "10 years ago");
}

/// The one that matters: our arithmetic against git's own, across every branch
/// of the function, using git's `%ar` as the oracle.
#[test]
fn relative_dates_match_the_real_git_across_every_bucket() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path();
    init(path);

    // Whole days only: sub-second clock drift between git and this process
    // cannot move any of these to a neighbouring bucket.
    let day_offsets = [1i64, 2, 13, 14, 40, 69, 70, 200, 364, 365, 400, 800, 1824, 1825, 4000];
    for (index, days) in day_offsets.iter().enumerate() {
        commit(path, &format!("file{index}.txt"), &format!("commit {index}"), *days);
    }

    let expected: HashMap<String, String> =
        git_rows(path, 100, 0).into_iter().map(|row| (row.hash, row.relative_date)).collect();
    let actual = get_commits(path, 100, 0, None, now()).expect("native log");

    assert_eq!(actual.commits.len(), day_offsets.len());
    for commit in actual.commits {
        assert_eq!(
            Some(&commit.relative_date),
            expected.get(&commit.hash),
            "relative date drifted for {}",
            commit.subject,
        );
    }
}

// ── differential: whole pages ───────────────────────────────────────────────

#[test]
fn a_page_matches_the_real_git_log_field_for_field() {
    let dir = interesting_repo();
    assert_eq!(native_rows(dir.path(), 10, 0), git_rows(dir.path(), 10, 0));
}

#[test]
fn every_pagination_window_matches_the_real_git_log() {
    let dir = interesting_repo();
    for skip in 0..6 {
        for max_count in 1..4 {
            assert_eq!(
                native_rows(dir.path(), max_count, skip),
                git_rows(dir.path(), max_count, skip),
                "page mismatch at skip={skip} maxCount={max_count}",
            );
        }
    }
}

#[test]
fn decoration_matches_the_real_git_log_for_head_branches_and_tags() {
    let dir = interesting_repo();
    let native = native_rows(dir.path(), 10, 0);
    let expected = git_rows(dir.path(), 10, 0);

    // Guard the guard: the fixture must actually decorate something, or this
    // test passes by comparing empty vectors.
    assert!(expected.iter().any(|row| row.refs.iter().any(|name| name.starts_with("HEAD -> "))));
    assert!(expected.iter().any(|row| row.refs.iter().any(|name| name.starts_with("tag: "))));
    // And at least one commit wearing more than one name, or ordering is untested.
    assert!(expected.iter().any(|row| row.refs.len() > 1));

    for (native, expected) in native.iter().zip(expected.iter()) {
        assert_eq!(native.refs, expected.refs, "decoration drifted for {}", expected.subject);
    }
}

#[test]
fn a_detached_head_is_decorated_as_plain_head() {
    let dir = interesting_repo();
    let path = dir.path();
    let head = git_stdout(path, &["rev-parse", "HEAD~1"]).trim().to_string();
    git(path, &["checkout", "--detach", &head]);

    assert_eq!(native_rows(path, 5, 0), git_rows(path, 5, 0));
    assert!(native_rows(path, 1, 0)[0].refs.contains(&"HEAD".to_string()));
}

#[test]
fn a_subject_keeps_only_the_first_paragraph() {
    let dir = interesting_repo();
    let commits = get_commits(dir.path(), 10, 0, None, now()).expect("native log").commits;
    let second = commits.iter().find(|c| c.subject.starts_with("second")).expect("second commit");
    assert_eq!(second.subject, "second commit");
}

#[test]
fn a_merge_commit_lists_both_parents() {
    let dir = interesting_repo();
    let commits = get_commits(dir.path(), 1, 0, None, now()).expect("native log").commits;
    let merge = &commits[0];
    assert_eq!(merge.subject, "merge feature");
    assert_eq!(merge.parent_hashes.split(' ').count(), 2);
    assert_eq!(merge.parent_hashes, git_stdout(dir.path(), &["log", "-1", "--pretty=%P"]).trim());
}

#[test]
fn a_root_commit_has_no_parents() {
    let dir = interesting_repo();
    let commits = get_commits(dir.path(), 100, 0, None, now()).expect("native log").commits;
    let root = commits.last().expect("a root commit");
    assert_eq!(root.subject, "first commit");
    assert_eq!(root.parent_hashes, "");
}

#[test]
fn a_non_ascii_author_survives_the_round_trip() {
    let dir = interesting_repo();
    let commits = get_commits(dir.path(), 1, 0, None, now()).expect("native log").commits;
    assert_eq!(commits[0].author_name, "Renée Ünicode");
    assert_eq!(commits[0].author_email, "renée@example.com");
}

// ── pagination and has_more ─────────────────────────────────────────────────

#[test]
fn has_more_is_set_only_while_commits_remain() {
    let dir = interesting_repo();
    let total = get_commits(dir.path(), 100, 0, None, now()).expect("native log").commits.len();

    let page = get_commits(dir.path(), total - 1, 0, None, now()).expect("native log");
    assert_eq!(page.commits.len(), total - 1);
    assert!(page.has_more);

    let page = get_commits(dir.path(), total, 0, None, now()).expect("native log");
    assert_eq!(page.commits.len(), total);
    assert!(!page.has_more);

    let page = get_commits(dir.path(), total + 5, 0, None, now()).expect("native log");
    assert_eq!(page.commits.len(), total);
    assert!(!page.has_more);
}

/// Callers spell "give me everything" as a very large number, and the page size
/// must not become an allocation size — reserving for it aborts the process.
#[test]
fn an_enormous_page_size_reads_the_whole_history_rather_than_aborting() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), u32::MAX as usize, 0, None, now()).expect("native log");
    assert_eq!(page.commits.len(), git_rows(dir.path(), 1000, 0).len());
    assert!(!page.has_more);
}

#[test]
fn skipping_past_the_end_yields_an_empty_page() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 10, 500, None, now()).expect("native log");
    assert!(page.commits.is_empty());
    assert!(!page.has_more);
}

#[test]
fn a_repository_without_commits_reads_as_empty_rather_than_failing() {
    let dir = tempfile::tempdir().expect("tempdir");
    init(dir.path());
    let page =
        get_commits(dir.path(), 10, 0, None, now()).expect("an unborn branch is not an error");
    assert!(page.commits.is_empty());
    assert!(!page.has_more);
}

#[test]
fn a_path_that_is_not_a_repository_fails_with_the_shared_error_text() {
    let dir = tempfile::tempdir().expect("tempdir");
    let error = get_commits(dir.path(), 10, 0, None, now()).expect_err("not a repository");
    assert!(error.to_string().starts_with("git log failed: "), "unexpected error text: {error}",);
}

#[test]
fn a_subdirectory_resolves_to_the_repository_that_contains_it() {
    let dir = interesting_repo();
    let nested = dir.path().join("nested");
    std::fs::create_dir(&nested).expect("mkdir");
    assert_eq!(native_rows(&nested, 3, 0), git_rows(dir.path(), 3, 0));
}

// ── search ──────────────────────────────────────────────────────────────────

#[test]
fn search_keeps_only_matching_messages_and_ignores_case() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 10, 0, Some("FEATURE"), now()).expect("native log");
    let subjects: Vec<&str> = page.commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, vec!["merge feature", "a feature"]);
}

#[test]
fn search_reads_the_body_not_just_the_subject() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 10, 0, Some("body paragraph"), now()).expect("native log");
    let subjects: Vec<&str> = page.commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, vec!["second commit"]);
}

#[test]
fn search_paginates_over_the_filtered_set() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 1, 1, Some("commit"), now()).expect("native log");
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].subject, "second commit");
    assert!(page.has_more);
}

#[test]
fn a_search_matching_nothing_yields_an_empty_page() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 10, 0, Some("no such commit"), now()).expect("native log");
    assert!(page.commits.is_empty());
    assert!(!page.has_more);
}

// ── ahead of remote ─────────────────────────────────────────────────────────

#[test]
fn commits_past_the_upstream_are_flagged_as_unpushed() {
    let origin = tempfile::tempdir().expect("tempdir");
    init(origin.path());
    commit(origin.path(), "one.txt", "first commit", 5);

    let clone = tempfile::tempdir().expect("tempdir");
    let target = clone.path().join("work");
    let status = Command::new("git")
        .args(["clone", &origin.path().to_string_lossy(), &target.to_string_lossy()])
        .status()
        .expect("git clone");
    assert!(status.success());
    git(&target, &["config", "user.email", "ralph@example.com"]);
    git(&target, &["config", "user.name", "Ralph"]);
    git(&target, &["config", "commit.gpgsign", "false"]);
    commit(&target, "two.txt", "unpushed commit", 2);

    let page = get_commits(&target, 10, 0, None, now()).expect("native log");
    let unpushed: Vec<&str> = page
        .commits
        .iter()
        .filter(|c| c.is_ahead_of_remote == Some(true))
        .map(|c| c.subject.as_str())
        .collect();
    assert_eq!(unpushed, vec!["unpushed commit"]);
}

#[test]
fn a_branch_without_an_upstream_flags_nothing_as_unpushed() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    assert!(page.commits.iter().all(|c| c.is_ahead_of_remote == Some(false)));
}

// ── get_commit ──────────────────────────────────────────────────────────────

#[test]
fn a_single_commit_matches_the_same_row_from_a_page() {
    let dir = interesting_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    let expected = &page.commits[2];

    let single = get_commit(dir.path(), &expected.hash, now()).expect("native log").expect("found");
    assert_eq!(single.hash, expected.hash);
    assert_eq!(single.short_hash, expected.short_hash);
    assert_eq!(single.subject, expected.subject);
    assert_eq!(single.body, expected.body);
    assert_eq!(single.date, expected.date);
    assert_eq!(single.relative_date, expected.relative_date);
    assert_eq!(single.parent_hashes, expected.parent_hashes);
    assert_eq!(single.refs, expected.refs);
}

#[test]
fn a_single_commit_leaves_the_unpushed_flag_unanswered() {
    let dir = interesting_repo();
    let head = git_stdout(dir.path(), &["rev-parse", "HEAD"]).trim().to_string();
    let single = get_commit(dir.path(), &head, now()).expect("native log").expect("found");
    assert_eq!(single.is_ahead_of_remote, None);
}

#[test]
fn a_single_commit_accepts_any_revision_spec_git_would() {
    let dir = interesting_repo();
    let by_name = get_commit(dir.path(), "v1.0.0", now()).expect("native log").expect("found");
    assert_eq!(by_name.subject, "second commit");

    let by_relative = get_commit(dir.path(), "HEAD~1", now()).expect("native log").expect("found");
    assert_eq!(by_relative.subject, "third commit");
}

#[test]
fn an_unknown_revision_reads_as_missing_rather_than_failing() {
    let dir = interesting_repo();
    assert!(get_commit(dir.path(), "no-such-ref", now()).expect("native log").is_none());
}

// ── body ────────────────────────────────────────────────────────────────────

/// A repository whose messages cover every shape `%b` renders differently.
///
/// The commits route renders the body as `%b` put through JavaScript's
/// `.trim()`, so that pair — not `%b` alone — is what these tests compare
/// against. The indented case is the one where the trim is visible: it eats the
/// leading spaces, and it always has.
fn body_repo() -> TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path();
    init(path);

    commit(path, "none.txt", "no body at all", 50);
    commit(path, "two.txt", "subject line\n\nfirst body line\nsecond body line", 40);
    commit(path, "multi.txt", "multi line\ntitle continues\n\nbody after a multi-line title", 30);
    commit(path, "blanks.txt", "trailing blanks\n\nbody with trailing blanks\n\n\n", 20);
    commit(path, "indent.txt", "indented body\n\n    four leading spaces", 10);

    dir
}

/// `%b` for one commit, trimmed exactly as the commits route trimmed it.
fn git_body(repo: &Path, hash: &str) -> String {
    git_stdout(repo, &["log", "-1", "--format=%b", hash]).trim().to_string()
}

/// The page's commit whose subject starts with `prefix`.
fn row_by_subject<'a>(
    commits: &'a [coc_native_core::git::log::Commit],
    prefix: &str,
) -> &'a coc_native_core::git::log::Commit {
    commits
        .iter()
        .find(|commit| commit.subject.starts_with(prefix))
        .unwrap_or_else(|| panic!("no commit whose subject starts with {prefix:?}"))
}

#[test]
fn a_body_matches_the_real_git_percent_b_for_every_message_shape() {
    let dir = body_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    assert_eq!(page.commits.len(), 5);
    for commit in &page.commits {
        assert_eq!(
            commit.body,
            git_body(dir.path(), &commit.hash),
            "body drifted for {}",
            commit.subject
        );
    }
}

#[test]
fn a_commit_without_a_body_reads_as_an_empty_string() {
    let dir = body_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    // Not `None` and not the subject repeated: the route's
    // `lines.slice(7).join('\n').trim()` produced `''` here, and the UI renders
    // the body only when it is truthy.
    assert_eq!(row_by_subject(&page.commits, "no body at all").body, "");
}

#[test]
fn a_body_keeps_its_internal_newlines_and_drops_the_trailing_ones() {
    let dir = body_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    assert_eq!(
        row_by_subject(&page.commits, "subject line").body,
        "first body line\nsecond body line"
    );
    assert_eq!(row_by_subject(&page.commits, "trailing blanks").body, "body with trailing blanks");
}

#[test]
fn a_multi_line_title_ends_at_the_blank_line_and_the_rest_is_body() {
    let dir = body_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    let row = row_by_subject(&page.commits, "multi line");
    // `%s` folds the two title lines into one; `%b` starts after the blank line
    // rather than after the first newline.
    assert_eq!(row.subject, "multi line title continues");
    assert_eq!(row.body, "body after a multi-line title");
}

#[test]
fn a_trim_eats_a_bodys_leading_indentation_the_way_it_always_did() {
    let dir = body_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    // git's `%b` prints "    four leading spaces"; the route's `.trim()` throws
    // the indentation away before the UI ever sees it. Ported as-is, and pinned
    // here so a future "fix" is a deliberate change rather than a drift.
    assert_eq!(row_by_subject(&page.commits, "indented body").body, "four leading spaces");
}

#[test]
fn a_single_commit_reports_the_same_body_as_its_page_row() {
    let dir = body_repo();
    let page = get_commits(dir.path(), 10, 0, None, now()).expect("native log");
    for expected in &page.commits {
        let single =
            get_commit(dir.path(), &expected.hash, now()).expect("native log").expect("found");
        assert_eq!(single.body, expected.body, "body drifted for {}", expected.subject);
    }
}
