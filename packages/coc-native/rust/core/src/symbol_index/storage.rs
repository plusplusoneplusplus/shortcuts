use std::collections::{HashMap, HashSet};
use std::io;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

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
        let progress_stride = paths.len().div_ceil(100).max(1);
        on_progress(SyncProgress {
            phase: SyncProgressPhase::Indexing,
            processed: 0,
            total: paths.len(),
        });

        for (position, relative) in paths.iter().enumerate() {
            let absolute = root.join(relative);
            let metadata = std::fs::metadata(&absolute)?;
            let source = read_bounded(&absolute, limits.max_file_bytes)?;
            let entry = FileManifestEntry {
                path: relative.clone(),
                size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
                mtime: modified_millis(&metadata)?,
                hash: blake3::hash(&source).to_hex().to_string(),
            };
            if previous.get(relative) == Some(&entry) {
                stats.unchanged += 1;
            } else {
                match extractor.extract(relative, &source) {
                    Ok(symbols) => {
                        self.replace_file(&entry, &symbols)?;
                        stats.parsed += 1;
                    }
                    Err(error) => stats.failures.push(SymbolFileFailure {
                        path: relative.clone(),
                        reason: error.to_string(),
                    }),
                }
            }
            let processed = position + 1;
            if processed == paths.len() || processed % progress_stride == 0 {
                on_progress(SyncProgress {
                    phase: SyncProgressPhase::Indexing,
                    processed,
                    total: paths.len(),
                });
            }
        }

        for removed in previous.keys().filter(|path| !seen.contains(path.as_str())) {
            self.remove_file(removed)?;
            stats.removed += 1;
        }
        on_progress(SyncProgress {
            phase: SyncProgressPhase::Complete,
            processed: paths.len(),
            total: paths.len(),
        });
        Ok(stats)
    }

    fn replace_file(&self, file: &FileManifestEntry, symbols: &[Symbol]) -> rusqlite::Result<()> {
        let mut connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO files(path, size, mtime, hash) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, hash=excluded.hash",
            params![file.path, file.size, file.mtime, file.hash],
        )?;
        let file_id: i64 =
            transaction.query_row("SELECT id FROM files WHERE path = ?1", [&file.path], |row| {
                row.get(0)
            })?;
        transaction.execute("DELETE FROM symbols WHERE file_id = ?1", [file_id])?;
        insert_symbols(&transaction, file_id, symbols)?;
        transaction.commit()
    }

    fn remove_file(&self, path: &str) -> rusqlite::Result<()> {
        let connection = self.connection.lock().unwrap_or_else(|error| error.into_inner());
        connection.execute("DELETE FROM files WHERE path = ?1", [path])?;
        Ok(())
    }
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
