/**
 * Fuzzy file-path scoring shared by the repo file-search endpoint and the SPA
 * file-finder dialogs, so server-ranked and client-ranked results agree.
 *
 * Dependency-free by design — this module is bundled into the browser client.
 */

/** Characters after which a match is treated as starting a new path/word segment. */
function isBoundary(ch: string): boolean {
    return ch === '/' || ch === '\\' || ch === '.' || ch === '-' || ch === '_';
}

/**
 * Score `filePath` against `query`: every query character must appear in
 * `filePath` in order (not necessarily contiguously).
 *
 * Returns 0 when the query does not match, or when the query is empty.
 * Higher is better. Consecutive matches and matches at a path or word boundary
 * score more, and shorter paths win ties.
 */
export function fuzzyFileScore(query: string, filePath: string): number {
    const q = query.toLowerCase();
    const t = filePath.toLowerCase();
    if (!q) return 0;
    if (q.length > t.length) return 0;

    let qi = 0;
    let score = 0;
    let prevMatchIdx = -1;

    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        // Bail out as soon as too few characters remain to complete the match.
        if (t.length - ti < q.length - qi) return 0;

        if (t[ti] === q[qi]) {
            if (ti === prevMatchIdx + 1) score += 2;
            if (ti === 0 || isBoundary(t[ti - 1])) score += 3;
            score += 1;
            prevMatchIdx = ti;
            qi++;
        }
    }

    if (qi < q.length) return 0;
    // Shorter targets are more specific matches.
    score += Math.max(0, 50 - filePath.length);
    return score;
}

/** A scored path, ordered best-first by {@link rankFuzzyMatches}. */
export interface FuzzyFileMatch {
    path: string;
    score: number;
}

/**
 * Score every path and return the best `limit` matches, highest score first.
 * Ties break on path order so results are stable for a given input list.
 */
export function rankFuzzyMatches(query: string, paths: readonly string[], limit: number): FuzzyFileMatch[] {
    const matches: FuzzyFileMatch[] = [];
    for (const path of paths) {
        const score = fuzzyFileScore(query, path);
        if (score > 0) matches.push({ path, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return limit >= 0 && limit < matches.length ? matches.slice(0, limit) : matches;
}
