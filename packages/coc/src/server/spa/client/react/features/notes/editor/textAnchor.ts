/**
 * textAnchor — pure-logic utilities for creating, resolving, and
 * batch-resolving text anchors with exact / fuzzy / orphaned confidence.
 *
 * No React or Node.js dependencies — safe for browser and test environments.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface TextAnchor {
    quotedText: string; // the exact text the user highlighted
    prefix: string; // ~50 chars immediately before the selection
    suffix: string; // ~50 chars immediately after the selection
}

export interface AnchorMatch {
    from: number; // character offset in the plain-text document (0-based)
    to: number; // exclusive end offset
    confidence: 'exact' | 'fuzzy' | 'orphaned';
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a TextAnchor from a document string and a [from, to) selection range.
 * `contextLength` defaults to 50 characters.
 */
export function createTextAnchor(
    text: string,
    from: number,
    to: number,
    contextLength: number = 50,
): TextAnchor {
    return {
        quotedText: text.slice(from, to),
        prefix: text.slice(Math.max(0, from - contextLength), from),
        suffix: text.slice(to, to + contextLength),
    };
}

/**
 * Find the best position for `anchor` inside `text`.
 * Returns an AnchorMatch with confidence level.
 */
export function resolveAnchor(text: string, anchor: TextAnchor): AnchorMatch {
    const { quotedText, prefix, suffix } = anchor;

    // 1. Full-context exact match
    const fullContext = prefix + quotedText + suffix;
    if (fullContext.length > 0) {
        const idx = text.indexOf(fullContext);
        if (idx !== -1) {
            return {
                from: idx + prefix.length,
                to: idx + prefix.length + quotedText.length,
                confidence: 'exact',
            };
        }
    }

    // 2. Quoted-text exact match
    if (quotedText.length > 0) {
        const occurrences = findAllOccurrences(text, quotedText);
        if (occurrences.length === 1) {
            return {
                from: occurrences[0],
                to: occurrences[0] + quotedText.length,
                confidence: 'exact',
            };
        }
        if (occurrences.length > 1) {
            // Score each candidate by prefix/suffix context overlap
            let bestIdx = occurrences[0];
            let bestScore = -1;
            for (const occ of occurrences) {
                const score = scoreContext(text, occ, quotedText.length, prefix, suffix);
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = occ;
                }
            }
            return {
                from: bestIdx,
                to: bestIdx + quotedText.length,
                confidence: 'exact',
            };
        }
    }

    // 3. Fuzzy match
    const fuzzy = fuzzyMatch(text, anchor);
    if (fuzzy) {
        return fuzzy;
    }

    // 4. Orphaned
    return { from: -1, to: -1, confidence: 'orphaned' };
}

/**
 * Batch-resolve an array of { threadId, anchor } tuples.
 * Returns a Map<threadId, AnchorMatch>.
 * When two anchors overlap, the earlier one wins (later one is shifted or orphaned).
 */
export function resolveAnchors(
    text: string,
    anchors: Array<{ threadId: string; anchor: TextAnchor }>,
): Map<string, AnchorMatch> {
    const result = new Map<string, AnchorMatch>();
    if (anchors.length === 0) return result;

    // Resolve each anchor independently first
    const entries: Array<{ threadId: string; match: AnchorMatch }> = anchors.map((a) => ({
        threadId: a.threadId,
        match: resolveAnchor(text, a.anchor),
    }));

    // Sort by from ascending (orphaned entries go to the end)
    entries.sort((a, b) => {
        if (a.match.from === -1 && b.match.from === -1) return 0;
        if (a.match.from === -1) return 1;
        if (b.match.from === -1) return -1;
        return a.match.from - b.match.from;
    });

    let prevTo = -1;
    for (const entry of entries) {
        if (entry.match.confidence === 'orphaned') {
            result.set(entry.threadId, entry.match);
            continue;
        }

        if (entry.match.from < prevTo) {
            // Overlap detected — try re-resolving constrained to text after prevTo
            const anchorData = anchors.find((a) => a.threadId === entry.threadId)!;
            const constrainedMatch = resolveAnchorAfter(text, anchorData.anchor, prevTo);
            if (constrainedMatch) {
                result.set(entry.threadId, constrainedMatch);
                prevTo = constrainedMatch.to;
            } else {
                result.set(entry.threadId, { from: -1, to: -1, confidence: 'orphaned' });
            }
        } else {
            result.set(entry.threadId, entry.match);
            prevTo = entry.match.to;
        }
    }

    return result;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function findAllOccurrences(text: string, search: string): number[] {
    const results: number[] = [];
    let idx = text.indexOf(search);
    while (idx !== -1) {
        results.push(idx);
        idx = text.indexOf(search, idx + 1);
    }
    return results;
}

/** Score how well prefix/suffix match the surrounding text at a candidate position. */
function scoreContext(
    text: string,
    candidateStart: number,
    quotedLength: number,
    prefix: string,
    suffix: string,
): number {
    let score = 0;

    // Check prefix: compare text before candidate with anchor prefix
    if (prefix.length > 0) {
        const textBefore = text.slice(Math.max(0, candidateStart - prefix.length), candidateStart);
        score += commonSuffixLength(textBefore, prefix);
    }

    // Check suffix: compare text after candidate with anchor suffix
    if (suffix.length > 0) {
        const candidateEnd = candidateStart + quotedLength;
        const textAfter = text.slice(candidateEnd, candidateEnd + suffix.length);
        score += commonPrefixLength(textAfter, suffix);
    }

    return score;
}

function commonPrefixLength(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return i;
    }
    return len;
}

function commonSuffixLength(a: string, b: string): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return i;
    }
    return len;
}

/** Compute length of the longest common substring between a and b using O(n*m) DP. */
function longestCommonSubstringLength(a: string, b: string): number {
    if (a.length === 0 || b.length === 0) return 0;
    let maxLen = 0;
    // Use a single row for space efficiency
    const prev = new Uint16Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
        let prevDiag = 0;
        for (let j = 1; j <= b.length; j++) {
            const temp = prev[j];
            if (a[i - 1] === b[j - 1]) {
                prev[j] = prevDiag + 1;
                if (prev[j] > maxLen) maxLen = prev[j];
            } else {
                prev[j] = 0;
            }
            prevDiag = temp;
        }
    }
    return maxLen;
}

/**
 * Fuzzy match: slide a window of length ±20% across text, scoring by LCS similarity.
 * For performance, first look for prefix hints (8-char substrings) and scan nearby.
 */
function fuzzyMatch(text: string, anchor: TextAnchor): AnchorMatch | null {
    const { quotedText, prefix } = anchor;
    if (quotedText.length === 0) return null;

    const minLen = Math.max(1, Math.floor(quotedText.length * 0.8));
    const maxLen = Math.ceil(quotedText.length * 1.2);

    let bestSimilarity = 0;
    let bestFrom = -1;
    let bestTo = -1;

    const scanRegion = (start: number, end: number) => {
        const regionStart = Math.max(0, start);
        const regionEnd = Math.min(text.length, end);
        for (let i = regionStart; i < regionEnd; i++) {
            for (let wLen = minLen; wLen <= maxLen && i + wLen <= text.length; wLen++) {
                const window = text.slice(i, i + wLen);
                const lcsLen = longestCommonSubstringLength(window, quotedText);
                const similarity = lcsLen / Math.max(wLen, quotedText.length);
                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestFrom = i;
                    bestTo = i + wLen;
                }
            }
        }
    };

    // Try prefix-hint guided scan first
    const HINT_LEN = 8;
    const SCAN_RADIUS = 200;
    let hintFound = false;

    if (prefix.length >= HINT_LEN) {
        const hints = new Set<string>();
        for (let i = 0; i <= prefix.length - HINT_LEN; i++) {
            hints.add(prefix.slice(i, i + HINT_LEN));
        }
        for (const hint of hints) {
            let idx = text.indexOf(hint);
            while (idx !== -1) {
                hintFound = true;
                scanRegion(idx - SCAN_RADIUS, idx + SCAN_RADIUS + maxLen);
                idx = text.indexOf(hint, idx + 1);
            }
        }
    }

    // Fall back to full-document scan if no prefix hints found
    if (!hintFound) {
        scanRegion(0, text.length);
    }

    if (bestSimilarity >= 0.6) {
        return { from: bestFrom, to: bestTo, confidence: 'fuzzy' };
    }

    return null;
}

/**
 * Re-resolve an anchor constrained to text after a given offset.
 * Used by resolveAnchors to handle overlapping results.
 */
function resolveAnchorAfter(
    text: string,
    anchor: TextAnchor,
    afterOffset: number,
): AnchorMatch | null {
    const subText = text.slice(afterOffset);
    const match = resolveAnchor(subText, anchor);
    if (match.confidence === 'orphaned') return null;
    return {
        from: match.from + afterOffset,
        to: match.to + afterOffset,
        confidence: match.confidence,
    };
}
