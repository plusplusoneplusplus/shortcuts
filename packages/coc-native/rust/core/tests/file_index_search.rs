//! Top-N selection tests, including a naive-sort oracle for the heap merge.

use coc_native_core::file_index::IndexState;

const PATHS: [&str; 4] =
    ["src/index.ts", "src/server/repos/tree-service.ts", "README.md", "test/index.test.ts"];

fn index_of(paths: &[&str]) -> IndexState {
    IndexState::from_paths(paths.iter().map(|s| s.to_string()).collect(), false)
}

fn search(state: &IndexState, query: &str, limit: usize) -> Vec<String> {
    state.search(query, limit).into_iter().map(|h| state.path_at(h.index).to_string()).collect()
}

#[test]
fn returns_only_matching_paths() {
    let state = index_of(&PATHS);
    let mut hits = search(&state, "index", 10);
    hits.sort();
    assert_eq!(hits, vec!["src/index.ts", "test/index.test.ts"]);
}

#[test]
fn orders_results_by_descending_score() {
    let state = index_of(&PATHS);
    let hits = state.search("index", 10);
    assert!(hits.windows(2).all(|w| w[0].score >= w[1].score));
}

#[test]
fn applies_the_limit() {
    let state = index_of(&PATHS);
    assert_eq!(state.search("e", 2).len(), 2);
}

#[test]
fn returns_everything_when_the_limit_exceeds_the_match_count() {
    let state = index_of(&PATHS);
    assert_eq!(state.search("index", 100).len(), 2);
}

#[test]
fn empty_inputs_produce_no_hits() {
    let state = index_of(&PATHS);
    assert!(state.search("index", 0).is_empty());
    assert!(state.search("", 10).is_empty());
    assert!(index_of(&[]).search("index", 10).is_empty());
}

#[test]
fn ties_break_on_index_order() {
    let state = index_of(&["a/x.ts", "b/x.ts", "c/x.ts"]);
    let hits = state.search("x", 10);
    assert!(hits.iter().all(|h| h.score == hits[0].score));
    assert_eq!(hits.iter().map(|h| h.index).collect::<Vec<_>>(), vec![0, 1, 2]);
    // A tie-broken top-1 must be the earliest path, not an arbitrary one.
    assert_eq!(search(&state, "x", 1), vec!["a/x.ts"]);
}

#[test]
fn hits_carry_the_matched_positions() {
    let state = index_of(&["src/index.ts"]);
    let hits = state.search("idx", 10);
    assert_eq!(hits.len(), 1);
    let path: Vec<char> = "src/index.ts".chars().collect();
    let matched: String = hits[0].indices.iter().map(|&i| path[i as usize]).collect();
    assert_eq!(matched, "idx");
}

/// Naive oracle: score everything, sort by (score desc, index asc), take N.
fn naive_top_n(paths: &[String], query: &str, limit: usize) -> Vec<(u32, u32)> {
    let single = IndexState::from_paths(paths.to_vec(), false);
    let mut all: Vec<(u32, u32)> = (0..paths.len())
        .filter_map(|i| {
            let one = IndexState::from_paths(vec![paths[i].clone()], false);
            one.search(query, 1).first().map(|h| (h.score, i as u32))
        })
        .collect();
    all.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    all.truncate(limit);
    let _ = single;
    all
}

#[test]
fn heap_merge_matches_a_naive_sort() {
    // Enough paths to spread across several rayon workers, so the per-thread
    // heaps really do have to merge.
    let paths: Vec<String> =
        (0..4000).map(|i| format!("pkg{}/src/module{}/index{}.ts", i % 7, i % 13, i)).collect();
    let state = IndexState::from_paths(paths.clone(), false);

    for query in ["index", "src", "mod", "i", "pkg3index", "zzz"] {
        for limit in [1usize, 5, 50, 500] {
            let expected = naive_top_n(&paths, query, limit);
            let actual: Vec<(u32, u32)> =
                state.search(query, limit).into_iter().map(|h| (h.score, h.index)).collect();
            assert_eq!(actual, expected, "query={query} limit={limit}");
        }
    }
}

#[test]
fn files_returns_windows_of_the_path_list() {
    let state = index_of(&PATHS);
    assert_eq!(state.len(), 4);
    assert_eq!(state.files(0, 2), vec!["src/index.ts", "src/server/repos/tree-service.ts"]);
    assert_eq!(state.files(3, 10), vec!["test/index.test.ts"]);
    assert!(state.files(4, 10).is_empty());
    assert!(state.files(0, 0).is_empty());
    assert!(state.files(99, 10).is_empty());
}

#[test]
fn non_ascii_paths_are_searchable_with_utf16_positions() {
    let state = index_of(&["src/héllo.ts", "src/hello.ts"]);
    let hits = state.search("hllo", 10);
    assert_eq!(hits.len(), 2);
    let accented = hits.iter().find(|h| state.path_at(h.index).contains('é')).unwrap();
    let units: Vec<u16> = "src/héllo.ts".encode_utf16().collect();
    // 'é' occupies one UTF-16 unit, so "llo" must start at 6, not 7.
    assert_eq!(accented.indices, vec![4, 6, 7, 8]);
    assert_eq!(units.len(), 12);
}
