use std::fs;
use std::path::Path;

use coc_native_core::repo_files::{delete_entry, RepoFilesError};

fn write(root: &Path, relative: &str, content: &str) {
    let file = root.join(relative);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, content).unwrap();
}

#[test]
fn deletes_one_file_and_preserves_siblings() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "folder/remove.txt", "remove");
    write(root.path(), "folder/keep.txt", "keep");
    assert_eq!(delete_entry(root.path(), "folder/remove.txt").unwrap(), 1);
    assert!(!root.path().join("folder/remove.txt").exists());
    assert_eq!(fs::read_to_string(root.path().join("folder/keep.txt")).unwrap(), "keep");
}

#[test]
fn deletes_populated_and_empty_folders_including_ignored_contents() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "folder/.gitignore", "*");
    write(root.path(), "folder/ignored/deep/file", "content");
    fs::create_dir(root.path().join("folder/empty")).unwrap();
    assert_eq!(delete_entry(root.path(), "folder").unwrap(), 6);
    assert!(!root.path().join("folder").exists());
    assert!(root.path().is_dir());
    fs::create_dir(root.path().join("empty")).unwrap();
    assert_eq!(delete_entry(root.path(), "empty").unwrap(), 1);
}

#[test]
fn rejects_root_absolute_traversal_and_platform_aliases_without_mutation() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "keep", "keep");
    for path in [
        "",
        ".",
        "/",
        "\\",
        "..",
        "../keep",
        "folder/../keep",
        "/keep",
        "\\keep",
        "C:\\keep",
        "C:keep",
        "\\\\server\\share\\keep",
        "folder\\..\\keep",
        "keep:stream",
        ".git.",
        ".git ",
        "folder//keep",
        "folder/./keep",
    ] {
        let error = delete_entry(root.path(), path).unwrap_err();
        assert_eq!(error.removed_entries, 0, "{path:?}");
        assert!(matches!(error.cause, RepoFilesError::InvalidArg(_)), "{path:?}");
        assert_eq!(fs::read_to_string(root.path().join("keep")).unwrap(), "keep");
    }
}

#[test]
fn git_metadata_files_directories_and_case_variants_are_protected() {
    for name in [".git", ".GIT", ".Git"] {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), name, "gitdir: protected");
        let error = delete_entry(root.path(), name).unwrap_err();
        assert_eq!(error.removed_entries, 0);
        assert_eq!(fs::read_to_string(root.path().join(name)).unwrap(), "gitdir: protected");
    }
    let root = tempfile::tempdir().unwrap();
    write(root.path(), ".git/HEAD", "protected");
    for relative in [".git", ".git/HEAD"] {
        assert_eq!(delete_entry(root.path(), relative).unwrap_err().removed_entries, 0);
    }
    assert_eq!(fs::read_to_string(root.path().join(".git/HEAD")).unwrap(), "protected");
}

#[test]
fn preflight_refuses_nested_repositories_before_removing_any_sibling() {
    for metadata in [".git", ".git/HEAD", ".GIT/HEAD"] {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "folder/a", "must survive");
        write(root.path(), &format!("folder/nested/{metadata}"), "protected");
        let error = delete_entry(root.path(), "folder").unwrap_err();
        assert_eq!(error.removed_entries, 0);
        assert!(error.to_string().contains("Git metadata"));
        assert_eq!(fs::read_to_string(root.path().join("folder/a")).unwrap(), "must survive");
    }
}

#[test]
fn missing_target_is_an_error_not_success() {
    let root = tempfile::tempdir().unwrap();
    let error = delete_entry(root.path(), "missing").unwrap_err();
    assert_eq!(error.removed_entries, 0);
    assert!(matches!(error.cause, RepoFilesError::PathMissing(_)));
}

#[cfg(windows)]
#[test]
fn locked_file_failure_keeps_the_file_and_preserves_the_io_error() {
    use std::os::windows::fs::OpenOptionsExt;

    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("locked");
    fs::write(&file, "must survive").unwrap();
    let handle = fs::OpenOptions::new().read(true).share_mode(1).open(&file).unwrap();
    let error = delete_entry(root.path(), "locked").unwrap_err();
    assert_eq!(error.removed_entries, 0);
    assert!(
        matches!(error.cause, RepoFilesError::Io(ref cause) if cause.raw_os_error() == Some(32)),
        "{error:?}"
    );
    assert_eq!(fs::read_to_string(&file).unwrap(), "must survive");
    drop(handle);
    assert_eq!(delete_entry(root.path(), "locked").unwrap(), 1);
}

#[cfg(any(unix, windows))]
mod links {
    use super::*;

    fn directory_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(target, link).unwrap();
    }

    fn file_link(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(target, link).unwrap();
    }

    #[test]
    fn unlinks_file_directory_and_dangling_symlinks_without_following_targets() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), ".git/HEAD", "protected outside");
        write(outside.path(), "file", "outside");
        directory_link(outside.path(), &root.path().join("directory-link"));
        file_link(&outside.path().join("file"), &root.path().join("file-link"));
        file_link(&outside.path().join("missing"), &root.path().join("dangling"));
        for name in ["directory-link", "file-link", "dangling"] {
            assert_eq!(delete_entry(root.path(), name).unwrap(), 1);
            assert!(fs::symlink_metadata(root.path().join(name)).is_err());
        }
        assert_eq!(fs::read_to_string(outside.path().join("file")).unwrap(), "outside");
        assert_eq!(
            fs::read_to_string(outside.path().join(".git/HEAD")).unwrap(),
            "protected outside"
        );
    }

    #[test]
    fn folder_deletion_unlinks_descendant_links_without_following_them() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), ".git/HEAD", "protected");
        fs::create_dir(root.path().join("folder")).unwrap();
        directory_link(outside.path(), &root.path().join("folder/link"));
        assert_eq!(delete_entry(root.path(), "folder").unwrap(), 2);
        assert_eq!(fs::read_to_string(outside.path().join(".git/HEAD")).unwrap(), "protected");
    }

    #[test]
    fn symlinked_ancestors_are_rejected_inside_and_outside_the_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        write(outside.path(), "file", "outside");
        write(root.path(), "real/file", "inside");
        directory_link(outside.path(), &root.path().join("outside-link"));
        directory_link(&root.path().join("real"), &root.path().join("inside-link"));
        for name in ["outside-link/file", "inside-link/file"] {
            let error = delete_entry(root.path(), name).unwrap_err();
            assert_eq!(error.removed_entries, 0);
            assert!(error.to_string().contains("symlinked ancestor"));
        }
        assert_eq!(fs::read_to_string(outside.path().join("file")).unwrap(), "outside");
        assert_eq!(fs::read_to_string(root.path().join("real/file")).unwrap(), "inside");
    }

    #[test]
    fn a_symlinked_registered_root_can_delete_its_own_entries() {
        let parent = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let link = parent.path().join("root-link");
        write(root.path(), "file", "content");
        directory_link(root.path(), &link);
        assert_eq!(delete_entry(&link, "file").unwrap(), 1);
        assert!(!root.path().join("file").exists());
        assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
    }
}
