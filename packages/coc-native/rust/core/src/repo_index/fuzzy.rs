//! Fuzzy top-N path search over a snapshot.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::sync::Arc;

use rayon::prelude::*;

use super::score::{lower_unit, score_units, Query};
use super::snapshot::Snapshot;

/// A path's lowercased form, kept in the narrowest representation that still
/// indexes like a JavaScript string.
enum LowerPath {
    /// ASCII-only path: byte offsets equal UTF-16 offsets.
    Ascii(Box<[u8]>),
    Wide(Box<[u16]>),
}

/// Fuzzy top-N search over one snapshot's paths.
///
/// Owns the lowercased copy of every path, built eagerly on construction so
/// no search pays that cost. The matcher carries its snapshot, so hit indices
/// always resolve against the same path list they were scored on.
pub struct FuzzyMatcher {
    snapshot: Arc<Snapshot>,
    lower: Vec<LowerPath>,
}

impl FuzzyMatcher {
    /// Build the lowercase cache over `snapshot`'s paths.
    pub fn new(snapshot: Arc<Snapshot>) -> Self {
        let lower = snapshot
            .paths()
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
        Self { snapshot, lower }
    }

    /// The snapshot this matcher scores against.
    pub fn snapshot(&self) -> &Arc<Snapshot> {
        &self.snapshot
    }

    /// Score every path and return the best `limit` matches, best first.
    ///
    /// Ties break on index order, matching the stable sort the TypeScript
    /// `rankFuzzyMatches` relies on.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let query = Query::new(query);
        if query.is_empty() || limit == 0 || self.lower.is_empty() {
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
    /// Position in the snapshot's path list, used for stable tie-breaking.
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
