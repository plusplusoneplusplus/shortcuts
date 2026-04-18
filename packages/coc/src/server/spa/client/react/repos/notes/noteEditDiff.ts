/**
 * Word-level diff for AI edit decorations.
 *
 * Tokenizes two strings on word/punctuation boundaries and runs a Myers
 * LCS diff to produce a flat list of DiffChunk objects, each typed as
 * 'equal', 'add', or 'remove'. Used by AiEditDecorationExtension to
 * render GitHub-style word-diff decorations in the Tiptap editor.
 */

export type DiffChunkType = 'equal' | 'add' | 'remove';

export interface DiffChunk {
    type: DiffChunkType;
    text: string;
}

/**
 * Tokenize a string into word-boundary-aware tokens.
 * Splits on whitespace + punctuation while preserving the delimiters
 * so that re-joining the tokens reproduces the original string exactly.
 */
function tokenize(text: string): string[] {
    if (!text) return [];
    // Split on word/non-word transitions and whitespace, preserving all characters
    return text.split(/(\s+|[^\w\s]+)/g).filter(t => t.length > 0);
}

/**
 * Compute Myers LCS-based word diff between oldStr and newStr.
 * Returns a flat list of DiffChunk objects.
 */
export function wordDiff(oldStr: string, newStr: string): DiffChunk[] {
    const aTokens = tokenize(oldStr);
    const bTokens = tokenize(newStr);

    if (aTokens.length === 0 && bTokens.length === 0) return [];
    if (aTokens.length === 0) return bTokens.map(t => ({ type: 'add' as DiffChunkType, text: t }));
    if (bTokens.length === 0) return aTokens.map(t => ({ type: 'remove' as DiffChunkType, text: t }));

    // Build LCS table
    const m = aTokens.length;
    const n = bTokens.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (aTokens[i - 1] === bTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Traceback to build diff
    const chunks: DiffChunk[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && aTokens[i - 1] === bTokens[j - 1]) {
            chunks.push({ type: 'equal', text: aTokens[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            chunks.push({ type: 'add', text: bTokens[j - 1] });
            j--;
        } else {
            chunks.push({ type: 'remove', text: aTokens[i - 1] });
            i--;
        }
    }

    chunks.reverse();
    return mergeAdjacentEqual(chunks);
}

/** Merge consecutive tokens of the same type into single chunks for efficiency. */
function mergeAdjacentEqual(chunks: DiffChunk[]): DiffChunk[] {
    if (chunks.length === 0) return chunks;
    const merged: DiffChunk[] = [chunks[0]];
    for (let k = 1; k < chunks.length; k++) {
        const prev = merged[merged.length - 1];
        const cur = chunks[k];
        if (prev.type === cur.type) {
            merged[merged.length - 1] = { type: prev.type, text: prev.text + cur.text };
        } else {
            merged.push(cur);
        }
    }
    return merged;
}
