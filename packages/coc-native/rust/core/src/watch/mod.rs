//! Subscription-local batching for native filesystem notifications.
//!
//! The watch backend supplies filtered, root-relative forward-slash paths.
//! Each subscription owns its debounce window independently of the shared root.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

pub const MAX_BATCH_PATHS: usize = 4096;
pub const MAX_BATCH_PATH_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchBatch {
    pub subscription_id: u32,
    pub paths: Vec<String>,
    pub rescan: bool,
}

/// A trailing-edge debounce window. The worker uses `deadline()` to wait rather
/// than polling; supplying the clock keeps batching tests independent of timing.
pub struct PendingBatch {
    subscription_id: u32,
    debounce: Duration,
    deadline: Option<Instant>,
    paths: BTreeSet<String>,
    path_bytes: usize,
    rescan: bool,
}

impl PendingBatch {
    pub fn new(subscription_id: u32, debounce_ms: u32) -> Self {
        Self {
            subscription_id,
            debounce: Duration::from_millis(u64::from(debounce_ms)),
            deadline: None,
            paths: BTreeSet::new(),
            path_bytes: 0,
            rescan: false,
        }
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    /// Record an already-filtered, root-relative forward-slash path.
    pub fn record_path(&mut self, path: String, now: Instant) {
        self.deadline = Some(now + self.debounce);
        if self.rescan || self.paths.contains(&path) {
            return;
        }
        if self.paths.len() == MAX_BATCH_PATHS
            || path.len() > MAX_BATCH_PATH_BYTES - self.path_bytes
        {
            self.mark_rescan(now);
            return;
        }
        self.path_bytes += path.len();
        self.paths.insert(path);
    }

    /// Backend errors, overflow and root lifecycle changes all require a full
    /// reload. Retaining partial paths alongside that signal wastes queue space.
    pub fn mark_rescan(&mut self, now: Instant) {
        self.deadline = Some(now + self.debounce);
        self.paths.clear();
        self.path_bytes = 0;
        self.rescan = true;
    }

    pub fn drain_ready(&mut self, now: Instant) -> Option<WatchBatch> {
        if now < self.deadline? {
            return None;
        }
        self.deadline = None;
        self.path_bytes = 0;
        Some(WatchBatch {
            subscription_id: self.subscription_id,
            paths: std::mem::take(&mut self.paths).into_iter().collect(),
            rescan: std::mem::take(&mut self.rescan),
        })
    }
}
