/**
 * Diff Line Mapper Tests
 *
 * Unit tests for unified diff parsing and line-index computation.
 */

import { describe, it, expect } from 'vitest';
import {
    parseUnifiedDiff,
    mapLinesToDiffIndices,
    extractTextFromDiffLines,
} from '../../../src/server/llm-tools/diff-line-mapper';

// ============================================================================
// Sample Diffs
// ============================================================================

const SINGLE_HUNK_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
 import { foo } from './foo';
-import { bar } from './bar';
+import { bar } from './bar-v2';
+import { baz } from './baz';
 
 export function main() {
`;

const MULTI_HUNK_DIFF = `diff --git a/src/utils.ts b/src/utils.ts
index 1111111..2222222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -3,6 +3,7 @@
 const A = 1;
 const B = 2;
 const C = 3;
+const D = 4;
 
 function helper() {
@@ -20,4 +21,5 @@
 export function utils() {
     return A + B;
+    // TODO: add C + D
 }
`;

const ADDED_ONLY_DIFF = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export const x = 1;
+export const y = 2;
+export const z = 3;
`;

const DELETED_ONLY_DIFF = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index abcdef1..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const a = 1;
-export const b = 2;
-export const c = 3;
`;

// ============================================================================
// parseUnifiedDiff
// ============================================================================

describe('parseUnifiedDiff', () => {
    it('parses a single-hunk diff correctly', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);

        // Hunk header + 5 content lines (1 context, 1 removed, 2 added, 1 context)
        // Then 2 more context lines ("", "export function main() {")
        expect(lines.length).toBeGreaterThanOrEqual(5);

        // First entry is hunk header
        expect(lines[0].type).toBe('hunk-header');
        expect(lines[0].index).toBe(0);

        // Second is context line "import { foo } from './foo';"
        expect(lines[1].type).toBe('context');
        expect(lines[1].content).toBe("import { foo } from './foo';");
        expect(lines[1].oldLine).toBe(1);
        expect(lines[1].newLine).toBe(1);

        // Third is removed line
        expect(lines[2].type).toBe('removed');
        expect(lines[2].content).toBe("import { bar } from './bar';");
        expect(lines[2].oldLine).toBe(2);
        expect(lines[2].newLine).toBeUndefined();

        // Fourth is added line (replacement)
        expect(lines[3].type).toBe('added');
        expect(lines[3].content).toBe("import { bar } from './bar-v2';");
        expect(lines[3].newLine).toBe(2);
        expect(lines[3].oldLine).toBeUndefined();

        // Fifth is added line (insertion)
        expect(lines[4].type).toBe('added');
        expect(lines[4].content).toBe("import { baz } from './baz';");
        expect(lines[4].newLine).toBe(3);
    });

    it('parses multiple hunks', () => {
        const lines = parseUnifiedDiff(MULTI_HUNK_DIFF);

        // Find the two hunk headers
        const hunkHeaders = lines.filter((l) => l.type === 'hunk-header');
        expect(hunkHeaders).toHaveLength(2);

        // First hunk starts at line 3 of old file
        const firstHunkAdded = lines.filter(
            (l) => l.type === 'added' && l.index > hunkHeaders[0].index && l.index < hunkHeaders[1].index,
        );
        expect(firstHunkAdded).toHaveLength(1);
        expect(firstHunkAdded[0].content).toBe('const D = 4;');

        // Second hunk
        const secondHunkAdded = lines.filter(
            (l) => l.type === 'added' && l.index > hunkHeaders[1].index,
        );
        expect(secondHunkAdded).toHaveLength(1);
        expect(secondHunkAdded[0].content).toBe('    // TODO: add C + D');
    });

    it('parses an added-only diff (new file)', () => {
        const lines = parseUnifiedDiff(ADDED_ONLY_DIFF);

        // Should have hunk header + 3 added lines
        expect(lines).toHaveLength(4);
        expect(lines[0].type).toBe('hunk-header');
        expect(lines[1].type).toBe('added');
        expect(lines[1].newLine).toBe(1);
        expect(lines[2].type).toBe('added');
        expect(lines[2].newLine).toBe(2);
        expect(lines[3].type).toBe('added');
        expect(lines[3].newLine).toBe(3);
    });

    it('parses a deleted-only diff', () => {
        const lines = parseUnifiedDiff(DELETED_ONLY_DIFF);

        expect(lines).toHaveLength(4);
        expect(lines[0].type).toBe('hunk-header');
        expect(lines[1].type).toBe('removed');
        expect(lines[1].oldLine).toBe(1);
        expect(lines[2].type).toBe('removed');
        expect(lines[2].oldLine).toBe(2);
        expect(lines[3].type).toBe('removed');
        expect(lines[3].oldLine).toBe(3);
    });

    it('assigns sequential indices starting at 0', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        for (let i = 0; i < lines.length; i++) {
            expect(lines[i].index).toBe(i);
        }
    });

    it('returns empty array for empty input', () => {
        expect(parseUnifiedDiff('')).toEqual([]);
    });

    it('returns empty array for binary file diff', () => {
        const binaryDiff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;
        expect(parseUnifiedDiff(binaryDiff)).toEqual([]);
    });

    it('skips "No newline at end of file" markers', () => {
        const diff = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 line1
-line2
\\ No newline at end of file
+line2-modified
\\ No newline at end of file
`;
        const lines = parseUnifiedDiff(diff);
        const nonHeaders = lines.filter((l) => l.type !== 'hunk-header');
        // Should have: context(line1), removed(line2), added(line2-modified)
        expect(nonHeaders).toHaveLength(3);
        expect(nonHeaders.every((l) => !l.content.startsWith('\\'))).toBe(true);
    });
});

// ============================================================================
// mapLinesToDiffIndices
// ============================================================================

describe('mapLinesToDiffIndices', () => {
    it('maps a single added line', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'added', 3);

        expect(mapping.side).toBe('added');
        expect(mapping.diffLineStart).toBeDefined();
        expect(mapping.diffLineEnd).toBeDefined();
        expect(mapping.newLineStart).toBe(3);
        expect(mapping.newLineEnd).toBe(3);
    });

    it('maps a single removed line', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'removed', 2);

        expect(mapping.side).toBe('removed');
        expect(mapping.oldLineStart).toBe(2);
        expect(mapping.oldLineEnd).toBe(2);
    });

    it('maps a context line', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'context', 1);

        expect(mapping.side).toBe('context');
        expect(mapping.oldLineStart).toBe(1);
        expect(mapping.newLineStart).toBe(1);
    });

    it('maps a range of added lines', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'added', 2, 3);

        expect(mapping.newLineStart).toBe(2);
        expect(mapping.newLineEnd).toBe(3);
        expect(mapping.diffLineEnd).toBeGreaterThan(mapping.diffLineStart);
    });

    it('maps lines in second hunk', () => {
        const lines = parseUnifiedDiff(MULTI_HUNK_DIFF);
        // The added line in second hunk is at new line 23
        const mapping = mapLinesToDiffIndices(lines, 'added', 23);

        expect(mapping.side).toBe('added');
        expect(mapping.newLineStart).toBe(23);
    });

    it('maps lines in a new-file diff', () => {
        const lines = parseUnifiedDiff(ADDED_ONLY_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'added', 1, 3);

        expect(mapping.diffLineStart).toBe(1); // index 0 is hunk header
        expect(mapping.diffLineEnd).toBe(3);
        expect(mapping.newLineStart).toBe(1);
        expect(mapping.newLineEnd).toBe(3);
    });

    it('maps lines in a deleted-file diff', () => {
        const lines = parseUnifiedDiff(DELETED_ONLY_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'removed', 1, 3);

        expect(mapping.diffLineStart).toBe(1);
        expect(mapping.diffLineEnd).toBe(3);
        expect(mapping.oldLineStart).toBe(1);
        expect(mapping.oldLineEnd).toBe(3);
    });

    it('throws when line is outside any hunk', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        expect(() => mapLinesToDiffIndices(lines, 'added', 999)).toThrow(
            /not found in any diff hunk/,
        );
    });

    it('defaults lineEnd to lineStart when not provided', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        const mapping = mapLinesToDiffIndices(lines, 'added', 2);

        expect(mapping.diffLineStart).toBe(mapping.diffLineEnd);
    });
});

// ============================================================================
// extractTextFromDiffLines
// ============================================================================

describe('extractTextFromDiffLines', () => {
    it('extracts text for a range of diff lines', () => {
        const lines = parseUnifiedDiff(ADDED_ONLY_DIFF);
        const text = extractTextFromDiffLines(lines, 1, 3);

        expect(text).toBe('export const x = 1;\nexport const y = 2;\nexport const z = 3;');
    });

    it('excludes hunk headers from extracted text', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        const text = extractTextFromDiffLines(lines, 0, 2);

        // Index 0 is hunk header — should be excluded
        expect(text).not.toContain('@@');
    });

    it('returns single line for single-index range', () => {
        const lines = parseUnifiedDiff(ADDED_ONLY_DIFF);
        const text = extractTextFromDiffLines(lines, 1, 1);

        expect(text).toBe('export const x = 1;');
    });

    it('returns empty string when range has no content lines', () => {
        const lines = parseUnifiedDiff(SINGLE_HUNK_DIFF);
        // Index 0 is a hunk header only
        const text = extractTextFromDiffLines(lines, 0, 0);

        expect(text).toBe('');
    });
});
