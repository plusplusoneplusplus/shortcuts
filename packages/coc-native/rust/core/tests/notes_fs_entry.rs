//! Parity tests for `notes_fs::entry` — create, rename, delete, and order
//! persistence.
//!
//! The behaviours pinned here are the ones the HTTP contract depends on:
//! `.md` auto-append, system-folder protection, the case-alias rename rule,
//! sidecar carry-along, `.order.json` upkeep, and every status code.

use std::fs;
use std::path::Path;

use coc_native_core::notes_fs::{
    create_entry, delete_entry, rename_entry, write_order, CreateKind, EntryKind, EntryOptions,
};

mod support {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch directory removed on drop. Canonicalized, because macOS hands
    /// out `/var/...` for a `/private/var/...` temp dir and the containment
    /// checks would then compare two spellings of the same place.
    pub struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        pub fn new(label: &str) -> Self {
            let id = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("notes-fs-entry-{label}-{}-{id}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self { path: std::fs::canonicalize(&path).expect("canonicalize temp dir") }
        }

        pub fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

use support::TempDir;

const SYSTEM_FOLDERS: &[&str] = &["Plans"];

fn system_folder_names() -> Vec<String> {
    SYSTEM_FOLDERS.iter().map(|name| name.to_string()).collect()
}

fn selected_root() -> EntryOptions<'static> {
    EntryOptions { is_default_root: false, system_folder_names: &[] }
}

fn default_root(names: &[String]) -> EntryOptions<'_> {
    EntryOptions { is_default_root: true, system_folder_names: names }
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent");
    }
    fs::write(path, contents).expect("write file");
}

fn read_order(dir: &Path) -> Vec<String> {
    let raw = fs::read_to_string(dir.join(".order.json")).expect("read order file");
    let value: serde_json::Value = serde_json::from_str(&raw).expect("parse order file");
    value["order"]
        .as_array()
        .expect("order array")
        .iter()
        .map(|entry| entry.as_str().expect("string entry").to_string())
        .collect()
}

fn write_order_file(dir: &Path, order: &[&str]) {
    let names: Vec<String> = order.iter().map(|name| name.to_string()).collect();
    fs::write(
        dir.join(".order.json"),
        serde_json::to_string_pretty(&serde_json::json!({ "order": names })).unwrap(),
    )
    .expect("seed order file");
}

// ── Create ───────────────────────────────────────────────────────────────────

#[test]
fn create_page_appends_the_markdown_extension() {
    let temp = TempDir::new("create-page");
    let root = temp.path();

    let created =
        create_entry(root, "notes/Ideas", CreateKind::Page, selected_root()).expect("create page");

    assert_eq!(created.path, "notes/Ideas.md");
    assert_eq!(created.kind, CreateKind::Page);
    assert_eq!(fs::read_to_string(root.join("notes").join("Ideas.md")).unwrap(), "");
}

#[test]
fn create_page_keeps_an_existing_markdown_extension() {
    let temp = TempDir::new("create-page-md");
    let created = create_entry(temp.path(), "Ideas.md", CreateKind::Page, selected_root())
        .expect("create page");
    assert_eq!(created.path, "Ideas.md");
}

#[test]
fn create_notebook_and_section_make_directories_without_an_extension() {
    let temp = TempDir::new("create-dirs");
    let root = temp.path();

    let notebook =
        create_entry(root, "Work", CreateKind::Notebook, selected_root()).expect("create notebook");
    let section = create_entry(root, "Work/Q3", CreateKind::Section, selected_root())
        .expect("create section");

    assert_eq!(notebook.path, "Work");
    assert_eq!(section.path, "Work/Q3");
    assert!(root.join("Work").join("Q3").is_dir());
}

#[test]
fn create_builds_a_missing_notes_root_first() {
    let temp = TempDir::new("create-missing-root");
    let root = temp.path().join("collection");

    create_entry(&root, "Ideas", CreateKind::Page, selected_root()).expect("create page");

    assert!(root.join("Ideas.md").is_file());
}

#[test]
fn create_rejects_a_traversing_path_on_a_selected_root() {
    let temp = TempDir::new("create-traversal");
    let error = create_entry(temp.path(), "../escape", CreateKind::Page, selected_root())
        .expect_err("must refuse");
    assert_eq!(error.status_code(), 403);
    assert_eq!(error.message(), "Access denied: parent directory references are not allowed");
}

#[test]
fn create_rejects_an_escaping_path_on_the_default_root() {
    let temp = TempDir::new("create-default-escape");
    let root = temp.path().join("notes");
    let names = system_folder_names();

    let error = create_entry(&root, "../outside/Note", CreateKind::Page, default_root(&names))
        .expect_err("must refuse");

    assert_eq!(error.status_code(), 403);
    assert_eq!(error.message(), "Access denied: path is outside notes directory");
}

#[test]
fn create_allows_a_dot_dot_path_that_lands_back_inside_the_default_root() {
    let temp = TempDir::new("create-default-reentry");
    let root = temp.path();
    let names = system_folder_names();

    let created = create_entry(root, "a/../b/Note", CreateKind::Page, default_root(&names))
        .expect("create page");

    assert_eq!(created.path, "a/../b/Note.md");
    assert!(root.join("b").join("Note.md").is_file());
}

// ── Rename ───────────────────────────────────────────────────────────────────

#[test]
fn rename_moves_a_page_and_appends_the_extension_to_the_destination() {
    let temp = TempDir::new("rename-page");
    let root = temp.path();
    write_file(&root.join("Ideas.md"), "body");

    let outcome = rename_entry(root, "Ideas.md", "Archive/Old", selected_root()).expect("rename");

    assert_eq!(outcome.effective_new_path, "Archive/Old.md");
    assert_eq!(outcome.kind, Some(EntryKind::File));
    assert_eq!(outcome.old_rel, "Ideas.md");
    assert_eq!(outcome.new_rel, "Archive/Old.md");
    assert_eq!(fs::read_to_string(root.join("Archive").join("Old.md")).unwrap(), "body");
    assert!(!root.join("Ideas.md").exists());
}

#[test]
fn rename_leaves_a_directory_name_untouched() {
    let temp = TempDir::new("rename-dir");
    let root = temp.path();
    fs::create_dir_all(root.join("Work")).unwrap();

    let outcome = rename_entry(root, "Work", "Personal", selected_root()).expect("rename");

    assert_eq!(outcome.effective_new_path, "Personal");
    assert_eq!(outcome.kind, Some(EntryKind::Dir));
    assert!(root.join("Personal").is_dir());
}

#[test]
fn rename_carries_the_comments_sidecar_along() {
    let temp = TempDir::new("rename-sidecar");
    let root = temp.path();
    write_file(&root.join("Ideas.md"), "body");
    write_file(&root.join("Ideas.md.comments.json"), "[]");

    rename_entry(root, "Ideas.md", "Renamed.md", selected_root()).expect("rename");

    assert!(!root.join("Ideas.md.comments.json").exists());
    assert_eq!(fs::read_to_string(root.join("Renamed.md.comments.json")).unwrap(), "[]");
}

#[test]
fn rename_without_a_sidecar_still_succeeds() {
    let temp = TempDir::new("rename-no-sidecar");
    let root = temp.path();
    write_file(&root.join("Ideas.md"), "body");

    rename_entry(root, "Ideas.md", "Renamed.md", selected_root()).expect("rename");

    assert!(root.join("Renamed.md").is_file());
}

#[test]
fn rename_within_a_directory_rewrites_the_order_entry_in_place() {
    let temp = TempDir::new("rename-order-same-parent");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("b.md"), "b");
    write_order_file(root, &["b.md", "a.md"]);

    rename_entry(root, "a.md", "z.md", selected_root()).expect("rename");

    assert_eq!(read_order(root), vec!["b.md".to_string(), "z.md".to_string()]);
}

#[test]
fn rename_across_directories_drops_the_entry_from_the_old_order() {
    let temp = TempDir::new("rename-order-cross-parent");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("b.md"), "b");
    fs::create_dir_all(root.join("sub")).unwrap();
    write_order_file(root, &["b.md", "a.md"]);

    rename_entry(root, "a.md", "sub/a.md", selected_root()).expect("rename");

    assert_eq!(read_order(root), vec!["b.md".to_string()]);
    assert!(!root.join("sub").join(".order.json").exists());
}

#[test]
fn rename_never_creates_an_order_file_that_did_not_exist() {
    let temp = TempDir::new("rename-order-absent");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");

    rename_entry(root, "a.md", "z.md", selected_root()).expect("rename");

    assert!(!root.join(".order.json").exists());
}

#[test]
fn rename_reports_a_missing_source_as_not_found() {
    let temp = TempDir::new("rename-missing");
    let error =
        rename_entry(temp.path(), "Nope.md", "Other.md", selected_root()).expect_err("must fail");
    assert_eq!(error.status_code(), 404);
    assert_eq!(error.message(), "Source path not found");
}

#[test]
fn rename_onto_a_different_existing_entry_is_a_conflict() {
    let temp = TempDir::new("rename-conflict");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("b.md"), "b");

    let error = rename_entry(root, "a.md", "b.md", selected_root()).expect_err("must fail");

    assert_eq!(error.status_code(), 409);
    assert_eq!(error.message(), "Destination path already exists");
    assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "a");
    assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "b");
}

#[test]
fn rename_onto_itself_is_a_conflict() {
    let temp = TempDir::new("rename-self");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");

    let error = rename_entry(root, "a.md", "a.md", selected_root()).expect_err("must fail");

    assert_eq!(error.status_code(), 409);
    assert_eq!(error.message(), "Destination path already exists");
}

/// A case-only rename must go through. On a case-sensitive filesystem the
/// destination simply does not exist; on a case-insensitive one it appears to,
/// and the alias check is what lets it past.
#[test]
fn rename_permits_a_case_only_alias_of_the_same_entry() {
    let temp = TempDir::new("rename-case-alias");
    let root = temp.path();
    write_file(&root.join("ideas.md"), "body");

    let outcome = rename_entry(root, "ideas.md", "Ideas.md", selected_root())
        .expect("case-only rename must be allowed");

    assert_eq!(outcome.effective_new_path, "Ideas.md");
    let names: Vec<String> = fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["Ideas.md".to_string()]);
}

/// The alias branch itself, reachable on a case-sensitive filesystem: the
/// destination exists, but it is a link onto the source, so the two realpaths
/// agree and the rename replaces the link.
#[cfg(unix)]
#[test]
fn rename_permits_a_destination_that_resolves_to_the_source() {
    let temp = TempDir::new("rename-alias-symlink");
    let root = temp.path();
    write_file(&root.join("a.md"), "body");
    std::os::unix::fs::symlink(root.join("a.md"), root.join("b.md")).unwrap();

    rename_entry(root, "a.md", "b.md", selected_root()).expect("alias rename must be allowed");

    assert!(!root.join("a.md").exists());
    assert_eq!(fs::read_to_string(root.join("b.md")).unwrap(), "body");
    assert!(!fs::symlink_metadata(root.join("b.md")).unwrap().file_type().is_symlink());
}

/// Same inode, different name: a hard link is a separate entry in the
/// collection, so overwriting it is still a conflict. This is what keeps the
/// device/inode fallback from waving through unrelated renames.
#[cfg(unix)]
#[test]
fn rename_onto_a_hard_link_of_the_source_is_still_a_conflict() {
    let temp = TempDir::new("rename-hardlink");
    let root = temp.path();
    write_file(&root.join("a.md"), "body");
    fs::hard_link(root.join("a.md"), root.join("b.md")).unwrap();

    let error = rename_entry(root, "a.md", "b.md", selected_root()).expect_err("must fail");

    assert_eq!(error.status_code(), 409);
    assert_eq!(error.message(), "Destination path already exists");
    assert!(root.join("a.md").is_file());
}

#[test]
fn rename_refuses_a_system_folder_on_the_default_root() {
    let temp = TempDir::new("rename-system");
    let root = temp.path();
    fs::create_dir_all(root.join("Plans")).unwrap();
    let names = system_folder_names();

    let error = rename_entry(root, "Plans", "Schemes", default_root(&names)).expect_err("refuse");

    assert_eq!(error.status_code(), 403);
    assert_eq!(error.message(), "Cannot rename a system folder");
    assert!(root.join("Plans").is_dir());
}

/// System-folder protection is a property of the managed default root only. A
/// user's own collection may hold a folder called `Plans` and must stay editable.
#[test]
fn rename_allows_a_system_folder_name_on_a_selected_root() {
    let temp = TempDir::new("rename-system-selected");
    let root = temp.path();
    fs::create_dir_all(root.join("Plans")).unwrap();

    rename_entry(root, "Plans", "Schemes", selected_root()).expect("rename");

    assert!(root.join("Schemes").is_dir());
}

#[test]
fn rename_rejects_a_traversing_destination_on_a_selected_root() {
    let temp = TempDir::new("rename-traversal");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");

    let error = rename_entry(root, "a.md", "../escape.md", selected_root()).expect_err("refuse");

    assert_eq!(error.status_code(), 403);
    assert_eq!(error.message(), "Access denied: parent directory references are not allowed");
    assert!(root.join("a.md").is_file());
}

// ── Delete ───────────────────────────────────────────────────────────────────

#[test]
fn delete_removes_a_page_and_its_sidecar() {
    let temp = TempDir::new("delete-page");
    let root = temp.path();
    write_file(&root.join("Ideas.md"), "body");
    write_file(&root.join("Ideas.md.comments.json"), "[]");

    let outcome = delete_entry(root, "Ideas.md", selected_root()).expect("delete");

    assert_eq!(outcome.kind, EntryKind::File);
    assert_eq!(outcome.rel, "Ideas.md");
    assert!(!root.join("Ideas.md").exists());
    assert!(!root.join("Ideas.md.comments.json").exists());
}

#[test]
fn delete_removes_a_directory_recursively() {
    let temp = TempDir::new("delete-dir");
    let root = temp.path();
    write_file(&root.join("Work").join("deep").join("a.md"), "a");

    let outcome = delete_entry(root, "Work", selected_root()).expect("delete");

    assert_eq!(outcome.kind, EntryKind::Dir);
    assert_eq!(outcome.rel, "Work");
    assert!(!root.join("Work").exists());
}

#[test]
fn delete_drops_the_entry_from_the_parent_order() {
    let temp = TempDir::new("delete-order");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");
    write_file(&root.join("b.md"), "b");
    write_order_file(root, &["a.md", "b.md"]);

    delete_entry(root, "a.md", selected_root()).expect("delete");

    assert_eq!(read_order(root), vec!["b.md".to_string()]);
}

#[test]
fn delete_reports_a_missing_path_as_not_found() {
    let temp = TempDir::new("delete-missing");
    let error = delete_entry(temp.path(), "Nope.md", selected_root()).expect_err("must fail");
    assert_eq!(error.status_code(), 404);
    assert_eq!(error.message(), "Path not found");
}

#[test]
fn delete_refuses_a_system_folder_on_the_default_root() {
    let temp = TempDir::new("delete-system");
    let root = temp.path();
    fs::create_dir_all(root.join("Plans")).unwrap();
    let names = system_folder_names();

    let error = delete_entry(root, "Plans", default_root(&names)).expect_err("refuse");

    assert_eq!(error.status_code(), 403);
    assert_eq!(error.message(), "Cannot delete a system folder");
    assert!(root.join("Plans").is_dir());
}

/// The guard is anchored at the root, not at the name: a nested `Plans` is an
/// ordinary folder.
#[test]
fn delete_allows_a_nested_folder_that_shares_a_system_name() {
    let temp = TempDir::new("delete-nested-system");
    let root = temp.path();
    fs::create_dir_all(root.join("Work").join("Plans")).unwrap();
    let names = system_folder_names();

    delete_entry(root, "Work/Plans", default_root(&names)).expect("delete");

    assert!(!root.join("Work").join("Plans").exists());
}

// ── Order ────────────────────────────────────────────────────────────────────

#[test]
fn write_order_persists_the_list_for_a_subdirectory() {
    let temp = TempDir::new("order-sub");
    let root = temp.path();
    fs::create_dir_all(root.join("Work")).unwrap();

    write_order(root, "Work", &["b.md".to_string(), "a.md".to_string()], selected_root())
        .expect("write order");

    assert_eq!(read_order(&root.join("Work")), vec!["b.md".to_string(), "a.md".to_string()]);
}

#[test]
fn write_order_accepts_the_empty_parent_path_as_the_root() {
    let temp = TempDir::new("order-root");
    let root = temp.path();

    write_order(root, "", &["a.md".to_string()], selected_root()).expect("write order");

    assert_eq!(read_order(root), vec!["a.md".to_string()]);
}

#[test]
fn write_order_accepts_the_empty_parent_path_on_the_default_root() {
    let temp = TempDir::new("order-root-default");
    let root = temp.path();
    let names = system_folder_names();

    write_order(root, "", &["a.md".to_string()], default_root(&names)).expect("write order");

    assert_eq!(read_order(root), vec!["a.md".to_string()]);
}

#[test]
fn write_order_reports_a_missing_directory_as_not_found() {
    let temp = TempDir::new("order-missing");
    let error = write_order(temp.path(), "Nope", &[], selected_root()).expect_err("must fail");
    assert_eq!(error.status_code(), 404);
    assert_eq!(error.message(), "parentPath directory not found");
}

#[test]
fn write_order_rejects_a_file_as_the_parent() {
    let temp = TempDir::new("order-file");
    let root = temp.path();
    write_file(&root.join("a.md"), "a");

    let error = write_order(root, "a.md", &[], selected_root()).expect_err("must fail");

    assert_eq!(error.status_code(), 400);
    assert_eq!(error.message(), "parentPath must be a directory");
}

#[test]
fn write_order_rejects_an_escaping_parent_on_the_default_root() {
    let temp = TempDir::new("order-escape");
    let root = temp.path().join("notes");
    fs::create_dir_all(&root).unwrap();
    let names = system_folder_names();

    let error = write_order(&root, "../outside", &[], default_root(&names)).expect_err("refuse");

    assert_eq!(error.status_code(), 403);
    assert_eq!(error.message(), "Access denied: parentPath is outside notes directory");
}

#[test]
fn write_order_writes_the_same_bytes_the_typescript_did() {
    let temp = TempDir::new("order-bytes");
    let root = temp.path();

    write_order(root, "", &["a.md".to_string(), "b.md".to_string()], selected_root())
        .expect("write order");

    assert_eq!(
        fs::read_to_string(root.join(".order.json")).unwrap(),
        "{\n  \"order\": [\n    \"a.md\",\n    \"b.md\"\n  ]\n}"
    );
}

// ── Symlink escapes ──────────────────────────────────────────────────────────

/// A selected root must not follow a symlink out of the collection, for any of
/// the three mutations.
#[cfg(unix)]
#[test]
fn mutations_refuse_a_path_that_escapes_through_a_symlink() {
    let temp = TempDir::new("symlink-escape");
    let root = temp.path().join("collection");
    let outside = temp.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.md"), "secret").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();

    for error in [
        create_entry(&root, "link/new", CreateKind::Page, selected_root()).unwrap_err(),
        rename_entry(&root, "link/secret.md", "moved.md", selected_root()).unwrap_err(),
        delete_entry(&root, "link/secret.md", selected_root()).unwrap_err(),
    ] {
        assert_eq!(error.status_code(), 403);
        assert_eq!(
            error.message(),
            "Access denied: path escapes the selected Notes collection through a symbolic link"
        );
    }
    assert!(outside.join("secret.md").is_file());
}
