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
fn staged_additions_edits_and_disk_deletions_are_visible_without_invalidation() {
    let dir = repo();
    let options = ContentSearchOptions::default();
    fs::write(dir.path().join("new.txt"), "fresh-marker\n").unwrap();
    assert!(candidates(dir.path(), "fresh-marker", &options, false).is_empty());
    git(dir.path(), &["add", "new.txt"]);
    assert_eq!(candidates(dir.path(), "fresh-marker", &options, false), ["new.txt"]);
    fs::write(dir.path().join("new.txt"), "edited-marker\n").unwrap();
    assert!(candidates(dir.path(), "fresh-marker", &options, false).is_empty());
    assert_eq!(candidates(dir.path(), "edited-marker", &options, false), ["new.txt"]);
    fs::remove_file(dir.path().join("new.txt")).unwrap();
    assert!(candidates(dir.path(), "edited-marker", &options, false).is_empty());
}

#[test]
fn simultaneous_candidate_searches_keep_their_query_and_options() {
    let dir = repo();
    std::thread::scope(|scope| {
        let insensitive = scope
            .spawn(|| candidates(dir.path(), "needle", &ContentSearchOptions::default(), false));
        let sensitive = scope.spawn(|| {
            candidates(
                dir.path(),
                "needle",
                &ContentSearchOptions { case_sensitive: true, ..Default::default() },
                false,
            )
        });
        let absent = scope
            .spawn(|| candidates(dir.path(), "absent", &ContentSearchOptions::default(), false));
        assert_eq!(insensitive.join().unwrap(), ["ignored/tracked.txt", "tracked.txt"]);
        assert!(sensitive.join().unwrap().is_empty());
        assert!(absent.join().unwrap().is_empty());
    });
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

#[test]
fn directory_exclusions_prune_git_candidates_without_changing_native_answers() {
    let dir = repo();
    for name in [
        "src/data/a.txt",
        "src/data/nested/b.txt",
        "src/database/c.txt",
        "nested/src/data/d.txt",
        "src/keep.txt",
        "build-output/e.txt",
    ] {
        let full = dir.path().join(name);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, "Needle\n").unwrap();
        git(dir.path(), &["add", "--", name]);
    }
    let baseline = candidates(dir.path(), "Needle", &ContentSearchOptions::default(), false);
    for exclude in [
        vec!["src/data/**".into()],
        vec!["/src/data/**".into(), "build-output/**".into()],
        vec!["ignored/**".into()],
    ] {
        for case_sensitive in [false, true] {
            let options = ContentSearchOptions {
                exclude: exclude.clone(),
                case_sensitive,
                include: vec!["*.txt".into()],
                ..Default::default()
            };
            let narrowed = candidates(dir.path(), "Needle", &options, false);
            assert!(narrowed.len() < baseline.len());
            let expected = search(
                dir.path(),
                "Needle",
                &ContentSearchOptions { files: Some(baseline.clone()), ..options.clone() },
            )
            .unwrap();
            let actual = search(
                dir.path(),
                "Needle",
                &ContentSearchOptions { files: Some(narrowed), ..options.clone() },
            )
            .unwrap();
            assert_eq!(actual, expected);
            assert!(actual.matches.iter().any(|hit| hit.path == "nested/src/data/d.txt"));
        }
    }
}

#[test]
fn unsupported_and_scoped_exclusions_keep_native_rule_semantics() {
    let dir = repo();
    let baseline = candidates(dir.path(), "Needle", &ContentSearchOptions::default(), false);
    for (exclude, scope) in [
        (vec!["**/tracked.txt".into()], None),
        (vec!["ignored/**".into(), "!ignored/tracked.txt".into()], None),
        (vec!["[".into()], None),
        (vec!["ignored/**".into()], Some("ignored".into())),
    ] {
        let options = ContentSearchOptions { exclude, path: scope, ..Default::default() };
        assert_eq!(candidates(dir.path(), "Needle", &options, false), baseline);
    }
}

#[test]
fn excluded_oversized_files_do_not_change_truncation_and_symlinks_stay_native_candidates() {
    let dir = repo();
    fs::create_dir(dir.path().join("data")).unwrap();
    fs::write(dir.path().join("data/large.txt"), "Needle\n".repeat(200_000)).unwrap();
    git(dir.path(), &["add", "data/large.txt"]);
    let hash = git(dir.path(), &["hash-object", "-w", "tracked.txt"]);
    git(dir.path(), &["update-index", "--add", "--cacheinfo", "120000", &hash, "data/link.txt"]);
    let options = ContentSearchOptions { exclude: vec!["data/**".into()], ..Default::default() };
    let baseline = candidates(dir.path(), "Needle", &ContentSearchOptions::default(), false);
    let narrowed = candidates(dir.path(), "Needle", &options, false);
    assert!(!narrowed.contains(&"data/large.txt".into()));
    assert!(narrowed.contains(&"data/link.txt".into()));
    let expected = search(
        dir.path(),
        "Needle",
        &ContentSearchOptions { files: Some(baseline), ..options.clone() },
    )
    .unwrap();
    assert!(!expected.truncated);
    assert_eq!(
        search(dir.path(), "Needle", &ContentSearchOptions { files: Some(narrowed), ..options })
            .unwrap(),
        expected
    );
}
