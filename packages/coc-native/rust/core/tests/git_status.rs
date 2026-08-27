//! The porcelain status parser and the working-tree read path.
//!
//! The parse cases mirror what the TypeScript `parsePorcelain` tests asserted,
//! so a divergence shows up here rather than as a wrong row in the Git tab.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::status::{
    parse_porcelain, status_entries, ChangeStage, ChangeStatus, StatusEntry, STATUS_TIMEOUT_MS,
};
use coc_native_core::git::GitCommandOptions;
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

fn only(entries: &[StatusEntry]) -> &StatusEntry {
    assert_eq!(entries.len(), 1, "expected exactly one entry, got {entries:?}");
    &entries[0]
}

fn find(entries: &[StatusEntry], stage: ChangeStage) -> &StatusEntry {
    entries
        .iter()
        .find(|entry| entry.stage == stage)
        .unwrap_or_else(|| panic!("no {stage:?} entry in {entries:?}"))
}

// ── parse_porcelain ─────────────────────────────────────────────────────────

#[test]
fn empty_output_has_no_changes() {
    assert!(parse_porcelain("").is_empty());
    assert!(parse_porcelain("\n").is_empty());
}

#[test]
fn parses_a_staged_modification() {
    let entry = &parse_porcelain("M  src/foo.ts")[0];
    assert_eq!(entry.status, ChangeStatus::Modified);
    assert_eq!(entry.stage, ChangeStage::Staged);
    assert_eq!(entry.path, "src/foo.ts");
    assert_eq!(entry.original_path, None);
}

#[test]
fn parses_an_unstaged_modification() {
    let entries = parse_porcelain(" M src/foo.ts");
    let entry = only(&entries);
    assert_eq!(entry.status, ChangeStatus::Modified);
    assert_eq!(entry.stage, ChangeStage::Unstaged);
}

#[test]
fn a_file_dirty_in_both_columns_becomes_two_changes() {
    let entries = parse_porcelain("MM src/foo.ts");
    assert_eq!(entries.len(), 2);
    assert_eq!(find(&entries, ChangeStage::Staged).status, ChangeStatus::Modified);
    assert_eq!(find(&entries, ChangeStage::Unstaged).status, ChangeStatus::Modified);
}

#[test]
fn parses_added_and_deleted() {
    assert_eq!(parse_porcelain("A  new-feature.ts")[0].status, ChangeStatus::Added);
    assert_eq!(parse_porcelain("D  old.ts")[0].status, ChangeStatus::Deleted);
}

#[test]
fn parses_an_untracked_file() {
    let entries = parse_porcelain("?? newfile.txt");
    let entry = only(&entries);
    assert_eq!(entry.status, ChangeStatus::Untracked);
    assert_eq!(entry.stage, ChangeStage::Untracked);
    assert_eq!(entry.original_path, None);
}

#[test]
fn drops_ignored_files() {
    assert!(parse_porcelain("!! dist/bundle.js").is_empty());
}

#[test]
fn parses_a_rename_into_destination_and_original() {
    let entries = parse_porcelain("R  old.ts -> new.ts");
    let entry = only(&entries);
    assert_eq!(entry.status, ChangeStatus::Renamed);
    assert_eq!(entry.stage, ChangeStage::Staged);
    assert_eq!(entry.path, "new.ts");
    assert_eq!(entry.original_path.as_deref(), Some("old.ts"));
}

#[test]
fn parses_a_copy_into_destination_and_original() {
    let entries = parse_porcelain("C  template.ts -> copy.ts");
    let entry = only(&entries);
    assert_eq!(entry.status, ChangeStatus::Copied);
    assert_eq!(entry.original_path.as_deref(), Some("template.ts"));
}

#[test]
fn a_rename_edited_afterwards_reports_both_stages() {
    // `RM` — renamed in the index, then modified in the worktree. The worktree
    // row has to point at the destination too, or the diff opens the old path.
    let entries = parse_porcelain("RM old.ts -> new.ts");
    assert_eq!(entries.len(), 2);
    for entry in &entries {
        assert_eq!(entry.path, "new.ts");
        assert_eq!(entry.original_path.as_deref(), Some("old.ts"));
    }
    assert_eq!(find(&entries, ChangeStage::Staged).status, ChangeStatus::Renamed);
    assert_eq!(find(&entries, ChangeStage::Unstaged).status, ChangeStatus::Modified);
}

#[test]
fn parses_conflicts_from_every_column_carrying_a_u() {
    // `U` in either column is a conflict. `AA` (both-added) and `DD`
    // (both-deleted) are unmerged to git but have no `U`, so this parser has
    // always reported them as plain added/deleted rows — kept as-is, because
    // the Git tab's grouping is built on what it returns today.
    for record in
        ["UU both.ts", "DU deleted-by-us.ts", "UD deleted-by-them.ts", "AU added-by-us.ts"]
    {
        let entries = parse_porcelain(record);
        assert!(
            entries.iter().any(|entry| entry.status == ChangeStatus::Conflict),
            "{record} should produce a conflict, got {entries:?}"
        );
    }
    let both_added = parse_porcelain("AA added.ts");
    assert!(both_added.iter().all(|entry| entry.status == ChangeStatus::Added), "{both_added:?}");
}

#[test]
fn an_untracked_name_containing_an_arrow_splits_the_way_it_always_has() {
    // The ` -> ` split runs before the untracked branch, so a literal arrow in
    // an untracked filename is read as a rename separator. Faithful to the
    // TypeScript parser this replaces; git quotes such names when
    // `core.quotePath` is on, which is the default, so it is close to
    // unreachable in practice. Pinned so a future rewrite is a deliberate
    // change rather than an accident.
    let entries = parse_porcelain("?? a -> b.txt");
    let entry = only(&entries);
    assert_eq!(entry.path, "b.txt");
    assert_eq!(entry.original_path, None);
}

#[test]
fn handles_crlf_line_endings() {
    let entries = parse_porcelain("M  foo.ts\r\n M bar.ts\r\n");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].path, "foo.ts");
    assert_eq!(entries[1].path, "bar.ts");
}

#[test]
fn skips_lines_too_short_to_carry_a_path() {
    assert!(parse_porcelain("M\nMM \n").is_empty());
}

#[test]
fn keeps_paths_with_spaces_and_non_ascii_bytes_intact() {
    let entries = parse_porcelain(" M a file with spaces.md\n?? ünïcode/påth.txt");
    assert_eq!(entries[0].path, "a file with spaces.md");
    assert_eq!(entries[1].path, "ünïcode/påth.txt");
}

#[test]
fn a_quoted_path_stays_quoted() {
    // Porcelain v1 C-quotes any path holding a space or a non-ASCII byte, and
    // the TypeScript parser this replaces never unquoted it. Pinned so the
    // move keeps the Git tab rendering exactly what it rendered before;
    // unquoting is a UI-visible change no slice of this work covers.
    let entries = parse_porcelain("?? \"a file with spaces.md\"");
    assert_eq!(only(&entries).path, "\"a file with spaces.md\"");
}

#[test]
fn lists_every_file_under_an_untracked_directory_separately() {
    let entries = parse_porcelain("?? Plans/a.md\n?? Plans/nested/deep.md");
    assert_eq!(entries.len(), 2);
    // No trailing separator, so the client's tree builder never sees an empty leaf.
    assert!(entries.iter().all(|entry| !entry.path.ends_with('/')));
}

// ── status_entries ──────────────────────────────────────────────────────────

#[test]
fn status_timeout_is_shorter_than_the_command_default() {
    assert_eq!(STATUS_TIMEOUT_MS, 15_000);
}

#[test]
fn a_clean_repo_has_no_changes() {
    let repo = repo_with_commit();
    let entries =
        status_entries(repo.path(), &GitCommandOptions::default()).expect("status should succeed");
    assert!(entries.is_empty(), "{entries:?}");
}

#[test]
fn reads_staged_untracked_and_renamed_changes_from_a_real_repo() {
    let repo = repo_with_commit();
    let path = repo.path();
    std::fs::write(path.join("README.md"), "changed\n").expect("write");
    std::fs::write(path.join("untracked.txt"), "new\n").expect("write");
    std::fs::write(path.join("staged.txt"), "staged\n").expect("write");
    git(path, &["add", "staged.txt"]);

    let entries =
        status_entries(path, &GitCommandOptions::default()).expect("status should succeed");

    let staged = entries.iter().find(|entry| entry.path == "staged.txt").expect("staged.txt");
    assert_eq!(staged.status, ChangeStatus::Added);
    assert_eq!(staged.stage, ChangeStage::Staged);

    let readme = entries.iter().find(|entry| entry.path == "README.md").expect("README.md");
    assert_eq!(readme.status, ChangeStatus::Modified);
    assert_eq!(readme.stage, ChangeStage::Unstaged);

    let untracked = entries.iter().find(|entry| entry.path == "untracked.txt").expect("untracked");
    assert_eq!(untracked.stage, ChangeStage::Untracked);
}

#[test]
fn lists_untracked_directory_contents_per_file() {
    // The `--untracked-files=all` contract: a wholly-untracked directory must
    // not collapse into a single `Plans/` row.
    let repo = repo_with_commit();
    let plans = repo.path().join("Plans");
    std::fs::create_dir(&plans).expect("mkdir");
    std::fs::write(plans.join("a.md"), "a\n").expect("write");
    std::fs::write(plans.join("b.md"), "b\n").expect("write");

    let entries =
        status_entries(repo.path(), &GitCommandOptions::default()).expect("status should succeed");
    let mut paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
    paths.sort_unstable();
    assert_eq!(paths, vec!["Plans/a.md", "Plans/b.md"]);
}

#[test]
fn a_conflicted_merge_reports_a_conflict() {
    let repo = repo_with_commit();
    let path = repo.path();
    std::fs::write(path.join("shared.txt"), "base\n").expect("write");
    git(path, &["add", "shared.txt"]);
    git(path, &["commit", "-m", "base"]);
    git(path, &["checkout", "-b", "other"]);
    std::fs::write(path.join("shared.txt"), "theirs\n").expect("write");
    git(path, &["commit", "-am", "theirs"]);
    git(path, &["checkout", "main"]);
    std::fs::write(path.join("shared.txt"), "ours\n").expect("write");
    git(path, &["commit", "-am", "ours"]);
    // The merge is expected to fail, so it does not go through the asserting helper.
    let _ = Command::new("git").arg("-C").arg(path).args(["merge", "other"]).status();

    let entries =
        status_entries(path, &GitCommandOptions::default()).expect("status should succeed");
    let conflict = entries.iter().find(|entry| entry.path == "shared.txt").expect("shared.txt");
    assert_eq!(conflict.status, ChangeStatus::Conflict);
}

#[test]
fn an_empty_repo_with_no_commits_still_reports_untracked_files() {
    let dir = tempfile::tempdir().expect("tempdir");
    git(dir.path(), &["init", "--initial-branch=main"]);
    std::fs::write(dir.path().join("first.txt"), "first\n").expect("write");

    let entries =
        status_entries(dir.path(), &GitCommandOptions::default()).expect("status should succeed");
    let entry = only(&entries);
    assert_eq!(entry.path, "first.txt");
    assert_eq!(entry.stage, ChangeStage::Untracked);
}

#[test]
fn a_path_that_is_not_a_repository_fails_with_the_ui_error_text() {
    let dir = tempfile::tempdir().expect("tempdir");
    let error = status_entries(dir.path(), &GitCommandOptions::default())
        .expect_err("a non-repository should fail");
    assert!(
        error.to_string().starts_with("git status --porcelain --untracked-files=all failed: "),
        "{error}"
    );
}
