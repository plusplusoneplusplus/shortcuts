//! `.order.json` persistence for notes directories.
//!
//! A port of the persistence half of
//! `packages/coc/src/server/notes/notes-order.ts`. Each notes directory may
//! hold a `.order.json` of the shape `{ "order": ["a", "b.md"] }`; the names
//! listed there sort first, everything else falls back to the alphabetical
//! order the caller established.
//!
//! Only the file operations live here. The sorting half (`applyOrder`) stays in
//! TypeScript, because sibling fallback order is `localeCompare` and
//! reimplementing ICU collation on this side would drift.
//!
//! The written bytes are part of the contract: existing collections are read by
//! older clients and diffed in git, so the output must stay byte-identical to
//! `JSON.stringify({ order }, null, 2)`.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// The per-directory order file. Named the same on every platform.
pub const ORDER_FILE_NAME: &str = ".order.json";

/// Where the order file for `dir` lives.
pub fn order_file_path(dir: &Path) -> PathBuf {
    dir.join(ORDER_FILE_NAME)
}

/// Read a directory's ordered name list.
///
/// A missing, unreadable, or malformed file is not an error — it means "no
/// custom order", the same as the TypeScript's bare `catch`. Non-string entries
/// in the array are dropped; they can never match a directory entry name, and
/// skipping them preserves the relative order of the names that can.
pub fn read_order_file(dir: &Path) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(order_file_path(dir)) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let Some(entries) = parsed.get("order").and_then(Value::as_array) else {
        return Vec::new();
    };
    entries.iter().filter_map(Value::as_str).map(str::to_string).collect()
}

/// Render an order list exactly as `JSON.stringify({ order }, null, 2)` does:
/// two-space indentation and no trailing newline.
pub fn serialize_order(order: &[String]) -> String {
    let document = Value::Object(
        [(
            "order".to_string(),
            Value::Array(order.iter().map(|n| Value::String(n.clone())).collect()),
        )]
        .into_iter()
        .collect(),
    );
    serde_json::to_string_pretty(&document).expect("a map of strings always serializes")
}

/// Persist a directory's ordered name list.
pub fn write_order_file(dir: &Path, order: &[String]) -> io::Result<()> {
    fs::write(order_file_path(dir), serialize_order(order))
}

/// Drop an entry from a directory's order list, called after a delete.
///
/// Does nothing when the file is absent or the name is not listed — in
/// particular it does not create an order file for a directory that had none.
pub fn remove_from_order(dir: &Path, name: &str) -> io::Result<()> {
    let order = read_order_file(dir);
    let filtered: Vec<String> = order.iter().filter(|n| n.as_str() != name).cloned().collect();
    if filtered.len() != order.len() {
        write_order_file(dir, &filtered)?;
    }
    Ok(())
}

/// Rewrite an entry's name in place, called after a rename within one parent.
///
/// Renaming in place rather than removing and appending is what keeps the note
/// where the user put it.
pub fn update_order_on_rename(dir: &Path, old_name: &str, new_name: &str) -> io::Result<()> {
    let mut order = read_order_file(dir);
    if let Some(slot) = order.iter_mut().find(|n| n.as_str() == old_name) {
        *slot = new_name.to_string();
        write_order_file(dir, &order)?;
    }
    Ok(())
}
