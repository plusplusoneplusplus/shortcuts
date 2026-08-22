//! Walker tests: gitignore semantics, hidden files, symlinks and capping.

use std::fs;
use std::path::Path;

use coc_native_core::walk::{walk, WalkOptions};

fn write(root: &Path, relative: &str, contents: &str) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, contents).unwrap();
}

/// A directory that looks like a git repo, so gitignore rules apply the same
/// way ripgrep applies them.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir_all(dir.path().join(".git")).unwrap();
    fs::write(dir.path().join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
    dir
}

fn files(root: &Path, include_ignored: bool) -> Vec<String> {
    walk(root, &WalkOptions { include_ignored, max_entries: None }).unwrap().0
}

#[test]
fn lists_files_relative_to_the_root_and_sorted() {
    let dir = repo();
    write(dir.path(), "src/b.ts", "");
    write(dir.path(), "src/a.ts", "");
    write(dir.path(), "README.md", "");
    assert_eq!(files(dir.path(), false), vec!["README.md", "src/a.ts", "src/b.ts"]);
}

#[test]
fn directories_are_not_listed() {
    let dir = repo();
    fs::create_dir_all(dir.path().join("empty/nested")).unwrap();
    write(dir.path(), "a.ts", "");
    assert_eq!(files(dir.path(), false), vec!["a.ts"]);
}

#[test]
fn gitignored_files_are_excluded_unless_requested() {
    let dir = repo();
    write(dir.path(), ".gitignore", "ignored.txt\ndist/\n");
    write(dir.path(), "ignored.txt", "");
    write(dir.path(), "dist/bundle.js", "");
    write(dir.path(), "kept.ts", "");

    assert_eq!(files(dir.path(), false), vec![".gitignore", "kept.ts"]);

    let all = files(dir.path(), true);
    assert!(all.contains(&"ignored.txt".to_string()));
    assert!(all.contains(&"dist/bundle.js".to_string()));
}

#[test]
fn nested_gitignore_files_apply_to_their_subtree() {
    let dir = repo();
    write(dir.path(), "pkg/.gitignore", "secret.txt\n");
    write(dir.path(), "pkg/secret.txt", "");
    write(dir.path(), "pkg/public.txt", "");
    // The same name outside that subtree is unaffected.
    write(dir.path(), "secret.txt", "");

    let listed = files(dir.path(), false);
    assert!(listed.contains(&"pkg/public.txt".to_string()));
    assert!(listed.contains(&"secret.txt".to_string()));
    assert!(!listed.contains(&"pkg/secret.txt".to_string()));
}

#[test]
fn hidden_files_are_listed() {
    let dir = repo();
    write(dir.path(), ".env", "");
    write(dir.path(), ".config/settings.json", "");
    let listed = files(dir.path(), false);
    assert!(listed.contains(&".env".to_string()));
    assert!(listed.contains(&".config/settings.json".to_string()));
}

#[test]
fn the_git_directory_is_never_listed() {
    let dir = repo();
    write(dir.path(), ".git/config", "");
    write(dir.path(), "a.ts", "");
    assert_eq!(files(dir.path(), false), vec!["a.ts"]);
}

#[test]
fn max_entries_caps_the_list_and_reports_truncation() {
    let dir = repo();
    for i in 0..20 {
        write(dir.path(), &format!("f{i:02}.ts"), "");
    }

    let (capped, truncated) =
        walk(dir.path(), &WalkOptions { include_ignored: false, max_entries: Some(5) }).unwrap();
    assert_eq!(capped.len(), 5);
    assert!(truncated);

    let (whole, truncated) =
        walk(dir.path(), &WalkOptions { include_ignored: false, max_entries: Some(20) }).unwrap();
    assert_eq!(whole.len(), 20);
    assert!(!truncated);
}

#[test]
fn a_nonexistent_root_is_an_error() {
    let dir = repo();
    let err = walk(&dir.path().join("nope"), &WalkOptions::default()).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
}

#[test]
fn a_file_root_is_an_error() {
    let dir = repo();
    write(dir.path(), "a.ts", "");
    let err = walk(&dir.path().join("a.ts"), &WalkOptions::default()).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
}

#[cfg(unix)]
#[test]
fn directory_symlinks_are_followed_and_broken_ones_skipped() {
    let dir = repo();
    write(dir.path(), "real/inner.ts", "");
    std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("link")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("missing"), dir.path().join("broken")).unwrap();

    let listed = files(dir.path(), false);
    assert!(listed.contains(&"real/inner.ts".to_string()));
    assert!(listed.contains(&"link/inner.ts".to_string()));
    assert!(!listed.iter().any(|p| p.starts_with("broken")));
}

#[cfg(unix)]
#[test]
fn a_symlink_cycle_terminates() {
    let dir = repo();
    write(dir.path(), "a/inner.ts", "");
    std::os::unix::fs::symlink(dir.path().join("a"), dir.path().join("a").join("loop")).unwrap();

    // The point of the test is that this returns at all.
    let listed = files(dir.path(), false);
    assert!(listed.contains(&"a/inner.ts".to_string()));
}

#[test]
fn an_empty_repository_walks_to_an_empty_list() {
    let dir = repo();
    assert!(files(dir.path(), false).is_empty());
}
