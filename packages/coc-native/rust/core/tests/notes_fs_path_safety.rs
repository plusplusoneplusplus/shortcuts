//! Containment rules for non-default Notes roots.
//!
//! These are the tests that used to live beside
//! `packages/coc/src/server/notes/notes-path-safety.ts`. The error strings are
//! asserted literally on purpose: the server returns them as the body of a 403,
//! so a reword here is a visible API change.

use std::fs;
use std::path::{Path, PathBuf, MAIN_SEPARATOR};

use coc_native_core::notes_fs::path_safety::{
    canonicalize_potential_path, has_symlink_below_root, normalize_relative_notes_path,
    resolve_safe_notes_path, CanonicalizeError, SafePathOptions,
};

fn allow_root() -> SafePathOptions {
    SafePathOptions { allow_root: true, reject_symlinks: false }
}

fn reject_symlinks() -> SafePathOptions {
    SafePathOptions { allow_root: false, reject_symlinks: true }
}

fn write(root: &Path, relative: &str, contents: &str) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, contents).unwrap();
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

/// Windows refuses to create symlinks without Developer Mode or elevation, so
/// the link-based cases report their own skip rather than failing the suite on
/// a machine that simply is not allowed to make one.
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

// ── Normalization ────────────────────────────────────────────────────────────

#[test]
fn rejects_a_null_byte_anywhere_in_the_path() {
    let error = normalize_relative_notes_path("notes/evil\0.md").unwrap_err();
    assert_eq!(error.error, "Access denied: path contains an invalid null byte");
    assert_eq!(error.status_code, 403);
}

#[test]
fn rejects_absolute_paths_in_either_slash_style() {
    for candidate in ["/etc/passwd", "\\\\server\\share\\file.md", "\\etc\\passwd"] {
        let error = normalize_relative_notes_path(candidate).unwrap_err();
        assert_eq!(
            error.error, "Access denied: absolute paths are not allowed for this Notes collection",
            "expected {candidate} to be refused as absolute"
        );
    }
}

#[test]
fn rejects_drive_letters_including_the_drive_relative_form() {
    for candidate in ["C:\\notes\\a.md", "c:/notes/a.md", "c:notes/a.md"] {
        let error = normalize_relative_notes_path(candidate).unwrap_err();
        assert_eq!(
            error.error, "Access denied: absolute paths are not allowed for this Notes collection",
            "expected {candidate} to be refused as a drive path"
        );
    }
}

#[test]
fn rejects_parent_references_written_with_either_separator() {
    for candidate in ["../secrets.md", "notes/../../secrets.md", "notes\\..\\..\\secrets.md"] {
        let error = normalize_relative_notes_path(candidate).unwrap_err();
        assert_eq!(
            error.error, "Access denied: parent directory references are not allowed",
            "expected {candidate} to be refused as a traversal"
        );
    }
}

#[test]
fn keeps_a_dotdot_that_is_only_part_of_a_name() {
    let normalized = normalize_relative_notes_path("notes/..hidden/a.md").unwrap();
    assert_eq!(normalized, format!("notes{MAIN_SEPARATOR}..hidden{MAIN_SEPARATOR}a.md"));
}

#[test]
fn drops_empty_and_current_directory_segments() {
    let normalized = normalize_relative_notes_path("./notes//sub/./a.md").unwrap();
    assert_eq!(normalized, format!("notes{MAIN_SEPARATOR}sub{MAIN_SEPARATOR}a.md"));
}

#[test]
fn normalizes_backslashes_to_the_platform_separator() {
    let normalized = normalize_relative_notes_path("notes\\sub\\a.md").unwrap();
    assert_eq!(normalized, format!("notes{MAIN_SEPARATOR}sub{MAIN_SEPARATOR}a.md"));
}

// ── Resolution ───────────────────────────────────────────────────────────────

#[test]
fn resolves_a_path_inside_the_root_and_reports_it_with_forward_slashes() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "notes/sub/a.md", "# a");

    let resolved =
        resolve_safe_notes_path(root.path(), "notes\\sub\\a.md", SafePathOptions::default())
            .unwrap();

    assert_eq!(resolved.relative_path, "notes/sub/a.md");
    assert_eq!(resolved.absolute_path, root.path().join("notes").join("sub").join("a.md"));
}

#[test]
fn resolves_a_target_that_does_not_exist_yet() {
    let root = tempfile::tempdir().unwrap();

    let resolved =
        resolve_safe_notes_path(root.path(), "new/deep/page.md", SafePathOptions::default())
            .unwrap();

    assert_eq!(resolved.relative_path, "new/deep/page.md");
}

#[test]
fn the_empty_path_needs_allow_root() {
    let root = tempfile::tempdir().unwrap();

    let error = resolve_safe_notes_path(root.path(), "", SafePathOptions::default()).unwrap_err();
    assert_eq!(
        error.error,
        "Access denied: path must identify an entry within the Notes collection"
    );

    let resolved = resolve_safe_notes_path(root.path(), "", allow_root()).unwrap();
    assert_eq!(resolved.relative_path, "");
    assert_eq!(resolved.absolute_path, canonical_lexical(root.path()));
}

#[test]
fn a_path_of_only_dot_segments_is_the_root() {
    let root = tempfile::tempdir().unwrap();
    let resolved = resolve_safe_notes_path(root.path(), "./.", allow_root()).unwrap();
    assert_eq!(resolved.relative_path, "");
}

/// `path.resolve` semantics: the test's own expectation has to be normalized
/// the same way, or a `/tmp` that is itself a symlink makes this compare a
/// lexical path against a canonical one.
fn canonical_lexical(path: &Path) -> PathBuf {
    coc_native_core::notes_fs::path_safety::resolve_lexically(path)
}

// ── Symlinks ─────────────────────────────────────────────────────────────────

#[test]
fn rejects_a_path_escaping_through_a_symlink() {
    let base = tempfile::tempdir().unwrap();
    if !can_symlink(base.path()) {
        return;
    }
    let root = base.path().join("root");
    let outside = base.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.md"), "secret").unwrap();
    symlink(&outside, &root.join("escape"));

    let error =
        resolve_safe_notes_path(&root, "escape/secret.md", SafePathOptions::default()).unwrap_err();

    assert_eq!(
        error.error,
        "Access denied: path escapes the selected Notes collection through a symbolic link"
    );
    assert_eq!(error.status_code, 403);
}

#[test]
fn rejects_a_not_yet_created_target_under_an_escaping_symlink() {
    let base = tempfile::tempdir().unwrap();
    if !can_symlink(base.path()) {
        return;
    }
    let root = base.path().join("root");
    let outside = base.path().join("outside");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, &root.join("escape"));

    let error =
        resolve_safe_notes_path(&root, "escape/not-there-yet.md", SafePathOptions::default())
            .unwrap_err();

    assert_eq!(
        error.error,
        "Access denied: path escapes the selected Notes collection through a symbolic link"
    );
}

#[test]
fn accepts_a_symlink_that_stays_inside_the_root() {
    let base = tempfile::tempdir().unwrap();
    if !can_symlink(base.path()) {
        return;
    }
    let root = base.path().join("root");
    fs::create_dir_all(root.join("real")).unwrap();
    fs::write(root.join("real").join("a.md"), "# a").unwrap();
    symlink(&root.join("real"), &root.join("alias"));

    let resolved =
        resolve_safe_notes_path(&root, "alias/a.md", SafePathOptions::default()).unwrap();

    assert_eq!(resolved.relative_path, "alias/a.md");
}

#[test]
fn a_dangling_symlink_is_refused_rather_than_read_as_a_missing_file() {
    let base = tempfile::tempdir().unwrap();
    if !can_symlink(base.path()) {
        return;
    }
    let root = base.path().join("root");
    fs::create_dir_all(&root).unwrap();
    symlink(&base.path().join("nowhere"), &root.join("dangling"));

    let error = resolve_safe_notes_path(&root, "dangling", SafePathOptions::default()).unwrap_err();
    assert_eq!(
        error.error,
        "Access denied: path could not be safely resolved within the selected Notes collection"
    );

    assert!(matches!(
        canonicalize_potential_path(&root.join("dangling")),
        Err(CanonicalizeError::DanglingSymlink)
    ));
}

#[test]
fn reject_symlinks_refuses_an_inside_link_that_the_default_mode_allows() {
    let base = tempfile::tempdir().unwrap();
    if !can_symlink(base.path()) {
        return;
    }
    let root = base.path().join("root");
    fs::create_dir_all(root.join("real")).unwrap();
    fs::write(root.join("real").join("a.md"), "# a").unwrap();
    symlink(&root.join("real"), &root.join("alias"));

    assert!(resolve_safe_notes_path(&root, "alias/a.md", SafePathOptions::default()).is_ok());

    let error = resolve_safe_notes_path(&root, "alias/a.md", reject_symlinks()).unwrap_err();
    assert_eq!(
        error.error,
        "Access denied: symbolic links are not allowed in this managed Notes path"
    );
}

#[test]
fn the_symlink_sweep_stops_at_a_missing_component() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    fs::create_dir_all(&root).unwrap();

    assert!(!has_symlink_below_root(&root, &root.join("a").join("b").join("c.md")).unwrap());
}

// ── Canonicalization of a partially missing path ─────────────────────────────

#[test]
fn canonicalization_preserves_missing_trailing_components() {
    let base = tempfile::tempdir().unwrap();
    let existing = base.path().join("exists");
    fs::create_dir_all(&existing).unwrap();

    let resolved = canonicalize_potential_path(&existing.join("a").join("b.md")).unwrap();

    let expected = fs::canonicalize(&existing).unwrap().join("a").join("b.md");
    assert_eq!(resolved, expected);
}
