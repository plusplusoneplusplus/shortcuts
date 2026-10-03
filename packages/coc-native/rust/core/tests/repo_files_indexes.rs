//! `RepoIndexes` lifecycle: shared cold builds, retry after failure, variant
//! and handle isolation, TTL refresh, write-queued refresh and disposal.

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use coc_native_core::repo_files::{RepoFilesError, RepoIndexes};

const LONG: Duration = Duration::from_secs(3600);

fn write(root: &Path, relative: &str) {
    let target = root.join(relative);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, "x").unwrap();
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), ".git/HEAD");
    dir
}

fn files(indexes: &Arc<RepoIndexes>, include_ignored: bool) -> Vec<String> {
    indexes.index(include_ignored).unwrap().snapshot().files(0, usize::MAX)
}

fn wait_for(mut done: impl FnMut() -> bool) {
    for _ in 0..200 {
        if done() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("timed out");
}

#[test]
fn concurrent_cold_callers_share_one_build() {
    let dir = repo();
    write(dir.path(), "a.ts");
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), LONG);
    let snapshots: Vec<_> = (0..8)
        .map(|_| {
            let indexes = Arc::clone(&indexes);
            thread::spawn(move || indexes.index(false).unwrap().snapshot())
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|t| t.join().unwrap())
        .collect();
    assert!(snapshots.iter().all(|s| Arc::ptr_eq(s, &snapshots[0])));
}

#[test]
fn a_failed_build_is_not_cached() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("later");
    let indexes = RepoIndexes::new(root.clone(), LONG);
    assert!(indexes.index(false).is_err());
    write(&root, "a.ts");
    assert_eq!(files(&indexes, false), ["a.ts"]);
}

#[test]
fn variants_are_independent() {
    let dir = repo();
    fs::write(dir.path().join(".gitignore"), "ignored.ts\n").unwrap();
    write(dir.path(), "ignored.ts");
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), LONG);
    assert_eq!(files(&indexes, false), [".gitignore"]);
    assert_eq!(files(&indexes, true), [".gitignore", "ignored.ts"]);
}

#[test]
fn handles_for_different_roots_never_share_state() {
    let (a, b) = (repo(), repo());
    write(a.path(), "a.ts");
    write(b.path(), "b.ts");
    let (ia, ib) = (
        RepoIndexes::new(a.path().to_path_buf(), LONG),
        RepoIndexes::new(b.path().to_path_buf(), LONG),
    );
    assert_eq!(files(&ia, false), ["a.ts"]);
    assert_eq!(files(&ib, false), ["b.ts"]);
    write(b.path(), "b2.ts");
    assert!(ia.invalidate());
    assert_eq!(files(&ib, false), ["b.ts"], "invalidating one handle leaves the other alone");
}

#[test]
fn a_stale_snapshot_is_served_while_the_ttl_refresh_runs() {
    let dir = repo();
    write(dir.path(), "first.ts");
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), Duration::ZERO);
    let first = indexes.index(false).unwrap().snapshot();
    write(dir.path(), "second.ts");
    assert_eq!(first.files(0, 10), ["first.ts"], "a held snapshot never changes");
    wait_for(|| files(&indexes, false).contains(&"second.ts".to_owned()));
}

#[test]
fn a_fresh_snapshot_is_not_rewalked_before_the_ttl() {
    let dir = repo();
    write(dir.path(), "first.ts");
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), LONG);
    files(&indexes, false);
    write(dir.path(), "second.ts");
    thread::sleep(Duration::from_millis(50));
    assert_eq!(files(&indexes, false), ["first.ts"]);
}

#[test]
fn invalidate_after_a_write_sees_it_even_with_a_scan_in_flight() {
    let dir = repo();
    for i in 0..200 {
        write(dir.path(), &format!("d{}/f{i}.ts", i % 10));
    }
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), Duration::ZERO);
    files(&indexes, false);
    for round in 0..20 {
        // TTL 0: this read starts a background scan that may predate the write.
        files(&indexes, false);
        let name = format!("written{round}.ts");
        write(dir.path(), &name);
        assert!(indexes.invalidate());
        assert!(files(&indexes, false).contains(&name), "round {round}");
    }
}

#[test]
fn a_failed_refresh_keeps_the_snapshot_and_retries() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    write(&root, "a.ts");
    let indexes = RepoIndexes::new(root.clone(), LONG);
    assert_eq!(files(&indexes, false), ["a.ts"]);

    fs::rename(&root, dir.path().join("moved")).unwrap();
    assert!(!indexes.invalidate());
    assert_eq!(files(&indexes, false), ["a.ts"]);

    fs::rename(dir.path().join("moved"), &root).unwrap();
    write(&root, "b.ts");
    assert!(indexes.invalidate());
    assert_eq!(files(&indexes, false), ["a.ts", "b.ts"]);
}

#[test]
fn failed_invalidation_retries_on_read_before_the_ttl_for_both_variants() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    write(&root, ".git/HEAD");
    fs::write(root.join(".gitignore"), "ignored.ts\n").unwrap();
    write(&root, "a.ts");
    let indexes = RepoIndexes::new(root.clone(), LONG);
    let held = [false, true].map(|ignored| indexes.index(ignored).unwrap());
    let original = held[0].snapshot();

    fs::rename(&root, dir.path().join("moved")).unwrap();
    assert!(!indexes.invalidate());
    for index in &held {
        assert_eq!(index.snapshot().files(0, 10), [".gitignore", "a.ts"]);
    }

    fs::rename(dir.path().join("moved"), &root).unwrap();
    write(&root, "b.ts");
    write(&root, "ignored.ts");
    // No second invalidation: reads must retry despite the hour-long TTL.
    wait_for(|| {
        for ignored in [false, true] {
            indexes.index(ignored).unwrap();
        }
        held.iter().all(|index| index.snapshot().files(0, 10).contains(&"b.ts".to_owned()))
    });
    assert_eq!(held[0].snapshot().files(0, 10), [".gitignore", "a.ts", "b.ts"]);
    assert_eq!(held[1].snapshot().files(0, 10), [".gitignore", "a.ts", "b.ts", "ignored.ts"]);
    assert_eq!(original.files(0, 10), [".gitignore", "a.ts"], "held snapshots stay immutable");
}

#[test]
fn invalidate_skips_variants_that_were_never_built() {
    let dir = repo();
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), LONG);
    assert!(indexes.invalidate());
    write(dir.path(), "a.ts");
    assert_eq!(files(&indexes, true), ["a.ts"]);
}

#[test]
fn dispose_rejects_new_requests_but_not_held_snapshots() {
    let dir = repo();
    write(dir.path(), "a.ts");
    let indexes = RepoIndexes::new(dir.path().to_path_buf(), LONG);
    let held = indexes.index(false).unwrap();
    indexes.dispose();
    assert!(matches!(indexes.index(false), Err(RepoFilesError::Disposed)));
    assert!(matches!(indexes.root(), Err(RepoFilesError::Disposed)));
    assert!(indexes.invalidate(), "nothing left to refresh");
    assert_eq!(held.snapshot().files(0, 10), ["a.ts"]);
}
