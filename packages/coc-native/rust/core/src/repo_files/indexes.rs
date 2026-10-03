//! The file indexes behind one repository handle and their whole lifecycle:
//! lazy shared builds, TTL stale-while-revalidate, refreshes queued behind
//! writes, and disposal. Node only keeps one handle per workspace root.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use super::RepoFilesError;
use crate::repo_index::{RepoIndex, WalkOptions};

#[derive(Default)]
struct Variant {
    /// The built index. Held across a cold build so concurrent cold callers
    /// share it; a failed build leaves `None` for the next caller to retry.
    index: Mutex<Option<RepoIndex>>,
    /// Serializes refresh writers: a refresh queued after a write waits for
    /// any scan already running, then starts its own.
    refresh: Mutex<()>,
    /// Start of the walk behind the published snapshot. A failed refresh
    /// clears it, so the next read retries even before the TTL expires.
    walked_at: Mutex<Option<Instant>>,
    /// A TTL refresh is running in the background.
    refreshing: AtomicBool,
    #[cfg(test)]
    after_refresh: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

/// One repository root's index variants (`[respecting ignores, showIgnored]`).
pub struct RepoIndexes {
    root: PathBuf,
    ttl: Duration,
    disposed: AtomicBool,
    variants: [Variant; 2],
}

impl RepoIndexes {
    pub fn new(root: PathBuf, ttl: Duration) -> Arc<Self> {
        Arc::new(Self { root, ttl, disposed: AtomicBool::new(false), variants: Default::default() })
    }

    /// The root, or `Disposed` once the handle is closed to new requests.
    pub fn root(&self) -> Result<&Path, RepoFilesError> {
        if self.disposed.load(Ordering::Acquire) {
            return Err(RepoFilesError::Disposed);
        }
        Ok(&self.root)
    }

    /// The live index for a variant, built on first use. A snapshot older
    /// than the TTL is still returned while a background walk replaces it.
    pub fn index(self: &Arc<Self>, include_ignored: bool) -> Result<RepoIndex, RepoFilesError> {
        let root = self.root()?;
        let variant = &self.variants[usize::from(include_ignored)];
        let mut slot = variant.index.lock();
        if let Some(index) = slot.as_ref() {
            let index = index.clone();
            drop(slot);
            let stale = variant.walked_at.lock().is_none_or(|at| at.elapsed() >= self.ttl);
            if stale && !variant.refreshing.swap(true, Ordering::AcqRel) {
                let this = Arc::clone(self);
                std::thread::spawn(move || {
                    let variant = &this.variants[usize::from(include_ignored)];
                    this.refresh(variant);
                    variant.refreshing.store(false, Ordering::Release);
                });
            }
            return Ok(index);
        }
        let started = Instant::now();
        let options = WalkOptions { include_ignored, max_entries: None };
        let index = RepoIndex::build(root.to_path_buf(), options)?;
        if !self.disposed.load(Ordering::Acquire) {
            *slot = Some(index.clone());
            *variant.walked_at.lock() = Some(started);
        }
        Ok(index)
    }

    /// Re-walk every built variant, each queued behind any scan in flight,
    /// so the result reflects writes made before this call. Returns whether
    /// every variant is now fresh; a failure keeps the previous snapshot.
    pub fn invalidate(&self) -> bool {
        self.variants.iter().filter(|variant| !self.refresh(variant)).count() == 0
    }

    fn refresh(&self, variant: &Variant) -> bool {
        let _writer = variant.refresh.lock();
        let Some(index) = variant.index.lock().clone() else { return true };
        if self.disposed.load(Ordering::Acquire) {
            return true;
        }
        let started = Instant::now();
        let fresh = index.refresh().is_ok();
        #[cfg(test)]
        if let Some(pause) = variant.after_refresh.lock().take() {
            pause();
        }
        *variant.walked_at.lock() = fresh.then_some(started);
        fresh
    }

    /// Reject new requests and drop the indexes. Readers already holding a
    /// snapshot keep it; a build or refresh still running publishes nothing.
    pub fn dispose(&self) {
        self.disposed.store(true, Ordering::Release);
        for variant in &self.variants {
            if let Some(mut slot) = variant.index.try_lock() {
                *slot = None;
            }
        }
    }
}

#[cfg(test)]
#[path = "../../tests/support/repo_files_indexes_race.rs"]
mod race_tests;
