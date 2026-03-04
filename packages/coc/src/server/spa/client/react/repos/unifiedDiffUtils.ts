/**
 * Generates a minimal unified diff string compatible with UnifiedDiffViewer.
 * Produces standard unified-diff format with a single hunk covering all changes.
 */
export function generateUnifiedDiff(
    oldText: string,
    newText: string,
    fileName: string = 'pipeline.yaml',
): string {
    const oldLines = oldText === '' ? [] : oldText.split('\n');
    const newLines = newText === '' ? [] : newText.split('\n');

    // LCS-based diff
    const lcs = computeLCS(oldLines, newLines);
    const diffLines = buildDiffLines(oldLines, newLines, lcs);

    const header = [
        `--- a/${fileName}`,
        `+++ b/${fileName}`,
        `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ];

    return [...header, ...diffLines].join('\n');
}

/**
 * Compute the Longest Common Subsequence table for two string arrays.
 * Returns a 2D table where dp[i][j] = length of LCS of oldLines[0..i-1] and newLines[0..j-1].
 */
function computeLCS(oldLines: string[], newLines: string[]): number[][] {
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
    return dp;
}

/**
 * Walk the LCS table to produce diff lines with +/- /space prefixes.
 */
function buildDiffLines(oldLines: string[], newLines: string[], dp: number[][]): string[] {
    const result: string[] = [];
    let i = oldLines.length;
    let j = newLines.length;

    // Backtrack through the LCS table
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.push(` ${oldLines[i - 1]}`);
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.push(`+${newLines[j - 1]}`);
            j--;
        } else {
            result.push(`-${oldLines[i - 1]}`);
            i--;
        }
    }

    return result.reverse();
}
