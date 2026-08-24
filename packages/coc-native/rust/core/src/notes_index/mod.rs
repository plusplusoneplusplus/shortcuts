//! An in-memory full-text index for one resolved Notes root.
//!
//! The snapshot owns the original Markdown lines together with their
//! JavaScript-compatible lowercase forms. Filesystem reads and lowercase work
//! therefore happen while the snapshot is built, while a search only walks
//! immutable memory and returns a bounded response.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

/// Maximum number of matching files returned by one search.
pub const MAX_MATCHING_FILES: usize = 50;
/// Maximum number of filename and content matches returned by one search.
pub const MAX_TOTAL_MATCHES: usize = 100;

/// Filesystem policy for one resolved Notes root.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct NotesIndexOptions {
    /// Skip every symbolic-link entry. External and task-derived Notes roots
    /// enable this to prevent reads outside the resolved root.
    pub skip_symlinks: bool,
}

/// One filename or content-line match.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotesMatch {
    /// Zero for a filename match, otherwise the one-based content line.
    pub line: usize,
    /// The original basename or line text, without lowercase normalization.
    pub text: String,
}

/// All matches for one root-relative Markdown path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotesSearchResult {
    /// Root-relative path with `/` separators on every platform.
    pub path: String,
    /// Filename match first, followed by content matches in line order.
    pub matches: Vec<NotesMatch>,
}

/// The bounded response from one index search.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotesSearchResponse {
    pub results: Vec<NotesSearchResult>,
    pub truncated: bool,
}

#[derive(Debug)]
struct IndexedText {
    original: String,
    lowercase: String,
}

impl IndexedText {
    fn new(original: String) -> Self {
        let lowercase = javascript_lowercase(&original);
        Self { original, lowercase }
    }
}

#[derive(Debug)]
struct IndexedDocument {
    path: String,
    basename: IndexedText,
    /// An unreadable file still contributes a filename match, matching the
    /// Node scanner, but has no searchable content lines.
    lines: Vec<IndexedText>,
}

#[derive(Debug, Default)]
struct NotesSnapshot {
    documents: Vec<IndexedDocument>,
}

impl NotesSnapshot {
    fn build(root: &Path, options: NotesIndexOptions) -> io::Result<Self> {
        match fs::metadata(root) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("not a directory: {}", root.display()),
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(error) => return Err(error),
        }

        let mut documents = Vec::new();
        walk_directory(root, "", options, &mut documents);
        Ok(Self { documents })
    }

    fn search(&self, query: &str) -> NotesSearchResponse {
        let lowercase_query = javascript_lowercase(query);
        let mut results = Vec::new();
        let mut total_matches = 0usize;

        for document in &self.documents {
            if results.len() >= MAX_MATCHING_FILES || total_matches >= MAX_TOTAL_MATCHES {
                break;
            }

            let mut matches = Vec::new();
            if document.basename.lowercase.contains(&lowercase_query) {
                matches.push(NotesMatch { line: 0, text: document.basename.original.clone() });
                total_matches += 1;
            }

            if total_matches < MAX_TOTAL_MATCHES {
                for (index, line) in document.lines.iter().enumerate() {
                    if total_matches >= MAX_TOTAL_MATCHES {
                        break;
                    }
                    if line.lowercase.contains(&lowercase_query) {
                        matches.push(NotesMatch { line: index + 1, text: line.original.clone() });
                        total_matches += 1;
                    }
                }
            }

            if !matches.is_empty() {
                results.push(NotesSearchResult { path: document.path.clone(), matches });
            }
        }

        NotesSearchResponse {
            truncated: results.len() >= MAX_MATCHING_FILES || total_matches >= MAX_TOTAL_MATCHES,
            results,
        }
    }
}

/// A Notes content index rooted at one already-authorized directory.
///
/// Cloning yields another handle to the same immutable snapshot. A lock-backed
/// slot keeps snapshot replacement atomic for the refresh operations layered
/// on this core index.
#[derive(Clone)]
pub struct NotesIndex {
    root: PathBuf,
    options: NotesIndexOptions,
    state: Arc<RwLock<Arc<NotesSnapshot>>>,
}

impl NotesIndex {
    /// Recursively build a complete searchable snapshot.
    ///
    /// A missing root is a valid empty index. Other root-level errors are
    /// returned, while unreadable descendants are skipped.
    pub fn build(root: PathBuf, options: NotesIndexOptions) -> io::Result<Self> {
        let snapshot = NotesSnapshot::build(&root, options)?;
        Ok(Self { root, options, state: Arc::new(RwLock::new(Arc::new(snapshot))) })
    }

    /// The resolved root represented by this index.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The root-specific symlink policy retained for later refreshes.
    pub fn options(&self) -> NotesIndexOptions {
        self.options
    }

    /// Number of eligible Markdown documents in the current snapshot.
    pub fn document_count(&self) -> usize {
        self.snapshot().documents.len()
    }

    /// Search the current complete snapshot.
    pub fn search(&self, query: &str) -> NotesSearchResponse {
        self.snapshot().search(query)
    }

    fn snapshot(&self) -> Arc<NotesSnapshot> {
        Arc::clone(&self.state.read().unwrap_or_else(|error| error.into_inner()))
    }
}

/// ECMAScript `String.prototype.toLowerCase()` uses Unicode's default,
/// locale-independent lowercase mapping. Rust's `str::to_lowercase` implements
/// the same mapping, including multi-character results such as `İ` → `i̇`.
fn javascript_lowercase(value: &str) -> String {
    value.to_lowercase()
}

fn walk_directory(
    directory: &Path,
    relative_directory: &str,
    options: NotesIndexOptions,
    documents: &mut Vec<IndexedDocument>,
) {
    let mut entries = match fs::read_dir(directory) {
        Ok(entries) => entries.flatten().collect::<Vec<_>>(),
        Err(_) => return,
    };
    // Node's `fs.readdir` is backed by libuv's sorted scandir result. Sort by
    // the platform-native filename representation so snapshot order, cap
    // boundaries, and result order stay aligned on Unix and Windows.
    entries.sort_unstable_by_key(|entry| entry.file_name());

    for entry in entries {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if options.skip_symlinks && file_type.is_symlink() {
            continue;
        }

        let basename = entry.file_name().to_string_lossy().into_owned();
        let relative_path = join_relative_path(relative_directory, &basename);
        if file_type.is_dir() {
            walk_directory(&entry.path(), &relative_path, options, documents);
        } else if basename.ends_with(".md") {
            let lines: Vec<String> = fs::read(entry.path())
                .ok()
                .map(|bytes| {
                    String::from_utf8_lossy(&bytes).split('\n').map(str::to_owned).collect()
                })
                .unwrap_or_default();
            documents.push(IndexedDocument {
                path: relative_path,
                basename: IndexedText::new(basename),
                lines: lines.into_iter().map(IndexedText::new).collect(),
            });
        }
    }
}

fn join_relative_path(parent: &str, basename: &str) -> String {
    if parent.is_empty() {
        basename.to_owned()
    } else {
        format!("{parent}/{basename}")
    }
}
