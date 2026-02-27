/**
 * Lightweight line-level diff utility for rendering edit tool calls.
 *
 * Uses a simple LCS (Longest Common Subsequence) approach to compute
 * a unified diff between two strings split by newlines.
 */

export interface DiffLine {
    type: 'added' | 'removed' | 'context';
    content: string;
}

/** Maximum line count before falling back to raw display. */
export const MAX_DIFF_LINES = 500;

/**
 * Compute a line-level diff between two strings.
 *
 * Returns an array of DiffLine objects with type 'added', 'removed', or 'context'.
 * If either input exceeds MAX_DIFF_LINES, returns null to signal the caller
 * should fall back to raw display.
 */
export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] | null {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
        return null;
    }

    // Build LCS table
    const m = oldLines.length;
    const n = newLines.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to produce diff
    const result: DiffLine[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.push({ type: 'context', content: oldLines[i - 1] });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.push({ type: 'added', content: newLines[j - 1] });
            j--;
        } else {
            result.push({ type: 'removed', content: oldLines[i - 1] });
            i--;
        }
    }

    result.reverse();
    return result;
}
