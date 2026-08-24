//! A generic in-memory, gitignore-aware index of one repository's file paths,
//! with fuzzy top-N path search over it. Quick-open search is its first
//! consumer, but nothing here is specific to it.

pub mod fuzzy;
pub mod score;
pub mod snapshot;
pub mod walk;

pub use fuzzy::{FuzzyMatcher, Hit};
pub use snapshot::Snapshot;
pub use walk::WalkOptions;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

/// A live index of one repository: the root and walk configuration plus the
/// current searchable snapshot, replaced wholesale on refresh.
///
/// Cloning yields another handle to the same index: a refresh through any
/// handle is visible through all of them.
#[derive(Clone)]
pub struct RepoIndex {
    root: PathBuf,
    options: WalkOptions,
    /// The current snapshot and its matcher. Refresh swaps the `Arc`
    /// wholesale, so a reader holds either the old list or the new one and
    /// never sees a torn mix of the two.
    state: Arc<RwLock<Arc<FuzzyMatcher>>>,
}

impl RepoIndex {
    /// Walk `root` and build a ready-to-search index.
    pub fn build(root: PathBuf, options: WalkOptions) -> io::Result<Self> {
        let matcher = index(&root, &options)?;
        Ok(Self { root, options, state: Arc::new(RwLock::new(Arc::new(matcher))) })
    }

    /// The root this index walks.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Re-walk the root and atomically swap in the new snapshot.
    ///
    /// The rebuild happens entirely outside the lock, which is held only for
    /// the swap itself; concurrent readers cloned their `Arc` beforehand and
    /// keep reading the old snapshot safely.
    pub fn refresh(&self) -> io::Result<()> {
        let rebuilt = Arc::new(index(&self.root, &self.options)?);
        // A poisoned lock still holds a valid snapshot — a writer could only
        // poison it by panicking inside the swap below, which cannot panic —
        // so recover rather than fail.
        let mut slot = self.state.write().unwrap_or_else(|e| e.into_inner());
        *slot = rebuilt;
        Ok(())
    }

    /// The current snapshot.
    pub fn snapshot(&self) -> Arc<Snapshot> {
        Arc::clone(self.searcher().snapshot())
    }

    /// The current snapshot's fuzzy matcher, which carries the snapshot it
    /// scores against.
    pub fn searcher(&self) -> Arc<FuzzyMatcher> {
        // See `refresh` for why recovering from poison is sound here.
        Arc::clone(&self.state.read().unwrap_or_else(|e| e.into_inner()))
    }
}

/// Build a snapshot of `root` together with its fuzzy matcher, so the
/// lowercase cache is paid for at build time rather than on the first search.
fn index(root: &Path, options: &WalkOptions) -> io::Result<FuzzyMatcher> {
    let snapshot = Snapshot::build(root, options)?;
    Ok(FuzzyMatcher::new(Arc::new(snapshot)))
}
