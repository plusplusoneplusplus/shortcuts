//! Fuzzy path scorer, ported line-for-line from
//! `packages/coc/src/server/shared/fuzzy-file-score.ts`.
//!
//! Ranking parity with the TypeScript scorer is a hard requirement. Nothing
//! ranks with the TS scorer any more — `tree-service.ts` makes this addon
//! mandatory — but it is the readable statement of what this is supposed to do,
//! and `packages/coc-native/test/parity.test.ts` holds the two to it.
//!
//! Two deliberate deviations from JavaScript semantics, both pinned by tests:
//!
//! * Case folding is ASCII-only. `String.prototype.toLowerCase()` applies full
//!   Unicode folding; matching that here would need a Unicode table and only
//!   changes results for non-ASCII queries, which the scorer never scored well
//!   anyway. The TS side folds the same way for parity (see `asciiLower`).
//! * Positions are UTF-16 code-unit offsets, because that is what a JavaScript
//!   string index means and the client uses them to highlight characters.

/// One target/query element: either a byte (ASCII-only paths) or a UTF-16 code
/// unit. Both index identically for ASCII, which is why the byte form is worth
/// having — it halves the memory of the lowercased index for typical repos.
pub trait Unit: Copy + Eq {
    fn as_u32(self) -> u32;
}

impl Unit for u8 {
    #[inline]
    fn as_u32(self) -> u32 {
        u32::from(self)
    }
}

impl Unit for u16 {
    #[inline]
    fn as_u32(self) -> u32 {
        u32::from(self)
    }
}

/// Characters after which a match starts a new path/word segment.
#[inline]
fn is_boundary(unit: u32) -> bool {
    // '/'    '\\'   '.'    '-'    '_'
    unit == 0x2F || unit == 0x5C || unit == 0x2E || unit == 0x2D || unit == 0x5F
}

/// ASCII-lowercase a single UTF-16 code unit.
#[inline]
pub fn lower_unit(unit: u16) -> u16 {
    if (0x41..=0x5A).contains(&unit) {
        unit + 32
    } else {
        unit
    }
}

/// Score `query` against `target` — both already ASCII-lowercased.
///
/// Every query unit must appear in `target` in order, not necessarily
/// contiguously. Returns 0 when the query does not match or is empty; higher is
/// better. Matched positions are appended to `indices`, which is left empty on a
/// zero score.
///
/// Three linear passes, borrowed from fzf's `FuzzyMatchV1`:
///
/// 1. **Forward** — consume the query greedily left to right, recording the
///    first matched offset and one past the last.
/// 2. **Backward** — walk that window right to left consuming the query in
///    reverse; where the query runs out is the tightened start. This is what
///    slides `prompt` off the `p` of `packages` and the `r` of `forge` and onto
///    the literal `prompt` further along the path.
/// 3. **Score** — walk the tight window forward, collecting indices and bonuses.
///
/// A heuristic, not an optimal alignment: two linear passes rather than an
/// O(n*m) dynamic-programming matrix. Some alignments stay sub-optimal by
/// design — that is a known trade, not a bug to "fix" into a matrix without
/// measuring the cost first.
pub fn score_units<T: Unit>(query: &[T], target: &[T], indices: &mut Vec<u32>) -> u32 {
    indices.clear();
    if query.is_empty() {
        return 0;
    }
    if query.len() > target.len() {
        return 0;
    }

    // Forward: the leftmost match, which bounds the window the rest works in.
    let mut qi = 0usize;
    let mut sidx: Option<usize> = None;
    let mut eidx: Option<usize> = None;
    for (ti, unit) in target.iter().enumerate() {
        if *unit == query[qi] {
            if sidx.is_none() {
                sidx = Some(ti);
            }
            qi += 1;
            if qi == query.len() {
                eidx = Some(ti + 1);
                break;
            }
        }
    }
    let (Some(mut sidx), Some(eidx)) = (sidx, eidx) else {
        return 0;
    };

    // Backward: tighten the start to the rightmost one that still matches.
    let mut qi = query.len();
    for ti in (sidx..eidx).rev() {
        if target[ti] == query[qi - 1] {
            qi -= 1;
            if qi == 0 {
                sidx = ti;
                break;
            }
        }
    }

    let mut score = 0u32;
    let mut prev_match: i64 = -1;
    let mut qj = 0usize;
    for ti in sidx..eidx {
        if qj >= query.len() {
            break;
        }
        if target[ti] != query[qj] {
            continue;
        }
        if ti as i64 == prev_match + 1 {
            score += 2;
        }
        // Starting the target outranks starting a segment within it, so an
        // exact filename prefix beats a match that merely follows a dash.
        if ti == 0 {
            score += 5;
        } else if is_boundary(target[ti - 1].as_u32()) {
            score += 3;
        }
        score += 1;
        prev_match = ti as i64;
        qj += 1;
        indices.push(ti as u32);
    }

    // No length term: how specific a target is belongs in `Hit`'s comparator,
    // not the quality score.
    score
}

/// A query, prepared once per search and reused across every path.
pub struct Query {
    /// ASCII-lowercased UTF-16 code units.
    pub wide: Vec<u16>,
    /// Same units narrowed to bytes, present only when the query is all-ASCII.
    /// A non-ASCII query can never match an ASCII-only path.
    pub ascii: Option<Vec<u8>>,
}

impl Query {
    pub fn new(query: &str) -> Self {
        let wide: Vec<u16> = query.encode_utf16().map(lower_unit).collect();
        let ascii = if wide.iter().all(|&u| u < 0x80) {
            Some(wide.iter().map(|&u| u as u8).collect())
        } else {
            None
        };
        Self { wide, ascii }
    }

    pub fn is_empty(&self) -> bool {
        self.wide.is_empty()
    }
}
