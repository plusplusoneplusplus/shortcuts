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
 * When two anchors overlap, the earlier one wins — the later one is shifted or
 * orphaned.
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

/**
 * Ceiling on the total DP cells the fuzzy sliding-window scan may compute for a
 * single {@link resolveAnchor} call. The scan is O(region × windows × window ×
 * quoted) — on a large document (e.g. a full pdf.js page's text layer) with a
 * long, drifted quote that resolves to no exact/hint match, an unbounded scan is
 * billions of ops and pegs the main thread for seconds (the paper-reader freeze).
 * The cap keeps the worst case to a few hundred milliseconds; it is generous
 * enough that a normal drifted quote still scans several candidate regions and
 * resolves. Only pathologically large inputs get truncated, degrading gracefully
 * to the best match found so far (or "orphaned").
 */
const MAX_FUZZY_LCS_CELLS = 40_000_000;

/**
 * A prefix 8-gram that occurs more often than this in the document carries almost
 * no location signal (it is boilerplate/repetition), so the fuzzy scan skips it
 * rather than scanning a region around every occurrence.
 */
const MAX_HINT_OCCURRENCES = 24;

/**
 * Length of the longest common substring between `a` and `b` using O(n*m) DP.
 * `buf` is a caller-owned scratch row of length ≥ `b.length + 1`, reused across
 * the many windows in a fuzzy scan to avoid a per-window allocation. It is
 * zero-filled up front because the first DP row reads it as the all-zero row 0.
 */
function longestCommonSubstringLength(a: string, b: string, buf: Uint16Array): number {
    if (a.length === 0 || b.length === 0) return 0;
    buf.fill(0, 0, b.length + 1);
    let maxLen = 0;
    for (let i = 1; i <= a.length; i++) {
        let prevDiag = 0;
        for (let j = 1; j <= b.length; j++) {
            const temp = buf[j];
            if (a[i - 1] === b[j - 1]) {
                buf[j] = prevDiag + 1;
                if (buf[j] > maxLen) maxLen = buf[j];
            } else {
                buf[j] = 0;
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

    // Scratch DP row reused across every window, plus a running cell budget so the
    // whole scan is bounded regardless of document/quote size (see
    // MAX_FUZZY_LCS_CELLS). Once the budget is exhausted the scan stops and the
    // best match found so far stands.
    const lcsBuf = new Uint16Array(quotedText.length + 1);
    let cellsUsed = 0;

    const scanRegion = (start: number, end: number) => {
        const regionStart = Math.max(0, start);
        const regionEnd = Math.min(text.length, end);
        for (let i = regionStart; i < regionEnd; i++) {
            for (let wLen = minLen; wLen <= maxLen && i + wLen <= text.length; wLen++) {
                cellsUsed += wLen * quotedText.length;
                if (cellsUsed > MAX_FUZZY_LCS_CELLS) return;
                const window = text.slice(i, i + wLen);
                const lcsLen = longestCommonSubstringLength(window, quotedText, lcsBuf);
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
        // Gather each distinct 8-char prefix hint with all of its positions, then
        // scan the rarest (most distinctive) hints first. On a repetitive document
        // a common hint carries almost no location signal but would burn the whole
        // work budget scanning hundreds of useless regions before the one
        // informative hint near the real match is reached; ordering by rarity (and
        // skipping pathologically common hints) makes the guided scan land on the
        // right region within budget.
        const seen = new Set<string>();
        const candidates: number[][] = [];
        for (let i = 0; i <= prefix.length - HINT_LEN; i++) {
            const hint = prefix.slice(i, i + HINT_LEN);
            if (seen.has(hint)) continue;
            seen.add(hint);
            const occ = findAllOccurrences(text, hint);
            if (occ.length > 0) candidates.push(occ);
        }
        candidates.sort((a, b) => a.length - b.length);
        outer: for (const occ of candidates) {
            if (occ.length > MAX_HINT_OCCURRENCES) continue; // too common to be useful
            for (const idx of occ) {
                hintFound = true;
                scanRegion(idx - SCAN_RADIUS, idx + SCAN_RADIUS + maxLen);
                if (cellsUsed > MAX_FUZZY_LCS_CELLS) break outer;
            }
        }
    }

    // Fall back to a (budget-bounded) full-document scan if no prefix hints found.
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
