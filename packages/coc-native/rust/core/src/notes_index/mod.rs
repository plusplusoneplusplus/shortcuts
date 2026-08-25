//! An in-memory full-text index for one resolved Notes root.
//!
//! The snapshot owns the original Markdown lines together with their
//! JavaScript-compatible lowercase forms. Filesystem reads and lowercase work
//! therefore happen while the snapshot is built, while a search only walks
//! immutable memory and returns a bounded response.

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

/// Maximum number of matching files returned by one search.
pub const MAX_MATCHING_FILES: usize = 50;
/// Maximum number of filename and content matches returned by one search.
pub const MAX_TOTAL_MATCHES: usize = 100;
/// Maximum number of root-relative filesystem hints accepted by one
/// incremental refresh.
pub const MAX_CHANGED_PATHS: usize = 1_024;

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

#[derive(Clone, Debug)]
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

#[derive(Clone, Debug)]
struct IndexedDocument {
    path: String,
    basename: IndexedText,
    /// An unreadable file still contributes a filename match, matching the
    /// Node scanner, but has no searchable content lines.
    lines: Vec<IndexedText>,
}

#[derive(Clone, Debug, Default)]
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

    fn refresh_changed(
        &self,
        root: &Path,
        options: NotesIndexOptions,
        changed_paths: &[String],
    ) -> io::Result<Self> {
        validate_incremental_root(root)?;
        if changed_paths.len() > MAX_CHANGED_PATHS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "changed-path batch has {} entries; maximum is {MAX_CHANGED_PATHS}",
                    changed_paths.len()
                ),
            ));
        }

        let normalized = changed_paths
            .iter()
            .map(|path| normalize_changed_path(path))
            .collect::<io::Result<BTreeSet<_>>>()?;
        let mut documents = self
            .documents
            .iter()
            .cloned()
            .map(|document| (document.path.clone(), document))
            .collect::<HashMap<_, _>>();

        for relative_path in normalized {
            documents.remove(&relative_path);
            if let Some(document) = read_changed_document(root, &relative_path, options)? {
                documents.insert(relative_path, document);
            }
        }

        let mut documents = documents.into_values().collect::<Vec<_>>();
        documents.sort_unstable_by(|left, right| compare_relative_paths(&left.path, &right.path));
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
    /// Writers serialize before capturing the current snapshot, so concurrent
    /// incremental batches cannot overwrite each other's completed changes.
    refresh_lock: Arc<Mutex<()>>,
}

impl NotesIndex {
    /// Recursively build a complete searchable snapshot.
    ///
    /// A missing root is a valid empty index. Other root-level errors are
    /// returned, while unreadable descendants are skipped.
    pub fn build(root: PathBuf, options: NotesIndexOptions) -> io::Result<Self> {
        let snapshot = NotesSnapshot::build(&root, options)?;
        Ok(Self {
            root,
            options,
            state: Arc::new(RwLock::new(Arc::new(snapshot))),
            refresh_lock: Arc::new(Mutex::new(())),
        })
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

    /// Rebuild the complete root and atomically replace the current snapshot.
    ///
    /// The old snapshot remains searchable while the replacement is built and
    /// is retained when construction fails.
    pub fn refresh(&self) -> io::Result<()> {
        let _guard = self.refresh_lock.lock().unwrap_or_else(|error| error.into_inner());
        let rebuilt = Arc::new(NotesSnapshot::build(&self.root, self.options)?);
        self.replace_snapshot(rebuilt);
        Ok(())
    }

    /// Apply a bounded batch of normalized, root-relative file hints and
    /// atomically replace the current snapshot.
    ///
    /// Existing eligible Markdown files are upserted from disk and missing or
    /// ineligible files are removed. Ambiguous directory hints and unsafe paths
    /// fail the batch so the caller can recover with a full refresh. Concurrent
    /// refresh calls serialize, ensuring each batch starts from the last
    /// complete snapshot rather than losing an earlier batch.
    pub fn refresh_changed(&self, changed_paths: &[String]) -> io::Result<()> {
        let _guard = self.refresh_lock.lock().unwrap_or_else(|error| error.into_inner());
        let rebuilt =
            Arc::new(self.snapshot().refresh_changed(&self.root, self.options, changed_paths)?);
        self.replace_snapshot(rebuilt);
        Ok(())
    }

    fn snapshot(&self) -> Arc<NotesSnapshot> {
        Arc::clone(&self.state.read().unwrap_or_else(|error| error.into_inner()))
    }

    fn replace_snapshot(&self, snapshot: Arc<NotesSnapshot>) {
        let mut slot = self.state.write().unwrap_or_else(|error| error.into_inner());
        *slot = snapshot;
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
    // `read_dir` hands back filesystem order, which differs per platform —
    // NTFS enumerates case-insensitively, so `bytes.md` precedes `Needle.md`
    // there. Sort by the raw filename bytes instead, so snapshot order, cap
    // boundaries, and result order are the same on every host.
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

fn validate_incremental_root(root: &Path) -> io::Result<()> {
    match fs::metadata(root) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("not a directory: {}", root.display()),
        )),
        Err(error) => Err(error),
    }
}

fn normalize_changed_path(path: &str) -> io::Result<String> {
    let normalized = path.replace('\\', "/");
    let drive_absolute = normalized.as_bytes().get(1) == Some(&b':')
        && normalized.as_bytes().first().is_some_and(u8::is_ascii_alphabetic);
    if normalized.is_empty()
        || normalized.starts_with('/')
        || drive_absolute
        || normalized.contains('\0')
        || normalized
            .split('/')
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid root-relative changed path: {path:?}"),
        ));
    }
    Ok(normalized)
}

fn read_changed_document(
    root: &Path,
    relative_path: &str,
    options: NotesIndexOptions,
) -> io::Result<Option<IndexedDocument>> {
    let components = relative_path.split('/').collect::<Vec<_>>();
    let mut absolute_path = root.to_path_buf();
    let mut target_metadata = None;

    for (index, component) in components.iter().enumerate() {
        absolute_path.push(component);
        let metadata = match fs::symlink_metadata(&absolute_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        if options.skip_symlinks && metadata.file_type().is_symlink() {
            return Ok(None);
        }
        if index + 1 < components.len() && !metadata.is_dir() {
            return Ok(None);
        }
        target_metadata = Some(metadata);
    }

    let metadata = target_metadata.expect("a normalized changed path has a component");
    if metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("directory-level Notes change requires a full refresh: {relative_path}"),
        ));
    }

    let basename = components.last().expect("a normalized changed path has a basename");
    if !basename.ends_with(".md") {
        return Ok(None);
    }

    let lines: Vec<String> = fs::read(absolute_path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).split('\n').map(str::to_owned).collect())
        .unwrap_or_default();
    Ok(Some(IndexedDocument {
        path: relative_path.to_owned(),
        basename: IndexedText::new((*basename).to_owned()),
        lines: lines.into_iter().map(IndexedText::new).collect(),
    }))
}

fn compare_relative_paths(left: &str, right: &str) -> Ordering {
    let mut left = left.split('/');
    let mut right = right.split('/');
    loop {
        match (left.next(), right.next()) {
            (Some(left), Some(right)) => match left.cmp(right) {
                Ordering::Equal => {}
                ordering => return ordering,
            },
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
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
