//! Fuzzy path scorer, ported line-for-line from
//! `packages/coc/src/server/shared/fuzzy-file-score.ts`.
//!
//! Ranking parity with the TypeScript scorer is a hard requirement: the SPA
//! falls back to the TS implementation whenever the native addon is absent, and
//! both must produce the same ordering for the same input list.
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
/// `target_len` is passed separately because the shortness bonus in the TS
/// scorer uses the *original* path length, which equals the lowercased length
/// under ASCII folding but is clearer stated explicitly.
pub fn score_units<T: Unit>(query: &[T], target: &[T], indices: &mut Vec<u32>) -> u32 {
    indices.clear();
    if query.is_empty() {
        return 0;
    }
    if query.len() > target.len() {
        return 0;
    }

    let mut qi = 0usize;
    let mut score = 0u32;
    let mut prev_match: i64 = -1;

    for ti in 0..target.len() {
        if qi >= query.len() {
            break;
        }
        // Bail out as soon as too few units remain to complete the match.
        if target.len() - ti < query.len() - qi {
            indices.clear();
            return 0;
        }

        if target[ti] == query[qi] {
            if ti as i64 == prev_match + 1 {
                score += 2;
            }
            if ti == 0 || is_boundary(target[ti - 1].as_u32()) {
                score += 3;
            }
            score += 1;
            prev_match = ti as i64;
            qi += 1;
            indices.push(ti as u32);
        }
    }

    if qi < query.len() {
        indices.clear();
        return 0;
    }
    // Shorter targets are more specific matches.
    score += 50u32.saturating_sub(target.len() as u32);
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
