//! Gitignore-aware C-family definition extraction.
//!
//! Each build creates an immutable snapshot outside the state lock, then swaps
//! its `Arc` atomically. A bad or over-budget file is recorded as a failure and
//! does not abort extraction of the rest of the repository.

use std::fmt;
use std::io::{self, Read};
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Language, Node, ParseOptions, Parser, QueryCursor};
use tree_sitter_tags::TagsConfiguration;

use crate::repo_index::walk::{walk, WalkOptions};

const DEFAULT_MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
const DEFAULT_MAX_NESTING_DEPTH: usize = 1_024;
const DEFAULT_MAX_PARSE_TIME: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug)]
pub struct ExtractionLimits {
    pub max_file_bytes: usize,
    pub max_nesting_depth: usize,
    pub max_parse_time: Duration,
}

impl Default for ExtractionLimits {
    fn default() -> Self {
        Self {
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
            max_nesting_depth: DEFAULT_MAX_NESTING_DEPTH,
            max_parse_time: DEFAULT_MAX_PARSE_TIME,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub path: String,
    /// One-based source line.
    pub line: u32,
    /// One-based UTF-8 source column.
    pub column: u32,
    pub parent: Option<String>,
    pub docs: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SymbolFileFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Default)]
pub struct SymbolSnapshot {
    symbols: Vec<Symbol>,
    failures: Vec<SymbolFileFailure>,
    files_scanned: usize,
}

impl SymbolSnapshot {
    pub fn symbols(&self) -> &[Symbol] {
        &self.symbols
    }

    pub fn failures(&self) -> &[SymbolFileFailure] {
        &self.failures
    }

    pub fn files_scanned(&self) -> usize {
        self.files_scanned
    }
}

#[derive(Debug)]
pub enum ExtractError {
    UnsupportedExtension(String),
    FileTooLarge { bytes: usize, limit: usize },
    NestingTooDeep { depth: usize, limit: usize },
    ParseTimedOut(Duration),
    InvalidUtf8,
    Language(tree_sitter::LanguageError),
    Tags(tree_sitter_tags::Error),
}

impl fmt::Display for ExtractError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedExtension(extension) => {
                write!(f, "unsupported C-family extension: {extension}")
            }
            Self::FileTooLarge { bytes, limit } => {
                write!(f, "file is {bytes} bytes; limit is {limit}")
            }
            Self::NestingTooDeep { depth, limit } => {
                write!(f, "nesting depth {depth} exceeds limit {limit}")
            }
            Self::ParseTimedOut(limit) => write!(f, "parse exceeded {} ms", limit.as_millis()),
            Self::InvalidUtf8 => write!(f, "symbol name is not valid UTF-8"),
            Self::Language(error) => write!(f, "{error}"),
            Self::Tags(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for ExtractError {}

impl From<tree_sitter_tags::Error> for ExtractError {
    fn from(error: tree_sitter_tags::Error) -> Self {
        Self::Tags(error)
    }
}

impl From<tree_sitter::LanguageError> for ExtractError {
    fn from(error: tree_sitter::LanguageError) -> Self {
        Self::Language(error)
    }
}

pub struct SymbolExtractor {
    c: TagsConfiguration,
    cpp: TagsConfiguration,
    limits: ExtractionLimits,
}

impl SymbolExtractor {
    pub fn new(limits: ExtractionLimits) -> Result<Self, ExtractError> {
        Ok(Self {
            c: configuration(tree_sitter_c::LANGUAGE.into(), tree_sitter_c::TAGS_QUERY)?,
            cpp: configuration(tree_sitter_cpp::LANGUAGE.into(), tree_sitter_cpp::TAGS_QUERY)?,
            limits,
        })
    }

    pub fn extract(&self, path: &str, source: &[u8]) -> Result<Vec<Symbol>, ExtractError> {
        if source.len() > self.limits.max_file_bytes {
            return Err(ExtractError::FileTooLarge {
                bytes: source.len(),
                limit: self.limits.max_file_bytes,
            });
        }
        let depth = maximum_delimiter_depth(source);
        if depth > self.limits.max_nesting_depth {
            return Err(ExtractError::NestingTooDeep {
                depth,
                limit: self.limits.max_nesting_depth,
            });
        }

        let config = configuration_for_path(path, &self.c, &self.cpp)?;
        let started = Instant::now();
        let mut parser = Parser::new();
        parser.set_language(&config.language)?;
        let tree = parser
            .parse_with_options(
                &mut |offset, _| source.get(offset..).unwrap_or_default(),
                None,
                Some(ParseOptions::new().progress_callback(&mut |_| {
                    if started.elapsed() > self.limits.max_parse_time {
                        ControlFlow::Break(())
                    } else {
                        ControlFlow::Continue(())
                    }
                })),
            )
            .ok_or(ExtractError::ParseTimedOut(self.limits.max_parse_time))?;

        let capture_names = config.query.capture_names();
        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(&config.query, tree.root_node(), source);
        let mut symbols = Vec::new();
        while let Some(query_match) = matches.next() {
            let definition = query_match.captures().iter().find_map(|capture| {
                let capture_name = capture_names[capture.index as usize];
                capture_name.strip_prefix("definition.").map(|kind| (kind, capture.node))
            });
            let name_node = query_match
                .captures()
                .iter()
                .find(|capture| capture_names[capture.index as usize] == "name")
                .map(|capture| capture.node);
            let (Some((kind, definition_node)), Some(name_node)) = (definition, name_node) else {
                continue;
            };
            let name = node_text(name_node, source)?.to_owned();
            let position = name_node.start_position();
            symbols.push(Symbol {
                name,
                kind: kind.to_owned(),
                path: path.to_owned(),
                line: u32::try_from(position.row).unwrap_or(u32::MAX).saturating_add(1),
                column: utf16_column(source, name_node.start_byte()).saturating_add(1),
                parent: symbol_parent(name_node, source),
                docs: adjacent_docs(definition_node, source),
            });
        }
        Ok(symbols)
    }
}

#[derive(Clone)]
pub struct SymbolIndex {
    root: PathBuf,
    limits: ExtractionLimits,
    state: Arc<RwLock<Arc<SymbolSnapshot>>>,
}

impl SymbolIndex {
    pub fn build(root: PathBuf, limits: ExtractionLimits) -> io::Result<Self> {
        let snapshot = Arc::new(build_snapshot(&root, limits)?);
        Ok(Self { root, limits, state: Arc::new(RwLock::new(snapshot)) })
    }

    pub fn refresh(&self) -> io::Result<()> {
        let rebuilt = Arc::new(build_snapshot(&self.root, self.limits)?);
        *self.state.write().unwrap_or_else(|error| error.into_inner()) = rebuilt;
        Ok(())
    }

    pub fn snapshot(&self) -> Arc<SymbolSnapshot> {
        Arc::clone(&self.state.read().unwrap_or_else(|error| error.into_inner()))
    }
}

fn build_snapshot(root: &Path, limits: ExtractionLimits) -> io::Result<SymbolSnapshot> {
    let (paths, _) = walk(root, &WalkOptions::default())?;
    let paths: Vec<String> = paths.into_iter().filter(|path| is_c_family_path(path)).collect();
    let extractor = SymbolExtractor::new(limits)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let results: Vec<Result<Vec<Symbol>, SymbolFileFailure>> = paths
        .par_iter()
        .map(|relative| {
            let absolute = root.join(relative);
            let source = read_bounded(&absolute, limits.max_file_bytes).map_err(|error| {
                SymbolFileFailure { path: relative.clone(), reason: error.to_string() }
            })?;
            extractor.extract(relative, &source).map_err(|error| SymbolFileFailure {
                path: relative.clone(),
                reason: error.to_string(),
            })
        })
        .collect();

    let mut symbols = Vec::new();
    let mut failures = Vec::new();
    for result in results {
        match result {
            Ok(mut file_symbols) => symbols.append(&mut file_symbols),
            Err(failure) => failures.push(failure),
        }
    }
    symbols.sort_by(|left, right| {
        (&left.path, left.line, left.column, &left.name).cmp(&(
            &right.path,
            right.line,
            right.column,
            &right.name,
        ))
    });
    failures.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(SymbolSnapshot { symbols, failures, files_scanned: paths.len() })
}

fn configuration(language: Language, tags_query: &str) -> Result<TagsConfiguration, ExtractError> {
    TagsConfiguration::new(language, tags_query, "").map_err(ExtractError::from)
}

fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>, io::Error> {
    let mut file = std::fs::File::open(path)?;
    let mut source = Vec::with_capacity(limit.min(64 * 1024).saturating_add(1));
    file.by_ref().take(limit.saturating_add(1) as u64).read_to_end(&mut source)?;
    if source.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("file is larger than {limit} bytes"),
        ));
    }
    Ok(source)
}

fn configuration_for_path<'a>(
    path: &str,
    c: &'a TagsConfiguration,
    cpp: &'a TagsConfiguration,
) -> Result<&'a TagsConfiguration, ExtractError> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "c" | "m" => Ok(c),
        "cc" | "cpp" | "cxx" | "c++" | "h" | "hh" | "hpp" | "hxx" | "h++" | "inl" | "ipp"
        | "cu" | "cuh" | "mm" => Ok(cpp),
        _ => Err(ExtractError::UnsupportedExtension(extension)),
    }
}

fn is_c_family_path(path: &str) -> bool {
    configuration_extension(path).is_some()
}

fn configuration_extension(path: &str) -> Option<String> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "c" | "cc"
            | "cpp"
            | "cxx"
            | "c++"
            | "h"
            | "hh"
            | "hpp"
            | "hxx"
            | "h++"
            | "inl"
            | "ipp"
            | "cu"
            | "cuh"
            | "m"
            | "mm"
    )
    .then_some(extension)
}

fn maximum_delimiter_depth(source: &[u8]) -> usize {
    let mut depth = 0usize;
    let mut maximum = 0usize;
    for byte in source {
        match byte {
            b'{' | b'(' | b'[' => {
                depth = depth.saturating_add(1);
                maximum = maximum.max(depth);
            }
            b'}' | b')' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    maximum
}

fn node_text<'a>(node: Node<'_>, source: &'a [u8]) -> Result<&'a str, ExtractError> {
    std::str::from_utf8(&source[node.byte_range()]).map_err(|_| ExtractError::InvalidUtf8)
}

fn utf16_column(source: &[u8], byte_offset: usize) -> u32 {
    let line_start = source[..byte_offset]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |position| position + 1);
    let prefix = std::str::from_utf8(&source[line_start..byte_offset]).unwrap_or_default();
    u32::try_from(prefix.encode_utf16().count()).unwrap_or(u32::MAX)
}

fn symbol_parent(name_node: Node<'_>, source: &[u8]) -> Option<String> {
    if let Some(parent) = name_node.parent() {
        if parent.kind() == "qualified_identifier" {
            if let Some(scope) = parent.child_by_field_name("scope") {
                return node_text(scope, source).ok().map(str::to_owned);
            }
        }
    }
    let mut ancestor = name_node.parent();
    while let Some(node) = ancestor {
        if matches!(
            node.kind(),
            "namespace_definition" | "class_specifier" | "struct_specifier" | "union_specifier"
        ) {
            if let Some(parent_name) = node.child_by_field_name("name") {
                if parent_name.byte_range() != name_node.byte_range() {
                    return node_text(parent_name, source).ok().map(str::to_owned);
                }
            }
        }
        ancestor = node.parent();
    }
    None
}

fn adjacent_docs(mut node: Node<'_>, source: &[u8]) -> Option<String> {
    loop {
        if let Some(comment) =
            node.prev_named_sibling().filter(|sibling| sibling.kind() == "comment")
        {
            let between = &source[comment.end_byte()..node.start_byte()];
            if between.iter().all(u8::is_ascii_whitespace)
                && !between.windows(2).any(|window| window == b"\n\n")
            {
                return node_text(comment, source).ok().map(strip_comment);
            }
        }
        node = node.parent()?;
    }
}

fn strip_comment(comment: &str) -> String {
    comment
        .trim()
        .trim_start_matches("///")
        .trim_start_matches("//")
        .trim_start_matches("/*")
        .trim_end_matches("*/")
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const C_FIXTURE: &str = include_str!("../../tests/fixtures/symbol_index/sample.c");
    const CPP_FIXTURE: &str = include_str!("../../tests/fixtures/symbol_index/sample.cpp");
    const HEADER_FIXTURE: &str = include_str!("../../tests/fixtures/symbol_index/sample.hpp");
    const PATHOLOGICAL_FIXTURE: &str =
        include_str!("../../tests/fixtures/symbol_index/pathological.c");

    #[test]
    fn extracts_c_definitions() {
        let extractor =
            SymbolExtractor::new(ExtractionLimits::default()).expect("valid bundled queries");
        let symbols =
            extractor.extract("src/sample.c", C_FIXTURE.as_bytes()).expect("C extraction");
        assert!(symbols.iter().any(|symbol| symbol.name == "point" && symbol.kind == "class"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "make_point" && symbol.kind == "function"));
        let function = symbols.iter().find(|symbol| symbol.name == "make_point").expect("function");
        assert_eq!(function.path, "src/sample.c");
        assert_eq!(function.line, 7);
        assert_eq!(function.column, 14);
        assert_eq!(function.docs.as_deref(), Some("Build a point from two coordinates."));
    }

    #[test]
    fn extracts_cpp_templates_namespaces_and_members() {
        let extractor =
            SymbolExtractor::new(ExtractionLimits::default()).expect("valid bundled queries");
        let symbols =
            extractor.extract("src/sample.cpp", CPP_FIXTURE.as_bytes()).expect("C++ extraction");
        assert!(symbols.iter().any(|symbol| symbol.name == "Box" && symbol.kind == "class"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "Box" && symbol.parent.as_deref() == Some("fixture")));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "value" && symbol.parent.as_deref() == Some("Box")));
        assert!(symbols.iter().any(|symbol| symbol.name == "make_box"));
    }

    #[test]
    fn maps_headers_to_cpp() {
        let extractor =
            SymbolExtractor::new(ExtractionLimits::default()).expect("valid bundled queries");
        let symbols = extractor
            .extract("include/sample.hpp", HEADER_FIXTURE.as_bytes())
            .expect("header extraction");
        assert!(symbols.iter().any(|symbol| symbol.name == "HeaderOnly"));
    }

    #[test]
    fn one_pathological_file_does_not_abort_a_repository_build() {
        let root = tempdir().expect("tempdir");
        std::fs::write(root.path().join("good.c"), C_FIXTURE).expect("good fixture");
        std::fs::write(root.path().join("pathological.c"), PATHOLOGICAL_FIXTURE)
            .expect("bad fixture");
        std::fs::write(root.path().join("ignored.txt"), "not C").expect("ignored fixture");

        let index = SymbolIndex::build(
            root.path().to_path_buf(),
            ExtractionLimits { max_nesting_depth: 32, ..ExtractionLimits::default() },
        )
        .expect("repository build");
        let snapshot = index.snapshot();

        assert_eq!(snapshot.files_scanned(), 2);
        assert!(snapshot.symbols().iter().any(|symbol| symbol.name == "make_point"));
        assert_eq!(snapshot.failures().len(), 1);
        assert_eq!(snapshot.failures()[0].path, "pathological.c");
        assert!(snapshot.failures()[0].reason.contains("nesting depth"));
    }

    #[test]
    fn filters_ignored_and_non_c_files_before_reading() {
        let root = tempdir().expect("tempdir");
        std::fs::create_dir(root.path().join(".git")).expect("git directory");
        std::fs::write(root.path().join(".gitignore"), "ignored.c\n").expect("gitignore");
        std::fs::write(root.path().join("visible.c"), C_FIXTURE).expect("visible C");
        std::fs::write(root.path().join("ignored.c"), C_FIXTURE).expect("ignored C");
        std::fs::write(root.path().join("notes.txt"), "not C").expect("non-C");

        let snapshot = SymbolIndex::build(root.path().to_path_buf(), ExtractionLimits::default())
            .expect("repository build")
            .snapshot();

        assert_eq!(snapshot.files_scanned(), 1);
        assert!(snapshot.symbols().iter().all(|symbol| symbol.path == "visible.c"));
    }

    #[test]
    fn reports_utf16_columns_after_non_ascii_text() {
        let extractor =
            SymbolExtractor::new(ExtractionLimits::default()).expect("valid bundled queries");
        let source = "const char *label = \"😀\"; int target() { return 0; }\n";
        let target = extractor
            .extract("unicode.cpp", source.as_bytes())
            .expect("C++ extraction")
            .into_iter()
            .find(|symbol| symbol.name == "target")
            .expect("target symbol");
        let expected =
            source[..source.find("target").expect("target byte")].encode_utf16().count() as u32 + 1;
        assert_eq!(target.column, expected);
    }

    #[test]
    fn bounds_file_reads_before_allocating_the_whole_file() {
        let root = tempdir().expect("tempdir");
        let file = root.path().join("large.cpp");
        std::fs::write(&file, vec![b'x'; 65]).expect("large fixture");

        let error = read_bounded(&file, 64).expect_err("oversized file");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("larger than 64 bytes"));
    }

    #[test]
    fn keeps_old_snapshots_alive_across_refresh() {
        let root = tempdir().expect("tempdir");
        std::fs::write(root.path().join("first.c"), "int first() { return 1; }\n").expect("first");
        let index = SymbolIndex::build(root.path().to_path_buf(), ExtractionLimits::default())
            .expect("build");
        let old = index.snapshot();
        std::fs::write(root.path().join("second.c"), "int second() { return 2; }\n")
            .expect("second");

        index.refresh().expect("refresh");
        let current = index.snapshot();

        assert!(old.symbols().iter().all(|symbol| symbol.name != "second"));
        assert!(current.symbols().iter().any(|symbol| symbol.name == "second"));
    }

    #[test]
    fn cancels_parsing_at_the_configured_deadline() {
        let extractor = SymbolExtractor::new(ExtractionLimits {
            max_parse_time: Duration::ZERO,
            ..ExtractionLimits::default()
        })
        .expect("valid bundled queries");

        assert!(matches!(
            extractor.extract("sample.cpp", CPP_FIXTURE.as_bytes()),
            Err(ExtractError::ParseTimedOut(_))
        ));
    }
}
