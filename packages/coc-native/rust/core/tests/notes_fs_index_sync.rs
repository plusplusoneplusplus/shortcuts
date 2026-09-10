//! Write-through tests: a mutation through `notes_fs` must be visible to a
//! search against the live index immediately, without the filesystem watcher.
//!
//! The proof in every test is a `search()` against an index that was built
//! *before* the mutation. If the write-through were missing, the snapshot
//! would still hold the pre-write state and these would fail.

use std::path::{Path, PathBuf};

use coc_native_core::notes_fs::{
    create_entry, delete_entry, rename_entry, write_note, ContentOptions, CreateKind, EntryOptions,
};
use coc_native_core::notes_index::registry::{
    apply_changes, live_indexes, NotesIndexChanges, WriteThroughOutcome,
};
use coc_native_core::notes_index::{NotesIndex, NotesIndexOptions};

mod support {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch directory removed on drop. Canonicalized, because macOS hands
    /// out `/var/...` for a `/private/var/...` temp dir and the registry key
    /// would then hold two spellings of the same place.
    pub struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        pub fn new(label: &str) -> Self {
            let id = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("notes-fs-index-{label}-{}-{id}", std::process::id()));
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

fn selected_entry() -> EntryOptions<'static> {
    EntryOptions { is_default_root: false, system_folder_names: &[] }
}

fn selected_content() -> ContentOptions<'static> {
    ContentOptions { is_default_root: false, allowed_prefixes: &[] }
}

fn build_index(root: &Path) -> NotesIndex {
    NotesIndex::build(root.to_path_buf(), NotesIndexOptions::default()).expect("build index")
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(path, contents).expect("write file");
}

/// Root-relative paths the index currently returns for a query.
fn matching_paths(index: &NotesIndex, query: &str) -> Vec<String> {
    index.search(query).results.into_iter().map(|result| result.path).collect()
}

#[test]
fn autosave_is_searchable_without_waiting_for_the_watcher() {
    let temp = TempDir::new("autosave");
    write_file(&temp.path().join("existing.md"), "old text\n");
    let index = build_index(temp.path());
    assert!(matching_paths(&index, "kingfisher").is_empty());

    write_note(temp.path(), "existing.md", "a kingfisher landed\n", None, selected_content())
        .expect("write note");

    assert_eq!(matching_paths(&index, "kingfisher"), vec!["existing.md".to_string()]);
}

#[test]
fn a_created_page_is_searchable_by_its_name() {
    let temp = TempDir::new("create");
    let index = build_index(temp.path());

    create_entry(temp.path(), "Nested/Osprey", CreateKind::Page, selected_entry())
        .expect("create page");

    assert_eq!(matching_paths(&index, "osprey"), vec!["Nested/Osprey.md".to_string()]);
}

#[test]
fn a_created_notebook_alone_changes_nothing() {
    let temp = TempDir::new("create-notebook");
    let index = build_index(temp.path());

    create_entry(temp.path(), "Empty", CreateKind::Notebook, selected_entry())
        .expect("create notebook");

    assert_eq!(index.document_count(), 0);
}

#[test]
fn a_deleted_page_leaves_the_index() {
    let temp = TempDir::new("delete");
    write_file(&temp.path().join("gone.md"), "heron\n");
    let index = build_index(temp.path());
    assert_eq!(matching_paths(&index, "heron"), vec!["gone.md".to_string()]);

    delete_entry(temp.path(), "gone.md", selected_entry()).expect("delete page");

    assert!(matching_paths(&index, "heron").is_empty());
}

#[test]
fn a_renamed_page_moves_in_one_snapshot_swap() {
    let temp = TempDir::new("rename-file");
    write_file(&temp.path().join("before.md"), "swallow\n");
    let index = build_index(temp.path());

    rename_entry(temp.path(), "before.md", "Nested/after.md", selected_entry())
        .expect("rename page");

    // The old path is gone and the new one is present in the same result set:
    // no window where the note is findable twice.
    assert_eq!(matching_paths(&index, "swallow"), vec!["Nested/after.md".to_string()]);
}

#[test]
fn a_renamed_directory_moves_every_page_below_it() {
    let temp = TempDir::new("rename-dir");
    write_file(&temp.path().join("Notebook/one.md"), "curlew\n");
    write_file(&temp.path().join("Notebook/Deep/two.md"), "curlew\n");
    let index = build_index(temp.path());
    assert_eq!(matching_paths(&index, "curlew").len(), 2);

    rename_entry(temp.path(), "Notebook", "Renamed", selected_entry()).expect("rename directory");

    assert_eq!(
        matching_paths(&index, "curlew"),
        vec!["Renamed/Deep/two.md".to_string(), "Renamed/one.md".to_string()]
    );
}

#[test]
fn a_deleted_directory_drops_every_page_below_it() {
    let temp = TempDir::new("delete-dir");
    write_file(&temp.path().join("Notebook/one.md"), "godwit\n");
    write_file(&temp.path().join("Notebook/Deep/two.md"), "godwit\n");
    write_file(&temp.path().join("kept.md"), "godwit\n");
    let index = build_index(temp.path());

    delete_entry(temp.path(), "Notebook", selected_entry()).expect("delete directory");

    assert_eq!(matching_paths(&index, "godwit"), vec!["kept.md".to_string()]);
}

#[test]
fn a_write_against_a_root_with_no_index_is_a_no_op() {
    let temp = TempDir::new("no-index");

    // No index was ever built for this root: the write must still succeed, and
    // the registry must simply report that there was nothing to update.
    write_note(temp.path(), "solo.md", "text\n", None, selected_content()).expect("write note");
    assert_eq!(
        apply_changes(temp.path(), &NotesIndexChanges::file("solo.md")),
        WriteThroughOutcome::NoIndex
    );
}

#[test]
fn dropping_the_last_handle_unregisters_the_root() {
    let temp = TempDir::new("drop");
    {
        let index = build_index(temp.path());
        assert_eq!(live_indexes(temp.path()).len(), 1);
        drop(index);
    }
    assert!(live_indexes(temp.path()).is_empty());
}

#[test]
fn every_live_index_for_a_root_is_updated() {
    let temp = TempDir::new("two-handles");
    let first = build_index(temp.path());
    let second = build_index(temp.path());

    create_entry(temp.path(), "Shared", CreateKind::Page, selected_entry()).expect("create page");

    assert_eq!(matching_paths(&first, "shared"), vec!["Shared.md".to_string()]);
    assert_eq!(matching_paths(&second, "shared"), vec!["Shared.md".to_string()]);
}

#[test]
fn a_repeated_change_is_idempotent() {
    let temp = TempDir::new("idempotent");
    let index = build_index(temp.path());
    create_entry(temp.path(), "Twice", CreateKind::Page, selected_entry()).expect("create page");

    // The watcher fires for the same path right after the write-through did.
    // The second application must not duplicate the document.
    assert_eq!(
        apply_changes(temp.path(), &NotesIndexChanges::file("Twice.md")),
        WriteThroughOutcome::Incremental
    );
    assert_eq!(matching_paths(&index, "twice"), vec!["Twice.md".to_string()]);
    assert_eq!(index.document_count(), 1);
}

#[test]
fn a_directory_change_with_no_markdown_is_still_incremental() {
    let temp = TempDir::new("empty-dir");
    std::fs::create_dir_all(temp.path().join("Empty/Deeper")).expect("create dirs");
    let index = build_index(temp.path());

    assert_eq!(
        apply_changes(temp.path(), &NotesIndexChanges::directory("Empty")),
        WriteThroughOutcome::Incremental
    );
    assert_eq!(index.document_count(), 0);
}

#[test]
fn an_oversized_directory_change_falls_back_to_a_full_refresh() {
    let temp = TempDir::new("oversized");
    let notebook = temp.path().join("Huge");
    std::fs::create_dir_all(&notebook).expect("create notebook");
    // One past the incremental batch limit, so the directory cannot be
    // expressed as a batch of changed paths.
    for index in 0..=coc_native_core::notes_index::MAX_CHANGED_PATHS {
        std::fs::write(notebook.join(format!("page-{index}.md")), "dunlin\n").expect("write page");
    }
    let index = build_index(temp.path());
    assert_eq!(index.document_count(), coc_native_core::notes_index::MAX_CHANGED_PATHS + 1);

    delete_entry(temp.path(), "Huge", selected_entry()).expect("delete notebook");

    // The rebuild is the fallback, not a silent skip: the pages are gone.
    assert_eq!(index.document_count(), 0);
}

#[test]
fn a_path_outside_the_root_is_not_indexed() {
    let temp = TempDir::new("outside");
    let root = temp.path().join("notes");
    std::fs::create_dir_all(&root).expect("create root");
    let index = build_index(&root);

    // The default root's absolute-path escape hatch resolves to a file outside
    // the notes tree; it was never in the index and must not enter it now. The
    // escaping path is dropped, leaving nothing to apply — and crucially, no
    // full refresh either.
    assert_eq!(
        apply_changes(&root, &NotesIndexChanges::file("../elsewhere.md")),
        WriteThroughOutcome::Incremental
    );
    assert_eq!(index.document_count(), 0);
}

#[test]
fn a_root_spelled_through_a_symlink_shares_its_index() {
    let temp = TempDir::new("symlink-root");
    let real_root = temp.path().join("real");
    std::fs::create_dir_all(&real_root).expect("create real root");
    let link_root = temp.path().join("link");
    if !create_directory_symlink(&real_root, &link_root) {
        return;
    }

    // Node resolved the root through the link; the write arrives with the real
    // path. Canonicalization is what makes them the same index.
    let index = build_index(&link_root);
    create_entry(&real_root, "Linked", CreateKind::Page, selected_entry()).expect("create page");

    assert_eq!(matching_paths(&index, "linked"), vec!["Linked.md".to_string()]);
}

/// Returns false when the platform refuses to create the link — Windows needs
/// Developer Mode or an elevated process for that, and the test is skipped.
fn create_directory_symlink(target: &Path, link: &PathBuf) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, link).is_ok()
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (target, link);
        false
    }
}
