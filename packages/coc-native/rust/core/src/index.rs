//! The in-memory path index and its top-N search.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::io;
use std::path::Path;

use rayon::prelude::*;

use crate::score::{lower_unit, score_units, Query};
use crate::walk::{walk, WalkOptions};

/// A path's lowercased form, kept in the narrowest representation that still
/// indexes like a JavaScript string.
enum LowerPath {
    /// ASCII-only path: byte offsets equal UTF-16 offsets.
    Ascii(Box<[u8]>),
    Wide(Box<[u16]>),
}

/// An immutable snapshot of a repository's file list.
///
/// `FileIndex` holds this behind an `Arc` and swaps the whole snapshot on
/// refresh, so a search either sees the old list or the new one — never a torn
/// mix of the two.
pub struct IndexState {
    paths: Vec<String>,
    lower: Vec<LowerPath>,
    truncated: bool,
}

impl IndexState {
    /// Build a snapshot by walking `root`.
    pub fn build(root: &Path, options: &WalkOptions) -> io::Result<Self> {
        let (paths, truncated) = walk(root, options)?;
        Ok(Self::from_paths(paths, truncated))
    }

    /// Build a snapshot from an explicit path list — the shape the parity and
    /// scoring tests need, and how `walk` results are turned into an index.
    pub fn from_paths(paths: Vec<String>, truncated: bool) -> Self {
        let lower = paths
            .iter()
            .map(|path| {
                if path.is_ascii() {
                    LowerPath::Ascii(
                        path.as_bytes().iter().map(|&b| b.to_ascii_lowercase()).collect(),
                    )
                } else {
                    LowerPath::Wide(path.encode_utf16().map(lower_unit).collect())
                }
            })
            .collect();
        Self { paths, lower, truncated }
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

    /// A window of the raw path list, in index order.
    pub fn files(&self, offset: usize, limit: usize) -> Vec<String> {
        if offset >= self.paths.len() || limit == 0 {
            return Vec::new();
        }
        let end = offset.saturating_add(limit).min(self.paths.len());
        self.paths[offset..end].to_vec()
    }

    /// Score every path and return the best `limit` matches, best first.
    ///
    /// Ties break on index order, matching the stable sort the TypeScript
    /// `rankFuzzyMatches` relies on.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let query = Query::new(query);
        if query.is_empty() || limit == 0 || self.paths.is_empty() {
            return Vec::new();
        }

        let mut heap = self
            .lower
            .par_iter()
            .enumerate()
            .fold(
                || (BinaryHeap::<Hit>::new(), Vec::<u32>::new()),
                |(mut heap, mut indices), (idx, lower)| {
                    let score = match lower {
                        LowerPath::Ascii(target) => match query.ascii.as_ref() {
                            Some(q) => score_units(q, target, &mut indices),
                            // A non-ASCII query cannot occur in an ASCII path.
                            None => 0,
                        },
                        LowerPath::Wide(target) => score_units(&query.wide, target, &mut indices),
                    };
                    if score > 0 {
                        push_capped(
                            &mut heap,
                            Hit { score, index: idx as u32, indices: indices.clone() },
                            limit,
                        );
                    }
                    (heap, indices)
                },
            )
            .map(|(heap, _)| heap)
            .reduce(BinaryHeap::new, |mut a, mut b| {
                if a.len() < b.len() {
                    std::mem::swap(&mut a, &mut b);
                }
                for hit in b {
                    push_capped(&mut a, hit, limit);
                }
                a
            });

        let mut hits = heap.drain().collect::<Vec<_>>();
        // `Hit`'s ordering treats greater as worse, so ascending is best-first.
        hits.sort_unstable();
        hits
    }
}

/// Push into a heap that keeps only the best `limit` entries.
fn push_capped(heap: &mut BinaryHeap<Hit>, hit: Hit, limit: usize) {
    if heap.len() < limit {
        heap.push(hit);
        return;
    }
    // `Hit`'s ordering makes the max element the *worst* one, so peeking gives
    // the entry to evict without sorting.
    if let Some(worst) = heap.peek() {
        if hit < *worst {
            heap.pop();
            heap.push(hit);
        }
    }
}

/// A scored path, with the matched positions used for client-side highlighting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hit {
    pub score: u32,
    /// Position in the index's path list, used for stable tie-breaking.
    pub index: u32,
    /// Matched UTF-16 offsets within the path, ascending.
    pub indices: Vec<u32>,
}

impl Ord for Hit {
    /// Greater means *worse*, so a `BinaryHeap<Hit>` evicts from its peek.
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.cmp(&self.score).then_with(|| self.index.cmp(&other.index))
    }
}

impl PartialOrd for Hit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl IndexState {
    /// Resolve a hit back to its path.
    pub fn path_at(&self, index: u32) -> &str {
        &self.paths[index as usize]
    }
}
