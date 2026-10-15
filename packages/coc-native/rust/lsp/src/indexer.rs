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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender};
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
    queue: IndexQueue,
}

/// A cloneable handle onto one [`Indexer`]'s queue.
///
/// The dispatch loop reaches the worker through the `Indexer` it owns; the
/// filesystem watcher lives on its own thread and holds one of these instead,
/// so both feed the same serial worker and a file touched by a save and by the
/// watcher at once is still parsed once.
#[derive(Clone)]
pub struct IndexQueue {
    sender: SyncSender<IndexWork>,
    overflow: Arc<AtomicBool>,
}

enum IndexWork {
    Path(String),
    Rescan,
}

fn drain_work(
    first: IndexWork,
    queued: impl Iterator<Item = IndexWork>,
    overflow: &AtomicBool,
) -> (Vec<String>, bool) {
    let mut batch = BTreeSet::new();
    let mut rescan = overflow.swap(false, Ordering::AcqRel);
    for work in std::iter::once(first).chain(queued.take(256)) {
        match work {
            IndexWork::Path(path) => {
                batch.insert(path);
            }
            IndexWork::Rescan => rescan = true,
        }
    }
    // A producer can overflow while the worker drains, including when its
    // wake-up Rescan cannot fit. Consume that signal before choosing the sync.
    rescan |= overflow.swap(false, Ordering::AcqRel);
    (batch.into_iter().collect(), rescan)
}

impl Indexer {
    pub fn start(root: PathBuf, store: Arc<SymbolStore>, transport: Transport) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<IndexWork>(256);
        let overflow = Arc::new(AtomicBool::new(false));
        let worker_overflow = overflow.clone();
        std::thread::spawn(move || {
            while let Ok(first) = receiver.recv() {
                // Whatever else is already queued belongs in the same sync. A
                // sorted set both de-duplicates a file saved twice and keeps
                // the log line stable to read.
                let (paths, rescan) = drain_work(first, receiver.try_iter(), &worker_overflow);
                let result = if rescan {
                    store.sync_repository(&root, ExtractionLimits::default())
                } else {
                    store.sync_changed_paths(&root, &paths, ExtractionLimits::default())
                };
                let message = match result {
                    Ok(stats) => json!({
                        "type": LOG_INFO,
                        "message": if rescan { format!(
                            "Reindexed workspace: {} parsed, {} unchanged, {} removed",
                            stats.parsed, stats.unchanged, stats.removed
                        ) } else { format!(
                            "Reindexed {} saved file(s): {} parsed, {} unchanged, {} removed",
                            stats.scanned, stats.parsed, stats.unchanged, stats.removed
                        ) },
                    }),
                    // A failed targeted sync leaves the previous rows for those
                    // files in place, which is stale but still navigable. The
                    // next save retries; nothing here aborts the session.
                    Err(error) => json!({
                        "type": LOG_WARNING,
                        "message": format!("Reindexing {} failed: {error}", if rescan {
                            "workspace".into()
                        } else { paths.join(", ") }),
                    }),
                };
                transport.notify("window/logMessage", message);
            }
        });
        Self { queue: IndexQueue { sender, overflow } }
    }

    /// Queues one repository-relative path. A closed channel means the worker
    /// is gone, which only happens on the way out; the save is dropped.
    pub fn submit(&self, relative: String) {
        self.queue.submit(relative);
    }

    pub fn queue(&self) -> IndexQueue {
        self.queue.clone()
    }
}

impl IndexQueue {
    pub fn submit(&self, relative: String) {
        self.send(IndexWork::Path(relative));
    }

    pub fn rescan(&self) {
        self.send(IndexWork::Rescan);
    }

    fn send(&self, work: IndexWork) {
        if matches!(self.sender.try_send(work), Err(mpsc::TrySendError::Full(_))) {
            self.overflow.store(true, Ordering::Release);
            // The worker may have drained the full queue between try_send and
            // setting the flag. Ensure it wakes even in that race.
            let _ = self.sender.try_send(IndexWork::Rescan);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct CompletedWrite(mpsc::Sender<()>);
    impl Write for CompletedWrite {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            let _ = self.0.send(());
            Ok(())
        }
    }

    #[test]
    fn explicit_rescan_reloads_unreported_files_and_removes_stale_rows() {
        let root = tempfile::Builder::new().prefix("index-rescan-").tempdir_in(".").unwrap();
        let store = Arc::new(SymbolStore::open(&root.path().join("index.sqlite")).unwrap());
        std::fs::write(root.path().join("old.c"), "int old_symbol(void) { return 0; }\n").unwrap();
        store.sync_repository(root.path(), ExtractionLimits::default()).unwrap();
        std::fs::remove_file(root.path().join("old.c")).unwrap();
        std::fs::write(root.path().join("new.c"), "int new_symbol(void) { return 1; }\n").unwrap();
        let (completed, receiver) = mpsc::channel();
        let indexer = Indexer::start(
            root.path().to_path_buf(),
            store.clone(),
            Transport::new(Box::new(CompletedWrite(completed))),
        );
        indexer.queue().rescan();
        receiver.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
        assert!(store.symbols_for_file("old.c").unwrap().is_empty());
        assert_eq!(store.symbols_for_file("new.c").unwrap()[0].name, "new_symbol");
    }

    #[test]
    fn a_saturated_queue_escalates_to_a_full_reload() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let overflow = Arc::new(AtomicBool::new(false));
        let queue = IndexQueue { sender, overflow: overflow.clone() };
        queue.submit("first.c".into());
        queue.submit("second.c".into());
        assert!(overflow.load(Ordering::Acquire));
        assert!(matches!(receiver.recv().unwrap(), IndexWork::Path(_)));
    }

    #[test]
    fn overflow_during_drain_is_consumed_even_when_its_rescan_cannot_be_queued() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let overflow = Arc::new(AtomicBool::new(false));
        let queue = IndexQueue { sender, overflow: overflow.clone() };
        queue.submit("queued.c".into());
        let mut triggered = false;
        let queued = std::iter::from_fn(|| {
            if !triggered {
                triggered = true;
                queue.submit("dropped.c".into());
            }
            receiver.try_recv().ok()
        });
        let (paths, rescan) = drain_work(IndexWork::Path("first.c".into()), queued, &overflow);
        assert_eq!(paths, ["first.c", "queued.c"]);
        assert!(rescan);
        assert!(!overflow.load(Ordering::Acquire));
        assert!(receiver.try_recv().is_err());
    }
}
