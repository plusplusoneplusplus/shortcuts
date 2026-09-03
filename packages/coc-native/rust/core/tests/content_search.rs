//! Behavioural tests for the repo content-search engine.

use std::fs;
use std::path::Path;

use coc_native_core::content_search::{
    search, ContentSearchOptions, ContentSearchResult, SearchError, MAX_LINE_UTF16,
};
use tempfile::TempDir;

/// A repo with one file per path, parent directories created as needed.
///
/// The `.git` marker is what makes `.gitignore` rules apply, so every fixture
/// gets one and search sees the same file set a real checkout would.
fn repo(files: &[(&str, &str)]) -> TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(dir.path().join(".git")).expect("git marker");
    fs::write(dir.path().join(".git").join("HEAD"), "ref: refs/heads/main\n").expect("git HEAD");
    for (path, contents) in files {
        let full = dir.path().join(path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(&full, contents).expect("write file");
    }
    dir
}

fn run(root: &Path, query: &str, options: ContentSearchOptions) -> ContentSearchResult {
    search(root, query, &options).expect("search succeeds")
}

/// `path:line` for every match, which is what most assertions care about.
fn locations(result: &ContentSearchResult) -> Vec<String> {
    result.matches.iter().map(|m| format!("{}:{}", m.path, m.line)).collect()
}

#[test]
fn finds_literal_matches_across_files_sorted_by_path_then_line() {
    let dir = repo(&[
        ("src/beta.txt", "nothing\nneedle here\nnothing\nneedle again\n"),
        ("src/alpha.txt", "needle\n"),
        ("src/gamma.txt", "no match\n"),
    ]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    assert_eq!(locations(&result), ["src/alpha.txt:1", "src/beta.txt:2", "src/beta.txt:4"]);
    assert!(!result.truncated);
}

#[test]
fn reports_the_matching_line_and_its_utf16_columns() {
    let dir = repo(&[("a.txt", "hello needle world\n")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    assert_eq!(hit.text, "hello needle world");
    assert_eq!((hit.start_column, hit.end_column), (6, 12));
}

#[test]
fn columns_are_utf16_offsets_not_byte_offsets() {
    // "héllo" is 6 bytes but 5 UTF-16 units; the emoji is one char but two.
    let dir = repo(&[("a.txt", "héllo 🎯 needle\n")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    let js_offsets: Vec<u16> = hit.text.encode_utf16().collect();
    assert_eq!((hit.start_column, hit.end_column), (9, 15));
    assert_eq!(
        String::from_utf16(&js_offsets[hit.start_column as usize..hit.end_column as usize])
            .expect("valid slice"),
        "needle",
    );
}

#[test]
fn is_case_insensitive_by_default_and_exact_when_asked() {
    let dir = repo(&[("a.txt", "Needle\nneedle\nNEEDLE\n")]);

    let insensitive = run(dir.path(), "needle", ContentSearchOptions::default());
    assert_eq!(insensitive.matches.len(), 3);

    let sensitive = run(
        dir.path(),
        "needle",
        ContentSearchOptions { case_sensitive: true, ..Default::default() },
    );
    assert_eq!(locations(&sensitive), ["a.txt:2"]);
}

#[test]
fn whole_word_requires_boundaries_around_the_query() {
    let dir = repo(&[("a.txt", "needle\nneedles\nthe needle.\nhayneedle\n")]);

    let result =
        run(dir.path(), "needle", ContentSearchOptions { whole_word: true, ..Default::default() });

    assert_eq!(locations(&result), ["a.txt:1", "a.txt:3"]);
}

#[test]
fn treats_the_query_as_a_literal_unless_regex_is_set() {
    let dir = repo(&[("a.txt", "a.c\nabc\n")]);

    let literal = run(dir.path(), "a.c", ContentSearchOptions::default());
    assert_eq!(locations(&literal), ["a.txt:1"]);

    let regex = run(dir.path(), "a.c", ContentSearchOptions { regex: true, ..Default::default() });
    assert_eq!(locations(&regex), ["a.txt:1", "a.txt:2"]);
}

#[test]
fn whole_word_wraps_a_regex_pattern_too() {
    let dir = repo(&[("a.txt", "cat\ncatalog\n")]);

    let result = run(
        dir.path(),
        "ca.",
        ContentSearchOptions { regex: true, whole_word: true, ..Default::default() },
    );

    assert_eq!(locations(&result), ["a.txt:1"]);
}

#[test]
fn an_invalid_regex_is_a_distinct_error_carrying_the_parse_message() {
    let dir = repo(&[("a.txt", "anything\n")]);

    let error = search(
        dir.path(),
        "(unclosed",
        &ContentSearchOptions { regex: true, ..Default::default() },
    )
    .expect_err("invalid regex rejected");

    assert!(matches!(error, SearchError::InvalidRegex(_)), "got {error:?}");
    assert!(error.to_string().contains("invalid regular expression"), "{error}");
}

#[test]
fn an_unparseable_pattern_is_fine_when_regex_is_off() {
    let dir = repo(&[("a.txt", "a (unclosed paren\n")]);

    let result = run(dir.path(), "(unclosed", ContentSearchOptions::default());

    assert_eq!(locations(&result), ["a.txt:1"]);
}

#[test]
fn an_empty_query_matches_nothing_rather_than_everything() {
    let dir = repo(&[("a.txt", "one\ntwo\n")]);

    let result = run(dir.path(), "", ContentSearchOptions::default());

    assert!(result.matches.is_empty());
    assert!(!result.truncated);
}

#[test]
fn skips_binary_files() {
    let dir = repo(&[("text.txt", "needle\n")]);
    fs::write(dir.path().join("blob.bin"), b"needle\x00needle\n").expect("write binary");

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    assert_eq!(locations(&result), ["text.txt:1"]);
}

#[test]
fn skips_files_over_the_size_cap_and_marks_the_result_truncated() {
    let big = format!("{}\nneedle\n", "x".repeat(200));
    let dir = repo(&[("small.txt", "needle\n"), ("big.txt", big.as_str())]);

    let result = run(
        dir.path(),
        "needle",
        ContentSearchOptions { max_file_size_bytes: 100, ..Default::default() },
    );

    assert_eq!(locations(&result), ["small.txt:1"]);
    assert!(result.truncated, "a size-skipped file is a truncation");
}

#[test]
fn caps_matches_per_file() {
    let dir = repo(&[("a.txt", "needle\n".repeat(10).as_str())]);

    let result =
        run(dir.path(), "needle", ContentSearchOptions { max_per_file: 3, ..Default::default() });

    assert_eq!(locations(&result), ["a.txt:1", "a.txt:2", "a.txt:3"]);
    assert!(result.truncated);
}

#[test]
fn caps_total_matches_across_files() {
    let dir = repo(&[
        ("a.txt", "needle\nneedle\n"),
        ("b.txt", "needle\nneedle\n"),
        ("c.txt", "needle\nneedle\n"),
    ]);

    let result =
        run(dir.path(), "needle", ContentSearchOptions { max_results: 4, ..Default::default() });

    assert_eq!(result.matches.len(), 4);
    assert!(result.truncated);
}

#[test]
fn a_result_under_every_cap_is_not_truncated() {
    let dir = repo(&[("a.txt", "needle\n")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    assert!(!result.truncated);
}

#[test]
fn returns_one_line_of_context_on_each_side() {
    let dir = repo(&[("a.txt", "one\ntwo\nneedle\nfour\nfive\n")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    assert_eq!(hit.before, ["two"]);
    assert_eq!(hit.after, ["four"]);
}

#[test]
fn context_is_empty_at_the_start_and_end_of_a_file() {
    let dir = repo(&[("first.txt", "needle\nsecond\n"), ("last.txt", "first\nneedle")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let first = &result.matches[0];
    assert!(first.before.is_empty());
    assert_eq!(first.after, ["second"]);
    let last = &result.matches[1];
    assert_eq!(last.before, ["first"]);
    assert!(last.after.is_empty());
}

#[test]
fn context_lines_can_be_turned_off() {
    let dir = repo(&[("a.txt", "one\nneedle\nthree\n")]);

    let result =
        run(dir.path(), "needle", ContentSearchOptions { context_lines: 0, ..Default::default() });

    assert!(result.matches[0].before.is_empty());
    assert!(result.matches[0].after.is_empty());
}

#[test]
fn scopes_the_walk_to_a_subfolder_but_reports_repo_relative_paths() {
    let dir = repo(&[
        ("src/inside.txt", "needle\n"),
        ("src/nested/deep.txt", "needle\n"),
        ("outside.txt", "needle\n"),
    ]);

    let result = run(
        dir.path(),
        "needle",
        ContentSearchOptions { path: Some("src".into()), ..Default::default() },
    );

    assert_eq!(locations(&result), ["src/inside.txt:1", "src/nested/deep.txt:1"]);
}

#[test]
fn a_path_that_escapes_the_root_is_an_error_not_a_whole_repo_search() {
    let dir = repo(&[("a.txt", "needle\n")]);

    for path in ["..", "../..", "src/../.."] {
        let error = search(
            dir.path(),
            "needle",
            &ContentSearchOptions { path: Some(path.into()), ..Default::default() },
        )
        .expect_err("traversal rejected");
        assert!(matches!(error, SearchError::InvalidPath(_)), "{path}: got {error:?}");
    }
}

#[test]
fn a_path_that_does_not_exist_is_an_error() {
    let dir = repo(&[("a.txt", "needle\n")]);

    let error = search(
        dir.path(),
        "needle",
        &ContentSearchOptions { path: Some("nope".into()), ..Default::default() },
    )
    .expect_err("missing directory rejected");

    assert!(matches!(error, SearchError::InvalidPath(_)), "got {error:?}");
}

#[test]
fn respects_gitignore_unless_show_ignored_is_set() {
    let dir = repo(&[
        (".gitignore", "ignored/\n"),
        ("tracked.txt", "needle\n"),
        ("ignored/hidden.txt", "needle\n"),
    ]);

    let default = run(dir.path(), "needle", ContentSearchOptions::default());
    assert_eq!(locations(&default), ["tracked.txt:1"]);

    let shown = run(
        dir.path(),
        "needle",
        ContentSearchOptions { show_ignored: true, ..Default::default() },
    );
    assert_eq!(locations(&shown), ["ignored/hidden.txt:1", "tracked.txt:1"]);
}

#[test]
fn never_descends_into_the_git_directory() {
    let dir = repo(&[(".git/config.txt", "needle\n"), ("tracked.txt", "needle\n")]);

    let result = run(
        dir.path(),
        "needle",
        ContentSearchOptions { show_ignored: true, ..Default::default() },
    );

    assert_eq!(locations(&result), ["tracked.txt:1"]);
}

#[test]
fn include_globs_whitelist_and_exclude_globs_subtract() {
    let dir = repo(&[("a.ts", "needle\n"), ("b.js", "needle\n"), ("c.ts", "needle\n")]);

    let included = run(
        dir.path(),
        "needle",
        ContentSearchOptions { include: vec!["*.ts".into()], ..Default::default() },
    );
    assert_eq!(locations(&included), ["a.ts:1", "c.ts:1"]);

    let excluded = run(
        dir.path(),
        "needle",
        ContentSearchOptions { exclude: vec!["*.ts".into()], ..Default::default() },
    );
    assert_eq!(locations(&excluded), ["b.js:1"]);
}

#[test]
fn decodes_non_utf8_bytes_lossily_without_breaking_columns() {
    let dir = repo(&[]);
    // A lone 0xFF is not valid UTF-8; it becomes one replacement character.
    let mut bytes = b"\xff needle\n".to_vec();
    bytes.extend_from_slice(b"tail\n");
    fs::write(dir.path().join("a.txt"), bytes).expect("write");

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    let units: Vec<u16> = hit.text.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&units[hit.start_column as usize..hit.end_column as usize])
            .expect("valid slice"),
        "needle",
    );
}

#[test]
fn caps_a_very_long_line_but_keeps_the_match_inside_the_returned_text() {
    let line = format!("{}needle{}\n", "a".repeat(50), "b".repeat(5_000));
    let dir = repo(&[("a.txt", line.as_str())]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    let units: Vec<u16> = hit.text.encode_utf16().collect();
    assert!(units.len() <= MAX_LINE_UTF16, "line capped, got {}", units.len());
    assert!((hit.end_column as usize) <= units.len(), "columns stay inside the text");
    assert_eq!(
        String::from_utf16(&units[hit.start_column as usize..hit.end_column as usize])
            .expect("valid slice"),
        "needle",
    );
}

#[test]
fn keeps_a_match_that_starts_past_the_line_cap_visible() {
    let line = format!("{}needle\n", "a".repeat(MAX_LINE_UTF16 + 100));
    let dir = repo(&[("a.txt", line.as_str())]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    let units: Vec<u16> = hit.text.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&units[hit.start_column as usize..hit.end_column as usize])
            .expect("valid slice"),
        "needle",
    );
}

#[test]
fn handles_crlf_line_endings_without_leaking_the_carriage_return() {
    let dir = repo(&[("a.txt", "one\r\nneedle here\r\nthree\r\n")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    let hit = &result.matches[0];
    assert_eq!(hit.text, "needle here");
    assert_eq!(hit.before, ["one"]);
    assert_eq!(hit.after, ["three"]);
}

#[test]
fn a_root_that_is_not_a_directory_is_an_error() {
    let dir = repo(&[("a.txt", "needle\n")]);

    let error = search(&dir.path().join("a.txt"), "needle", &ContentSearchOptions::default())
        .expect_err("file root rejected");

    assert!(matches!(error, SearchError::InvalidPath(_)), "got {error:?}");
}

#[test]
fn a_root_that_does_not_exist_is_an_io_error() {
    let dir = repo(&[]);

    let error = search(&dir.path().join("absent"), "needle", &ContentSearchOptions::default())
        .expect_err("missing root rejected");

    assert!(matches!(error, SearchError::Io(_)), "got {error:?}");
}

// -- Multi-line queries ------------------------------------------------------

/// The default options with regex mode on — the `.*` toggle.
fn regex_options() -> ContentSearchOptions {
    ContentSearchOptions { regex: true, ..ContentSearchOptions::default() }
}

#[test]
fn a_query_containing_a_newline_matches_across_the_line_break() {
    let dir = repo(&[("a.txt", "before\nalpha\nbeta\nafter\n")]);

    let result = run(dir.path(), "alpha\nbeta", ContentSearchOptions::default());

    assert_eq!(locations(&result), ["a.txt:2", "a.txt:3"]);
    // Each piece is still one line with per-line columns, so a client
    // highlighting text[start..end] highlights exactly what matched.
    assert_eq!(result.matches[0].text, "alpha");
    assert_eq!((result.matches[0].start_column, result.matches[0].end_column), (0, 5));
    assert_eq!(result.matches[1].text, "beta");
    assert_eq!((result.matches[1].start_column, result.matches[1].end_column), (0, 4));
}

#[test]
fn the_pieces_of_one_multi_line_match_share_a_group_id() {
    let dir = repo(&[("a.txt", "alpha\nbeta\nfiller\nalpha\nbeta\n")]);

    let result = run(dir.path(), "alpha\nbeta", ContentSearchOptions::default());

    let groups: Vec<Option<u32>> = result.matches.iter().map(|m| m.group).collect();
    assert_eq!(groups.len(), 4);
    assert_eq!(groups[0], groups[1]);
    assert_eq!(groups[2], groups[3]);
    // Two separate matches, so two ids — a client can tell them apart.
    assert_ne!(groups[0], groups[2]);
    assert!(groups.iter().all(Option::is_some));
}

#[test]
fn a_single_line_match_carries_no_group() {
    let dir = repo(&[("a.txt", "needle\n")]);

    let result = run(dir.path(), "needle", ContentSearchOptions::default());

    assert_eq!(result.matches[0].group, None);
}

#[test]
fn a_multi_line_query_matching_inside_one_line_carries_no_group() {
    let dir = repo(&[("a.txt", "alpha beta\nalpha\nbeta\n")]);

    let result = run(dir.path(), "alpha( |\n)beta", regex_options());

    // The first hit is confined to line 1, so it is indistinguishable from an
    // ordinary match and gets no id; the second crosses a break and does.
    assert_eq!(locations(&result), ["a.txt:1", "a.txt:2", "a.txt:3"]);
    assert_eq!(result.matches[0].group, None);
    assert!(result.matches[1].group.is_some());
    assert_eq!(result.matches[1].group, result.matches[2].group);
}

#[test]
fn a_newline_in_a_literal_query_is_searched_literally() {
    let dir = repo(&[("a.txt", "ax\nb\n"), ("b.txt", "a.\nb\n")]);

    let result = run(dir.path(), "a.\nb", ContentSearchOptions::default());

    // With regex off the `.` is a full stop, so only b.txt matches.
    assert_eq!(locations(&result), ["b.txt:1", "b.txt:2"]);
}

#[test]
fn a_regex_newline_escape_searches_across_lines() {
    let dir = repo(&[("a.txt", "alpha\nbeta\n")]);

    let result = run(dir.path(), r"alpha\nbeta", regex_options());

    assert_eq!(locations(&result), ["a.txt:1", "a.txt:2"]);
    assert_eq!(result.matches[0].group, result.matches[1].group);
    assert!(result.matches[0].group.is_some());
}

#[test]
fn an_escaped_backslash_before_n_stays_a_single_line_search() {
    let dir = repo(&[("a.txt", r"path\name")]);

    // `\\n` is an escaped backslash followed by a literal `n`, not a newline,
    // so this must not flip the searcher into multi-line mode.
    let result = run(dir.path(), r"\\name", regex_options());

    assert_eq!(locations(&result), ["a.txt:1"]);
    assert_eq!(result.matches[0].group, None);
}

#[test]
fn a_multi_line_query_does_not_match_lines_that_are_not_adjacent() {
    let dir = repo(&[("a.txt", "alpha\nmiddle\nbeta\n")]);

    let result = run(dir.path(), "alpha\nbeta", ContentSearchOptions::default());

    assert!(result.matches.is_empty());
}

#[test]
fn a_multi_line_match_spanning_three_lines_reports_every_line() {
    let dir = repo(&[("a.txt", "start one\ntwo\nthree end\ntail\n")]);

    let result = run(dir.path(), "one\ntwo\nthree", ContentSearchOptions::default());

    assert_eq!(locations(&result), ["a.txt:1", "a.txt:2", "a.txt:3"]);
    // The first and last pieces are partial lines; the middle one is whole.
    assert_eq!(result.matches[0].text, "start one");
    assert_eq!((result.matches[0].start_column, result.matches[0].end_column), (6, 9));
    assert_eq!((result.matches[1].start_column, result.matches[1].end_column), (0, 3));
    assert_eq!(result.matches[2].text, "three end");
    assert_eq!((result.matches[2].start_column, result.matches[2].end_column), (0, 5));
}

#[test]
fn a_multi_line_match_ending_on_the_line_break_does_not_touch_the_next_line() {
    let dir = repo(&[("a.txt", "alpha\nbeta\n")]);

    let result = run(dir.path(), r"alpha\n", regex_options());

    assert_eq!(locations(&result), ["a.txt:1"]);
    assert_eq!(result.matches[0].group, None);
}

#[test]
fn multi_line_matches_still_respect_the_per_file_cap() {
    let body = "alpha\nbeta\n".repeat(10);
    let dir = repo(&[("a.txt", body.as_str())]);

    let result = run(
        dir.path(),
        "alpha\nbeta",
        ContentSearchOptions { max_per_file: 3, ..ContentSearchOptions::default() },
    );

    assert_eq!(result.matches.len(), 3);
    assert!(result.truncated);
}
