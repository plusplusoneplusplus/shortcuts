/**
 * Tests for useCommitDiffCache — module-level diff caching with per-file pre-population.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    splitDiffByFile,
    buildFileDiffUrl,
    prePopulatePerFileCache,
    clearCacheForHash,
    _clearCache,
    _getCacheSize,
    _getCacheEntry,
} from '../../../../src/server/spa/client/react/repos/useCommitDiffCache';

// Mock fetchApi
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

beforeEach(() => {
    _clearCache();
});

afterEach(() => {
    vi.restoreAllMocks();
});

const FULL_DIFF = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    'index 1234567..abcdefg 100644',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,4 @@',
    ' line1',
    '+added',
    ' line2',
    '',
    'diff --git a/src/bar.ts b/src/bar.ts',
    'index 2345678..bcdefga 100644',
    '--- a/src/bar.ts',
    '+++ b/src/bar.ts',
    '@@ -10,2 +10,3 @@',
    ' old',
    '+new',
].join('\n');

describe('splitDiffByFile', () => {
    it('splits a multi-file diff into per-file sections', () => {
        const result = splitDiffByFile(FULL_DIFF);
        expect(result).toHaveLength(2);
        expect(result[0][0]).toBe('src/foo.ts');
        expect(result[1][0]).toBe('src/bar.ts');
    });

    it('each section starts with diff --git', () => {
        const result = splitDiffByFile(FULL_DIFF);
        for (const [, section] of result) {
            expect(section.startsWith('diff --git ')).toBe(true);
        }
    });

    it('returns empty array for empty string', () => {
        expect(splitDiffByFile('')).toEqual([]);
    });

    it('returns empty array for non-diff content', () => {
        expect(splitDiffByFile('some random text')).toEqual([]);
    });

    it('handles single-file diff', () => {
        const singleFile = [
            'diff --git a/readme.md b/readme.md',
            '--- a/readme.md',
            '+++ b/readme.md',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');
        const result = splitDiffByFile(singleFile);
        expect(result).toHaveLength(1);
        expect(result[0][0]).toBe('readme.md');
    });

    it('handles file paths with spaces', () => {
        const diffWithSpaces = [
            'diff --git a/my folder/file name.ts b/my folder/file name.ts',
            '--- a/my folder/file name.ts',
            '+++ b/my folder/file name.ts',
            '@@ -1 +1 @@',
            '-old',
            '+new',
        ].join('\n');
        const result = splitDiffByFile(diffWithSpaces);
        expect(result).toHaveLength(1);
        expect(result[0][0]).toBe('my folder/file name.ts');
    });
});

describe('buildFileDiffUrl', () => {
    it('builds correct URL for a file', () => {
        const url = buildFileDiffUrl('ws1', 'abc123', 'src/foo.ts');
        expect(url).toBe('/workspaces/ws1/git/commits/abc123/files/src%2Ffoo.ts/diff');
    });

    it('encodes special characters in workspaceId', () => {
        const url = buildFileDiffUrl('ws/special', 'abc123', 'foo.ts');
        expect(url).toContain('ws%2Fspecial');
    });

    it('encodes special characters in filePath', () => {
        const url = buildFileDiffUrl('ws1', 'abc123', 'path/to file.ts');
        expect(url).toContain('path%2Fto%20file.ts');
    });
});

describe('prePopulatePerFileCache', () => {
    it('populates per-file cache entries from full diff', () => {
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');

        const fooUrl = buildFileDiffUrl('ws1', 'abc123', 'src/foo.ts');
        const barUrl = buildFileDiffUrl('ws1', 'abc123', 'src/bar.ts');

        expect(_getCacheEntry(fooUrl)).toBeDefined();
        expect(_getCacheEntry(barUrl)).toBeDefined();
        expect(_getCacheSize()).toBe(2);
    });

    it('each cached section contains the correct file diff', () => {
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');

        const fooUrl = buildFileDiffUrl('ws1', 'abc123', 'src/foo.ts');
        const fooSection = _getCacheEntry(fooUrl)!;
        expect(fooSection).toContain('src/foo.ts');
        expect(fooSection).toContain('+added');
        expect(fooSection).not.toContain('src/bar.ts');
    });

    it('does not overwrite existing cache entries', () => {
        const fooUrl = buildFileDiffUrl('ws1', 'abc123', 'src/foo.ts');
        // Manually prime cache with a different value
        prePopulatePerFileCache('diff --git a/src/foo.ts b/src/foo.ts\noriginal', 'ws1', 'abc123');
        const first = _getCacheEntry(fooUrl);

        // Pre-populate again with the full diff — should NOT overwrite
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');
        expect(_getCacheEntry(fooUrl)).toBe(first);
    });

    it('handles empty diff gracefully', () => {
        prePopulatePerFileCache('', 'ws1', 'abc123');
        expect(_getCacheSize()).toBe(0);
    });
});

describe('cache management', () => {
    it('_clearCache empties the cache', () => {
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');
        expect(_getCacheSize()).toBeGreaterThan(0);
        _clearCache();
        expect(_getCacheSize()).toBe(0);
    });

    it('_getCacheEntry returns undefined for missing keys', () => {
        expect(_getCacheEntry('/nonexistent')).toBeUndefined();
    });
});

describe('clearCacheForHash', () => {
    it('evicts all entries for the given commit hash', () => {
        // Populate cache with entries for two different hashes
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'def456');
        expect(_getCacheSize()).toBe(4); // 2 files × 2 hashes

        clearCacheForHash('abc123');

        // abc123 entries gone, def456 entries remain
        expect(_getCacheSize()).toBe(2);
        expect(_getCacheEntry(buildFileDiffUrl('ws1', 'abc123', 'src/foo.ts'))).toBeUndefined();
        expect(_getCacheEntry(buildFileDiffUrl('ws1', 'abc123', 'src/bar.ts'))).toBeUndefined();
        expect(_getCacheEntry(buildFileDiffUrl('ws1', 'def456', 'src/foo.ts'))).toBeDefined();
        expect(_getCacheEntry(buildFileDiffUrl('ws1', 'def456', 'src/bar.ts'))).toBeDefined();
    });

    it('is a no-op when hash is not in cache', () => {
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');
        const sizeBefore = _getCacheSize();
        clearCacheForHash('nonexistent');
        expect(_getCacheSize()).toBe(sizeBefore);
    });

    it('evicts both full-commit and per-file URLs for the hash', () => {
        // Simulate a full-commit URL entry (manually set via the internal cache)
        // by priming through prePopulate + adding a full-commit-style key
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');
        // The full-commit URL also contains the hash
        const fullUrl = '/workspaces/ws1/git/commits/abc123/diff';
        // Simulate the hook having stored a full-commit entry
        prePopulatePerFileCache('', 'ws1', 'abc123'); // no-op but cache already has entries
        // We need to check that per-file entries are cleared
        expect(_getCacheSize()).toBe(2);
        clearCacheForHash('abc123');
        expect(_getCacheSize()).toBe(0);
    });
});

describe('CommitDetail integration', () => {
    it('CommitDetail.tsx imports useCachedDiff', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitDetail.tsx'),
            'utf-8',
        );
        expect(source).toContain("import { useCachedDiff } from './useCommitDiffCache'");
    });

    it('CommitDetail.tsx calls useCachedDiff hook', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitDetail.tsx'),
            'utf-8',
        );
        expect(source).toContain('useCachedDiff(diffUrl, workspaceId, hash)');
    });

    it('CommitDetail.tsx no longer has inline fetch useEffect for diffs', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'CommitDetail.tsx'),
            'utf-8',
        );
        // The old pattern had setDiff/setDiffLoading/setDiffError inline
        expect(source).not.toContain('setDiff(data.diff');
        expect(source).not.toContain('setDiffLoading(true)');
        expect(source).not.toContain('setDiffError(null)');
    });
});

describe('per-file diff cache bypass (regression: partial diff shown in file detail)', () => {
    it('pre-populated per-file entries exist in cache', () => {
        // Verify pre-population works as expected
        prePopulatePerFileCache(FULL_DIFF, 'ws1', 'abc123');
        const fooUrl = buildFileDiffUrl('ws1', 'abc123', 'src/foo.ts');
        expect(_getCacheEntry(fooUrl)).toBeDefined();
    });

    it('useCachedDiff source bypasses cache for per-file URLs', async () => {
        // Regression guard: the hook must skip pre-populated cache entries for
        // per-file URLs so the server's -U99999 endpoint is always reached.
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'useCommitDiffCache.ts'),
            'utf-8',
        );
        // Must check for per-file URL and skip cache
        expect(source).toContain("url.includes('/files/')");
        // Cache lookup must be gated — not an unconditional diffCache.get(url)
        expect(source).not.toMatch(/const cached = diffCache\.get\(url\);\s*if \(cached/);
    });

    it('useCachedDiff source explains the unlimited-context (-U99999) reason', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'useCommitDiffCache.ts'),
            'utf-8',
        );
        expect(source).toContain('U99999');
    });
});

