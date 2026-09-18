//! The incremental half of index ownership.
//!
//! The cold build at `initialized` walks the whole tree; everything after that
//! arrives one file at a time, from a `textDocument/didSave` the editor sent.
//! Both write the same store, so the incremental path runs on a single worker
//! thread rather than one thread per save: SQLite takes the connection mutex
//! either way, and a serial queue also lets a burst of saves collapse into one
//! targeted sync instead of re-parsing the same file several times over.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;

use coc_native_core::symbol_index::{ExtractionLimits, SymbolStore};
use serde_json::json;

use crate::transport::Transport;

/// `window/logMessage` severities, from the specification.
const LOG_WARNING: i64 = 2;
const LOG_INFO: i64 = 3;

/// A queue of repository-relative paths waiting to be re-indexed.
///
/// Dropping it closes the channel, which is what ends the worker — so the
/// server holds one for the whole session and lets process exit clean it up.
pub struct Indexer {
    sender: Sender<String>,
}

impl Indexer {
    pub fn start(root: PathBuf, store: Arc<SymbolStore>, transport: Transport) -> Self {
        let (sender, receiver) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            while let Ok(first) = receiver.recv() {
                // Whatever else is already queued belongs in the same sync. A
                // sorted set both de-duplicates a file saved twice and keeps
                // the log line stable to read.
                let mut batch = BTreeSet::new();
                batch.insert(first);
                batch.extend(receiver.try_iter());
                let paths: Vec<String> = batch.into_iter().collect();
                let message =
                    match store.sync_changed_paths(&root, &paths, ExtractionLimits::default()) {
                        Ok(stats) => json!({
                            "type": LOG_INFO,
                            "message": format!(
                                "Reindexed {} saved file(s): {} parsed, {} unchanged, {} removed",
                                stats.scanned, stats.parsed, stats.unchanged, stats.removed
                            ),
                        }),
                        // A failed targeted sync leaves the previous rows for those
                        // files in place, which is stale but still navigable. The
                        // next save retries; nothing here aborts the session.
                        Err(error) => json!({
                            "type": LOG_WARNING,
                            "message": format!("Reindexing {} failed: {error}", paths.join(", ")),
                        }),
                    };
                transport.notify("window/logMessage", message);
            }
        });
        Self { sender }
    }

    /// Queues one repository-relative path. A closed channel means the worker
    /// is gone, which only happens on the way out; the save is dropped.
    pub fn submit(&self, relative: String) {
        let _ = self.sender.send(relative);
    }
}
