/**
 * fileBannerModel — parse rule for the continuous-diff file-name banner.
 *
 * Covers the suppression range (`diff --git` → first `@@`), status detection
 * per git preamble shape, per-file +/− counts, and the details text carrying
 * the blob hashes/mode that the banner row drops from view.
 */

import { describe, it, expect } from 'vitest';
import {
    parseFileBanners,
    buildBannerIndex,
    bannerForLineIndex,
    bannerDetailsText,
    splitPath,
} from '../../../../src/server/spa/client/react/features/git/diff/fileBannerModel';

const parse = (diff: string) => parseFileBanners(diff.split('\n'));

const MODIFIED = `diff --git a/packages/coc-desktop/src/app-menu.ts b/packages/coc-desktop/src/app-menu.ts
index 2793a9ad6..8cd4f108a 100644
--- a/packages/coc-desktop/src/app-menu.ts
+++ b/packages/coc-desktop/src/app-menu.ts
@@ -1,3 +1,4 @@
 context
-removed
+added one
+added two`;

describe('parseFileBanners — modified file', () => {
    it('suppresses the whole preamble up to the first @@', () => {
        const [b] = parse(MODIFIED);
        expect(b.startIdx).toBe(0);
        // Lines 1..3 (index / --- / +++) are preamble; line 4 is the `@@`.
        expect(b.preambleEndIdx).toBe(4);
    });

    it('derives path, status and counts', () => {
        const [b] = parse(MODIFIED);
        expect(b.path).toBe('packages/coc-desktop/src/app-menu.ts');
        expect(b.status).toBe('modified');
        expect(b.additions).toBe(2);
        expect(b.deletions).toBe(1);
        expect(b.binary).toBe(false);
    });

    it('keeps the blob hashes off the row but in the details text', () => {
        const [b] = parse(MODIFIED);
        expect(b.indexLine).toBe('2793a9ad6..8cd4f108a 100644');
        expect(bannerDetailsText(b)).toContain('index 2793a9ad6..8cd4f108a 100644');
    });
});

describe('parseFileBanners — status detection', () => {
    it('reads `new file mode` as new', () => {
        const [b] = parse(`diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+line one
+line two`);
        expect(b.status).toBe('new');
        expect(b.mode).toBe('100644');
        expect(b.additions).toBe(2);
        expect(b.deletions).toBe(0);
        expect(b.preambleEndIdx).toBe(5);
    });

    it('reads a bare `--- /dev/null` as new even without a mode line', () => {
        const [b] = parse(`diff --git a/src/new.ts b/src/new.ts
index 0000000..e69de29
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,1 @@
+only`);
        expect(b.status).toBe('new');
    });

    it('reads `deleted file mode` as deleted', () => {
        const [b] = parse(`diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index e69de29..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two`);
        expect(b.status).toBe('deleted');
        expect(b.mode).toBe('100644');
        expect(b.additions).toBe(0);
        expect(b.deletions).toBe(2);
    });

    it('reads rename from/to as renamed and keeps the old path', () => {
        const [b] = parse(`diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index 2793a9a..8cd4f10 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
 keep
-was
+now`);
        expect(b.status).toBe('renamed');
        expect(b.path).toBe('src/new-name.ts');
        expect(b.oldPath).toBe('src/old-name.ts');
        expect(b.similarity).toBe(95);
        expect(b.preambleEndIdx).toBe(7);
        expect(bannerDetailsText(b)).toContain('similarity 95%');
        expect(bannerDetailsText(b)).toContain('from src/old-name.ts');
    });

    it('reads copy from/to as renamed', () => {
        const [b] = parse(`diff --git a/src/a.ts b/src/b.ts
similarity index 100%
copy from src/a.ts
copy to src/b.ts
@@ -1 +1 @@
 same`);
        expect(b.status).toBe('renamed');
        expect(b.path).toBe('src/b.ts');
        expect(b.oldPath).toBe('src/a.ts');
    });

    it('suppresses `old mode`/`new mode` lines that carry no diff prefix', () => {
        const [b] = parse(`diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
index 2793a9a..8cd4f10
--- a/run.sh
+++ b/run.sh
@@ -1 +1 @@
-a
+b`);
        expect(b.preambleEndIdx).toBe(6);
        expect(b.mode).toBe('100755');
        expect(b.additions).toBe(1);
        expect(b.deletions).toBe(1);
    });
});

describe('parseFileBanners — binary files', () => {
    it('renders a banner with no hunks when there is no @@ at all', () => {
        const [b] = parse(`diff --git a/logo.png b/logo.png
index 2793a9a..8cd4f10 100644
Binary files a/logo.png and b/logo.png differ`);
        expect(b.binary).toBe(true);
        expect(b.status).toBe('modified');
        expect(b.additions).toBe(0);
        expect(b.deletions).toBe(0);
        // No `@@`, so the preamble runs to the end of the section.
        expect(b.preambleEndIdx).toBe(3);
    });

    it('bounds a hunkless binary section at the next file, not the end of the diff', () => {
        const banners = parse(`diff --git a/logo.png b/logo.png
index 2793a9a..8cd4f10 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/src/x.ts b/src/x.ts
index aaa..bbb 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-a
+b`);
        expect(banners).toHaveLength(2);
        expect(banners[0].binary).toBe(true);
        expect(banners[0].preambleEndIdx).toBe(3);
        // The binary file must not absorb the second file's +/- lines.
        expect(banners[0].additions).toBe(0);
        expect(banners[0].deletions).toBe(0);
        expect(banners[1].additions).toBe(1);
        expect(banners[1].deletions).toBe(1);
    });
});

describe('parseFileBanners — multi-file counts', () => {
    const MULTI = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old a
+new a
diff --git a/b.ts b/b.ts
index 333..444 100644
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,3 @@
 keep
+one
+two`;

    it('attributes +/- counts to the owning file only', () => {
        const banners = parse(MULTI);
        expect(banners.map(b => b.path)).toEqual(['a.ts', 'b.ts']);
        expect(banners[0]).toMatchObject({ additions: 1, deletions: 1 });
        expect(banners[1]).toMatchObject({ additions: 2, deletions: 0 });
    });

    it('never counts the preamble `---`/`+++` lines as changes', () => {
        const banners = parse(MULTI);
        // 1 real add + 1 real del per file section — `+++`/`---` excluded.
        expect(banners[0].additions + banners[0].deletions).toBe(2);
    });

    it('counts hunk-body lines whose content itself starts with -- or ++', () => {
        const [b] = parse(`diff --git a/doc.md b/doc.md
index 111..222 100644
--- a/doc.md
+++ b/doc.md
@@ -1,2 +1,2 @@
--- a heading underline
+++ replacement text`);
        expect(b.additions).toBe(1);
        expect(b.deletions).toBe(1);
    });

    it('returns an empty list for a diff with no file sections', () => {
        expect(parse('')).toEqual([]);
        expect(parse('just some text\nnot a diff')).toEqual([]);
    });
});

describe('buildBannerIndex', () => {
    it('maps the `diff --git` row to its banner and suppresses the rest', () => {
        const banners = parse(MODIFIED);
        const { bannerByStart, suppressed } = buildBannerIndex(banners);
        expect(bannerByStart.get(0)?.path).toBe('packages/coc-desktop/src/app-menu.ts');
        // Rows 1-3 are dropped; row 0 becomes the banner and row 4 is the `@@`.
        expect([...suppressed].sort((a, b) => a - b)).toEqual([1, 2, 3]);
        expect(suppressed.has(0)).toBe(false);
        expect(suppressed.has(4)).toBe(false);
    });
});

describe('bannerForLineIndex', () => {
    const banners = parse(`diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
index 333..444 100644
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-old
+new`);

    it('returns the file section covering a line index', () => {
        expect(bannerForLineIndex(banners, 0)?.path).toBe('a.ts');
        expect(bannerForLineIndex(banners, 6)?.path).toBe('a.ts');
        expect(bannerForLineIndex(banners, 7)?.path).toBe('b.ts');
        expect(bannerForLineIndex(banners, 13)?.path).toBe('b.ts');
    });

    it('returns undefined before the first file section', () => {
        expect(bannerForLineIndex([], 3)).toBeUndefined();
    });
});

describe('splitPath', () => {
    it('splits a nested path into dimmed directory and bold basename', () => {
        expect(splitPath('packages/coc/src/app-menu.ts')).toEqual({
            dir: 'packages/coc/src/',
            base: 'app-menu.ts',
        });
    });

    it('handles a bare file name at the repo root', () => {
        expect(splitPath('README.md')).toEqual({ dir: '', base: 'README.md' });
    });
});
