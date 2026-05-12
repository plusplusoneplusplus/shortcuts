/**
 * Tests for pr-diff-provider: pull-request and pull-request-iteration factories.
 *
 * Verifies the remote diff provider logic: parsing unified diffs into
 * file entries, splitting by file, and the factory wiring for both
 * PR and PR-iteration sources.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createPullRequestDiffProvider,
    createPullRequestDiffProviderFromParams,
    createPullRequestIterationDiffProvider,
    createPullRequestIterationDiffProviderFromParams,
    _parseFullDiff,
} from '../../src/diff/pr-diff-provider';
import type { IPullRequestsService } from '../../src/providers/interfaces';
import type { IDiffProvider, PullRequestDiffSource, PullRequestIterationDiffSource } from '../../src/diff/types';

// ── Test data ────────────────────────────────────────────────

const FILE_DIFF_FOO = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    'index 1234567..abcdefg 100644',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,3 @@',
    ' line1',
    '-old line',
    '+new line',
    ' line3',
].join('\n');

const FILE_DIFF_BAR = [
    'diff --git a/src/bar.ts b/src/bar.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/bar.ts',
    '@@ -0,0 +1,2 @@',
    '+export const x = 1;',
    '+export const y = 2;',
].join('\n');

const FILE_DIFF_DELETED = [
    'diff --git a/src/old.ts b/src/old.ts',
    'deleted file mode 100644',
    '--- a/src/old.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-line1',
    '-line2',
    '-line3',
].join('\n');

const FILE_DIFF_RENAMED = [
    'diff --git a/src/before.ts b/src/after.ts',
    'similarity index 90%',
    'rename from src/before.ts',
    'rename to src/after.ts',
    'index aaa..bbb 100644',
    '--- a/src/before.ts',
    '+++ b/src/after.ts',
    '@@ -1,2 +1,2 @@',
    ' unchanged',
    '-old name',
    '+new name',
].join('\n');

const FILE_DIFF_BINARY = [
    'diff --git a/image.png b/image.png',
    'new file mode 100644',
    'Binary files /dev/null and b/image.png differ',
].join('\n');

const FULL_DIFF = [FILE_DIFF_FOO, FILE_DIFF_BAR, FILE_DIFF_DELETED, FILE_DIFF_RENAMED].join('\n');

// ── Helper factories ─────────────────────────────────────────

function makePrSource(overrides?: Partial<PullRequestDiffSource>): PullRequestDiffSource {
    return {
        kind: 'pr',
        repositoryRoot: '/repo',
        provider: 'github',
        remoteRepositoryId: 'owner/repo',
        pullRequestId: 42,
        ...overrides,
    };
}

function makeIterationSource(overrides?: Partial<PullRequestIterationDiffSource>): PullRequestIterationDiffSource {
    return {
        kind: 'pr-iteration',
        repositoryRoot: '/repo',
        provider: 'ado',
        remoteRepositoryId: 'my-repo',
        pullRequestId: 7,
        iterationId: 3,
        ...overrides,
    };
}

function mockPrService(diffResult: string): IPullRequestsService {
    return {
        listPullRequests: vi.fn(),
        getPullRequest: vi.fn(),
        createPullRequest: vi.fn(),
        updatePullRequest: vi.fn(),
        getThreads: vi.fn(),
        createThread: vi.fn(),
        getReviewers: vi.fn(),
        addReviewers: vi.fn(),
        getDiff: vi.fn().mockResolvedValue(diffResult),
    };
}

// ── _parseFullDiff tests ─────────────────────────────────────

describe('_parseFullDiff', () => {
    it('parses a multi-file unified diff into entries and content', () => {
        const { files, contentByPath } = _parseFullDiff(FULL_DIFF);

        expect(files.length).toBe(4);
        expect(contentByPath.size).toBe(4);
    });

    it('returns sorted files', () => {
        const { files } = _parseFullDiff(FULL_DIFF);
        const paths = files.map(f => f.path);
        expect(paths).toEqual([...paths].sort());
    });

    it('detects added files', () => {
        const { files } = _parseFullDiff(FILE_DIFF_BAR);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('added');
        expect(files[0].additions).toBe(2);
        expect(files[0].deletions).toBe(0);
    });

    it('detects deleted files', () => {
        const { files } = _parseFullDiff(FILE_DIFF_DELETED);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('deleted');
        expect(files[0].additions).toBe(0);
        expect(files[0].deletions).toBe(3);
    });

    it('detects modified files', () => {
        const { files } = _parseFullDiff(FILE_DIFF_FOO);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('modified');
        expect(files[0].additions).toBe(1);
        expect(files[0].deletions).toBe(1);
    });

    it('detects renamed files with originalPath', () => {
        const { files } = _parseFullDiff(FILE_DIFF_RENAMED);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('renamed');
        expect(files[0].path).toBe('src/after.ts');
        expect(files[0].originalPath).toBe('src/before.ts');
    });

    it('detects binary files', () => {
        const { files } = _parseFullDiff(FILE_DIFF_BINARY);
        expect(files).toHaveLength(1);
        expect(files[0].isBinary).toBe(true);
    });

    it('handles empty diff', () => {
        const { files, contentByPath } = _parseFullDiff('');
        expect(files).toHaveLength(0);
        expect(contentByPath.size).toBe(0);
    });

    it('handles whitespace-only diff', () => {
        const { files } = _parseFullDiff('  \n  \n  ');
        expect(files).toHaveLength(0);
    });

    it('stores raw content per file', () => {
        const { contentByPath } = _parseFullDiff(FULL_DIFF);
        const fooContent = contentByPath.get('src/foo.ts');
        expect(fooContent).toBeDefined();
        expect(fooContent!.raw).toContain('-old line');
        expect(fooContent!.raw).toContain('+new line');
        expect(fooContent!.truncated).toBe(false);
    });
});

// ── createPullRequestDiffProvider tests ──────────────────────

describe('createPullRequestDiffProvider', () => {
    let provider: IDiffProvider;
    let service: IPullRequestsService;

    beforeEach(() => {
        service = mockPrService(FULL_DIFF);
        provider = createPullRequestDiffProvider(makePrSource(), service);
    });

    it('has correct source descriptor', () => {
        expect(provider.source).toEqual(makePrSource());
    });

    it('throws if service does not implement getDiff', () => {
        const noGetDiff: IPullRequestsService = {
            listPullRequests: vi.fn(),
            getPullRequest: vi.fn(),
            createPullRequest: vi.fn(),
            updatePullRequest: vi.fn(),
            getThreads: vi.fn(),
            createThread: vi.fn(),
            getReviewers: vi.fn(),
            addReviewers: vi.fn(),
            // getDiff is optional and not provided
        };
        expect(() => createPullRequestDiffProvider(makePrSource(), noGetDiff)).toThrow(
            /does not implement getDiff/,
        );
    });

    it('listFiles returns parsed file entries', async () => {
        const files = await provider.listFiles();
        expect(files.length).toBe(4);
        expect(files.map(f => f.path)).toContain('src/foo.ts');
        expect(files.map(f => f.path)).toContain('src/bar.ts');
    });

    it('listFiles caches results', async () => {
        await provider.listFiles();
        await provider.listFiles();
        // getDiff should only be called once
        expect(service.getDiff).toHaveBeenCalledTimes(1);
    });

    it('getFileDiff returns content for a known file', async () => {
        const content = await provider.getFileDiff('src/foo.ts');
        expect(content.raw).toContain('-old line');
        expect(content.raw).toContain('+new line');
        expect(content.truncated).toBe(false);
    });

    it('getFileDiff returns empty content for unknown file', async () => {
        const content = await provider.getFileDiff('nonexistent.ts');
        expect(content.raw).toBe('');
        expect(content.totalLines).toBe(0);
    });

    it('getFullDiff returns the complete diff', async () => {
        const content = await provider.getFullDiff();
        expect(content.raw).toContain('src/foo.ts');
        expect(content.raw).toContain('src/bar.ts');
        expect(content.truncated).toBe(false);
    });

    it('prefetchAll returns map keyed by file path', async () => {
        const map = await provider.prefetchAll();
        expect(map.size).toBe(4);
        expect(map.has('src/foo.ts')).toBe(true);
        expect(map.has('src/bar.ts')).toBe(true);
        expect(map.get('src/foo.ts')!.raw).toContain('-old line');
    });

    it('getSummary returns aggregate stats', async () => {
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(4);
        expect(summary.additions).toBeGreaterThan(0);
        expect(summary.deletions).toBeGreaterThan(0);
    });

    it('passes correct arguments to getDiff', async () => {
        await provider.listFiles();
        expect(service.getDiff).toHaveBeenCalledWith('owner/repo', 42);
    });
});

// ── createPullRequestDiffProviderFromParams tests ────────────

describe('createPullRequestDiffProviderFromParams', () => {
    it('constructs source from params', () => {
        const service = mockPrService('');
        const provider = createPullRequestDiffProviderFromParams(
            'github', '/repo', 'owner/repo', 42, service,
        );
        expect(provider.source).toEqual({
            kind: 'pr',
            provider: 'github',
            repositoryRoot: '/repo',
            remoteRepositoryId: 'owner/repo',
            pullRequestId: 42,
        });
    });

    it('works with ADO provider type', () => {
        const service = mockPrService('');
        const provider = createPullRequestDiffProviderFromParams(
            'ado', '/repo', 'my-ado-repo', 123, service,
        );
        if (provider.source.kind === 'pr') {
            expect(provider.source.provider).toBe('ado');
        }
    });
});

// ── createPullRequestIterationDiffProvider tests ─────────────

describe('createPullRequestIterationDiffProvider', () => {
    let provider: IDiffProvider;
    let fetchDiff: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchDiff = vi.fn().mockResolvedValue(FULL_DIFF);
        provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetchDiff);
    });

    it('has correct source descriptor', () => {
        expect(provider.source).toEqual(makeIterationSource());
    });

    it('listFiles returns parsed entries', async () => {
        const files = await provider.listFiles();
        expect(files.length).toBe(4);
    });

    it('caches the parsed result', async () => {
        await provider.listFiles();
        await provider.getFileDiff('src/foo.ts');
        // fetchDiff should be called only once (cached)
        expect(fetchDiff).toHaveBeenCalledTimes(1);
    });

    it('getFullDiff calls fetchDiff', async () => {
        const content = await provider.getFullDiff();
        expect(content.raw).toBe(FULL_DIFF);
    });

    it('prefetchAll returns all file diffs', async () => {
        const map = await provider.prefetchAll();
        expect(map.size).toBe(4);
    });

    it('getSummary aggregates from parsed files', async () => {
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(4);
    });

    it('supports baseIterationId in source', () => {
        const src = makeIterationSource({ baseIterationId: 1 });
        const p = createPullRequestIterationDiffProvider(src, fetchDiff);
        if (p.source.kind === 'pr-iteration') {
            expect(p.source.baseIterationId).toBe(1);
        }
    });
});

// ── createPullRequestIterationDiffProviderFromParams tests ───

describe('createPullRequestIterationDiffProviderFromParams', () => {
    it('constructs source from params', () => {
        const fetchDiff = vi.fn().mockResolvedValue('');
        const provider = createPullRequestIterationDiffProviderFromParams(
            'ado', '/repo', 'my-repo', 7, 3, fetchDiff,
        );
        expect(provider.source).toEqual({
            kind: 'pr-iteration',
            provider: 'ado',
            repositoryRoot: '/repo',
            remoteRepositoryId: 'my-repo',
            pullRequestId: 7,
            iterationId: 3,
            baseIterationId: undefined,
        });
    });

    it('includes baseIterationId when provided', () => {
        const fetchDiff = vi.fn().mockResolvedValue('');
        const provider = createPullRequestIterationDiffProviderFromParams(
            'ado', '/repo', 'my-repo', 7, 3, fetchDiff, 1,
        );
        if (provider.source.kind === 'pr-iteration') {
            expect(provider.source.baseIterationId).toBe(1);
        }
    });
});

// ── Edge cases ───────────────────────────────────────────────

describe('edge cases', () => {
    it('handles empty diff from service', async () => {
        const service = mockPrService('');
        const provider = createPullRequestDiffProvider(makePrSource(), service);
        const files = await provider.listFiles();
        expect(files).toHaveLength(0);
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(0);
    });

    it('handles service returning only binary files', async () => {
        const service = mockPrService(FILE_DIFF_BINARY);
        const provider = createPullRequestDiffProvider(makePrSource(), service);
        const files = await provider.listFiles();
        expect(files).toHaveLength(1);
        expect(files[0].isBinary).toBe(true);
    });

    it('handles fetchDiff rejection gracefully', async () => {
        const fetchDiff = vi.fn().mockRejectedValue(new Error('Network error'));
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetchDiff);
        await expect(provider.listFiles()).rejects.toThrow('Network error');
    });

    it('handles diff with non-standard paths (spaces, unicode)', async () => {
        const diffWithSpaces = [
            'diff --git a/path with spaces/file.ts b/path with spaces/file.ts',
            'index aaa..bbb 100644',
            '--- a/path with spaces/file.ts',
            '+++ b/path with spaces/file.ts',
            '@@ -1,1 +1,1 @@',
            '-old',
            '+new',
        ].join('\n');

        const { files, contentByPath } = _parseFullDiff(diffWithSpaces);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('path with spaces/file.ts');
        expect(contentByPath.has('path with spaces/file.ts')).toBe(true);
    });

    it('handles single-file diff', async () => {
        const service = mockPrService(FILE_DIFF_FOO);
        const provider = createPullRequestDiffProvider(makePrSource(), service);
        const files = await provider.listFiles();
        expect(files).toHaveLength(1);
        const map = await provider.prefetchAll();
        expect(map.size).toBe(1);
    });
});
