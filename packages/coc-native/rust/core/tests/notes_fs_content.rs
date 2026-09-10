//! Parity tests for `notes_fs::content` — the read and autosave routes.
//!
//! The behaviours pinned here are the ones the HTTP contract depends on: which
//! regime resolves a path how, the mtime-rounding conflict rule, and the fact
//! that a save is never observable half-written.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use coc_native_core::notes_fs::{
    read_note, resolve_content_path, write_note, ContentError, ContentOptions, WriteOutcome,
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
                .join(format!("notes-fs-content-{label}-{}-{id}", std::process::id()));
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

fn selected_root() -> ContentOptions<'static> {
    ContentOptions { is_default_root: false, allowed_prefixes: &[] }
}

fn default_root(prefixes: &[PathBuf]) -> ContentOptions<'_> {
    ContentOptions { is_default_root: true, allowed_prefixes: prefixes }
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent");
    }
    fs::write(path, contents).expect("write fixture");
}

/// Windows' `SetFileTime` needs a handle opened for writing, so a read-only
/// `File::open` here fails with "Access is denied" even though the same call
/// succeeds on Unix. Ask for write access so the helper works on every target.
fn set_mtime(path: &Path, millis: u64) {
    let time = SystemTime::UNIX_EPOCH + Duration::from_millis(millis);
    let file = fs::OpenOptions::new().write(true).open(path).expect("open for utimes");
    file.set_modified(time).expect("set mtime");
}

// ── Reading ─────────────────────────────────────────────────────────────────

#[test]
fn reads_a_note_relative_to_a_selected_root() {
    let root = TempDir::new("read-selected");
    write_file(&root.path().join("Ideas/plan.md"), "# Plan\n");

    let note = read_note(root.path(), "Ideas/plan.md", selected_root()).expect("read");

    assert_eq!(note.content, "# Plan\n");
    assert!(note.mtime_ms > 0.0);
}

#[test]
fn read_reports_a_missing_file_as_not_found() {
    let root = TempDir::new("read-missing");

    let error = read_note(root.path(), "nope.md", selected_root()).expect_err("missing");

    assert!(matches!(error, ContentError::NotFound), "expected NotFound, got {error:?}");
}

#[test]
fn read_replaces_invalid_utf8_the_way_node_does() {
    let root = TempDir::new("read-invalid-utf8");
    let target = root.path().join("broken.md");
    write_file(&target, "");
    let mut file = fs::File::create(&target).expect("create");
    file.write_all(&[b'o', b'k', 0xff, b'!']).expect("write bytes");
    drop(file);

    let note = read_note(root.path(), "broken.md", selected_root()).expect("read");

    assert_eq!(note.content, "ok\u{fffd}!");
}

#[test]
fn read_refuses_to_escape_a_selected_root() {
    let root = TempDir::new("read-escape");
    write_file(&root.path().parent().unwrap().join("outside-secret.md"), "secret");

    let error =
        read_note(root.path(), "../outside-secret.md", selected_root()).expect_err("traversal");

    match error {
        ContentError::Denied(denied) => {
            assert_eq!(denied.status_code, 403);
            assert!(denied.error.starts_with("Access denied:"), "{}", denied.error);
        }
        other => panic!("expected Denied, got {other:?}"),
    }
}

// ── Default-root regime ─────────────────────────────────────────────────────

#[test]
fn default_root_accepts_an_absolute_path_inside_an_allowed_prefix() {
    let allowed = TempDir::new("default-abs-allowed");
    let root = allowed.path().join("notes");
    let target = allowed.path().join("state/scratchpad.md");
    write_file(&target, "scratch");
    let prefixes = vec![allowed.path().to_path_buf()];

    let note = read_note(&root, &target.to_string_lossy(), default_root(&prefixes)).expect("read");

    assert_eq!(note.content, "scratch");
}

#[test]
fn default_root_rejects_an_absolute_path_outside_every_prefix() {
    let allowed = TempDir::new("default-abs-allowed-other");
    let elsewhere = TempDir::new("default-abs-outside");
    let target = elsewhere.path().join("secret.md");
    write_file(&target, "secret");
    let prefixes = vec![allowed.path().to_path_buf()];

    let error = read_note(
        &allowed.path().join("notes"),
        &target.to_string_lossy(),
        default_root(&prefixes),
    )
    .expect_err("outside");

    match error {
        ContentError::Denied(denied) => {
            assert_eq!(denied.error, "Access denied: path is outside workspace data directory");
            assert_eq!(denied.status_code, 403);
        }
        other => panic!("expected Denied, got {other:?}"),
    }
}

#[test]
fn default_root_resolves_a_relative_path_against_the_root() {
    let workspace = TempDir::new("default-relative");
    let root = workspace.path().join("notes");
    write_file(&root.join("Plans/today.md"), "today");
    let prefixes = vec![workspace.path().to_path_buf()];

    let resolved =
        resolve_content_path(&root, "Plans/today.md", default_root(&prefixes)).expect("resolve");

    assert_eq!(resolved, root.join("Plans").join("today.md"));
}

#[test]
fn default_root_still_checks_traversal_against_the_allow_list() {
    let workspace = TempDir::new("default-traversal");
    let root = workspace.path().join("notes");
    let prefixes = vec![root.clone()];

    let error =
        resolve_content_path(&root, "../../etc/passwd", default_root(&prefixes)).expect_err("deny");

    match error {
        ContentError::Denied(denied) => {
            assert_eq!(denied.error, "Access denied: path is outside workspace data directory")
        }
        other => panic!("expected Denied, got {other:?}"),
    }
}

// ── Writing ─────────────────────────────────────────────────────────────────

#[test]
fn write_creates_missing_parent_directories() {
    let root = TempDir::new("write-parents");

    let outcome =
        write_note(root.path(), "A/B/C/note.md", "hello", None, selected_root()).expect("write");

    assert!(matches!(outcome, WriteOutcome::Written { .. }));
    assert_eq!(fs::read_to_string(root.path().join("A/B/C/note.md")).unwrap(), "hello");
}

#[test]
fn write_leaves_no_temp_file_behind() {
    let root = TempDir::new("write-no-temp");

    write_note(root.path(), "note.md", "body", None, selected_root()).expect("write");

    let leftovers: Vec<_> = fs::read_dir(root.path())
        .expect("read dir")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(leftovers, vec!["note.md".to_string()]);
}

#[test]
fn write_replaces_the_file_atomically() {
    // A save is a rename, not an in-place rewrite, so a reader sees either the
    // whole old file or the whole new one. On Unix that is observable: the
    // target gets a new inode instead of being truncated and refilled.
    let root = TempDir::new("write-atomic");
    let target = root.path().join("note.md");
    write_file(&target, "a very long original body that would be truncated by an in-place write");
    #[cfg(unix)]
    let original_inode = {
        use std::os::unix::fs::MetadataExt;
        fs::metadata(&target).unwrap().ino()
    };

    write_note(root.path(), "note.md", "short", None, selected_root()).expect("write");

    assert_eq!(fs::read_to_string(&target).unwrap(), "short");
    assert!(!root.path().join("note.md.tmp").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_ne!(fs::metadata(&target).unwrap().ino(), original_inode);
    }
}

#[test]
fn write_without_expected_mtime_overwrites_unconditionally() {
    let root = TempDir::new("write-no-lock");
    write_file(&root.path().join("note.md"), "old");
    set_mtime(&root.path().join("note.md"), 1_000_000);

    let outcome = write_note(root.path(), "note.md", "new", None, selected_root()).expect("write");

    assert!(matches!(outcome, WriteOutcome::Written { .. }));
    assert_eq!(fs::read_to_string(root.path().join("note.md")).unwrap(), "new");
}

#[test]
fn write_conflicts_when_the_file_changed_under_the_client() {
    let root = TempDir::new("write-conflict");
    let target = root.path().join("note.md");
    write_file(&target, "changed on disk");
    set_mtime(&target, 2_000_000);

    let outcome = write_note(root.path(), "note.md", "mine", Some(1_000_000.0), selected_root())
        .expect("write");

    match outcome {
        WriteOutcome::Conflict { current_mtime, current_content } => {
            assert_eq!(current_content, "changed on disk");
            assert_eq!(current_mtime.round(), 2_000_000.0);
        }
        other => panic!("expected a conflict, got {other:?}"),
    }
    // The client's content must not have landed.
    assert_eq!(fs::read_to_string(&target).unwrap(), "changed on disk");
}

#[test]
fn write_accepts_a_matching_expected_mtime() {
    let root = TempDir::new("write-match");
    let target = root.path().join("note.md");
    write_file(&target, "old");
    set_mtime(&target, 1_700_000_000_123);

    let outcome =
        write_note(root.path(), "note.md", "new", Some(1_700_000_000_123.0), selected_root())
            .expect("write");

    assert!(matches!(outcome, WriteOutcome::Written { .. }));
    assert_eq!(fs::read_to_string(&target).unwrap(), "new");
}

#[test]
fn write_rounds_both_sides_of_the_mtime_comparison() {
    // Sub-millisecond drift is not a conflict: the comparison is
    // `Math.round(stat.mtimeMs) !== Math.round(expectedMtime)`, and a client
    // that read 1_700_000_000_123.4 must still be able to save a file stamped
    // 1_700_000_000_123.
    let root = TempDir::new("write-rounding");
    let target = root.path().join("note.md");
    write_file(&target, "old");
    set_mtime(&target, 1_700_000_000_123);

    let outcome =
        write_note(root.path(), "note.md", "new", Some(1_700_000_000_123.4), selected_root())
            .expect("write");

    assert!(matches!(outcome, WriteOutcome::Written { .. }), "got {outcome:?}");
    assert_eq!(fs::read_to_string(&target).unwrap(), "new");
}

#[test]
fn write_treats_a_half_millisecond_gap_as_a_conflict() {
    // ...but a full millisecond apart after rounding still is one. .5 rounds up
    // (JS `Math.round` breaks ties toward +Infinity), so 122.5 becomes 123 and
    // matches, while 121.5 becomes 122 and does not.
    let root = TempDir::new("write-rounding-conflict");
    let target = root.path().join("note.md");
    write_file(&target, "disk");
    set_mtime(&target, 1_700_000_000_123);

    let matching =
        write_note(root.path(), "note.md", "a", Some(1_700_000_000_122.5), selected_root())
            .expect("write");
    assert!(matches!(matching, WriteOutcome::Written { .. }), "122.5 should round up to 123");

    set_mtime(&target, 1_700_000_000_123);
    let conflicting =
        write_note(root.path(), "note.md", "b", Some(1_700_000_000_121.5), selected_root())
            .expect("write");
    assert!(matches!(conflicting, WriteOutcome::Conflict { .. }), "got {conflicting:?}");
}

#[test]
fn write_of_a_new_file_is_never_a_conflict() {
    let root = TempDir::new("write-new-file");

    let outcome =
        write_note(root.path(), "fresh.md", "hi", Some(12_345.0), selected_root()).expect("write");

    assert!(matches!(outcome, WriteOutcome::Written { .. }));
    assert_eq!(fs::read_to_string(root.path().join("fresh.md")).unwrap(), "hi");
}

#[test]
fn write_reports_the_mtime_of_the_file_it_just_wrote() {
    let root = TempDir::new("write-mtime");

    let WriteOutcome::Written { mtime_ms } =
        write_note(root.path(), "note.md", "hi", None, selected_root()).expect("write")
    else {
        panic!("expected a successful write");
    };

    let stat = fs::metadata(root.path().join("note.md")).expect("stat");
    let observed = stat
        .modified()
        .expect("mtime")
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("after epoch")
        .as_secs_f64()
        * 1000.0;
    assert!((mtime_ms - observed).abs() < 1.0, "{mtime_ms} vs {observed}");
}

#[test]
fn write_refuses_to_escape_a_selected_root() {
    let root = TempDir::new("write-escape");

    let error = write_note(root.path(), "../escaped.md", "x", None, selected_root())
        .expect_err("traversal");

    assert!(matches!(error, ContentError::Denied(_)), "got {error:?}");
    assert!(!root.path().parent().unwrap().join("escaped.md").exists());
}

#[test]
fn write_round_trips_through_read() {
    let root = TempDir::new("write-read-round-trip");

    write_note(root.path(), "Ideas/note.md", "content\nwith lines\n", None, selected_root())
        .expect("write");
    let note = read_note(root.path(), "Ideas/note.md", selected_root()).expect("read");

    assert_eq!(note.content, "content\nwith lines\n");
}

#[cfg(unix)]
#[test]
fn write_refuses_a_page_symlinked_outside_a_selected_root() {
    // The refusal comes from the path check, before anything is created — so
    // neither the note nor its `.tmp` sibling can land outside the collection.
    use std::os::unix::fs::symlink;

    let root = TempDir::new("write-temp-symlink");
    let outside = TempDir::new("write-temp-outside");
    let target = outside.path().join("linked.md");
    write_file(&target, "outside");
    if symlink(&target, root.path().join("linked.md")).is_err() {
        return; // no permission to create links here
    }

    let error =
        write_note(root.path(), "linked.md", "hijack", None, selected_root()).expect_err("denied");

    assert!(matches!(error, ContentError::Denied(_)), "got {error:?}");
    assert_eq!(fs::read_to_string(&target).unwrap(), "outside");
    assert!(!outside.path().join("linked.md.tmp").exists());
}
