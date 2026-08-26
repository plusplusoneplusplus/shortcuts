//! Fuzzy top-N path search over a snapshot.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::sync::Arc;

use rayon::prelude::*;

use super::score::{lower_unit, score_units, Query, Unit};
use super::snapshot::Snapshot;

/// A path's lowercased form, kept in the narrowest representation that still
/// indexes like a JavaScript string.
enum LowerPath {
    /// ASCII-only path: byte offsets equal UTF-16 offsets.
    Ascii(Box<[u8]>),
    Wide(Box<[u16]>),
}

/// One indexed path: its lowercased units plus the ranking keys that can be
/// computed once instead of on every keystroke.
struct IndexedPath {
    lower: LowerPath,
    /// Offset just past the last `/`, so `lower[name_start..]` is the basename.
    /// Snapshot paths are always `/`-separated (see `walk::relative_path`), and
    /// ASCII folding never moves a separator, so this is safe to take on the
    /// lowered form.
    name_start: u32,
}

/// Score the basename first, falling back to the whole path.
///
/// Returns the tier — 2 for a basename match, 1 for a path-only match, 0 for no
/// match — alongside the score. Tier-2 indices are rebased onto the full path so
/// the client highlights the same characters either way.
fn score_tiered<T: Unit>(
    query: &[T],
    target: &[T],
    name_start: usize,
    indices: &mut Vec<u32>,
) -> (u8, u32) {
    let score = score_units(query, &target[name_start..], indices);
    if score > 0 {
        if name_start > 0 {
            for index in indices.iter_mut() {
                *index += name_start as u32;
            }
        }
        return (2, score);
    }
    // A query containing `/` can never match a basename, so it lands here with
    // no separator special-case.
    let score = score_units(query, target, indices);
    if score > 0 {
        (1, score)
    } else {
        (0, 0)
    }
}

/// Fuzzy top-N search over one snapshot's paths.
///
/// Owns the lowercased copy of every path, built eagerly on construction so
/// no search pays that cost. The matcher carries its snapshot, so hit indices
/// always resolve against the same path list they were scored on.
pub struct FuzzyMatcher {
    snapshot: Arc<Snapshot>,
    paths: Vec<IndexedPath>,
}

impl FuzzyMatcher {
    /// Build the lowercase cache over `snapshot`'s paths.
    pub fn new(snapshot: Arc<Snapshot>) -> Self {
        let paths = snapshot
            .paths()
            .iter()
            .map(|path| {
                let lower = if path.is_ascii() {
                    LowerPath::Ascii(
                        path.as_bytes().iter().map(|&b| b.to_ascii_lowercase()).collect(),
                    )
                } else {
                    LowerPath::Wide(path.encode_utf16().map(lower_unit).collect())
                };
                let name_start = match &lower {
                    LowerPath::Ascii(units) => last_separator(units, b'/'),
                    LowerPath::Wide(units) => last_separator(units, u16::from(b'/')),
                };
                IndexedPath { lower, name_start }
            })
            .collect();
        Self { snapshot, paths }
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
        if query.is_empty() || limit == 0 || self.paths.is_empty() {
            return Vec::new();
        }

        let mut heap = self
            .paths
            .par_iter()
            .enumerate()
            .fold(
                || (BinaryHeap::<Hit>::new(), Vec::<u32>::new()),
                |(mut heap, mut indices), (idx, entry)| {
                    let name_start = entry.name_start as usize;
                    let (tier, score) = match &entry.lower {
                        LowerPath::Ascii(target) => match query.ascii.as_ref() {
                            Some(q) => score_tiered(q, target, name_start, &mut indices),
                            // A non-ASCII query cannot occur in an ASCII path.
                            None => (0, 0),
                        },
                        LowerPath::Wide(target) => {
                            score_tiered(&query.wide, target, name_start, &mut indices)
                        }
                    };
                    if tier > 0 {
                        push_capped(
                            &mut heap,
                            Hit { tier, score, index: idx as u32, indices: indices.clone() },
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
    /// 2 when the basename matched, 1 when only the full path did.
    pub tier: u8,
    pub score: u32,
    /// Position in the snapshot's path list, used for stable tie-breaking.
    pub index: u32,
    /// Matched UTF-16 offsets within the path, ascending.
    pub indices: Vec<u32>,
}

impl Ord for Hit {
    /// Greater means *worse*, so a `BinaryHeap<Hit>` evicts from its peek.
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .tier
            .cmp(&self.tier)
            .then_with(|| other.score.cmp(&self.score))
            .then_with(|| self.index.cmp(&other.index))
    }
}

impl PartialOrd for Hit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Offset just past the last `separator` in `units`, or 0 when there is none.
fn last_separator<T: Unit>(units: &[T], separator: T) -> u32 {
    units.iter().rposition(|&u| u == separator).map_or(0, |i| i as u32 + 1)
}
