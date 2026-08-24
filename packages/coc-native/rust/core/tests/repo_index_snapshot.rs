//! Snapshot accessor tests: sizes, path windows and hit resolution.

use coc_native_core::repo_index::Snapshot;

const PATHS: [&str; 4] =
    ["src/index.ts", "src/server/repos/tree-service.ts", "README.md", "test/index.test.ts"];

fn snapshot_of(paths: &[&str]) -> Snapshot {
    Snapshot::from_paths(paths.iter().map(|s| s.to_string()).collect(), false)
}

#[test]
fn files_returns_windows_of_the_path_list() {
    let snapshot = snapshot_of(&PATHS);
    assert_eq!(snapshot.len(), 4);
    assert_eq!(snapshot.files(0, 2), vec!["src/index.ts", "src/server/repos/tree-service.ts"]);
    assert_eq!(snapshot.files(3, 10), vec!["test/index.test.ts"]);
    assert!(snapshot.files(4, 10).is_empty());
    assert!(snapshot.files(0, 0).is_empty());
    assert!(snapshot.files(99, 10).is_empty());
}

#[test]
fn paths_and_path_at_expose_the_list_in_index_order() {
    let snapshot = snapshot_of(&PATHS);
    assert_eq!(snapshot.paths(), &PATHS.map(String::from));
    assert_eq!(snapshot.path_at(2), "README.md");
}

#[test]
fn emptiness_and_truncation_round_trip() {
    let empty = snapshot_of(&[]);
    assert!(empty.is_empty());
    assert_eq!(empty.len(), 0);

    let snapshot = snapshot_of(&PATHS);
    assert!(!snapshot.is_empty());
    assert!(!snapshot.truncated());
    assert!(Snapshot::from_paths(vec!["a.ts".to_string()], true).truncated());
}
