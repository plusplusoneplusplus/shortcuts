//! Turning stored symbols into LSP payloads.
//!
//! A stored symbol is a name, a kind and a point. LSP wants a URI and a range,
//! in UTF-16 characters. Producing the range means knowing the target line's
//! text, so a lookup that returns fifty hits across ten files reads those ten
//! files — [`LineCache`] is what keeps it to ten reads rather than fifty.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use coc_native_core::symbol_index::Symbol;
use serde_json::{json, Value};

use crate::positions::{line_text, utf16_character, utf16_len};
use crate::uri::path_to_uri;

/// File contents read on demand while one request is being answered, then
/// dropped. Nothing here is a cache across requests: the index is authoritative
/// for what is in a file, and holding stale text would only invent wrong ranges
/// after an edit.
#[derive(Default)]
pub struct LineCache {
    files: HashMap<PathBuf, Option<String>>,
}

impl LineCache {
    pub fn new() -> Self {
        Self::default()
    }

    fn line(&mut self, path: &Path, line: u32) -> Option<&str> {
        let source = self
            .files
            .entry(path.to_path_buf())
            .or_insert_with(|| std::fs::read_to_string(path).ok());
        line_text(source.as_deref()?, line)
    }
}

/// The LSP range covering a stored symbol's name.
///
/// When the file cannot be read — deleted since the index was written, or
/// binary — the byte column is used as the character offset. That is exactly
/// right for ASCII, which is what the overwhelming majority of C-family source
/// lines are, and a near miss beats refusing to navigate at all.
pub fn symbol_range(cache: &mut LineCache, absolute: &Path, symbol: &Symbol) -> Value {
    let line = symbol.line.saturating_sub(1);
    let start = match cache.line(absolute, line) {
        Some(text) => utf16_character(text, symbol.column),
        None => symbol.column.saturating_sub(1),
    };
    json!({
        "start": { "line": line, "character": start },
        "end": { "line": line, "character": start + utf16_len(&symbol.name) },
    })
}

/// An LSP `Location` for a stored symbol, resolved against the workspace root.
pub fn symbol_location(cache: &mut LineCache, root: &Path, symbol: &Symbol) -> Value {
    let absolute = root.join(&symbol.path);
    json!({
        "uri": path_to_uri(&absolute),
        "range": symbol_range(cache, &absolute, symbol),
    })
}

/// An LSP `SymbolInformation` — the flat shape, deliberately.
///
/// The hierarchical `DocumentSymbol` needs a range spanning each symbol's whole
/// body, and the index stores only the point where a name appears. Inventing
/// those spans would make the outline lie about where a function ends; the flat
/// shape says exactly as much as the index knows, with `parent` as
/// `containerName`.
pub fn symbol_information(cache: &mut LineCache, root: &Path, symbol: &Symbol) -> Value {
    symbol_information_matched(cache, root, symbol, &[])
}

/// `symbol_information` plus the offsets in `name` a palette query scored on.
///
/// The indices ride along as an extension field: a standard LSP client ignores
/// it, and CoC's palette reads it to highlight exactly the characters the
/// ranking was based on instead of re-deriving a match that can disagree.
pub fn symbol_information_matched(
    cache: &mut LineCache,
    root: &Path,
    symbol: &Symbol,
    matches: &[u32],
) -> Value {
    let mut information = json!({
        "name": symbol.name,
        "kind": symbol_kind(&symbol.kind),
        "location": symbol_location(cache, root, symbol),
    });
    if let Some(parent) = &symbol.parent {
        information["containerName"] = json!(parent);
    }
    if !matches.is_empty() {
        information["cocMatchIndices"] = json!(matches);
    }
    information
}

/// Stored kind names to LSP `SymbolKind` numbers.
///
/// `prototype` is a declaration of a function and maps to `Function` like one;
/// the distinction between it and a definition survives in ranking, not here,
/// because LSP has no kind for it. `macro` has no kind either — `Constant` is
/// what clangd picked and matching it keeps icons consistent between the two
/// servers answering the same file.
pub fn symbol_kind(kind: &str) -> u8 {
    match kind {
        "module" => 2,
        "namespace" => 3,
        "class" => 5,
        "method" => 6,
        "property" => 7,
        "field" | "member" => 8,
        "constructor" => 9,
        "enum" => 10,
        "interface" => 11,
        "function" | "prototype" => 12,
        "variable" => 13,
        "macro" | "constant" => 14,
        "enumerator" | "enum_member" => 22,
        "struct" | "union" | "type" | "typedef" => 23,
        _ => 12,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn symbol(name: &str, kind: &str, line: u32, column: u32) -> Symbol {
        Symbol {
            name: name.to_string(),
            kind: kind.to_string(),
            path: "src/a.cpp".to_string(),
            line,
            column,
            parent: None,
            docs: None,
        }
    }

    #[test]
    fn a_range_spans_the_name_in_utf16_characters() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        // `é` is two bytes and one UTF-16 unit, so the stored byte column 12 is
        // character 11.
        std::fs::write(root.join("src/a.cpp"), "// é\nint widen(void);\n").unwrap();
        let located =
            symbol_location(&mut LineCache::new(), root, &symbol("widen", "function", 2, 5));
        assert_eq!(located["range"]["start"], json!({ "line": 1, "character": 4 }));
        assert_eq!(located["range"]["end"], json!({ "line": 1, "character": 9 }));
        assert!(located["uri"].as_str().unwrap().ends_with("/src/a.cpp"));
    }

    #[test]
    fn a_missing_file_still_produces_a_usable_range() {
        let directory = tempfile::tempdir().unwrap();
        let located = symbol_location(
            &mut LineCache::new(),
            directory.path(),
            &symbol("gone", "class", 3, 7),
        );
        assert_eq!(located["range"]["start"], json!({ "line": 2, "character": 6 }));
        assert_eq!(located["range"]["end"], json!({ "line": 2, "character": 10 }));
    }

    #[test]
    fn a_parent_becomes_the_container_name() {
        let directory = tempfile::tempdir().unwrap();
        let mut nested = symbol("run", "method", 1, 1);
        nested.parent = Some("Engine".to_string());
        let information = symbol_information(&mut LineCache::new(), directory.path(), &nested);
        assert_eq!(information["containerName"], json!("Engine"));
        assert_eq!(information["kind"], json!(6));
        let plain =
            symbol_information(&mut LineCache::new(), directory.path(), &symbol("f", "x", 1, 1));
        assert_eq!(plain.get("containerName"), None);
    }

    #[test]
    fn a_prototype_is_a_function_and_a_macro_is_a_constant() {
        assert_eq!(symbol_kind("prototype"), symbol_kind("function"));
        assert_eq!(symbol_kind("macro"), 14);
        assert_eq!(symbol_kind("struct"), 23);
        assert_eq!(symbol_kind("something-new"), 12);
    }
}
