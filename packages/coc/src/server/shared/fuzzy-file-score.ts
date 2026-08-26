/**
 * The reference implementation of fuzzy file-path scoring — a parity oracle,
 * not a runtime path.
 *
 * Nothing ranks with this any more: `/search` is answered by the Rust scorer in
 * `packages/coc-native`, which is mandatory. This is the readable statement of
 * what that scorer is supposed to do, and the property test in
 * `packages/coc-native/test/parity.test.ts` holds the two to it.
 *
 * Dependency-free by design, so a test on either side can import it directly.
 */

/** Characters after which a match is treated as starting a new path/word segment. */
function isBoundary(ch: string): boolean {
    return ch === '/' || ch === '\\' || ch === '.' || ch === '-' || ch === '_';
}

/**
 * ASCII-only case folding.
 *
 * Deliberately not `toLowerCase()`: full Unicode folding can change a string's
 * length (`'İ'.toLowerCase()` is two code units), which would misalign the match
 * indices used for highlighting, and it cannot be reproduced byte-for-byte by
 * the native scorer without shipping a Unicode table. Non-ASCII characters
 * therefore match case-sensitively on both sides.
 */
function asciiLower(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
    }
    return out;
}

/** A path scored against a query, with the positions that matched. */
export interface FuzzyFileMatch {
    path: string;
    score: number;
    /**
     * Matched positions within `path`, ascending, as JavaScript string indices.
     * Clients highlight exactly these characters, so the highlight can never
     * disagree with the score.
     */
    indices: number[];
}

/**
 * The character walk: score `query` against an already-lowercased `target`.
 *
 * Every query character must appear in `target` in order, not necessarily
 * contiguously. Returns `null` when it does not match.
 */
function matchQuality(q: string, t: string): { score: number; indices: number[] } | null {
    if (!q) return null;
    if (q.length > t.length) return null;

    let qi = 0;
    let score = 0;
    let prevMatchIdx = -1;
    const indices: number[] = [];

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        // Bail out as soon as too few characters remain to complete the match.
        if (t.length - ti < q.length - qi) return null;

        if (t[ti] === q[qi]) {
            if (ti === prevMatchIdx + 1) score += 2;
            if (ti === 0 || isBoundary(t[ti - 1])) score += 3;
            score += 1;
            prevMatchIdx = ti;
            indices.push(ti);
            qi++;
        }
    }

    if (qi < q.length) return null;
    // Shorter targets are more specific matches.
    score += Math.max(0, 50 - t.length);
    return { score, indices };
}

/** A match plus the ranking keys that never reach the wire. */
interface TieredMatch {
    score: number;
    indices: number[];
    /** 2 when the basename matched, 1 when only the full path did. */
    tier: number;
    /** Length of whatever was scored: the basename in tier 2, the path in tier 1. */
    targetLen: number;
}

/**
 * Score `filePath` against `query` and report which characters matched: every
 * query character must appear in `filePath` in order (not necessarily
 * contiguously).
 *
 * The basename is tried first. A query that matches it lands in tier 2 and its
 * indices are rebased onto the full path; anything else is scored against the
 * whole path in tier 1. A query containing `/` can never match a basename, so
 * it falls to tier 1 without a special case.
 *
 * Returns `null` when the query does not match, or when the query is empty.
 * **`score` is not a ranking oracle on its own** — two results in different
 * tiers can share one. Rank with {@link rankFuzzyMatches}.
 */
export function fuzzyFileMatch(query: string, filePath: string): TieredMatch | null {
    const q = asciiLower(query);
    if (!q) return null;
    const t = asciiLower(filePath);

    // ASCII folding never changes length, so `filePath` offsets index `t` too.
    const nameStart = filePath.lastIndexOf('/') + 1;
    const name = matchQuality(q, t.slice(nameStart));
    if (name) {
        return {
            score: name.score,
            indices: nameStart === 0 ? name.indices : name.indices.map(i => i + nameStart),
            tier: 2,
            targetLen: t.length - nameStart,
        };
    }

    const path = matchQuality(q, t);
    return path ? { score: path.score, indices: path.indices, tier: 1, targetLen: t.length } : null;
}

/**
 * Score `filePath` against `query`, returning 0 when it does not match.
 * See {@link fuzzyFileMatch} for the scoring rules.
 */
export function fuzzyFileScore(query: string, filePath: string): number {
    return fuzzyFileMatch(query, filePath)?.score ?? 0;
}

/**
 * Score every path and return the best `limit` matches, best first.
 *
 * Ordering is a lexicographic key, not a single number: tier descending, then
 * score descending, then path order. Ties break on path order so results are
 * stable for a given input list.
 */
export function rankFuzzyMatches(query: string, paths: readonly string[], limit: number): FuzzyFileMatch[] {
    const matches: (FuzzyFileMatch & { tier: number })[] = [];
    for (const path of paths) {
        const match = fuzzyFileMatch(query, path);
        if (match) matches.push({ path, score: match.score, indices: match.indices, tier: match.tier });
    }
    matches.sort((a, b) => b.tier - a.tier || b.score - a.score);
    const ranked = matches.map(({ path, score, indices }) => ({ path, score, indices }));
    return limit >= 0 && limit < ranked.length ? ranked.slice(0, limit) : ranked;
}
