//! Top-N selection tests, including a naive-sort oracle for the heap merge.

use std::sync::Arc;

use coc_native_core::repo_index::{FuzzyMatcher, Hit, Snapshot};

const PATHS: [&str; 4] =
    ["src/index.ts", "src/server/repos/tree-service.ts", "README.md", "test/index.test.ts"];

fn matcher_of(paths: &[&str]) -> FuzzyMatcher {
    let snapshot = Snapshot::from_paths(paths.iter().map(|s| s.to_string()).collect(), false);
    FuzzyMatcher::new(Arc::new(snapshot))
}

fn search(matcher: &FuzzyMatcher, query: &str, limit: usize) -> Vec<String> {
    matcher
        .search(query, limit)
        .into_iter()
        .map(|h| matcher.snapshot().path_at(h.index).to_string())
        .collect()
}

#[test]
fn returns_only_matching_paths() {
    let matcher = matcher_of(&PATHS);
    let mut hits = search(&matcher, "index", 10);
    hits.sort();
    assert_eq!(hits, vec!["src/index.ts", "test/index.test.ts"]);
}

#[test]
fn orders_results_by_descending_score_within_a_tier() {
    let matcher = matcher_of(&PATHS);
    let hits = matcher.search("index", 10);
    assert!(hits.iter().all(|h| h.tier == 2));
    assert!(hits.windows(2).all(|w| w[0].score >= w[1].score));
}

#[test]
fn a_basename_match_is_tier_two_and_a_path_only_match_is_tier_one() {
    let matcher = matcher_of(&PATHS);
    let name = matcher.search("index", 10);
    assert!(name.iter().all(|h| h.tier == 2), "basename matches must be tier 2");

    let path = matcher.search("srcindex", 10);
    assert_eq!(path.len(), 1);
    assert_eq!(path[0].tier, 1);
}

#[test]
fn every_basename_match_outranks_every_path_only_match() {
    let matcher = matcher_of(&[
        "p/r/o/m/p/t/deeply-nested-elsewhere.ts",
        "src/prompts.ts",
        "packages/coc/src/commands/wipe-data.ts",
        "src/prompt-builder.ts",
    ]);
    let hits = matcher.search("prompt", 10);
    let split = hits.iter().position(|h| h.tier == 1).unwrap();
    assert!(split > 0, "expected at least one basename match first");
    assert!(hits[..split].iter().all(|h| h.tier == 2));
    assert!(hits[split..].iter().all(|h| h.tier == 1));
}

#[test]
fn a_query_with_a_separator_falls_to_tier_one() {
    let matcher = matcher_of(&["src/explorer/quick-open.ts"]);
    let hits = matcher.search("explorer/quick", 10);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].tier, 1);
}

#[test]
fn tier_two_indices_land_inside_the_basename() {
    let path = "packages/forge/src/ai/prompt-builder.ts";
    let matcher = matcher_of(&[path]);
    let hits = matcher.search("builder", 10);
    let name_start = (path.rfind('/').unwrap() + 1) as u32;
    assert_eq!(hits[0].tier, 2);
    assert!(hits[0].indices.iter().all(|&i| i >= name_start));
}

#[test]
fn applies_the_limit() {
    let matcher = matcher_of(&PATHS);
    assert_eq!(matcher.search("e", 2).len(), 2);
}

#[test]
fn returns_everything_when_the_limit_exceeds_the_match_count() {
    let matcher = matcher_of(&PATHS);
    assert_eq!(matcher.search("index", 100).len(), 2);
}

#[test]
fn empty_inputs_produce_no_hits() {
    let matcher = matcher_of(&PATHS);
    assert!(matcher.search("index", 0).is_empty());
    assert!(matcher.search("", 10).is_empty());
    assert!(matcher_of(&[]).search("index", 10).is_empty());
}

#[test]
fn ties_break_on_index_order() {
    let matcher = matcher_of(&["a/x.ts", "b/x.ts", "c/x.ts"]);
    let hits = matcher.search("x", 10);
    assert!(hits.iter().all(|h| h.score == hits[0].score));
    assert_eq!(hits.iter().map(|h| h.index).collect::<Vec<_>>(), vec![0, 1, 2]);
    // A tie-broken top-1 must be the earliest path, not an arbitrary one.
    assert_eq!(search(&matcher, "x", 1), vec!["a/x.ts"]);
}

#[test]
fn hits_carry_the_matched_positions() {
    let matcher = matcher_of(&["src/index.ts"]);
    let hits = matcher.search("idx", 10);
    assert_eq!(hits.len(), 1);
    let path: Vec<char> = "src/index.ts".chars().collect();
    let matched: String = hits[0].indices.iter().map(|&i| path[i as usize]).collect();
    assert_eq!(matched, "idx");
}

/// Naive oracle: score everything, sort by `Hit`'s own comparator, take N.
fn naive_top_n(paths: &[String], query: &str, limit: usize) -> Vec<(u32, u32)> {
    let mut all: Vec<Hit> = (0..paths.len())
        .filter_map(|i| {
            let one =
                FuzzyMatcher::new(Arc::new(Snapshot::from_paths(vec![paths[i].clone()], false)));
            one.search(query, 1).first().map(|h| Hit { index: i as u32, ..h.clone() })
        })
        .collect();
    // `Hit`'s ordering treats greater as worse, so ascending is best-first.
    all.sort();
    all.truncate(limit);
    all.into_iter().map(|h| (h.score, h.index)).collect()
}

#[test]
fn heap_merge_matches_a_naive_sort() {
    // Enough paths to spread across several rayon workers, so the per-thread
    // heaps really do have to merge.
    let paths: Vec<String> =
        (0..4000).map(|i| format!("pkg{}/src/module{}/index{}.ts", i % 7, i % 13, i)).collect();
    let matcher = FuzzyMatcher::new(Arc::new(Snapshot::from_paths(paths.clone(), false)));

    for query in ["index", "src", "mod", "i", "pkg3index", "zzz"] {
        for limit in [1usize, 5, 50, 500] {
            let expected = naive_top_n(&paths, query, limit);
            let actual: Vec<(u32, u32)> =
                matcher.search(query, limit).into_iter().map(|h| (h.score, h.index)).collect();
            assert_eq!(actual, expected, "query={query} limit={limit}");
        }
    }
}

#[test]
fn non_ascii_paths_are_searchable_with_utf16_positions() {
    let matcher = matcher_of(&["src/héllo.ts", "src/hello.ts"]);
    let hits = matcher.search("hllo", 10);
    assert_eq!(hits.len(), 2);
    let accented = hits.iter().find(|h| matcher.snapshot().path_at(h.index).contains('é')).unwrap();
    let units: Vec<u16> = "src/héllo.ts".encode_utf16().collect();
    // 'é' occupies one UTF-16 unit, so "llo" must start at 6, not 7.
    assert_eq!(accented.indices, vec![4, 6, 7, 8]);
    assert_eq!(units.len(), 12);
}
