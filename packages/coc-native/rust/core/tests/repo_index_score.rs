//! Scorer tests mirroring `packages/coc/test/server/fuzzy-file-score.test.ts`,
//! so both suites assert the same table and drift shows up on either side.

use coc_native_core::repo_index::score::{score_units, Query};

/// Score through the same narrowing the index does: ASCII paths as bytes.
fn score(query: &str, path: &str) -> u32 {
    let q = Query::new(query);
    let mut indices = Vec::new();
    if path.is_ascii() {
        match q.ascii.as_ref() {
            Some(qa) => {
                let target: Vec<u8> =
                    path.as_bytes().iter().map(|b| b.to_ascii_lowercase()).collect();
                score_units(qa, &target, &mut indices)
            }
            None => 0,
        }
    } else {
        let target: Vec<u16> =
            path.encode_utf16().map(coc_native_core::repo_index::score::lower_unit).collect();
        score_units(&q.wide, &target, &mut indices)
    }
}

fn matched_indices(query: &str, path: &str) -> Vec<u32> {
    let q = Query::new(query);
    let mut indices = Vec::new();
    let target: Vec<u16> =
        path.encode_utf16().map(coc_native_core::repo_index::score::lower_unit).collect();
    score_units(&q.wide, &target, &mut indices);
    indices
}

#[test]
fn empty_query_scores_zero() {
    assert_eq!(score("", "src/index.ts"), 0);
}

#[test]
fn query_longer_than_path_scores_zero() {
    assert_eq!(score("abcdefghijklmnopqrstuvwxyz0123456789", "a.ts"), 0);
}

#[test]
fn non_subsequence_scores_zero() {
    assert_eq!(score("zxy", "index.ts"), 0);
    assert_eq!(score("zzz", "index.ts"), 0);
}

#[test]
fn matches_characters_in_order_but_non_contiguously() {
    assert!(score("index", "src/index.ts") > 0);
    assert!(score("idx", "index.ts") > 0);
    assert!(score("srcindex", "src/index.ts") > 0);
}

#[test]
fn matching_is_case_insensitive_both_ways() {
    assert!(score("INDEX", "src/index.ts") > 0);
    assert!(score("index", "src/INDEX.ts") > 0);
    assert_eq!(score("INDEX", "src/index.ts"), score("index", "src/index.ts"));
}

#[test]
fn consecutive_matches_beat_scattered_ones() {
    assert!(score("ind", "index.ts") > score("ind", "integration-dashboard.ts"));
}

#[test]
fn boundary_matches_beat_mid_word_matches() {
    assert!(score("i", "src/index.ts") > score("n", "src/index.ts"));
}

#[test]
fn backslash_dot_dash_and_underscore_are_boundaries() {
    // Each target has the matched character at index 4; only the boundary differs.
    let mid_word = score("t", "abcdt.x");
    for target in ["abc\\t.x", "abc.t.x", "abc-t.x", "abc_t.x"] {
        assert!(score("t", target) > mid_word, "expected a boundary bonus in {target}");
    }
}

#[test]
fn shorter_paths_win_ties() {
    assert!(score("idx", "index.ts") > score("idx", "very/deep/path/to/some/index.ts"));
}

#[test]
fn regex_special_characters_are_literal() {
    assert_eq!(score("*.ts?", "src/index.ts"), 0);
    assert!(score(".ts", "src/index.ts") > 0);
}

#[test]
fn empty_path_scores_zero() {
    assert_eq!(score("a", ""), 0);
}

#[test]
fn shortness_bonus_floors_at_zero() {
    let long_path = format!("{}/index.ts", "a".repeat(200));
    assert!(score("index", &long_path) > 0);
}

#[test]
fn the_backward_pass_slides_the_match_onto_the_literal_run() {
    // Greedy-forward alone consumes `p` from "packages" and `r` from "forge",
    // then scrapes up "ompt"; the backward pass slides the window onto the
    // literal "prompt" at offset 22.
    let path = "packages/forge/src/ai/prompt-builder.ts";
    assert_eq!(matched_indices("prompt", path), vec![22, 23, 24, 25, 26, 27]);
    assert_eq!(&path[22..28], "prompt");
}

#[test]
fn a_single_character_query_matches_its_first_occurrence() {
    // The degenerate window: sidx == eidx - 1, so the backward pass has one
    // position to consider and must leave the start where it is.
    assert_eq!(matched_indices("x", "src/index.ts"), vec![8]);
    assert_eq!(matched_indices("s", "src/index.ts"), vec![0]);
}

#[test]
fn a_full_length_query_matches_the_whole_target() {
    assert_eq!(matched_indices("abc", "abc"), vec![0, 1, 2]);
}

#[test]
fn indices_are_ascending_and_point_at_matches() {
    let path = "src/index.ts";
    let indices = matched_indices("six", path);
    let units: Vec<u16> = path.encode_utf16().collect();
    assert_eq!(indices.len(), 3);
    assert!(indices.windows(2).all(|w| w[0] < w[1]));
    let matched: String =
        indices.iter().map(|&i| char::from_u32(u32::from(units[i as usize])).unwrap()).collect();
    assert_eq!(matched, "six");
}

#[test]
fn indices_are_empty_when_the_query_does_not_match() {
    assert!(matched_indices("xyz", "src/index.ts").is_empty());
    assert!(matched_indices("", "src/index.ts").is_empty());
    // Bail-out branch: enough characters seen, but not enough remain.
    assert!(matched_indices("stt", "src/index.ts").is_empty());
}

#[test]
fn indices_are_utf16_offsets_for_non_ascii_paths() {
    // "é" is one UTF-16 unit but two UTF-8 bytes; "ts" must land at 2 and 3.
    let indices = matched_indices("ts", "éxts");
    assert_eq!(indices, vec![2, 3]);
}

#[test]
fn non_ascii_query_never_matches_an_ascii_path() {
    assert_eq!(score("é", "src/index.ts"), 0);
}

#[test]
fn ascii_folding_leaves_non_ascii_case_alone() {
    // Documented deviation from JS `toLowerCase`: "É" does not fold to "é".
    assert_eq!(score("é", "É.ts"), 0);
    assert!(score("é", "é.ts") > 0);
}
