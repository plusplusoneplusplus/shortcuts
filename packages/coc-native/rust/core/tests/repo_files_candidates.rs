//! Real Git candidate selection, composed with the existing fresh matcher.

use std::fs;
use std::path::Path;

use coc_native_core::content_search::{search, ContentSearchOptions};
use coc_native_core::git::{run_git, GitCommandOptions};
use coc_native_core::repo_files::{
    prepare_content_candidates, tracked_content_candidates, RepoFilesError,
};
use tempfile::TempDir;

fn git(root: &Path, args: &[&str]) -> String {
    run_git(
        root,
        &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        &GitCommandOptions::default(),
    )
    .expect("Git fixture command")
}

fn repo() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init"]);
    fs::create_dir(dir.path().join("ignored")).unwrap();
    fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    fs::write(dir.path().join("tracked.txt"), "before\n🎯 Needle\nafter\n").unwrap();
    fs::write(dir.path().join("ignored/tracked.txt"), "Needle\n").unwrap();
    fs::write(dir.path().join("untracked.txt"), "Needle\n").unwrap();
    fs::write(dir.path().join("ignored/untracked.txt"), "Needle\n").unwrap();
    git(dir.path(), &["add", ".gitignore", "tracked.txt"]);
    git(dir.path(), &["add", "-f", "ignored/tracked.txt"]);
    dir
}

fn candidates(
    root: &Path,
    query: &str,
    options: &ContentSearchOptions,
    untracked: bool,
) -> Vec<String> {
    tracked_content_candidates(root, query, options, untracked, None).unwrap()
}

#[test]
fn literals_read_fresh_working_tree_and_keep_tracked_ignored_paths() {
    let dir = repo();
    let options = ContentSearchOptions::default();
    assert_eq!(
        candidates(dir.path(), "Needle", &options, false),
        ["ignored/tracked.txt", "tracked.txt"]
    );
    fs::write(dir.path().join("tracked.txt"), "no match\n").unwrap();
    assert_eq!(candidates(dir.path(), "Needle", &options, false), ["ignored/tracked.txt"]);
    assert!(candidates(dir.path(), "absent", &options, false).is_empty());
    // Removing a file from the index must change the very next query too.
    git(dir.path(), &["rm", "--cached", "ignored/tracked.txt"]);
    assert!(candidates(dir.path(), "Needle", &options, false).is_empty());
}

#[test]
fn regex_multiline_empty_and_nul_queries_keep_all_tracked_candidates() {
    let dir = repo();
    let options = ContentSearchOptions::default();
    let expected = [".gitignore", "ignored/tracked.txt", "tracked.txt"];
    for query in ["", "before\n🎯 Needle", "before\r", "a\0b"] {
        assert_eq!(candidates(dir.path(), query, &options, false), expected);
    }
    assert_eq!(
        candidates(
            dir.path(),
            "before\\n.*Needle",
            &ContentSearchOptions { regex: true, ..options },
            false
        ),
        expected
    );
}

#[test]
fn untracked_mode_keeps_only_nonignored_untracked_files_without_literal_narrowing() {
    let dir = repo();
    let files = candidates(dir.path(), "absent", &ContentSearchOptions::default(), true);
    assert_eq!(files, ["untracked.txt", ".gitignore", "ignored/tracked.txt", "tracked.txt"]);
}

#[test]
fn native_matcher_still_owns_case_words_globs_context_and_utf16_columns() {
    let dir = repo();
    let mut options = ContentSearchOptions {
        whole_word: true,
        include: vec!["tracked.txt".into()],
        exclude: vec!["ignored/**".into()],
        ..Default::default()
    };
    options.files = Some(candidates(dir.path(), "needle", &options, false));
    let result = search(dir.path(), "needle", &options).unwrap();
    assert_eq!(result.matches.len(), 1);
    let hit = &result.matches[0];
    assert_eq!(hit.path, "tracked.txt");
    assert_eq!((hit.start_column, hit.end_column), (3, 9));
    assert_eq!(hit.before, ["before"]);
    assert_eq!(hit.after, ["after"]);
    let sensitive = ContentSearchOptions { case_sensitive: true, ..options.clone() };
    assert!(candidates(dir.path(), "needle", &sensitive, false).is_empty());
    assert!(search(dir.path(), "Need", &options).unwrap().matches.is_empty());
}

#[test]
fn staged_symlink_candidates_survive_git_grep_even_without_a_matching_regular_file() {
    let dir = repo();
    // An index entry is enough to test Git's symlink policy on every platform,
    // including Windows hosts without permission to create filesystem symlinks.
    let hash = git(dir.path(), &["hash-object", "-w", "tracked.txt"]);
    git(
        dir.path(),
        &["update-index", "--add", "--cacheinfo", "120000", &hash, "link with spaces.txt"],
    );
    assert_eq!(
        candidates(dir.path(), "absent", &ContentSearchOptions::default(), false),
        ["link with spaces.txt"]
    );
}

#[test]
fn candidate_paths_preserve_spaces_unicode_and_git_nul_delimiters() {
    let dir = repo();
    for name in ["space name.txt", "é🎯.txt", "tab\tname.txt", "line\nname.txt"] {
        // Control characters are legal filenames on POSIX but not on Windows.
        if cfg!(windows) && name.contains(['\t', '\n']) {
            continue;
        }
        fs::write(dir.path().join(name), "Needle\n").unwrap();
        git(dir.path(), &["add", "--", name]);
        assert!(candidates(dir.path(), "Needle", &ContentSearchOptions::default(), false)
            .contains(&name.to_owned()));
    }
}

#[test]
fn candidates_are_root_scoped_without_shared_query_results() {
    let first = repo();
    let second = repo();
    let options = ContentSearchOptions::default();
    fs::write(first.path().join("tracked.txt"), "first-only\n").unwrap();
    fs::write(second.path().join("tracked.txt"), "second-only\n").unwrap();
    for (own, other, query) in
        [(first.path(), second.path(), "first-only"), (second.path(), first.path(), "second-only")]
    {
        assert_eq!(candidates(own, query, &options, false), ["tracked.txt"]);
        assert!(candidates(other, query, &options, false).is_empty());
    }
}

#[test]
fn wsl_uses_supplied_outputs_and_never_runs_host_git_or_narrows_them() {
    let dir = tempfile::tempdir().unwrap(); // Intentionally not a Git repository.
    let root = dir.path().join("nonexistent-wsl-share");
    for (output, expected) in [
        ("", vec![]),
        (
            "ignored/tracked.txt\0space name.txt\0é🎯.txt\0",
            vec!["ignored/tracked.txt", "space name.txt", "é🎯.txt"],
        ),
    ] {
        assert_eq!(
            tracked_content_candidates(
                &root,
                "Needle",
                &ContentSearchOptions::default(),
                false,
                Some(output)
            )
            .unwrap(),
            expected
        );
    }
    // POSIX backslashes are filename characters; only the host separator is
    // normalized, matching Node's original split(path.sep).join('/') policy.
    let files = tracked_content_candidates(
        &root,
        "a",
        &ContentSearchOptions::default(),
        false,
        Some("dir\\file\0"),
    )
    .unwrap();
    assert_eq!(files, [if cfg!(windows) { "dir/file" } else { "dir\\file" }]);
}

#[test]
fn preparation_supplies_adapter_argv_and_identical_resource_limits() {
    let tracked = prepare_content_candidates(false);
    let untracked = prepare_content_candidates(true);
    assert_eq!(tracked.args, ["ls-files", "-z", "--cached"]);
    assert_eq!(untracked.args, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    for command in [tracked, untracked] {
        assert_eq!(command.timeout_ms, 15_000);
        assert_eq!(command.max_buffer, 64 * 1024 * 1024);
    }
}

#[test]
fn missing_git_repository_has_distinct_tracked_unavailable_contract() {
    let dir = tempfile::tempdir().unwrap();
    let error = tracked_content_candidates(
        dir.path(),
        "needle",
        &ContentSearchOptions::default(),
        false,
        None,
    )
    .unwrap_err();
    assert!(matches!(error, RepoFilesError::TrackedUnavailable(_)));
    assert!(error.to_string().starts_with("Git-tracked search is unavailable: "));
}

#[test]
fn narrowing_failures_keep_the_ordinary_search_error_contract() {
    let dir = repo();
    git(dir.path(), &["config", "grep.threads", "-1"]);
    let error = tracked_content_candidates(
        dir.path(),
        "Needle",
        &ContentSearchOptions::default(),
        false,
        None,
    )
    .unwrap_err();
    assert!(matches!(error, RepoFilesError::Io(_)));
    assert!(!error.to_string().contains("Git-tracked search is unavailable"));
}
