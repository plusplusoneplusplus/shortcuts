import { describe, it, expect } from 'vitest';
import { parseFullDiffAsync } from '../../src/diff/diff-utils';

// ── Test data ────────────────────────────────────────────────

const FILE_DIFF_FOO = `diff --git a/foo.ts b/foo.ts
index abc1234..def5678 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
`;

const FILE_DIFF_BAR = `diff --git a/bar.ts b/bar.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/bar.ts
@@ -0,0 +1,2 @@
+new line 1
+new line 2
`;

const FILE_DIFF_DELETED = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-gone1
-gone2
-gone3
`;

const FILE_DIFF_RENAMED = `diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`;

const FILE_DIFF_BINARY = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/image.png differ
`;

const FULL_DIFF = [FILE_DIFF_FOO, FILE_DIFF_BAR].join('');

describe('parseFullDiffAsync', () => {
    it('parses multi-file diff into entries and content map', async () => {
        const { files, contentByPath } = await parseFullDiffAsync(FULL_DIFF);
        expect(files).toHaveLength(2);
        expect(contentByPath.size).toBe(2);
    });

    it('sorts files by path', async () => {
        const { files } = await parseFullDiffAsync(FULL_DIFF);
        expect(files[0].path).toBe('bar.ts');
        expect(files[1].path).toBe('foo.ts');
    });

    it('detects rename with originalPath', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_RENAMED);
        expect(files[0].status).toBe('renamed');
        expect(files[0].originalPath).toBe('old-name.ts');
    });

    it('detects binary file', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_BINARY);
        expect(files[0].isBinary).toBe(true);
    });

    it('handles empty input', async () => {
        const { files, contentByPath } = await parseFullDiffAsync('');
        expect(files).toEqual([]);
        expect(contentByPath.size).toBe(0);
    });
});
