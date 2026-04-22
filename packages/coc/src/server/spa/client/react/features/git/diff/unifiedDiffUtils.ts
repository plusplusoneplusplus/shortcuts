import { computeLCS } from '../../../../diff-utils';

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
