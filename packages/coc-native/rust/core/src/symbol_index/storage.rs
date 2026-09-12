use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use rusqlite::{params, Connection, Transaction};

use super::{
    is_c_family_path, read_bounded, ExtractionLimits, Symbol, SymbolExtractor, SymbolFileFailure,
};
use crate::repo_index::walk::{walk, WalkOptions};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileManifestEntry {
    pub path: String,
    pub size: i64,
    pub mtime: i64,
    pub hash: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SyncStats {
    pub scanned: usize,
    pub parsed: usize,
    pub unchanged: usize,
    pub removed: usize,
    pub failures: Vec<SymbolFileFailure>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncProgressPhase {
    Scanning,
    Indexing,
    Complete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SyncProgress {
    pub phase: SyncProgressPhase,
    pub processed: usize,
    pub total: usize,
}

pub struct SymbolStore {
    connection: Mutex<Connection>,
}

enum PreparedFile {
    ManifestOnly(FileManifestEntry),
    Parsed(FileManifestEntry, Vec<Symbol>),
    Failed(SymbolFileFailure),
}

impl SymbolStore {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS files (
                 id INTEGER PRIMARY KEY,
                 path TEXT NOT NULL UNIQUE,
                 size INTEGER NOT NULL,
                 mtime INTEGER NOT NULL,
                 hash TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS symbols (
                 name TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                 line INTEGER NOT NULL,
                 col INTEGER NOT NULL,
                 parent TEXT
             );
             CREATE INDEX IF NOT EXISTS symbols_name_idx ON symbols(name);
             CREATE INDEX IF NOT EXISTS symbols_file_id_idx ON symbols(file_id);",
        )?;
        Ok(Self { connection: Mutex::new(connection) })
    }

    pub fn manifest(&self) -> rusqlite::Result<Vec<FileManifestEntry>> {
        let connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let mut statement =
            connection.prepare("SELECT path, size, mtime, hash FROM files ORDER BY path")?;
        let rows = statement
            .query_map([], |row| {
                Ok(FileManifestEntry {
                    path: row.get(0)?,
                    size: row.get(1)?,
                    mtime: row.get(2)?,
                    hash: row.get(3)?,
                })
            })?
            .collect();
        rows
    }

    pub fn symbols_for_file(&self, path: &str) -> rusqlite::Result<Vec<Symbol>> {
        let connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let mut statement = connection.prepare(
            "SELECT s.name, s.kind, f.path, s.line, s.col, s.parent
             FROM symbols s JOIN files f ON f.id = s.file_id
             WHERE f.path = ?1 ORDER BY s.line, s.col, s.name",
        )?;
        let rows = statement
            .query_map([path], |row| {
                Ok(Symbol {
                    name: row.get(0)?,
                    kind: row.get(1)?,
                    path: row.get(2)?,
                    line: row.get(3)?,
                    column: row.get(4)?,
                    parent: row.get(5)?,
                    docs: None,
                })
            })?
            .collect();
        rows
    }

    pub fn search(&self, name: &str, prefix: bool, limit: usize) -> rusqlite::Result<Vec<Symbol>> {
        let connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let sql = if prefix {
            "SELECT s.name, s.kind, f.path, s.line, s.col, s.parent
             FROM symbols s JOIN files f ON f.id = s.file_id
             WHERE s.name >= ?1 AND s.name < (?1 || char(1114111))
             ORDER BY s.name, f.path, s.line, s.col LIMIT ?2"
        } else {
            "SELECT s.name, s.kind, f.path, s.line, s.col, s.parent
             FROM symbols s JOIN files f ON f.id = s.file_id
             WHERE s.name = ?1
             ORDER BY f.path, s.line, s.col LIMIT ?2"
        };
        let mut statement = connection.prepare(sql)?;
        let rows = statement
            .query_map(params![name, i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
                Ok(Symbol {
                    name: row.get(0)?,
                    kind: row.get(1)?,
                    path: row.get(2)?,
                    line: row.get(3)?,
                    column: row.get(4)?,
                    parent: row.get(5)?,
                    docs: None,
                })
            })?
            .collect();
        rows
    }

    pub fn sync_repository(
        &self,
        root: &Path,
        limits: ExtractionLimits,
    ) -> Result<SyncStats, Box<dyn std::error::Error + Send + Sync>> {
        self.sync_repository_with_progress(root, limits, |_| {})
    }

    pub fn sync_repository_with_progress(
        &self,
        root: &Path,
        limits: ExtractionLimits,
        mut on_progress: impl FnMut(SyncProgress),
    ) -> Result<SyncStats, Box<dyn std::error::Error + Send + Sync>> {
        let extractor = SymbolExtractor::new(limits)?;
        let previous: HashMap<String, FileManifestEntry> =
            self.manifest()?.into_iter().map(|entry| (entry.path.clone(), entry)).collect();
        on_progress(SyncProgress { phase: SyncProgressPhase::Scanning, processed: 0, total: 0 });
        let (paths, _) = walk(root, &WalkOptions::default())?;
        let paths: Vec<String> = paths.into_iter().filter(|path| is_c_family_path(path)).collect();
        let seen: HashSet<&str> = paths.iter().map(String::as_str).collect();
        let mut stats = SyncStats { scanned: paths.len(), ..SyncStats::default() };
        let scan_stride = paths.len().div_ceil(50).max(1);
        let mut changed = Vec::new();
        for (position, relative) in paths.iter().enumerate() {
            let result = std::fs::metadata(root.join(relative))
                .and_then(|metadata| manifest_metadata(&metadata));
            match result {
                Ok((size, mtime))
                    if previous
                        .get(relative)
                        .is_some_and(|entry| entry.size == size && entry.mtime == mtime) =>
                {
                    stats.unchanged += 1;
                }
                Ok((size, mtime)) => changed.push((relative.clone(), size, mtime)),
                Err(error) => stats
                    .failures
                    .push(SymbolFileFailure { path: relative.clone(), reason: error.to_string() }),
            }
            report_progress(
                &mut on_progress,
                SyncProgressPhase::Scanning,
                position + 1,
                paths.len(),
                scan_stride,
            );
        }
        let progress_stride = changed.len().div_ceil(50).max(1);
        on_progress(SyncProgress {
            phase: SyncProgressPhase::Indexing,
            processed: 0,
            total: changed.len(),
        });
        let mut processed = 0usize;
        let mut connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let transaction = connection.transaction()?;
        let channel_capacity = rayon::current_num_threads().max(1);
        let (result_sender, result_receiver) = mpsc::sync_channel(channel_capacity);
        let previous_ref = &previous;
        let changed_ref = &changed;
        let mut write_error = None;
        std::thread::scope(|scope| {
            let worker = scope.spawn(move || {
                changed_ref.par_iter().for_each_with(
                    result_sender,
                    |sender, (relative, size, mtime)| {
                        let result = prepare_changed_file(
                            root,
                            relative,
                            *size,
                            *mtime,
                            previous_ref.get(relative),
                            &extractor,
                            limits,
                        );
                        let _ = sender.send(result);
                    },
                );
            });
            for result in result_receiver {
                if write_error.is_none() {
                    let result = match result {
                        PreparedFile::ManifestOnly(entry) => {
                            update_file_manifest(&transaction, &entry).map(|()| {
                                stats.unchanged += 1;
                            })
                        }
                        PreparedFile::Parsed(entry, symbols) => {
                            replace_file_in_transaction(&transaction, &entry, &symbols).map(|()| {
                                stats.parsed += 1;
                            })
                        }
                        PreparedFile::Failed(failure) => {
                            stats.failures.push(failure);
                            Ok(())
                        }
                    };
                    if let Err(error) = result {
                        write_error = Some(error);
                    }
                }
                processed += 1;
                report_progress(
                    &mut on_progress,
                    SyncProgressPhase::Indexing,
                    processed,
                    changed.len(),
                    progress_stride,
                );
            }
            match worker.join() {
                Ok(()) => {}
                Err(payload) => std::panic::resume_unwind(payload),
            }
        });
        if let Some(error) = write_error {
            return Err(Box::new(error));
        }

        for removed in previous.keys().filter(|path| !seen.contains(path.as_str())) {
            stats.removed += transaction.execute("DELETE FROM files WHERE path = ?1", [removed])?;
        }
        transaction.commit()?;
        on_progress(SyncProgress {
            phase: SyncProgressPhase::Complete,
            processed: paths.len(),
            total: paths.len(),
        });
        Ok(stats)
    }

    pub fn sync_changed_paths(
        &self,
        root: &Path,
        changed_paths: &[String],
        limits: ExtractionLimits,
    ) -> Result<SyncStats, Box<dyn std::error::Error + Send + Sync>> {
        let extractor = SymbolExtractor::new(limits)?;
        let paths: HashSet<String> = changed_paths
            .iter()
            .map(|path| normalize_relative_path(path))
            .collect::<Result<_, _>>()?;
        let mut stats = SyncStats { scanned: paths.len(), ..SyncStats::default() };

        for relative in paths {
            let absolute = root.join(&relative);
            let previous = self.manifest_entry(&relative)?;
            let metadata = match std::fs::metadata(&absolute) {
                Ok(metadata) if metadata.is_file() && is_c_family_path(&relative) => metadata,
                Ok(_) => {
                    stats.removed += usize::from(self.remove_changed_file(&relative)? > 0);
                    continue;
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    stats.removed += usize::from(self.remove_changed_file(&relative)? > 0);
                    continue;
                }
                Err(error) => {
                    stats
                        .failures
                        .push(SymbolFileFailure { path: relative, reason: error.to_string() });
                    continue;
                }
            };
            let source = match read_bounded(&absolute, limits.max_file_bytes) {
                Ok(source) => source,
                Err(error) => {
                    stats
                        .failures
                        .push(SymbolFileFailure { path: relative, reason: error.to_string() });
                    continue;
                }
            };
            let entry = match manifest_entry(
                previous.as_ref().map_or(relative.as_str(), |entry| entry.path.as_str()),
                &metadata,
                &source,
            ) {
                Ok(entry) => entry,
                Err(error) => {
                    stats
                        .failures
                        .push(SymbolFileFailure { path: relative, reason: error.to_string() });
                    continue;
                }
            };
            if previous.as_ref() == Some(&entry) {
                stats.unchanged += 1;
                continue;
            }
            match extractor.extract(&relative, &source) {
                Ok(symbols) => {
                    self.replace_file(&entry, &symbols)?;
                    stats.parsed += 1;
                }
                Err(error) => stats
                    .failures
                    .push(SymbolFileFailure { path: relative, reason: error.to_string() }),
            }
        }
        Ok(stats)
    }

    fn manifest_entry(&self, path: &str) -> rusqlite::Result<Option<FileManifestEntry>> {
        let connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let sql = if cfg!(windows) {
            "SELECT path, size, mtime, hash FROM files WHERE path = ?1 COLLATE NOCASE"
        } else {
            "SELECT path, size, mtime, hash FROM files WHERE path = ?1"
        };
        let mut statement = connection.prepare(sql)?;
        let mut rows = statement.query([path])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        Ok(Some(FileManifestEntry {
            path: row.get(0)?,
            size: row.get(1)?,
            mtime: row.get(2)?,
            hash: row.get(3)?,
        }))
    }

    fn replace_file(&self, file: &FileManifestEntry, symbols: &[Symbol]) -> rusqlite::Result<()> {
        let mut connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let transaction = connection.transaction()?;
        replace_file_in_transaction(&transaction, file, symbols)?;
        transaction.commit()
    }

    fn remove_changed_file(&self, path: &str) -> rusqlite::Result<usize> {
        let connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let sql = if cfg!(windows) {
            "DELETE FROM files WHERE path = ?1 COLLATE NOCASE"
        } else {
            "DELETE FROM files WHERE path = ?1"
        };
        connection.execute(sql, [path])
    }
}

fn report_progress(
    on_progress: &mut impl FnMut(SyncProgress),
    phase: SyncProgressPhase,
    processed: usize,
    total: usize,
    stride: usize,
) {
    if processed == total || processed.is_multiple_of(stride) {
        on_progress(SyncProgress { phase, processed, total });
    }
}

fn prepare_changed_file(
    root: &Path,
    relative: &str,
    size: i64,
    mtime: i64,
    previous: Option<&FileManifestEntry>,
    extractor: &SymbolExtractor,
    limits: ExtractionLimits,
) -> PreparedFile {
    let absolute = root.join(relative);
    let source = match read_bounded(&absolute, limits.max_file_bytes) {
        Ok(source) => source,
        Err(error) => {
            return PreparedFile::Failed(SymbolFileFailure {
                path: relative.to_owned(),
                reason: error.to_string(),
            });
        }
    };
    let entry = FileManifestEntry {
        path: relative.to_owned(),
        size,
        mtime,
        hash: blake3::hash(&source).to_hex().to_string(),
    };
    if previous.is_some_and(|old| old.hash == entry.hash) {
        return PreparedFile::ManifestOnly(entry);
    }
    match extractor.extract(relative, &source) {
        Ok(symbols) => PreparedFile::Parsed(entry, symbols),
        Err(error) => PreparedFile::Failed(SymbolFileFailure {
            path: relative.to_owned(),
            reason: error.to_string(),
        }),
    }
}

fn manifest_entry(
    path: &str,
    metadata: &std::fs::Metadata,
    source: &[u8],
) -> io::Result<FileManifestEntry> {
    let (size, mtime) = manifest_metadata(metadata)?;
    Ok(FileManifestEntry {
        path: path.to_owned(),
        size,
        mtime,
        hash: blake3::hash(source).to_hex().to_string(),
    })
}

fn manifest_metadata(metadata: &std::fs::Metadata) -> io::Result<(i64, i64)> {
    Ok((i64::try_from(metadata.len()).unwrap_or(i64::MAX), modified_millis(metadata)?))
}

fn update_file_manifest(
    transaction: &Transaction<'_>,
    file: &FileManifestEntry,
) -> rusqlite::Result<()> {
    transaction.execute(
        "UPDATE files SET size = ?2, mtime = ?3, hash = ?4 WHERE path = ?1",
        params![file.path, file.size, file.mtime, file.hash],
    )?;
    Ok(())
}

fn replace_file_in_transaction(
    transaction: &Transaction<'_>,
    file: &FileManifestEntry,
    symbols: &[Symbol],
) -> rusqlite::Result<()> {
    transaction.execute(
        "INSERT INTO files(path, size, mtime, hash) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, hash=excluded.hash",
        params![file.path, file.size, file.mtime, file.hash],
    )?;
    let file_id: i64 =
        transaction
            .query_row("SELECT id FROM files WHERE path = ?1", [&file.path], |row| row.get(0))?;
    transaction.execute("DELETE FROM symbols WHERE file_id = ?1", [file_id])?;
    insert_symbols(transaction, file_id, symbols)
}

fn normalize_relative_path(path: &str) -> io::Result<String> {
    let portable = if cfg!(windows) { path.replace('\\', "/") } else { path.to_owned() };
    let mut normalized = PathBuf::new();
    for component in Path::new(&portable).components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("symbol index path must be repository-relative: {path}"),
                ));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "symbol index path is empty"));
    }
    let normalized = normalized.to_string_lossy();
    Ok(if cfg!(windows) { normalized.replace('\\', "/") } else { normalized.into_owned() })
}

fn insert_symbols(
    transaction: &Transaction<'_>,
    file_id: i64,
    symbols: &[Symbol],
) -> rusqlite::Result<()> {
    let mut statement = transaction.prepare(
        "INSERT INTO symbols(name, kind, file_id, line, col, parent) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?;
    for symbol in symbols {
        statement.execute(params![
            symbol.name,
            symbol.kind,
            file_id,
            symbol.line,
            symbol.column,
            symbol.parent
        ])?;
    }
    Ok(())
}

fn modified_millis(metadata: &std::fs::Metadata) -> io::Result<i64> {
    let duration = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn reparses_only_changed_files_and_removes_deleted_files() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("one.c"), "int one() { return 1; }\n").expect("one");
        std::fs::write(root.path().join("two.cpp"), "int two() { return 2; }\n").expect("two");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");

        let cold = store.sync_repository(root.path(), ExtractionLimits::default()).expect("cold");
        assert_eq!((cold.parsed, cold.unchanged), (2, 0));
        let warm = store.sync_repository(root.path(), ExtractionLimits::default()).expect("warm");
        assert_eq!((warm.parsed, warm.unchanged), (0, 2));

        std::fs::write(root.path().join("one.c"), "int changed() { return 3; }\n").expect("change");
        std::fs::remove_file(root.path().join("two.cpp")).expect("remove");
        let changed =
            store.sync_repository(root.path(), ExtractionLimits::default()).expect("changed");
        assert_eq!((changed.parsed, changed.unchanged, changed.removed), (1, 0, 1));
        assert_eq!(store.symbols_for_file("one.c").expect("symbols")[0].name, "changed");
        assert!(store.symbols_for_file("two.cpp").expect("removed symbols").is_empty());
    }

    #[test]
    fn warm_sync_does_not_read_files_with_unchanged_metadata() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("large.c"), "int retained();\n").expect("fixture");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("initial");

        let warm = store
            .sync_repository(
                root.path(),
                ExtractionLimits { max_file_bytes: 1, ..ExtractionLimits::default() },
            )
            .expect("warm sync");

        assert_eq!((warm.parsed, warm.unchanged, warm.failures.len()), (0, 1, 0));
        assert_eq!(
            store.symbols_for_file("large.c").expect("retained symbols")[0].name,
            "retained"
        );
    }

    #[test]
    fn metadata_only_changes_update_the_manifest_without_reparsing() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        let file = root.path().join("stable.c");
        std::fs::write(&file, "int stable();\n").expect("fixture");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("initial");
        let before = store.manifest().expect("before manifest").remove(0);
        let changed_mtime = before.mtime + 10_000;
        let file_time = std::time::SystemTime::UNIX_EPOCH
            + std::time::Duration::from_millis(u64::try_from(changed_mtime).expect("mtime"));
        std::fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .expect("open fixture")
            .set_modified(file_time)
            .expect("touch fixture");

        let warm = store.sync_repository(root.path(), ExtractionLimits::default()).expect("sync");
        let after = store.manifest().expect("after manifest").remove(0);

        assert_eq!((warm.parsed, warm.unchanged), (0, 1));
        assert_ne!(after.mtime, before.mtime);
        assert_eq!(after.hash, before.hash);
    }

    #[test]
    fn targeted_sync_reads_only_named_paths() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("one.c"), "int one() { return 1; }\n").expect("one");
        std::fs::write(root.path().join("two.cpp"), "int two() { return 2; }\n").expect("two");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("cold");

        std::fs::write(root.path().join("one.c"), "int changed() { return 3; }\n").expect("change");
        std::fs::write(root.path().join("two.cpp"), "int ignored() { return 4; }\n")
            .expect("unlisted change");
        let changed = store
            .sync_changed_paths(root.path(), &["one.c".to_owned()], ExtractionLimits::default())
            .expect("targeted sync");

        assert_eq!((changed.scanned, changed.parsed, changed.unchanged), (1, 1, 0));
        assert_eq!(store.symbols_for_file("one.c").expect("one symbols")[0].name, "changed");
        assert_eq!(store.symbols_for_file("two.cpp").expect("two symbols")[0].name, "two");
    }

    #[test]
    fn targeted_sync_removes_deleted_files_and_rejects_paths_outside_root() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("gone.h"), "int gone();\n").expect("fixture");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("cold");
        std::fs::remove_file(root.path().join("gone.h")).expect("remove");

        let removed = store
            .sync_changed_paths(root.path(), &["gone.h".to_owned()], ExtractionLimits::default())
            .expect("targeted removal");
        assert_eq!((removed.scanned, removed.removed), (1, 1));
        assert!(store.symbols_for_file("gone.h").expect("removed symbols").is_empty());

        let error = store
            .sync_changed_paths(
                root.path(),
                &["../outside.cpp".to_owned()],
                ExtractionLimits::default(),
            )
            .expect_err("path traversal");
        assert!(error.to_string().contains("repository-relative"));
    }

    #[cfg(not(windows))]
    #[test]
    fn targeted_sync_preserves_posix_backslashes() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        let relative = r"back\slash.cpp";
        std::fs::write(root.path().join(relative), "int original();\n").expect("fixture");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store
            .sync_changed_paths(root.path(), &[relative.to_owned()], ExtractionLimits::default())
            .expect("targeted sync");

        assert_eq!(store.symbols_for_file(relative).expect("symbols")[0].name, "original");
    }

    #[cfg(windows)]
    #[test]
    fn full_sync_preserves_a_case_only_rename() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("Before.cpp"), "int before();\n").expect("fixture");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("cold");
        std::fs::rename(root.path().join("Before.cpp"), root.path().join("before.cpp"))
            .expect("rename");

        store.sync_repository(root.path(), ExtractionLimits::default()).expect("rename sync");

        assert_eq!(
            store.symbols_for_file("before.cpp").expect("renamed symbols")[0].name,
            "before"
        );
    }

    #[test]
    fn failed_update_leaves_the_last_committed_database_readable() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        let file = root.path().join("one.c");
        std::fs::write(&file, "int stable() { return 1; }\n").expect("stable");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("initial");

        std::fs::write(
            &file,
            "int broken((((((((((((((((((((((((((((x))))))))))))))))))))))))))));",
        )
        .expect("pathological");
        let stats = store
            .sync_repository(
                root.path(),
                ExtractionLimits { max_nesting_depth: 8, ..ExtractionLimits::default() },
            )
            .expect("failed update");

        assert_eq!(stats.failures.len(), 1);
        assert_eq!(store.symbols_for_file("one.c").expect("readable")[0].name, "stable");
    }

    #[test]
    fn oversized_files_fail_without_aborting_other_updates() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("good.c"), "int before();\n").expect("good");
        std::fs::write(root.path().join("large.c"), "int retained();\n").expect("large");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("initial");
        std::fs::write(root.path().join("good.c"), "int after();\n").expect("change good");
        std::fs::write(root.path().join("large.c"), vec![b'x'; 65]).expect("oversized");
        let limits = ExtractionLimits { max_file_bytes: 64, ..ExtractionLimits::default() };

        let full = store.sync_repository(root.path(), limits).expect("full sync");

        assert_eq!((full.parsed, full.failures.len()), (1, 1));
        assert_eq!(full.failures[0].path, "large.c");
        assert_eq!(store.symbols_for_file("good.c").expect("good symbols")[0].name, "after");
        assert_eq!(
            store.symbols_for_file("large.c").expect("retained symbols")[0].name,
            "retained"
        );

        std::fs::write(root.path().join("good.c"), "int latest();\n").expect("change good again");
        let targeted = store
            .sync_changed_paths(root.path(), &["large.c".to_owned(), "good.c".to_owned()], limits)
            .expect("targeted sync");
        assert_eq!((targeted.parsed, targeted.failures.len()), (1, 1));
        assert_eq!(targeted.failures[0].path, "large.c");
        assert_eq!(store.symbols_for_file("good.c").expect("latest symbols")[0].name, "latest");
    }

    #[test]
    fn full_sync_rolls_back_every_file_when_a_database_write_fails() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(root.path().join("one.c"), "int one();\n").expect("one");
        std::fs::write(root.path().join("two.c"), "int two();\n").expect("two");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("initial");
        store
            .connection
            .lock()
            .expect("connection")
            .execute_batch(
                "CREATE TRIGGER fail_second_file BEFORE UPDATE ON files
                 WHEN NEW.path = 'two.c'
                 BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
            )
            .expect("trigger");
        std::fs::write(root.path().join("one.c"), "int changed_one();\n").expect("change one");
        std::fs::write(root.path().join("two.c"), "int changed_two();\n").expect("change two");

        let error = store
            .sync_repository(root.path(), ExtractionLimits::default())
            .expect_err("second write fails");

        assert!(error.to_string().contains("simulated write failure"));
        assert_eq!(store.symbols_for_file("one.c").expect("one symbols")[0].name, "one");
        assert_eq!(store.symbols_for_file("two.c").expect("two symbols")[0].name, "two");
    }

    #[test]
    fn searches_exact_names_and_prefixes_in_stable_order() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        std::fs::write(
            root.path().join("symbols.cpp"),
            "int alpha() { return 1; }\nint alphabet() { return 2; }\nint alpha() { return 3; }\n",
        )
        .expect("symbols");
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        store.sync_repository(root.path(), ExtractionLimits::default()).expect("sync");

        let exact = store.search("alpha", false, 10).expect("exact");
        assert_eq!(
            exact.iter().map(|symbol| symbol.name.as_str()).collect::<Vec<_>>(),
            ["alpha", "alpha"]
        );

        let prefix = store.search("alph", true, 10).expect("prefix");
        assert_eq!(
            prefix.iter().map(|symbol| symbol.name.as_str()).collect::<Vec<_>>(),
            ["alpha", "alpha", "alphabet"]
        );
        assert!(store.search("missing", false, 10).expect("miss").is_empty());
        assert_eq!(store.search("alph", true, 1).expect("limited").len(), 1);
    }

    #[test]
    fn reports_bounded_progress_during_a_cold_build() {
        let root = tempdir().expect("root");
        let data = tempdir().expect("data");
        for index in 0..250 {
            std::fs::write(
                root.path().join(format!("file-{index}.cpp")),
                format!("int symbol_{index}() {{ return {index}; }}\n"),
            )
            .expect("fixture");
        }
        let store = SymbolStore::open(&data.path().join("symbols.sqlite")).expect("store");
        let mut progress = Vec::new();

        let stats = store
            .sync_repository_with_progress(root.path(), ExtractionLimits::default(), |event| {
                progress.push(event)
            })
            .expect("cold build");

        assert_eq!(stats.parsed, 250);
        assert_eq!(
            progress.first(),
            Some(&SyncProgress { phase: SyncProgressPhase::Scanning, processed: 0, total: 0 })
        );
        assert!(progress.iter().any(|event| {
            event.phase == SyncProgressPhase::Indexing
                && event.processed > 0
                && event.processed < event.total
        }));
        assert_eq!(
            progress.last(),
            Some(&SyncProgress { phase: SyncProgressPhase::Complete, processed: 250, total: 250 })
        );
        assert!(progress.len() <= 103);
    }
}
