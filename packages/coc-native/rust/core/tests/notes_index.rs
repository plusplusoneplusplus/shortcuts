//! Notes content-index parity and boundary tests.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Barrier};
use std::thread;

use coc_native_core::notes_index::{
    NotesIndex, NotesIndexOptions, MAX_CHANGED_PATHS, MAX_MATCHING_FILES, MAX_TOTAL_MATCHES,
};

fn write(root: &Path, relative: &str, contents: &str) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, contents).unwrap();
}

fn build(root: &Path) -> NotesIndex {
    NotesIndex::build(root.to_path_buf(), NotesIndexOptions::default()).unwrap()
}

#[test]
fn indexes_lowercase_markdown_filenames_and_original_content_lines() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "projects/meeting-notes.md", "Heading\nDiscuss TARGET here\r\nlast target");
    write(root.path(), "projects/ignored.MD", "target");
    write(root.path(), "projects/plain.txt", "target");

    let index = build(root.path());
    assert_eq!(index.document_count(), 1);
    let response = index.search("target");

    assert!(!response.truncated);
    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].path, "projects/meeting-notes.md");
    assert_eq!(response.results[0].matches[0].line, 2);
    assert_eq!(response.results[0].matches[0].text, "Discuss TARGET here\r");
    assert_eq!(response.results[0].matches[1].line, 3);
    assert_eq!(response.results[0].matches[1].text, "last target");
}

#[test]
fn filename_match_precedes_content_matches() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "nested/Needle.md", "needle one\nnope\nNEEDLE two");

    let response = build(root.path()).search("needle");
    let result = &response.results[0];
    assert_eq!(result.path, "nested/Needle.md");
    assert_eq!(result.matches.iter().map(|item| item.line).collect::<Vec<_>>(), vec![0, 1, 3]);
    assert_eq!(result.matches[0].text, "Needle.md");
}

#[test]
fn uses_javascript_compatible_unicode_lowercasing() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "unicode.md", "İSTANBUL\nStraße\nCAFÉ");
    let index = build(root.path());

    assert_eq!(index.search("İST").results[0].matches[0].line, 1);
    assert_eq!(index.search("straße").results[0].matches[0].line, 2);
    assert_eq!(index.search("café").results[0].matches[0].line, 3);
    // Lowercasing is not full case folding: JavaScript does not turn ß into ss.
    assert!(index.search("STRASSE").results.is_empty());
    // JavaScript lowercases İ to `i` plus a combining dot, not plain `i`.
    assert!(index.search("istanbul").results.is_empty());
}

#[test]
fn missing_roots_build_empty_non_truncated_indexes() {
    let parent = tempfile::tempdir().unwrap();
    let missing = parent.path().join("missing");
    let index = build(&missing);

    assert_eq!(index.root(), missing);
    assert_eq!(index.document_count(), 0);
    assert_eq!(index.search("anything").results, vec![]);
    assert!(!index.search("anything").truncated);
}

#[test]
fn a_file_root_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "not-a-root.md", "text");
    let error =
        match NotesIndex::build(root.path().join("not-a-root.md"), NotesIndexOptions::default()) {
            Ok(_) => panic!("a file root should fail"),
            Err(error) => error,
        };
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
}

#[test]
fn nested_response_paths_always_use_forward_slashes() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "one/two/note.md", "path-token");

    let response = build(root.path()).search("path-token");
    assert_eq!(response.results[0].path, "one/two/note.md");
    assert!(!response.results[0].path.contains('\\'));
}

#[test]
fn walks_each_directory_in_case_sensitive_filename_byte_order() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "z-last.md", "order-token");
    write(root.path(), "nested/middle.md", "order-token");
    write(root.path(), "a-first.md", "order-token");
    // Uppercase sorts ahead of lowercase by byte. A case-insensitive order —
    // what NTFS hands back from `read_dir` — would put this file after
    // `a-first.md`, so the assertion pins the sort rather than the host.
    write(root.path(), "Needle.md", "order-token");

    let paths = build(root.path())
        .search("order-token")
        .results
        .into_iter()
        .map(|result| result.path)
        .collect::<Vec<_>>();
    assert_eq!(paths, vec!["Needle.md", "a-first.md", "nested/middle.md", "z-last.md"]);
}

#[test]
fn matching_file_cap_is_bounded_and_exact_cap_is_truncated() {
    let root = tempfile::tempdir().unwrap();
    for index in 0..MAX_MATCHING_FILES {
        write(root.path(), &format!("note-{index:03}.md"), "file-cap-token");
    }

    let response = build(root.path()).search("file-cap-token");
    assert_eq!(response.results.len(), MAX_MATCHING_FILES);
    assert_eq!(response.results.iter().map(|result| result.matches.len()).sum::<usize>(), 50);
    assert!(response.truncated);

    write(root.path(), "one-more.md", "file-cap-token");
    let response = build(root.path()).search("file-cap-token");
    assert_eq!(response.results.len(), MAX_MATCHING_FILES);
    assert!(response.truncated);
}

#[test]
fn total_match_cap_is_bounded_and_filename_match_consumes_the_first_slot() {
    let root = tempfile::tempdir().unwrap();
    let content = std::iter::repeat_n("needle", MAX_TOTAL_MATCHES).collect::<Vec<_>>().join("\n");
    write(root.path(), "needle.md", &content);

    let response = build(root.path()).search("needle");
    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].matches.len(), MAX_TOTAL_MATCHES);
    assert_eq!(response.results[0].matches[0].line, 0);
    assert_eq!(response.results[0].matches.last().unwrap().line, MAX_TOTAL_MATCHES - 1);
    assert!(response.truncated);
}

#[cfg(unix)]
#[test]
fn unreadable_markdown_keeps_its_filename_match_and_skips_content() {
    let root = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(root.path().join("missing-target"), root.path().join("needle.md"))
        .unwrap();

    let response = build(root.path()).search("needle");
    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].matches.len(), 1);
    assert_eq!(response.results[0].matches[0].line, 0);
}

#[cfg(unix)]
#[test]
fn external_root_policy_skips_file_and_directory_symlinks() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("root");
    let outside = parent.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    write(&outside, "secret.md", "outside-token");
    std::os::unix::fs::symlink(outside.join("secret.md"), root.join("file-link.md")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("directory-link")).unwrap();

    let index = NotesIndex::build(root, NotesIndexOptions { skip_symlinks: true }).unwrap();
    assert_eq!(index.options(), NotesIndexOptions { skip_symlinks: true });
    assert_eq!(index.document_count(), 0);
    assert!(index.search("outside-token").results.is_empty());
    assert!(index.search("file-link").results.is_empty());
}

#[test]
fn invalid_utf8_content_matches_node_utf8_replacement_semantics() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("bytes.md"), b"before \xFF after").unwrap();

    let response = build(root.path()).search("� after");
    assert_eq!(response.results[0].matches[0].text, "before � after");
}

#[test]
fn incremental_refresh_adds_modifies_and_deletes_markdown_files() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "existing.md", "old-token");
    let index = build(root.path());

    write(root.path(), "nested/added.md", "added-token");
    index.refresh_changed(&["nested/added.md".to_owned()]).unwrap();
    assert_eq!(index.search("added-token").results[0].path, "nested/added.md");

    write(root.path(), "existing.md", "modified-token");
    index.refresh_changed(&["existing.md".to_owned()]).unwrap();
    assert!(index.search("old-token").results.is_empty());
    assert_eq!(index.search("modified-token").results[0].path, "existing.md");

    fs::remove_file(root.path().join("nested/added.md")).unwrap();
    index.refresh_changed(&["nested/added.md".to_owned()]).unwrap();
    assert!(index.search("added-token").results.is_empty());
}

#[test]
fn incremental_batches_normalize_windows_separators_and_preserve_walk_order() {
    let root = tempfile::tempdir().unwrap();
    let index = build(root.path());
    write(root.path(), "a/inside.md", "batch-token");
    write(root.path(), "a.md", "batch-token");
    write(root.path(), "ignored.MD", "batch-token");

    index
        .refresh_changed(&[
            "ignored.MD".to_owned(),
            "a.md".to_owned(),
            "a\\inside.md".to_owned(),
            "a.md".to_owned(),
        ])
        .unwrap();

    assert_eq!(
        index
            .search("batch-token")
            .results
            .into_iter()
            .map(|result| result.path)
            .collect::<Vec<_>>(),
        vec!["a/inside.md", "a.md"]
    );
}

#[test]
fn full_refresh_recovers_from_directory_renames() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "before/note.md", "rename-token");
    let index = build(root.path());

    fs::rename(root.path().join("before"), root.path().join("after")).unwrap();
    index.refresh().unwrap();

    let response = index.search("rename-token");
    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].path, "after/note.md");
}

#[test]
fn incremental_refresh_converges_file_rename_batches() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "before.md", "rename-token");
    let index = build(root.path());

    fs::rename(root.path().join("before.md"), root.path().join("after.md")).unwrap();
    index.refresh_changed(&["before.md".to_owned(), "after.md".to_owned()]).unwrap();

    let response = index.search("rename-token");
    assert_eq!(response.results.len(), 1);
    assert_eq!(response.results[0].path, "after.md");
}

#[test]
fn failed_incremental_refresh_retains_the_last_complete_snapshot() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("notes");
    write(&root, "stable.md", "stable-token");
    let index = build(&root);

    fs::remove_dir_all(&root).unwrap();
    fs::write(&root, "not a directory").unwrap();
    assert!(index.refresh_changed(&["stable.md".to_owned()]).is_err());
    assert!(index.refresh().is_err());

    assert_eq!(index.document_count(), 1);
    assert_eq!(index.search("stable-token").results[0].path, "stable.md");
}

#[test]
fn unsafe_oversized_and_directory_batches_require_recovery() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "stable.md", "stable-token");
    write(root.path(), "folder/note.md", "folder-token");
    let index = build(root.path());

    assert!(index.refresh_changed(&["../escape.md".to_owned()]).is_err());
    assert!(index.refresh_changed(&["folder".to_owned()]).is_err());
    let oversized = vec!["stable.md".to_owned(); MAX_CHANGED_PATHS + 1];
    assert!(index.refresh_changed(&oversized).is_err());

    assert_eq!(index.document_count(), 2);
    assert_eq!(index.search("stable-token").results[0].path, "stable.md");
}

#[test]
fn concurrent_incremental_refreshes_do_not_lose_completed_batches() {
    let root = tempfile::tempdir().unwrap();
    let index = build(root.path());
    write(root.path(), "first.md", "first-token");
    write(root.path(), "second.md", "second-token");

    let first = index.clone();
    let first_refresh = thread::spawn(move || {
        first.refresh_changed(&["first.md".to_owned()]).unwrap();
    });
    let second = index.clone();
    let second_refresh = thread::spawn(move || {
        second.refresh_changed(&["second.md".to_owned()]).unwrap();
    });
    first_refresh.join().unwrap();
    second_refresh.join().unwrap();

    assert_eq!(index.document_count(), 2);
    assert_eq!(index.search("first-token").results[0].path, "first.md");
    assert_eq!(index.search("second-token").results[0].path, "second.md");
}

#[test]
fn searches_during_refresh_see_complete_old_or_new_snapshots() {
    let root = tempfile::tempdir().unwrap();
    for number in 0..20 {
        write(root.path(), &format!("note-{number:02}.md"), "old generation");
    }
    let index = build(root.path());
    for number in 0..20 {
        write(root.path(), &format!("note-{number:02}.md"), "new generation");
    }

    let barrier = Arc::new(Barrier::new(2));
    let refreshing_index = index.clone();
    let refreshing_barrier = Arc::clone(&barrier);
    let refreshing = thread::spawn(move || {
        let paths = (0..20).map(|number| format!("note-{number:02}.md")).collect::<Vec<_>>();
        refreshing_barrier.wait();
        refreshing_index.refresh_changed(&paths).unwrap();
    });

    barrier.wait();
    for _ in 0..200 {
        let response = index.search("generation");
        assert_eq!(response.results.len(), 20);
        let lines = response
            .results
            .iter()
            .map(|result| result.matches[0].text.as_str())
            .collect::<Vec<_>>();
        assert!(
            lines.iter().all(|line| *line == "old generation")
                || lines.iter().all(|line| *line == "new generation")
        );
    }
    refreshing.join().unwrap();
    assert!(index
        .search("generation")
        .results
        .iter()
        .all(|result| result.matches[0].text == "new generation"));
}

#[cfg(unix)]
#[test]
fn incremental_refresh_preserves_the_skip_symlinks_policy() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("root");
    let outside = parent.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    write(&outside, "secret.md", "outside-token");
    let index = NotesIndex::build(root.clone(), NotesIndexOptions { skip_symlinks: true }).unwrap();

    std::os::unix::fs::symlink(outside.join("secret.md"), root.join("linked.md")).unwrap();
    index.refresh_changed(&["linked.md".to_owned()]).unwrap();

    assert!(index.search("outside-token").results.is_empty());
    assert!(index.search("linked").results.is_empty());
}
