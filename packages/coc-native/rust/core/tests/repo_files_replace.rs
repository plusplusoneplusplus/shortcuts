//! Replace in search results: the span engine and its filesystem wrapper.

use std::fs;

use coc_native_core::repo_files::{
    apply_replacements, build_matcher, preserve_case, replace_content, ReplaceFile, ReplaceOptions,
    ReplaceTarget, RepoFilesError,
};

const REGEX: ReplaceOptions =
    ReplaceOptions { case_sensitive: false, whole_word: false, regex: true, preserve_case: false };

/// A target for `needle`'s first occurrence at or after UTF-16 column `from`.
fn target(line: u32, text: &str, needle: &str, from: usize) -> ReplaceTarget {
    let units: Vec<u16> = text.encode_utf16().collect();
    let needle: Vec<u16> = needle.encode_utf16().collect();
    let start = (from..units.len()).find(|&i| units[i..].starts_with(&needle)).expect("needle");
    ReplaceTarget {
        line: f64::from(line),
        text: text.to_owned(),
        start_column: start as f64,
        end_column: (start + needle.len()) as f64,
    }
}

fn apply(
    content: &str,
    targets: &[ReplaceTarget],
    query: &str,
    replacement: &str,
    options: ReplaceOptions,
) -> Result<(String, u32), String> {
    let matcher = build_matcher(query, options).expect("valid query");
    apply_replacements(content, targets, &matcher, replacement, options)
}

fn plain(
    content: &str,
    targets: &[ReplaceTarget],
    query: &str,
    replacement: &str,
) -> Result<(String, u32), String> {
    apply(content, targets, query, replacement, ReplaceOptions::default())
}

#[test]
fn literal_queries_match_metacharacters_literally() {
    let t = target(1, "x a.c abc", "a.c", 0);
    assert_eq!(plain("x a.c abc", &[t], "a.c", "Z"), Ok(("x Z abc".into(), 1)));
    let stale = target(1, "abc", "abc", 0);
    assert!(plain("abc", &[stale], "a.c", "Z").is_err());
}

#[test]
fn case_and_whole_word_follow_the_search_flags() {
    let t = target(1, "NEEDLE", "NEEDLE", 0);
    assert!(plain("NEEDLE", std::slice::from_ref(&t), "needle", "x").is_ok());
    let sensitive = ReplaceOptions { case_sensitive: true, ..ReplaceOptions::default() };
    assert!(apply("NEEDLE", &[t], "needle", "x", sensitive).is_err());
    let whole = ReplaceOptions { whole_word: true, ..ReplaceOptions::default() };
    assert!(apply("needles", &[target(1, "needles", "needle", 0)], "needle", "x", whole).is_err());
    let hit = target(1, "a needle here", "needle", 0);
    assert_eq!(apply("a needle here", &[hit], "needle", "x", whole), Ok(("a x here".into(), 1)));
}

#[test]
fn bad_queries_are_invalid_arg() {
    for (query, options) in
        [("", ReplaceOptions::default()), ("a\nb", ReplaceOptions::default()), ("(unclosed", REGEX)]
    {
        assert!(
            matches!(build_matcher(query, options), Err(RepoFilesError::InvalidArg(_))),
            "{query}"
        );
    }
    let Err(error) = build_matcher("(unclosed", REGEX) else { panic!("expected error") };
    assert!(error.to_string().starts_with("Invalid regular expression: "));
}

#[test]
fn preserve_case_carries_simple_casing_only() {
    assert_eq!(preserve_case("FOO", "bar"), "BAR");
    assert_eq!(preserve_case("foo", "BAR"), "bar");
    assert_eq!(preserve_case("Foo", "bar"), "Bar");
    assert_eq!(preserve_case("fooBar", "baz qux"), "baz qux");
    assert_eq!(preserve_case("123", "Bar"), "Bar");
    assert_eq!(preserve_case("", "Bar"), "Bar");
}

#[test]
fn regex_mode_expands_group_references() {
    let text = "user@host";
    let run = |replacement: &str, options| {
        apply(text, &[target(1, text, text, 0)], "(\\w+)@(\\w+)", replacement, options).unwrap().0
    };
    assert_eq!(run("$2/$1", REGEX), "host/user");
    assert_eq!(run("[$&]", REGEX), "[user@host]");
    assert_eq!(run("$$1", REGEX), "$1");
    assert_eq!(run("$9", REGEX), "$9");
    assert_eq!(run("$0|$01", REGEX), "user@host|user");
    assert_eq!(run("a$", REGEX), "a$");
    let literal =
        apply(text, &[target(1, text, text, 0)], text, "$5.00", ReplaceOptions::default());
    assert_eq!(literal.unwrap().0, "$5.00");
}

#[test]
fn unmatched_group_is_left_as_written() {
    let text = "b";
    let out = apply(text, &[target(1, text, "b", 0)], "(a)?b", "[$1]", REGEX).unwrap();
    assert_eq!(out.0, "[$1]");
}

#[test]
fn rewrites_only_listed_spans_and_keeps_line_endings() {
    let content = "const needle = 1;\nconst other = needle;\n";
    let t = target(1, "const needle = 1;", "needle", 0);
    assert_eq!(
        plain(content, &[t], "needle", "pin"),
        Ok(("const pin = 1;\nconst other = needle;\n".into(), 1))
    );

    let text = "needle and needle";
    let both = [target(1, text, "needle", 0), target(1, text, "needle", 5)];
    assert_eq!(
        plain("needle and needle\n", &both, "needle", "pinpoint"),
        Ok(("pinpoint and pinpoint\n".into(), 2))
    );

    let crlf = [target(1, "a needle", "needle", 0)];
    assert_eq!(
        plain("a needle\r\nsecond\r\n", &crlf, "needle", "pin").unwrap().0,
        "a pin\r\nsecond\r\n"
    );
    assert_eq!(plain("a needle", &crlf, "needle", "pin").unwrap().0, "a pin");
}

#[test]
fn preserve_case_applies_after_expansion() {
    let text = "call FOO(1)";
    let options = ReplaceOptions { preserve_case: true, ..REGEX };
    let out = apply(
        "call FOO(1)\n",
        &[target(1, text, "FOO(1)", 0)],
        "foo\\((\\d)\\)",
        "bar[$1]",
        options,
    );
    assert_eq!(out.unwrap().0, "call BAR[1]\n");
}

#[test]
fn stale_targets_skip_the_whole_file() {
    let changed = plain(
        "const needle = 2;\n",
        &[target(1, "const needle = 1;", "needle", 0)],
        "needle",
        "pin",
    );
    assert_eq!(changed, Err("Line 1 changed on disk".into()));

    let gone = ReplaceTarget { line: 9.0, text: "gone".into(), start_column: 0.0, end_column: 4.0 };
    assert_eq!(
        plain("only one line\n", &[gone], "gone", "pin"),
        Err("Line 9 no longer exists".into())
    );

    let fractional =
        ReplaceTarget { line: 1.5, text: "a".into(), start_column: 0.0, end_column: 1.0 };
    assert_eq!(plain("a\n", &[fractional], "a", "b"), Err("Line 1.5 no longer exists".into()));

    let shifted = ReplaceTarget {
        line: 1.0,
        text: "needle needle".into(),
        start_column: 3.0,
        end_column: 9.0,
    };
    assert_eq!(
        plain("needle needle\n", &[shifted], "needle", "pin"),
        Err("Match at line 1, column 3 no longer matches".into())
    );

    let mixed = [target(1, "first needle", "needle", 0), target(2, "second needle", "needle", 0)];
    assert!(plain("first needle\nsecond CHANGED\n", &mixed, "needle", "pin").is_err());
}

#[test]
fn zero_width_matches_advance_one_code_unit() {
    let t = ReplaceTarget { line: 1.0, text: "ab".into(), start_column: 1.0, end_column: 1.0 };
    assert_eq!(apply("ab\n", &[t], "x*", "-", REGEX), Ok(("a-b\n".into(), 1)));
}

#[test]
fn columns_are_utf16_code_units() {
    let text = "😀 é needle";
    let t = target(1, text, "needle", 0);
    assert_eq!(t.start_column, 5.0);
    assert_eq!(plain(text, &[t], "needle", "pin").unwrap().0, "😀 é pin");
    // Non-unicode mode: `.` matches one code unit, so it can split a pair.
    let half = ReplaceTarget { line: 1.0, text: "😀".into(), start_column: 0.0, end_column: 1.0 };
    assert!(apply("😀", &[half], ".", "x", REGEX).is_ok());
}

#[test]
fn replace_content_writes_and_reports_skips() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("a.txt"), "a needle\n").unwrap();
    fs::write(root.join("stale.txt"), "changed\n").unwrap();
    fs::write(root.join("bin.dat"), b"needle\0").unwrap();
    fs::create_dir(root.join("dir")).unwrap();
    fs::write(root.join("big.txt"), vec![b'a'; 1024 * 1024 + 1]).unwrap();

    let file = |path: &str, text: &str| ReplaceFile {
        path: path.into(),
        targets: vec![target(1, text, "needle", 0)],
    };
    let files = [
        file("/a.txt", "a needle"),
        file("stale.txt", "a needle"),
        file("missing.txt", "a needle"),
        file("bin.dat", "needle"),
        file("dir", "needle"),
        file("big.txt", "needle"),
    ];
    let summary =
        replace_content(root, "needle", "pin", &files, ReplaceOptions::default()).unwrap();
    assert_eq!((summary.replaced_matches, summary.replaced_files), (1, 1));
    let reasons: Vec<_> =
        summary.skipped.iter().map(|s| (s.path.as_str(), s.reason, s.message.as_str())).collect();
    assert_eq!(
        reasons,
        [
            ("stale.txt", "stale", "Line 1 changed on disk"),
            ("missing.txt", "missing", "File no longer exists"),
            ("bin.dat", "unreadable", "File is binary"),
            ("dir", "unreadable", "Not a file"),
            ("big.txt", "unreadable", "File is too large to replace in"),
        ]
    );
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "a pin\n");
    assert_eq!(fs::read_to_string(root.join("stale.txt")).unwrap(), "changed\n");
}

#[test]
fn replace_content_rejects_bad_queries_and_escaping_paths() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.txt"), "a needle\n").unwrap();
    let files =
        [ReplaceFile { path: "a.txt".into(), targets: vec![target(1, "a needle", "needle", 0)] }];
    assert!(matches!(
        replace_content(dir.path(), "(", "x", &files, REGEX),
        Err(RepoFilesError::InvalidArg(_))
    ));
    assert_eq!(fs::read_to_string(dir.path().join("a.txt")).unwrap(), "a needle\n");

    let escaping = [ReplaceFile { path: "../x.txt".into(), targets: files[0].targets.clone() }];
    assert!(matches!(
        replace_content(dir.path(), "needle", "x", &escaping, ReplaceOptions::default()),
        Err(RepoFilesError::PathTraversal)
    ));
}
