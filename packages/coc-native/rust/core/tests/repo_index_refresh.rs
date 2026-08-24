//! `RepoIndex` lifecycle tests: build, refresh and the atomic snapshot swap.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use coc_native_core::repo_index::{RepoIndex, WalkOptions};

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

fn build(root: &Path) -> RepoIndex {
    RepoIndex::build(root.to_path_buf(), WalkOptions::default()).unwrap()
}

#[test]
fn build_walks_the_root_into_a_searchable_snapshot() {
    let dir = repo();
    write(dir.path(), "src/a.ts", "");
    write(dir.path(), "README.md", "");

    let index = build(dir.path());
    assert_eq!(index.root(), dir.path());
    assert_eq!(index.snapshot().files(0, 10), vec!["README.md", "src/a.ts"]);

    let matcher = index.searcher();
    let hits = matcher.search("readme", 10);
    assert_eq!(hits.len(), 1);
    assert_eq!(matcher.snapshot().path_at(hits[0].index), "README.md");
}

#[test]
fn build_surfaces_walk_errors() {
    let dir = repo();
    assert!(RepoIndex::build(dir.path().join("nope"), WalkOptions::default()).is_err());
}

#[test]
fn refresh_picks_up_added_and_removed_files() {
    let dir = repo();
    write(dir.path(), "old.ts", "");
    let index = build(dir.path());
    assert_eq!(index.snapshot().files(0, 10), vec!["old.ts"]);

    write(dir.path(), "new.ts", "");
    fs::remove_file(dir.path().join("old.ts")).unwrap();
    index.refresh().unwrap();

    assert_eq!(index.snapshot().files(0, 10), vec!["new.ts"]);
    // The matcher was rebuilt with the snapshot, not left over the old list.
    let matcher = index.searcher();
    assert!(matcher.search("old", 10).is_empty());
    assert_eq!(matcher.search("new", 10).len(), 1);
}

#[test]
fn refresh_keeps_the_walk_options() {
    let dir = repo();
    for i in 0..4 {
        write(dir.path(), &format!("f{i}.ts"), "");
    }
    let options = WalkOptions { include_ignored: false, max_entries: Some(2) };
    let index = RepoIndex::build(dir.path().to_path_buf(), options).unwrap();
    assert!(index.snapshot().truncated());

    write(dir.path(), "f4.ts", "");
    index.refresh().unwrap();
    let snapshot = index.snapshot();
    assert_eq!(snapshot.len(), 2);
    assert!(snapshot.truncated());
}

#[test]
fn refresh_surfaces_walk_errors_and_keeps_the_old_snapshot() {
    let dir = repo();
    write(dir.path(), "a.ts", "");
    let root = dir.path().to_path_buf();
    let index = build(&root);

    drop(dir);
    assert!(index.refresh().is_err());
    // A failed refresh must not tear down the snapshot readers still use.
    assert_eq!(index.snapshot().files(0, 10), vec!["a.ts"]);
}

#[test]
fn a_snapshot_taken_before_refresh_keeps_the_old_list() {
    let dir = repo();
    write(dir.path(), "a.ts", "");
    let index = build(dir.path());

    let old_snapshot = index.snapshot();
    let old_matcher = index.searcher();
    write(dir.path(), "b.ts", "");
    index.refresh().unwrap();

    // Held references see the pre-refresh world, coherently.
    assert_eq!(old_snapshot.files(0, 10), vec!["a.ts"]);
    assert!(old_matcher.search("b", 10).is_empty());
    // New reads see the post-refresh world.
    assert_eq!(index.snapshot().files(0, 10), vec!["a.ts", "b.ts"]);
}

#[test]
fn clones_are_handles_to_the_same_index() {
    let dir = repo();
    write(dir.path(), "a.ts", "");
    let index = build(dir.path());
    let handle = index.clone();

    write(dir.path(), "b.ts", "");
    handle.refresh().unwrap();
    assert_eq!(index.snapshot().len(), 2);
}

#[test]
fn readers_never_see_a_torn_snapshot_during_refreshes() {
    let dir = repo();
    let generations = ["alpha", "beta"];
    let populate = |name: &str| {
        for other in generations.iter().filter(|g| **g != name) {
            for i in 0..8 {
                let _ = fs::remove_file(dir.path().join(format!("{other}{i}.ts")));
            }
        }
        for i in 0..8 {
            write(dir.path(), &format!("{name}{i}.ts"), "");
        }
    };
    populate("alpha");
    let index = build(dir.path());
    let done = AtomicBool::new(false);

    std::thread::scope(|scope| {
        for _ in 0..2 {
            scope.spawn(|| {
                while !done.load(Ordering::Relaxed) {
                    // One matcher pull is one generation: the file list and the
                    // search results must agree with each other in full.
                    let matcher = index.searcher();
                    let files = matcher.snapshot().files(0, 100);
                    assert_eq!(files.len(), 8);
                    let homogeneous =
                        generations.iter().any(|g| files.iter().all(|f| f.starts_with(g)));
                    assert!(homogeneous, "torn file list: {files:?}");
                    // Every path matches "ts", so a coherent pair returns all 8.
                    let hits = matcher.search("ts", 100);
                    assert_eq!(hits.len(), 8);
                    for hit in hits {
                        let path = matcher.snapshot().path_at(hit.index);
                        assert!(files.iter().any(|f| f == path));
                    }
                }
            });
        }

        for round in 0..10 {
            populate(generations[round % 2]);
            index.refresh().unwrap();
        }
        done.store(true, Ordering::Relaxed);
    });
}
