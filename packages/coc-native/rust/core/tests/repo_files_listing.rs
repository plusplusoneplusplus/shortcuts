//! Explorer listing contracts: dirs-first `localeCompare` order, ignore
//! filtering, caps, deep listings, and the subtree file walk.

use std::cmp::Ordering;
use std::fs;
use std::path::Path;

use coc_native_core::repo_files::{
    list_directory, list_files, locale_compare, FileListing, RepoFilesError, TreeListing,
};

fn write(root: &Path, relative: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, "x").unwrap();
}

/// A directory that looks like a git repo, so gitignore rules apply.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    write(dir.path(), ".git/HEAD");
    dir
}

fn names(root: &Path, relative: &str, include_ignored: bool) -> Vec<String> {
    let entries = list_directory(root, relative, 1, include_ignored, 5000).unwrap().entries;
    entries.into_iter().map(|e| e.name).collect()
}

#[test]
fn locale_compare_matches_node() {
    // Expected orders are `[...].sort((a, b) => a.localeCompare(b))` under Node 24 ICU.
    let mut names =
        vec!["b", "B", "a", "_a", "-a", ".a", "A", "a10", "a2", "é", "e", "Z", "1", "ä"];
    names.sort_by(|a, b| locale_compare(a, b));
    assert_eq!(names, ["_a", "-a", ".a", "1", "a", "A", "ä", "a10", "a2", "b", "B", "e", "é", "Z"]);
    assert_eq!(locale_compare("README.md", "readme.md"), Ordering::Greater);
}

#[test]
fn dirs_first_then_locale_order_with_sizes_and_paths() {
    let dir = repo();
    let root = dir.path();
    for file in ["src/b.ts", "src/Zeta/x", "src/alpha/x", "src/_c.ts", "src/A.ts"] {
        write(root, file);
    }
    let TreeListing { entries, truncated } = list_directory(root, "/src", 1, false, 5000).unwrap();
    assert!(!truncated);
    let got: Vec<_> =
        entries.iter().map(|e| (e.name.as_str(), e.is_dir(), e.size, e.path.as_str())).collect();
    assert_eq!(
        got,
        [
            ("alpha", true, None, "src/alpha"),
            ("Zeta", true, None, "src/Zeta"),
            ("_c.ts", false, Some(1), "src/_c.ts"),
            ("A.ts", false, Some(1), "src/A.ts"),
            ("b.ts", false, Some(1), "src/b.ts"),
        ]
    );
}

#[test]
fn ignored_files_and_dirs_are_hidden_unless_requested_and_git_is_listed() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join(".gitignore"), "dist/\n*.log\n").unwrap();
    for file in ["dist/a.js", "debug.log", "keep.ts", ".env"] {
        write(root, file);
    }
    assert_eq!(names(root, "", false), [".git", ".env", ".gitignore", "keep.ts"]);
    assert_eq!(
        names(root, ".", true),
        [".git", "dist", ".env", ".gitignore", "debug.log", "keep.ts"]
    );
}

#[cfg(unix)]
#[test]
fn symlinks_report_their_target_and_broken_links_are_skipped() {
    let dir = repo();
    let root = dir.path();
    write(root, "real/f.txt");
    std::os::unix::fs::symlink(root.join("real"), root.join("link")).unwrap();
    std::os::unix::fs::symlink(root.join("nowhere"), root.join("broken")).unwrap();
    let entries = list_directory(root, "", 1, true, 5000).unwrap().entries;
    let got: Vec<_> = entries.iter().map(|e| (e.name.as_str(), e.is_dir())).collect();
    assert_eq!(got, [(".git", true), ("link", true), ("real", true)]);
}

#[test]
fn cap_truncates_and_suppresses_children() {
    let dir = repo();
    let root = dir.path();
    for file in ["d1/a", "d1/b", "d1/c", "d2/x", "f"] {
        write(root, file);
    }
    let TreeListing { entries, truncated } = list_directory(root, "", 3, true, 2).unwrap();
    assert!(truncated);
    assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), [".git", "d1"]);
    assert!(entries.iter().all(|e| e.children.is_none()));

    let TreeListing { entries, truncated } = list_directory(root, "", 2, false, 4).unwrap();
    assert!(!truncated);
    let d1 = entries.iter().find(|e| e.name == "d1").unwrap();
    // Exactly the cap (4 root entries) is not truncated, so dirs get children.
    let child_names: Vec<_> =
        d1.children.as_ref().unwrap().iter().map(|e| e.path.as_str()).collect();
    assert_eq!(child_names, ["d1/a", "d1/b", "d1/c"]);
    assert!(entries.iter().find(|e| e.name == "f").unwrap().children.is_none());
}

#[test]
fn listing_errors_keep_route_messages() {
    let dir = repo();
    let root = dir.path();
    write(root, "file.txt");
    let message = |rel: &str| list_directory(root, rel, 1, false, 10).unwrap_err().to_string();
    assert_eq!(message("missing"), "Path does not exist: missing");
    assert_eq!(message("file.txt"), "Not a directory: file.txt");
    assert!(matches!(
        list_directory(root, "../x", 1, false, 10),
        Err(RepoFilesError::PathTraversal)
    ));
}

#[test]
fn file_walk_is_depth_first_in_locale_order_without_git() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join(".gitignore"), "out/\n").unwrap();
    for file in ["pkg/b.ts", "pkg/A/z.ts", "pkg/a.ts", "pkg/out/o.js", "pkg/sub/.git/HEAD"] {
        write(root, file);
    }
    let FileListing { files, truncated } = list_files(root, "pkg", false, 100).unwrap();
    assert!(!truncated);
    // Files and directories interleave by name; no dirs-first here.
    assert_eq!(files, ["pkg/A/z.ts", "pkg/a.ts", "pkg/b.ts"]);
    let files = list_files(root, "/pkg/", true, 100).unwrap().files;
    assert_eq!(files, ["pkg/A/z.ts", "pkg/a.ts", "pkg/b.ts", "pkg/out/o.js"]);
}

#[test]
fn file_walk_caps_and_tolerates_missing_starts() {
    let dir = repo();
    let root = dir.path();
    for file in ["pkg/a", "pkg/b", "pkg/c"] {
        write(root, file);
    }
    let walk = |rel: &str, max| {
        let FileListing { files, truncated } = list_files(root, rel, false, max).unwrap();
        (files, truncated)
    };
    assert_eq!(walk("pkg", 2), (vec!["pkg/a".into(), "pkg/b".into()], true));
    // Reaching the cap exactly still reports truncation, as the JS walk did.
    assert!(list_files(root, "pkg", false, 3).unwrap().truncated);
    assert_eq!(walk("missing", 3), (vec![], false));
    assert_eq!(walk("pkg/a", 3), (vec![], false));
    assert!(matches!(list_files(root, "../x", false, 3), Err(RepoFilesError::PathTraversal)));
}

#[test]
fn listing_uses_git_rules_for_directories_and_ignore_rules_for_files() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join(".ignore"), "visible/\n*.log\n!git-hidden/\n").unwrap();
    fs::write(root.join(".gitignore"), "git-hidden/\n").unwrap();
    for file in ["visible/a.txt", "visible/debug.log", "git-hidden/a.txt", "debug.log"] {
        write(root, file);
    }
    let entries = list_directory(root, "", 2, false, 5000).unwrap().entries;
    assert_eq!(
        entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
        [".git", "visible", ".gitignore", ".ignore"]
    );
    // Opening the directory uses its local file policy, just like rg from that directory.
    assert_eq!(
        entries
            .iter()
            .find(|e| e.name == "visible")
            .unwrap()
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        ["a.txt"]
    );
    assert_eq!(
        names(root, "", true),
        [".git", "git-hidden", "visible", ".gitignore", ".ignore", "debug.log"]
    );
    // The file walker keeps the complete ripgrep ignore policy.
    assert!(!list_files(root, "", false, 100).unwrap().files.iter().any(|p| p == "visible/a.txt"));
}

#[test]
fn non_git_directory_listing_keeps_ignore_hidden_directories() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join(".ignore"), "hidden/\n*.log\n").unwrap();
    write(root, "hidden/a.txt");
    write(root, "debug.log");
    assert_eq!(names(root, "", false), ["hidden", ".ignore"]);
}

#[test]
fn ignored_directory_with_tracked_files_stays_listed() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let git = |args: &[&str]| {
        let status = std::process::Command::new("git").arg("-C").arg(root).args(args).status();
        assert!(status.unwrap().success(), "git {args:?}");
    };
    git(&["init", "-q"]);
    fs::write(root.join(".gitignore"), "build/\nignored/\n").unwrap();
    write(root, "build/out.js");
    write(root, "ignored/scratch.txt");
    git(&["add", "-f", "build/out.js"]);
    // Like `git check-ignore`: tracked content keeps an ignored directory visible.
    assert_eq!(names(root, "", false), [".git", "build", ".gitignore"]);
    assert_eq!(names(root, "", true), [".git", "build", "ignored", ".gitignore"]);
}
