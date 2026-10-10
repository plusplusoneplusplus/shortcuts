//! Commit detail: the parent, the file list, the diff, and the objects a
//! review view resolves at a commit.
//!
//! The parsers are exercised as pure functions, including the rename forms
//! `--numstat` emits, because those are what decide whether a row shows line
//! counts or a blank column. Everything that talks to a repository is checked
//! against the real `git` command it replaces, so "the same answer" is verified
//! rather than asserted — the `gix` paths in particular, where a divergence
//! would be invisible until a diff opened against the wrong parent.

use std::path::Path;
use std::process::Command;

use coc_native_core::git::commit::{
    commit_diff, commit_files, commit_files_args, file_bytes_at_commit, file_content_at_commit,
    file_exists_at_commit, parent_hash, parse_commit_files, process_commit_metadata, validate_ref,
    EMPTY_TREE_HASH,
};
use coc_native_core::git::status::ChangeStatus;
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

/// Whether a command succeeded, for the cases where the failure is the point.
fn git_succeeds(repo: &Path, values: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(values)
        .output()
        .expect("git should be on PATH for these tests")
        .status
        .success()
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

fn commit(repo: &Path, message: &str) -> String {
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-m", message]);
    git_stdout(repo, &["rev-parse", "HEAD"])
}

/// A repository with two commits: `a.txt` added, then modified with `b.txt`.
fn repo_with_history() -> (TempDir, String, String) {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "a.txt", "one\n");
    let first = commit(dir.path(), "first");
    write(dir.path(), "a.txt", "one\ntwo\n");
    write(dir.path(), "b.txt", "new\n");
    let second = commit(dir.path(), "second");
    (dir, first, second)
}

fn options() -> GitCommandOptions {
    GitCommandOptions::default()
}

// ─────────────────────────────────────────────────────────────────────────────
// parent_hash
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn the_parent_matches_what_rev_parse_reports() {
    let (dir, first, second) = repo_with_history();
    assert_eq!(parent_hash(dir.path(), &second), first);
    assert_eq!(parent_hash(dir.path(), &second), git_stdout(dir.path(), &["rev-parse", "HEAD~1"]));
}

#[test]
fn a_root_commit_is_diffed_against_the_empty_tree() {
    let (dir, first, _) = repo_with_history();
    // The command this replaces fails here, which is why there is a fallback
    // at all — assert that before asserting the fallback.
    assert!(!git_succeeds(dir.path(), &["rev-parse", "--verify", &format!("{first}~1")]));
    assert_eq!(parent_hash(dir.path(), &first), EMPTY_TREE_HASH);
}

#[test]
fn a_revision_that_names_nothing_falls_back_to_the_empty_tree() {
    let (dir, _, _) = repo_with_history();
    assert_eq!(parent_hash(dir.path(), "no-such-ref"), EMPTY_TREE_HASH);
}

#[test]
fn a_path_that_is_not_a_repository_falls_back_to_the_empty_tree() {
    let dir = TempDir::new().expect("temp dir");
    assert_eq!(parent_hash(&dir.path().join("missing"), "HEAD"), EMPTY_TREE_HASH);
}

#[test]
fn a_merge_commit_takes_its_first_parent() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "a.txt", "one\n");
    commit(dir.path(), "first");

    git(dir.path(), &["checkout", "-b", "side"]);
    write(dir.path(), "side.txt", "side\n");
    commit(dir.path(), "side commit");

    git(dir.path(), &["checkout", "main"]);
    write(dir.path(), "main.txt", "main\n");
    let main_tip = commit(dir.path(), "main commit");

    git(dir.path(), &["merge", "--no-ff", "-m", "merge", "side"]);
    let merge = git_stdout(dir.path(), &["rev-parse", "HEAD"]);

    assert_eq!(parent_hash(dir.path(), &merge), main_tip);
}

// ─────────────────────────────────────────────────────────────────────────────
// parse_commit_files
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn metadata_preserves_literal_paths_and_git_order() {
    let files = parse_commit_files(
        "M\0z\0A\0café\t\n.txt\0D\0a => b\0",
        concat!("3\t1\tz\0", "2\t0\tcafé\t\n.txt\0"),
    );
    assert_eq!(
        files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
        vec!["z", "café\t\n.txt", "a => b"]
    );
    assert_eq!(files[0].additions, Some(3));
    assert_eq!(files[1].additions, Some(2));
    assert_eq!(files[2].status, ChangeStatus::Deleted);
    assert_eq!(files[2].additions, None);
}

#[test]
fn metadata_joins_rename_and_copy_destinations_without_arrow_heuristics() {
    let files = parse_commit_files(
        "R100\0old\0src/{a => b}.txt\0C75\0source\0copy\0",
        concat!("2\t1\t\0old\0src/{a => b}.txt\0", "0\t0\t\0source\0copy\0"),
    );
    assert_eq!(files[0].original_path.as_deref(), Some("old"));
    assert_eq!(files[0].status, ChangeStatus::Renamed);
    assert_eq!(files[0].additions, Some(2));
    assert_eq!(files[1].status, ChangeStatus::Copied);
    assert_eq!(files[1].additions, Some(0));
}

#[test]
fn binary_and_invalid_counts_remain_absent() {
    let files = parse_commit_files("M\0binary\0M\0invalid\0", "-\t-\tbinary\0x\t1\tinvalid\0");
    assert!(files.iter().all(|file| file.additions.is_none() && file.deletions.is_none()));
    assert!(parse_commit_files("", "").is_empty());
    assert!(parse_commit_files("R100\0old\0", "").is_empty());
}

// ─────────────────────────────────────────────────────────────────────────────
// commit_files against a real repository
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn commit_files_reads_a_real_commit() {
    let (dir, first, second) = repo_with_history();
    let result = commit_files(dir.path(), &second, &options()).expect("files");

    assert_eq!(result.parent_hash, first);
    let paths: Vec<&str> = result.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(paths, vec!["a.txt", "b.txt"]);
    assert_eq!(result.files[0].status, ChangeStatus::Modified);
    assert_eq!(result.files[0].additions, Some(1));
    assert_eq!(result.files[1].status, ChangeStatus::Added);
    assert_eq!(result.files[1].additions, Some(1));
}

#[test]
fn a_root_commit_lists_files_against_the_empty_tree() {
    let (dir, first, _) = repo_with_history();
    let result = commit_files(dir.path(), &first, &options()).expect("files");

    // Before: omitting --root silently lost the initial commit file list.
    assert_eq!(
        git_stdout(dir.path(), &["diff-tree", "--no-commit-id", "--name-status", "-r", &first]),
        ""
    );
    assert_eq!(result.parent_hash, EMPTY_TREE_HASH);
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].status, ChangeStatus::Added);
    assert_eq!(result.files[0].additions, Some(1));
}

#[test]
fn commit_files_detects_a_rename_end_to_end() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "src/old.ts", "export const value = 1;\n");
    commit(dir.path(), "first");
    std::fs::rename(dir.path().join("src/old.ts"), dir.path().join("src/new.ts")).expect("rename");
    let second = commit(dir.path(), "rename");

    let result = commit_files(dir.path(), &second, &options()).expect("files");
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path, "src/new.ts");
    assert_eq!(result.files[0].original_path.as_deref(), Some("src/old.ts"));
    assert_eq!(result.files[0].status, ChangeStatus::Renamed);
}

#[test]
fn commit_files_fails_for_a_path_that_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = commit_files(dir.path(), "HEAD", &options()).expect_err("not a repository");
    assert!(error.to_string().contains("diff-tree"), "{error}");
}

// ─────────────────────────────────────────────────────────────────────────────
// commit_diff
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn commit_diff_matches_the_command_it_replaces() {
    let (dir, first, second) = repo_with_history();
    let native = commit_diff(dir.path(), &second, &options()).expect("diff");
    let legacy = git_stdout(dir.path(), &["diff", &first, &second]);
    assert_eq!(native, legacy);
    assert!(native.contains("+two"), "{native}");
}

#[test]
fn commit_diff_of_a_root_commit_shows_the_whole_file() {
    let (dir, first, _) = repo_with_history();
    let diff = commit_diff(dir.path(), &first, &options()).expect("diff");
    assert!(diff.contains("+one"), "{diff}");
}

#[test]
fn commit_diff_fails_for_a_path_that_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = commit_diff(dir.path(), "HEAD", &options()).expect_err("not a repository");
    assert!(error.to_string().contains("diff-tree"), "{error}");
}

// ─────────────────────────────────────────────────────────────────────────────
// file_content_at_commit
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn file_content_matches_git_show_byte_for_byte() {
    let (dir, _, second) = repo_with_history();
    let content = file_content_at_commit(dir.path(), &second, "a.txt").expect("read");
    assert_eq!(content.as_deref(), Some("one\ntwo\n"));
}

#[test]
fn file_content_keeps_the_trailing_newline_a_command_would_have_lost() {
    // This is the reason the blob is read directly: every command that crosses
    // the boundary drops one trailing newline, and a file's bytes cannot.
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "trailing.txt", "body\n\n\n");
    let hash = commit(dir.path(), "first");

    assert_eq!(
        file_content_at_commit(dir.path(), &hash, "trailing.txt").expect("read").as_deref(),
        Some("body\n\n\n"),
    );
}

#[test]
fn file_content_reads_an_empty_file_as_an_empty_string() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "empty.txt", "");
    let hash = commit(dir.path(), "first");

    // Distinct from `None`: the file is there and it has no bytes.
    assert_eq!(
        file_content_at_commit(dir.path(), &hash, "empty.txt").expect("read"),
        Some(String::new()),
    );
}

#[test]
fn file_content_reads_a_nested_path() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "a/b/c.txt", "deep\n");
    let hash = commit(dir.path(), "first");

    assert_eq!(
        file_content_at_commit(dir.path(), &hash, "a/b/c.txt").expect("read").as_deref(),
        Some("deep\n"),
    );
}

#[test]
fn file_content_reads_a_path_holding_a_space() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "a file.txt", "spaced\n");
    let hash = commit(dir.path(), "first");

    assert_eq!(
        file_content_at_commit(dir.path(), &hash, "a file.txt").expect("read").as_deref(),
        Some("spaced\n"),
    );
}

#[test]
fn file_content_is_absent_for_a_missing_path_and_a_bad_revision() {
    let (dir, _, second) = repo_with_history();
    assert_eq!(file_content_at_commit(dir.path(), &second, "nope.txt").expect("read"), None);
    assert_eq!(file_content_at_commit(dir.path(), "no-such-ref", "a.txt").expect("read"), None);
}

#[test]
fn file_content_is_absent_for_a_directory() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "a/b.txt", "deep\n");
    let hash = commit(dir.path(), "first");

    // `git show <rev>:a` prints a tree listing, which was never file content.
    assert_eq!(file_content_at_commit(dir.path(), &hash, "a").expect("read"), None);
}

#[test]
fn file_content_fails_for_a_path_that_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = file_content_at_commit(dir.path(), "HEAD", "a.txt").expect_err("not a repository");
    assert!(error.to_string().starts_with("git show"), "{error}");
}

// ─────────────────────────────────────────────────────────────────────────────
// file_bytes_at_commit
// ─────────────────────────────────────────────────────────────────────────────

/// Write raw bytes, for the cases a `&str` cannot express.
fn write_bytes(repo: &Path, name: &str, contents: &[u8]) {
    let path = repo.join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("parent directory should be creatable");
    }
    std::fs::write(path, contents).expect("file should be writable");
}

#[test]
fn file_bytes_match_what_git_cat_file_stored() {
    let (dir, _, second) = repo_with_history();
    let stored = Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .args(["cat-file", "blob", &format!("{second}:a.txt")])
        .output()
        .expect("git should be on PATH for these tests");
    assert!(stored.status.success());

    let bytes = file_bytes_at_commit(dir.path(), &second, "a.txt").expect("read");
    assert_eq!(bytes.as_deref(), Some(stored.stdout.as_slice()));
}

#[test]
fn file_bytes_survive_content_that_is_not_utf8() {
    // The whole reason this export exists: the string view replaces every
    // invalid sequence with U+FFFD, and an image cannot come back from that.
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    let raw: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0xff, 0xfe, 0x00, 0x1a];
    write_bytes(dir.path(), "image.png", raw);
    let hash = commit(dir.path(), "first");

    assert_eq!(
        file_bytes_at_commit(dir.path(), &hash, "image.png").expect("read").as_deref(),
        Some(raw)
    );
    // And the same read through the string view is lossy, which is the point.
    let lossy =
        file_content_at_commit(dir.path(), &hash, "image.png").expect("read").expect("some");
    assert_ne!(lossy.as_bytes(), raw);
    assert!(lossy.contains('\u{fffd}'));
}

#[test]
fn file_bytes_keep_every_trailing_newline() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "note.md", "# note\n\n\n");
    let hash = commit(dir.path(), "first");

    assert_eq!(
        file_bytes_at_commit(dir.path(), &hash, "note.md").expect("read").as_deref(),
        Some(b"# note\n\n\n".as_slice()),
    );
}

#[test]
fn file_bytes_read_an_empty_file_as_an_empty_buffer() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "empty.md", "");
    let hash = commit(dir.path(), "first");

    // Distinct from `None`, exactly as the string view is from `Some("")`.
    assert_eq!(
        file_bytes_at_commit(dir.path(), &hash, "empty.md").expect("read"),
        Some(Vec::new()),
    );
}

#[test]
fn file_bytes_are_absent_for_a_missing_path_a_bad_revision_and_a_directory() {
    let (dir, _, second) = repo_with_history();
    assert_eq!(file_bytes_at_commit(dir.path(), &second, "nope.txt").expect("read"), None);
    assert_eq!(file_bytes_at_commit(dir.path(), "no-such-ref", "a.txt").expect("read"), None);

    let nested = TempDir::new().expect("temp dir");
    init(nested.path());
    write(nested.path(), "a/b.txt", "deep\n");
    let hash = commit(nested.path(), "first");
    assert_eq!(file_bytes_at_commit(nested.path(), &hash, "a").expect("read"), None);
}

#[test]
fn file_bytes_fail_for_a_path_that_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = file_bytes_at_commit(dir.path(), "HEAD", "a.txt").expect_err("not a repository");
    assert!(error.to_string().starts_with("git show"), "{error}");
}

// ─────────────────────────────────────────────────────────────────────────────
// file_exists_at_commit
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn file_existence_agrees_with_cat_file() {
    let (dir, _, second) = repo_with_history();
    for (path, expected) in [("a.txt", true), ("nope.txt", false)] {
        let spec = format!("{second}:{path}");
        assert_eq!(git_succeeds(dir.path(), &["cat-file", "-e", &spec]), expected, "{path}");
        assert_eq!(file_exists_at_commit(dir.path(), &second, path).expect("exists"), expected);
    }
}

#[test]
fn a_directory_exists_the_way_cat_file_says_it_does() {
    let dir = TempDir::new().expect("temp dir");
    init(dir.path());
    write(dir.path(), "a/b.txt", "deep\n");
    let hash = commit(dir.path(), "first");

    let spec = format!("{hash}:a");
    assert!(git_succeeds(dir.path(), &["cat-file", "-e", &spec]));
    assert!(file_exists_at_commit(dir.path(), &hash, "a").expect("exists"));
}

#[test]
fn nothing_exists_at_a_revision_that_names_nothing() {
    let (dir, _, _) = repo_with_history();
    assert!(!file_exists_at_commit(dir.path(), "no-such-ref", "a.txt").expect("exists"));
}

// ─────────────────────────────────────────────────────────────────────────────
// validate_ref
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn validate_ref_resolves_head_and_a_branch() {
    let (dir, _, second) = repo_with_history();
    assert_eq!(
        validate_ref(dir.path(), "HEAD").expect("validate").as_deref(),
        Some(second.as_str())
    );
    assert_eq!(
        validate_ref(dir.path(), "main").expect("validate").as_deref(),
        Some(second.as_str())
    );
}

#[test]
fn validate_ref_resolves_a_full_and_a_short_hash() {
    let (dir, _, second) = repo_with_history();
    let short = &second[..7];
    assert_eq!(
        validate_ref(dir.path(), &second).expect("validate").as_deref(),
        Some(second.as_str())
    );
    assert_eq!(
        validate_ref(dir.path(), short).expect("validate").as_deref(),
        Some(second.as_str())
    );
}

#[test]
fn validate_ref_answers_none_for_garbage() {
    let (dir, _, _) = repo_with_history();
    assert_eq!(validate_ref(dir.path(), "not-a-valid-ref-at-all-xyz").expect("validate"), None);
}

#[test]
fn a_lightweight_tag_validates_and_an_annotated_one_does_not() {
    let (dir, _, second) = repo_with_history();
    git(dir.path(), &["tag", "light"]);
    git(dir.path(), &["tag", "-a", "heavy", "-m", "annotated"]);

    // The quirk being pinned: `rev-parse --verify` does not peel, so the
    // annotated tag reads back as a tag object and the port keeps saying no.
    assert_eq!(git_stdout(dir.path(), &["cat-file", "-t", "heavy"]), "tag");
    assert_eq!(git_stdout(dir.path(), &["cat-file", "-t", "light"]), "commit");

    assert_eq!(
        validate_ref(dir.path(), "light").expect("validate").as_deref(),
        Some(second.as_str())
    );
    assert_eq!(validate_ref(dir.path(), "heavy").expect("validate"), None);
}

#[test]
fn a_tree_is_not_a_commit() {
    let (dir, _, second) = repo_with_history();
    let tree = git_stdout(dir.path(), &["rev-parse", &format!("{second}^{{tree}}")]);
    assert_eq!(validate_ref(dir.path(), &tree).expect("validate"), None);
}

#[test]
fn validate_ref_fails_for_a_path_that_is_not_a_repository() {
    let dir = TempDir::new().expect("temp dir");
    let error = validate_ref(dir.path(), "HEAD").expect_err("not a repository");
    assert!(error.to_string().starts_with("git rev-parse --verify"), "{error}");
}

#[test]
fn transported_metadata_matches_host_for_root_ordinary_and_merge_commits() {
    let (dir, first, second) = repo_with_history();
    let tree = git_stdout(dir.path(), &["rev-parse", &format!("{second}^{{tree}}")]);
    let merge =
        git_stdout(dir.path(), &["commit-tree", &tree, "-p", &second, "-p", &first, "-m", "merge"]);
    for (revision, expected_parent) in
        [(&first, EMPTY_TREE_HASH), (&second, first.as_str()), (&merge, second.as_str())]
    {
        let batch = commit_files_args(revision);
        let outputs: Vec<String> = batch
            .iter()
            .map(|args| coc_native_core::git::run_git(dir.path(), args, &options()).unwrap())
            .collect();
        let transported = process_commit_metadata(&outputs[0], &outputs[1], &outputs[2]);
        assert_eq!(transported.parent_hash, expected_parent);
        assert_eq!(transported, commit_files(dir.path(), revision, &options()).unwrap());
    }
    let batch = commit_files_args("--all");
    assert!(coc_native_core::git::run_git(dir.path(), &batch[2], &options()).is_err());
}
