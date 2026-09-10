//! `.order.json` persistence.
//!
//! These replace the persistence half of
//! `packages/coc/test/server/notes-order.test.ts`. The byte-format assertions
//! are literal on purpose: the file is committed to users' notes repos and read
//! by clients that were never rebuilt, so the output has to stay identical to
//! `JSON.stringify({ order }, null, 2)`.

use std::fs;
use std::path::Path;

use coc_native_core::notes_fs::order::{
    order_file_path, read_order_file, remove_from_order, serialize_order, update_order_on_rename,
    write_order_file, ORDER_FILE_NAME,
};

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("temp dir")
}

fn raw_order(dir: &Path) -> String {
    fs::read_to_string(order_file_path(dir)).expect("order file")
}

fn names(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

// ── Byte format ──────────────────────────────────────────────────────────────

#[test]
fn serializes_with_two_space_indentation_and_no_trailing_newline() {
    assert_eq!(
        serialize_order(&names(&["b.md", "a.md"])),
        "{\n  \"order\": [\n    \"b.md\",\n    \"a.md\"\n  ]\n}"
    );
}

#[test]
fn serializes_an_empty_list_as_an_inline_empty_array() {
    assert_eq!(serialize_order(&[]), "{\n  \"order\": []\n}");
}

#[test]
fn leaves_non_ascii_names_unescaped_the_way_json_stringify_does() {
    assert_eq!(serialize_order(&names(&["日記.md"])), "{\n  \"order\": [\n    \"日記.md\"\n  ]\n}");
}

#[test]
fn escapes_quotes_and_backslashes_in_names() {
    assert_eq!(
        serialize_order(&names(&["a\"b\\c.md"])),
        "{\n  \"order\": [\n    \"a\\\"b\\\\c.md\"\n  ]\n}"
    );
}

// ── Round trip ───────────────────────────────────────────────────────────────

#[test]
fn writes_then_reads_back_the_same_order() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["second.md", "first.md"])).unwrap();
    assert_eq!(read_order_file(dir.path()), names(&["second.md", "first.md"]));
}

#[test]
fn writes_the_order_file_under_the_expected_name() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md"])).unwrap();
    assert!(dir.path().join(ORDER_FILE_NAME).is_file());
}

#[test]
fn overwrites_an_existing_order_file_rather_than_merging() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md", "b.md"])).unwrap();
    write_order_file(dir.path(), &names(&["c.md"])).unwrap();
    assert_eq!(read_order_file(dir.path()), names(&["c.md"]));
}

// ── Tolerant reads ───────────────────────────────────────────────────────────

#[test]
fn reads_an_empty_list_when_the_file_is_absent() {
    let dir = temp_dir();
    assert!(read_order_file(dir.path()).is_empty());
}

#[test]
fn reads_an_empty_list_when_the_directory_is_absent() {
    let dir = temp_dir();
    assert!(read_order_file(&dir.path().join("nope")).is_empty());
}

#[test]
fn reads_an_empty_list_when_the_json_is_malformed() {
    let dir = temp_dir();
    fs::write(order_file_path(dir.path()), "{ not json").unwrap();
    assert!(read_order_file(dir.path()).is_empty());
}

#[test]
fn reads_an_empty_list_when_order_is_missing_or_not_an_array() {
    let dir = temp_dir();
    fs::write(order_file_path(dir.path()), "{}").unwrap();
    assert!(read_order_file(dir.path()).is_empty());
    fs::write(order_file_path(dir.path()), "{\"order\": \"a.md\"}").unwrap();
    assert!(read_order_file(dir.path()).is_empty());
    fs::write(order_file_path(dir.path()), "[]").unwrap();
    assert!(read_order_file(dir.path()).is_empty());
}

#[test]
fn drops_non_string_entries_but_keeps_the_relative_order_of_the_rest() {
    let dir = temp_dir();
    fs::write(order_file_path(dir.path()), "{\"order\": [\"a.md\", 7, null, \"b.md\"]}").unwrap();
    assert_eq!(read_order_file(dir.path()), names(&["a.md", "b.md"]));
}

// ── remove_from_order ────────────────────────────────────────────────────────

#[test]
fn removing_drops_only_the_named_entry() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md", "b.md", "c.md"])).unwrap();
    remove_from_order(dir.path(), "b.md").unwrap();
    assert_eq!(read_order_file(dir.path()), names(&["a.md", "c.md"]));
}

#[test]
fn removing_an_unlisted_name_leaves_the_file_byte_identical() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md"])).unwrap();
    let before = raw_order(dir.path());
    remove_from_order(dir.path(), "missing.md").unwrap();
    assert_eq!(raw_order(dir.path()), before);
}

#[test]
fn removing_does_not_create_an_order_file_for_a_directory_without_one() {
    let dir = temp_dir();
    remove_from_order(dir.path(), "a.md").unwrap();
    assert!(!order_file_path(dir.path()).exists());
}

#[test]
fn removing_the_last_entry_leaves_an_empty_order_list() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md"])).unwrap();
    remove_from_order(dir.path(), "a.md").unwrap();
    assert_eq!(raw_order(dir.path()), "{\n  \"order\": []\n}");
}

// ── update_order_on_rename ───────────────────────────────────────────────────

#[test]
fn renaming_replaces_the_name_in_place() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md", "b.md", "c.md"])).unwrap();
    update_order_on_rename(dir.path(), "b.md", "z.md").unwrap();
    assert_eq!(read_order_file(dir.path()), names(&["a.md", "z.md", "c.md"]));
}

#[test]
fn renaming_an_unlisted_name_leaves_the_file_byte_identical() {
    let dir = temp_dir();
    write_order_file(dir.path(), &names(&["a.md"])).unwrap();
    let before = raw_order(dir.path());
    update_order_on_rename(dir.path(), "missing.md", "z.md").unwrap();
    assert_eq!(raw_order(dir.path()), before);
}

#[test]
fn renaming_does_not_create_an_order_file_for_a_directory_without_one() {
    let dir = temp_dir();
    update_order_on_rename(dir.path(), "a.md", "b.md").unwrap();
    assert!(!order_file_path(dir.path()).exists());
}

#[test]
fn renaming_rewrites_only_the_first_occurrence_of_a_duplicated_name() {
    let dir = temp_dir();
    fs::write(order_file_path(dir.path()), "{\"order\": [\"a.md\", \"a.md\"]}").unwrap();
    update_order_on_rename(dir.path(), "a.md", "b.md").unwrap();
    assert_eq!(read_order_file(dir.path()), names(&["b.md", "a.md"]));
}
