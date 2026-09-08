//! The recursive tree scan and the ISO timestamps it carries.
//!
//! These cover what `buildTree` in `notes-read-handler.ts` did, minus sorting:
//! the entries come back in raw `readdir` order, so every assertion here that
//! cares about a set of names sorts first. What the scan *does* decide — which
//! entries survive the filter, notebook vs. section, symlink handling per root
//! regime, and which `.order.json` is honoured — is asserted directly.

use std::fs;
use std::path::Path;

use coc_native_core::notes_fs::timestamp::{format_iso_instant, unix_millis};
use coc_native_core::notes_fs::tree::{
    scan_notes_tree, NotesTree, TreeEntry, TreeEntryKind, TreeOptions,
};

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("temp dir")
}

fn default_root() -> TreeOptions {
    TreeOptions { is_default_root: true }
}

fn selected_root() -> TreeOptions {
    TreeOptions { is_default_root: false }
}

fn write(root: &Path, relative: &str, contents: &str) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, contents).unwrap();
}

fn write_order(dir: &Path, names: &[&str]) {
    let list = names.iter().map(|n| format!("    \"{n}\"")).collect::<Vec<_>>().join(",\n");
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join(".order.json"), format!("{{\n  \"order\": [\n{list}\n  ]\n}}")).unwrap();
}

/// Names in a stable order, so the readdir order (which is filesystem-defined)
/// never decides whether a test passes.
fn sorted_names(entries: &[TreeEntry]) -> Vec<String> {
    let mut names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    names.sort();
    names
}

fn find<'a>(entries: &'a [TreeEntry], name: &str) -> &'a TreeEntry {
    entries.iter().find(|e| e.name == name).unwrap_or_else(|| panic!("no entry named {name}"))
}

#[cfg(unix)]
fn symlink(original: &Path, link: &Path) {
    std::os::unix::fs::symlink(original, link).unwrap();
}

#[cfg(windows)]
fn symlink(original: &Path, link: &Path) {
    if original.is_dir() {
        std::os::windows::fs::symlink_dir(original, link).unwrap();
    } else {
        std::os::windows::fs::symlink_file(original, link).unwrap();
    }
}

/// Windows refuses to create symlinks without Developer Mode or elevation.
fn can_symlink(dir: &Path) -> bool {
    let target = dir.join("__probe_target");
    fs::write(&target, "x").unwrap();
    let link = dir.join("__probe_link");
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(&target, &link).is_ok();
    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_file(&target, &link).is_ok();
    if created {
        let _ = fs::remove_file(&link);
    }
    let _ = fs::remove_file(&target);
    created
}

// ── Filtering ────────────────────────────────────────────────────────────────

#[test]
fn keeps_markdown_files_and_visible_directories_only() {
    let dir = temp_dir();
    let root = dir.path();
    write(root, "note.md", "hi");
    write(root, "notes.txt", "hi");
    write(root, "README", "hi");
    fs::create_dir_all(root.join("Plans")).unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();

    let tree = scan_notes_tree(root, default_root()).unwrap();
    assert_eq!(sorted_names(&tree.entries), vec!["Plans", "note.md"]);
}

#[test]
fn the_markdown_suffix_check_is_case_sensitive_like_the_typescript() {
    let dir = temp_dir();
    write(dir.path(), "Shout.MD", "hi");
    write(dir.path(), "quiet.md", "hi");

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert_eq!(sorted_names(&tree.entries), vec!["quiet.md"]);
}

#[test]
fn a_hidden_markdown_file_is_still_a_page() {
    // Only directories are filtered on the leading dot; `.secret.md` matched
    // the file branch in the TypeScript and still does here.
    let dir = temp_dir();
    write(dir.path(), ".secret.md", "hi");

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert_eq!(sorted_names(&tree.entries), vec![".secret.md"]);
}

#[test]
fn an_unreadable_or_missing_directory_scans_as_empty() {
    let dir = temp_dir();
    let tree = scan_notes_tree(&dir.path().join("nope"), default_root()).unwrap();
    assert_eq!(tree, NotesTree::default());
}

// ── Shape ────────────────────────────────────────────────────────────────────

#[test]
fn top_level_directories_are_notebooks_and_nested_ones_are_sections() {
    let dir = temp_dir();
    let root = dir.path();
    write(root, "Work/Q1/plan.md", "hi");

    let tree = scan_notes_tree(root, default_root()).unwrap();
    let work = find(&tree.entries, "Work");
    assert_eq!(work.kind, TreeEntryKind::Notebook);
    assert_eq!(work.path, "Work");

    let children = work.children.as_ref().unwrap();
    let quarter = find(children, "Q1");
    assert_eq!(quarter.kind, TreeEntryKind::Section);
    assert_eq!(quarter.path, "Work/Q1");

    let page = find(quarter.children.as_ref().unwrap(), "plan.md");
    assert_eq!(page.kind, TreeEntryKind::Page);
    assert_eq!(page.path, "Work/Q1/plan.md");
}

#[test]
fn nested_paths_use_forward_slashes_on_every_platform() {
    let dir = temp_dir();
    write(dir.path(), "a/b/c.md", "hi");

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    let deep = &tree.entries[0].children.as_ref().unwrap()[0].children.as_ref().unwrap()[0];
    assert_eq!(deep.path, "a/b/c.md");
}

#[test]
fn only_pages_carry_a_timestamp_and_only_directories_carry_children() {
    let dir = temp_dir();
    write(dir.path(), "Work/plan.md", "hi");

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    let work = find(&tree.entries, "Work");
    assert!(work.last_modified_at.is_none());
    assert!(work.children.is_some());
    assert!(work.explicit_order.is_some());

    let page = find(work.children.as_ref().unwrap(), "plan.md");
    assert!(page.last_modified_at.is_some());
    assert!(page.children.is_none());
    assert!(page.explicit_order.is_none());
}

#[test]
fn a_pages_timestamp_matches_its_own_modification_time() {
    let dir = temp_dir();
    write(dir.path(), "plan.md", "hi");
    let expected = format_iso_instant(unix_millis(
        fs::metadata(dir.path().join("plan.md")).unwrap().modified().unwrap(),
    ));

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert_eq!(tree.entries[0].last_modified_at.as_deref(), Some(expected.as_str()));
}

#[test]
fn an_empty_directory_reports_an_empty_child_list_not_a_missing_one() {
    let dir = temp_dir();
    fs::create_dir_all(dir.path().join("Empty")).unwrap();

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert_eq!(find(&tree.entries, "Empty").children.as_deref(), Some(&[][..]));
}

// ── Explicit order pass-through ──────────────────────────────────────────────

#[test]
fn returns_the_roots_own_order_file_alongside_its_entries() {
    let dir = temp_dir();
    write(dir.path(), "a.md", "hi");
    write(dir.path(), "b.md", "hi");
    write_order(dir.path(), &["b.md", "a.md"]);

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert_eq!(tree.explicit_order, vec!["b.md".to_string(), "a.md".to_string()]);
    // The scan does not sort: ordering is Node's job.
    assert_eq!(sorted_names(&tree.entries), vec!["a.md", "b.md"]);
}

#[test]
fn returns_each_subdirectorys_order_file() {
    let dir = temp_dir();
    write(dir.path(), "Work/a.md", "hi");
    write_order(&dir.path().join("Work"), &["a.md"]);

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert!(tree.explicit_order.is_empty());
    assert_eq!(
        find(&tree.entries, "Work").explicit_order.as_deref(),
        Some(&["a.md".to_string()][..])
    );
}

#[test]
fn a_directory_without_an_order_file_reports_an_empty_list() {
    let dir = temp_dir();
    fs::create_dir_all(dir.path().join("Work")).unwrap();

    let tree = scan_notes_tree(dir.path(), default_root()).unwrap();
    assert_eq!(find(&tree.entries, "Work").explicit_order.as_deref(), Some(&[][..]));
}

// ── Symlinks, per root regime ────────────────────────────────────────────────

#[test]
fn a_selected_root_skips_symlinked_entries() {
    let dir = temp_dir();
    let root = dir.path();
    if !can_symlink(root) {
        return;
    }
    write(root, "real.md", "hi");
    let outside = temp_dir();
    write(outside.path(), "elsewhere.md", "hi");
    fs::create_dir_all(outside.path().join("Folder")).unwrap();
    symlink(&outside.path().join("elsewhere.md"), &root.join("linked.md"));
    symlink(&outside.path().join("Folder"), &root.join("LinkedFolder"));

    let tree = scan_notes_tree(root, selected_root()).unwrap();
    assert_eq!(sorted_names(&tree.entries), vec!["real.md"]);
}

#[test]
fn the_default_root_keeps_a_symlinked_markdown_file_as_a_page() {
    // `Dirent.isDirectory()` is false for a link, so the TypeScript's filter
    // let a `*.md` link through the file branch and dropped a linked folder.
    let dir = temp_dir();
    let root = dir.path();
    if !can_symlink(root) {
        return;
    }
    let outside = temp_dir();
    write(outside.path(), "elsewhere.md", "hi");
    fs::create_dir_all(outside.path().join("Folder")).unwrap();
    symlink(&outside.path().join("elsewhere.md"), &root.join("linked.md"));
    symlink(&outside.path().join("Folder"), &root.join("LinkedFolder"));

    let tree = scan_notes_tree(root, default_root()).unwrap();
    assert_eq!(sorted_names(&tree.entries), vec!["linked.md"]);
    assert_eq!(find(&tree.entries, "linked.md").kind, TreeEntryKind::Page);
}

#[test]
fn a_dangling_markdown_symlink_fails_the_scan_the_way_stat_did() {
    let dir = temp_dir();
    let root = dir.path();
    if !can_symlink(root) {
        return;
    }
    symlink(Path::new("./missing-target.md"), &root.join("broken.md"));

    assert!(scan_notes_tree(root, default_root()).is_err());
}

#[test]
fn a_selected_root_ignores_an_order_file_reached_through_a_symlinked_parent() {
    // The directory itself is skipped by the symlink filter, but the order read
    // is gated separately; this pins the gate rather than the filter.
    let dir = temp_dir();
    let root = dir.path();
    if !can_symlink(root) {
        return;
    }
    let outside = temp_dir();
    write_order(outside.path(), &["secret.md"]);
    symlink(outside.path(), &root.join("Escape"));

    let tree = scan_notes_tree(root, selected_root()).unwrap();
    assert!(tree.entries.is_empty());
    assert!(tree.explicit_order.is_empty());
}

// ── Timestamp formatting ─────────────────────────────────────────────────────

#[test]
fn formats_the_epoch() {
    assert_eq!(format_iso_instant(0), "1970-01-01T00:00:00.000Z");
}

#[test]
fn formats_milliseconds_with_three_digits() {
    assert_eq!(format_iso_instant(1_757_308_269_007), "2025-09-08T05:11:09.007Z");
}

#[test]
fn formats_a_leap_day() {
    assert_eq!(format_iso_instant(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
}

#[test]
fn formats_both_kinds_of_century_year() {
    // 2000 was a leap year, 1900 was not — the two cases the 400-year cycle in
    // the day arithmetic has to tell apart.
    assert_eq!(format_iso_instant(951_782_400_000), "2000-02-29T00:00:00.000Z");
    assert_eq!(format_iso_instant(-2_203_891_200_000), "1900-03-01T00:00:00.000Z");
}

#[test]
fn formats_a_pre_epoch_instant_by_flooring_into_the_previous_day() {
    assert_eq!(format_iso_instant(-1), "1969-12-31T23:59:59.999Z");
    assert_eq!(format_iso_instant(-500), "1969-12-31T23:59:59.500Z");
}

#[test]
fn formats_years_outside_the_four_digit_range_in_the_expanded_form() {
    // `new Date(8640000000000000).toISOString()` and its negative twin.
    assert_eq!(format_iso_instant(8_640_000_000_000_000), "+275760-09-13T00:00:00.000Z");
    assert_eq!(format_iso_instant(-8_640_000_000_000_000), "-271821-04-20T00:00:00.000Z");
}

#[test]
fn truncates_sub_millisecond_precision_toward_zero_on_both_sides_of_the_epoch() {
    use std::time::{Duration, UNIX_EPOCH};
    let after = UNIX_EPOCH + Duration::new(1, 999_999);
    assert_eq!(unix_millis(after), 1000);
    let before = UNIX_EPOCH - Duration::new(1, 999_999);
    assert_eq!(unix_millis(before), -1000);
}
