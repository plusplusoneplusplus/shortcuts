//! Commit-range resolution without spawning git for the ref work.
//!
//! Base-ref resolution is the part with real branching logic — five candidate
//! refs, two modes, and a fallback that has to announce itself — so every one
//! of those paths gets a temp repository built to trigger exactly it. The
//! parsers are tested as pure functions, including the cases where the port is
//! faithful to a bug rather than to what git means.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::range::{
    changed_files, count_commits_ahead, default_remote_branch, diff_stats, merge_base,
    parse_changed_files, parse_diff_shortstat, resolve_base_ref, upstream_branch, BaseMode,
    DiffStats,
};
use coc_native_core::git::status::ChangeStatus;
use coc_native_core::git::GitCommandOptions;
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

fn options() -> GitCommandOptions {
    GitCommandOptions::default()
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

// ─────────────────────────────────────────────────────────────────────────────
// Changed files — parsing
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn changed_files_join_counts_to_statuses() {
    let files = parse_changed_files(
        "10\t2\tsrc/a.ts\n0\t5\tsrc/gone.ts\n3\t0\tsrc/new.ts\n",
        "M\tsrc/a.ts\nD\tsrc/gone.ts\nA\tsrc/new.ts\n",
    );

    assert_eq!(files.len(), 3);
    assert_eq!(files[0].path, "src/a.ts");
    assert_eq!(files[0].status, ChangeStatus::Modified);
    assert_eq!((files[0].additions, files[0].deletions), (10, 2));
    assert_eq!(files[1].status, ChangeStatus::Deleted);
    assert_eq!(files[2].status, ChangeStatus::Added);
    assert!(files.iter().all(|file| file.old_path.is_none()));
}

#[test]
fn changed_files_keep_gits_order_rather_than_sorting() {
    let files = parse_changed_files("1\t0\tz.ts\n1\t0\ta.ts\n", "M\tz.ts\nM\ta.ts\n");
    // Sorting is the caller's job: it uses `localeCompare`, which orders
    // `docs/x.md` before `README.md` where a byte comparison does the reverse.
    assert_eq!(files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["z.ts", "a.ts"]);
}

#[test]
fn changed_files_carry_the_source_of_a_rename() {
    let files = parse_changed_files("0\t0\told.ts => new.ts\n", "R100\told.ts\tnew.ts\n");

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "new.ts");
    assert_eq!(files[0].status, ChangeStatus::Renamed);
    assert_eq!(files[0].old_path.as_deref(), Some("old.ts"));
}

#[test]
fn changed_files_carry_the_source_of_a_copy() {
    let files = parse_changed_files("0\t0\tbase.ts => copy.ts\n", "C075\tbase.ts\tcopy.ts\n");

    assert_eq!(files[0].path, "copy.ts");
    assert_eq!(files[0].status, ChangeStatus::Copied);
    assert_eq!(files[0].old_path.as_deref(), Some("base.ts"));
}

#[test]
fn changed_files_read_a_rename_whose_braces_start_the_path() {
    // `{a => b}/file.ts` is what git prints when the two paths share no prefix.
    let files =
        parse_changed_files("0\t0\t{old => new}/file.ts\n", "R100\told/file.ts\tnew/file.ts\n");
    assert_eq!(files[0].path, "new");
}

#[test]
fn changed_files_mangle_a_rename_under_a_shared_directory() {
    // A faithfully ported bug. The TypeScript regex's second alternative
    // matches from position 0 whenever the first cannot, so the braces are
    // never seen and the path keeps its closing brace — which then misses the
    // status map and shows as `modified`. Pinned so the port is not "fixed"
    // by accident; changing it changes what the range view renders.
    let files =
        parse_changed_files("0\t0\tsrc/{old.ts => new.ts}\n", "R100\tsrc/old.ts\tsrc/new.ts\n");
    assert_eq!(files[0].path, "new.ts}");
    assert_eq!(files[0].status, ChangeStatus::Modified);
    assert_eq!(files[0].old_path, None);
}

#[test]
fn changed_files_count_a_binary_file_as_zero_lines() {
    let files = parse_changed_files("-\t-\tlogo.png\n", "M\tlogo.png\n");
    assert_eq!((files[0].additions, files[0].deletions), (0, 0));
}

#[test]
fn changed_files_fall_back_to_modified_for_a_path_git_did_not_classify() {
    let files = parse_changed_files("4\t1\tsrc/a.ts\n", "M\tsrc/other.ts\n");
    assert_eq!(files[0].status, ChangeStatus::Modified);
    assert_eq!(files[0].old_path, None);
}

#[test]
fn changed_files_read_an_unknown_status_letter_as_modified() {
    let files = parse_changed_files("1\t1\tsrc/a.ts\n", "X\tsrc/a.ts\n");
    assert_eq!(files[0].status, ChangeStatus::Modified);
}

#[test]
fn changed_files_read_a_conflict_letter() {
    let files = parse_changed_files("1\t1\tsrc/a.ts\n", "U\tsrc/a.ts\n");
    assert_eq!(files[0].status, ChangeStatus::Conflict);
}

#[test]
fn changed_files_are_empty_without_name_status_output() {
    assert!(parse_changed_files("10\t2\tsrc/a.ts\n", "").is_empty());
}

#[test]
fn changed_files_skip_lines_with_too_few_columns() {
    let files = parse_changed_files("10\t2\n\n10\t2\tsrc/a.ts\n", "M\nM\tsrc/a.ts\n");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "src/a.ts");
}

#[test]
fn changed_files_survive_crlf_line_endings() {
    let files = parse_changed_files("10\t2\tsrc/a.ts\r\n", "M\tsrc/a.ts\r\n");
    // The `\r` rides along on the path exactly as it did in TypeScript, where
    // `split('\n')` left it too — worth pinning rather than silently changing.
    assert_eq!(files.len(), 1);
    assert!(files[0].path.starts_with("src/a.ts"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff statistics — parsing
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn shortstat_reads_both_totals() {
    assert_eq!(
        parse_diff_shortstat(" 3 files changed, 12 insertions(+), 7 deletions(-)"),
        DiffStats { additions: 12, deletions: 7 }
    );
}

#[test]
fn shortstat_reads_a_lone_insertion_total() {
    assert_eq!(
        parse_diff_shortstat(" 1 file changed, 10 insertions(+)"),
        DiffStats { additions: 10, deletions: 0 }
    );
}

#[test]
fn shortstat_reads_a_lone_deletion_total() {
    assert_eq!(
        parse_diff_shortstat(" 1 file changed, 7 deletions(-)"),
        DiffStats { additions: 0, deletions: 7 }
    );
}

#[test]
fn shortstat_reads_the_singular_spellings() {
    assert_eq!(
        parse_diff_shortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)"),
        DiffStats { additions: 1, deletions: 1 }
    );
}

#[test]
fn shortstat_of_an_empty_range_is_zero() {
    assert_eq!(parse_diff_shortstat(""), DiffStats::default());
}

#[test]
fn shortstat_without_numbers_is_zero() {
    assert_eq!(parse_diff_shortstat(" 1 file changed"), DiffStats::default());
}

// ─────────────────────────────────────────────────────────────────────────────
// Changed files and statistics against a real repository
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn changed_files_read_a_real_range() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "kept.txt", "one\n");
    write(dir.path(), "removed.txt", "gone\n");
    let base = commit(dir.path(), "base.txt", "base\n", "first");
    set_remote_ref(dir.path(), "origin/main", &base);

    write(dir.path(), "kept.txt", "one\ntwo\n");
    std::fs::remove_file(dir.path().join("removed.txt")).expect("removed.txt should exist");
    let added = commit(dir.path(), "added.txt", "new\n", "second");
    assert_ne!(added, base);

    let files = changed_files(dir.path(), "origin/main", "HEAD", &options()).expect("resolves");
    let by_path = |name: &str| {
        files.iter().find(|file| file.path == name).unwrap_or_else(|| panic!("{name} missing"))
    };

    assert_eq!(files.len(), 3);
    assert_eq!(by_path("kept.txt").status, ChangeStatus::Modified);
    assert_eq!((by_path("kept.txt").additions, by_path("kept.txt").deletions), (1, 0));
    assert_eq!(by_path("removed.txt").status, ChangeStatus::Deleted);
    assert_eq!(by_path("added.txt").status, ChangeStatus::Added);
}

#[test]
fn changed_files_read_a_real_rename() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    let base = commit(dir.path(), "old.txt", "contents worth detecting\n", "first");
    set_remote_ref(dir.path(), "origin/main", &base);

    std::fs::rename(dir.path().join("old.txt"), dir.path().join("new.txt")).expect("rename");
    git(dir.path(), &["add", "-A"]);
    git(dir.path(), &["commit", "-m", "second"]);

    let files = changed_files(dir.path(), "origin/main", "HEAD", &options()).expect("resolves");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "new.txt");
    assert_eq!(files[0].status, ChangeStatus::Renamed);
    assert_eq!(files[0].old_path.as_deref(), Some("old.txt"));
}

#[test]
fn changed_files_of_an_empty_range_are_empty() {
    let (dir, _) = repo_with_history();
    let head = git_stdout(dir.path(), &["rev-parse", "HEAD"]);
    set_remote_ref(dir.path(), "origin/main", &head);

    assert!(changed_files(dir.path(), "origin/main", "HEAD", &options())
        .expect("resolves")
        .is_empty());
}

#[test]
fn changed_files_reject_a_revision_that_names_nothing() {
    let (dir, _) = repo_with_history();
    let error = changed_files(dir.path(), "origin/nope", "HEAD", &options())
        .expect_err("git diff exits non-zero for an unknown ref");
    assert!(
        error.to_string().starts_with("git diff --numstat origin/nope...HEAD failed:"),
        "unexpected message: {error}"
    );
}

#[test]
fn diff_stats_read_a_real_range() {
    let (dir, first) = repo_with_history();
    set_remote_ref(dir.path(), "origin/main", &first);

    let stats = diff_stats(dir.path(), "origin/main", "HEAD", &options()).expect("resolves");
    let expected = parse_diff_shortstat(&git_stdout(
        dir.path(),
        &["diff", "--shortstat", "origin/main...HEAD"],
    ));
    assert_eq!(stats, expected);
    assert_eq!(stats, DiffStats { additions: 2, deletions: 0 });
}

#[test]
fn diff_stats_of_an_empty_range_are_zero() {
    let (dir, _) = repo_with_history();
    let head = git_stdout(dir.path(), &["rev-parse", "HEAD"]);
    set_remote_ref(dir.path(), "origin/main", &head);

    assert_eq!(
        diff_stats(dir.path(), "origin/main", "HEAD", &options()).expect("resolves"),
        DiffStats::default()
    );
}
