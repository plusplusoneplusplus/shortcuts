//! The immutable file-list snapshot, with no knowledge of scoring.

use std::io;
use std::path::Path;

use super::walk::{walk, WalkOptions};

/// An immutable snapshot of a repository's file list.
///
/// `RepoIndex` holds one behind an `Arc` and swaps the whole snapshot on
/// refresh, so a reader either sees the old list or the new one — never a torn
/// mix of the two.
pub struct Snapshot {
    paths: Vec<String>,
    truncated: bool,
}

impl Snapshot {
    /// Build a snapshot by walking `root`.
    pub fn build(root: &Path, options: &WalkOptions) -> io::Result<Self> {
        let (paths, truncated) = walk(root, options)?;
        Ok(Self::from_paths(paths, truncated))
    }

    /// Build a snapshot from an explicit path list — the shape the parity and
    /// scoring tests need, and how `walk` results are turned into a snapshot.
    pub fn from_paths(paths: Vec<String>, truncated: bool) -> Self {
        Self { paths, truncated }
    }

    pub fn len(&self) -> usize {
        self.paths.len()
    }

    pub fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }

    /// The whole path list, in index order.
    pub fn paths(&self) -> &[String] {
        &self.paths
    }

    /// A window of the raw path list, in index order.
    pub fn files(&self, offset: usize, limit: usize) -> Vec<String> {
        if offset >= self.paths.len() || limit == 0 {
            return Vec::new();
        }
        let end = offset.saturating_add(limit).min(self.paths.len());
        self.paths[offset..end].to_vec()
    }

    /// Resolve a hit back to its path.
    pub fn path_at(&self, index: u32) -> &str {
        &self.paths[index as usize]
    }
}
