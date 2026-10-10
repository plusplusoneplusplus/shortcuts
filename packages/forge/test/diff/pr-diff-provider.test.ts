/**
 * Verifies the remote diff provider logic: parsing unified diffs into
 * file entries, splitting by file, and the factory wiring for both
 * PR and PR-iteration sources.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import {
    createPullRequestDiffProvider,
    createPullRequestDiffProviderFromParams,
    createPullRequestIterationDiffProvider,
    createPullRequestIterationDiffProviderFromParams,
    type RemoteDiffProvider,
} from '../../src/diff/pr-diff-provider';
import { parseFullDiffAsync } from '../../src/diff/diff-utils';
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
const ROOT = path.resolve('fixture-repo');
const CONTEXT = { workspaceId: 'workspace-a', host: 'provider.example', repository: 'org/project/repo' };

// ── Helper factories ─────────────────────────────────────────

function makePrSource(overrides?: Partial<PullRequestDiffSource>): PullRequestDiffSource {
    return {
        kind: 'pr',
        repositoryRoot: ROOT,
        provider: 'github',
        remoteRepositoryId: 'owner/repo',
        pullRequestId: 42,
        ...overrides,
    };
}

function makeIterationSource(overrides?: Partial<PullRequestIterationDiffSource>): PullRequestIterationDiffSource {
    return {
        kind: 'pr-iteration',
        repositoryRoot: ROOT,
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

// ── parseFullDiffAsync tests ─────────────────────────────────────

describe('parseFullDiffAsync', () => {
    it('parses a multi-file unified diff into entries and content', async () => {
        const { files, contentByPath } = await parseFullDiffAsync(FULL_DIFF);

        expect(files.length).toBe(4);
        expect(contentByPath.size).toBe(4);
    });

    it('returns sorted files', async () => {
        const { files } = await parseFullDiffAsync(FULL_DIFF);
        const paths = files.map(f => f.path);
        expect(paths).toEqual([...paths].sort());
    });

    it('detects added files', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_BAR);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('added');
        expect(files[0].additions).toBe(2);
        expect(files[0].deletions).toBe(0);
    });

    it('detects deleted files', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_DELETED);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('deleted');
        expect(files[0].additions).toBe(0);
        expect(files[0].deletions).toBe(3);
    });

    it('detects modified files', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_FOO);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('modified');
        expect(files[0].additions).toBe(1);
        expect(files[0].deletions).toBe(1);
    });

    it('detects renamed files with originalPath', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_RENAMED);
        expect(files).toHaveLength(1);
        expect(files[0].status).toBe('renamed');
        expect(files[0].path).toBe('src/after.ts');
        expect(files[0].originalPath).toBe('src/before.ts');
    });

    it('detects binary files', async () => {
        const { files } = await parseFullDiffAsync(FILE_DIFF_BINARY);
        expect(files).toHaveLength(1);
        expect(files[0].isBinary).toBe(true);
    });

    it('handles empty diff', async () => {
        const { files, contentByPath } = await parseFullDiffAsync('');
        expect(files).toHaveLength(0);
        expect(contentByPath.size).toBe(0);
    });

    it('handles whitespace-only diff', async () => {
        const { files } = await parseFullDiffAsync('  \n  \n  ');
        expect(files).toHaveLength(0);
    });

    it('stores raw content per file', async () => {
        const { contentByPath } = await parseFullDiffAsync(FULL_DIFF);
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
        provider = createPullRequestDiffProvider(makePrSource(), service, CONTEXT);
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
        expect(() => createPullRequestDiffProvider(makePrSource(), noGetDiff, CONTEXT)).toThrow(
            /does not implement getDiff/,
        );
    });

    it('listFiles returns parsed file entries', async () => {
        const files = await provider.listFiles();
        expect(files.length).toBe(4);
        expect(files.map(f => f.path)).toContain('src/foo.ts');
        expect(files.map(f => f.path)).toContain('src/bar.ts');
    });

    it('listFiles fetches current remote state', async () => {
        await provider.listFiles();
        await provider.listFiles();
        expect(service.getDiff).toHaveBeenCalledTimes(2);
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
            'github', ROOT, 'owner/repo', 42, service, CONTEXT,
        );
        expect(provider.source).toEqual({
            kind: 'pr',
            provider: 'github',
            repositoryRoot: ROOT,
            remoteRepositoryId: 'owner/repo',
            pullRequestId: 42,
        });
    });

    it('works with ADO provider type', () => {
        const service = mockPrService('');
        const provider = createPullRequestDiffProviderFromParams(
            'ado', ROOT, 'my-ado-repo', 123, service, CONTEXT,
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
        provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetchDiff, CONTEXT);
    });

    it('has correct source descriptor', () => {
        expect(provider.source).toEqual(makeIterationSource());
    });

    it('listFiles returns parsed entries', async () => {
        const files = await provider.listFiles();
        expect(files.length).toBe(4);
    });

    it('reads supplied data for each operation', async () => {
        await provider.listFiles();
        await provider.getFileDiff('src/foo.ts');
        // No provider-owned patch-result cache.
        expect(fetchDiff).toHaveBeenCalledTimes(2);
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
        const p = createPullRequestIterationDiffProvider(src, fetchDiff, CONTEXT);
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
            'ado', ROOT, 'my-repo', 7, 3, fetchDiff, CONTEXT,
        );
        expect(provider.source).toEqual({
            kind: 'pr-iteration',
            provider: 'ado',
            repositoryRoot: ROOT,
            remoteRepositoryId: 'my-repo',
            pullRequestId: 7,
            iterationId: 3,
            baseIterationId: undefined,
        });
    });

    it('includes baseIterationId when provided', () => {
        const fetchDiff = vi.fn().mockResolvedValue('');
        const provider = createPullRequestIterationDiffProviderFromParams(
            'ado', ROOT, 'my-repo', 7, 3, fetchDiff, CONTEXT, 1,
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
        const provider = createPullRequestDiffProvider(makePrSource(), service, CONTEXT);
        const files = await provider.listFiles();
        expect(files).toHaveLength(0);
        const summary = await provider.getSummary();
        expect(summary.filesChanged).toBe(0);
    });

    it('handles service returning only binary files', async () => {
        const service = mockPrService(FILE_DIFF_BINARY);
        const provider = createPullRequestDiffProvider(makePrSource(), service, CONTEXT);
        const files = await provider.listFiles();
        expect(files).toHaveLength(1);
        expect(files[0].isBinary).toBe(true);
    });

    it('handles fetchDiff rejection gracefully', async () => {
        const fetchDiff = vi.fn().mockRejectedValue(new Error('Network error'));
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetchDiff, CONTEXT);
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

        const { files, contentByPath } = await parseFullDiffAsync(diffWithSpaces);
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('path with spaces/file.ts');
        expect(contentByPath.has('path with spaces/file.ts')).toBe(true);
    });

    it('handles single-file diff', async () => {
        const service = mockPrService(FILE_DIFF_FOO);
        const provider = createPullRequestDiffProvider(makePrSource(), service, CONTEXT);
        const files = await provider.listFiles();
        expect(files).toHaveLength(1);
        const map = await provider.prefetchAll();
        expect(map.size).toBe(1);
    });
});

// Real native processing, with authenticated transport represented by the supplied callback.
describe('Rust supplied-patch backend', () => {
    afterEach(() => vi.restoreAllMocks());

    it('decodes Git-quoted paths for all five operations and preserves patch bytes', async () => {
        const raw = [
            'diff --git "a/name\\t\\303\\251.txt" "b/name\\t\\303\\251.txt"',
            '--- "a/name\\t\\303\\251.txt"',
            '+++ "b/name\\t\\303\\251.txt"',
            '@@ -1 +1 @@',
            '---header-like removed text',
            '+++header-like added text',
            '',
        ].join('\n');
        const path = 'name\té.txt';
        const provider = createPullRequestDiffProvider(makePrSource(), mockPrService(raw), CONTEXT);
        expect(await provider.listFiles()).toEqual([
            expect.objectContaining({ path, status: 'modified', additions: 1, deletions: 1, isBinary: false }),
        ]);
        const content = { raw, truncated: false, totalLines: raw.split('\n').length };
        expect(await provider.getFileDiff(path, { contextLines: 99999, full: true })).toEqual(content);
        expect(await provider.getFullDiff()).toEqual(content);
        expect(await provider.prefetchAll()).toEqual(new Map([[path, content]]));
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
    });

    it('distinguishes mode-only and empty-file changes from explicit binary changes', async () => {
        const raw = [
            'diff --git a/mode.txt b/mode.txt', 'old mode 100644', 'new mode 100755',
            'diff --git a/empty.txt b/empty.txt', 'new file mode 100644',
            FILE_DIFF_BINARY,
        ].join('\n');
        const provider = createPullRequestIterationDiffProvider(makeIterationSource({ baseIterationId: 1 }), async () => raw, CONTEXT);
        expect(provider.source).toEqual(makeIterationSource({ baseIterationId: 1 }));
        expect(await provider.listFiles()).toEqual([
            expect.objectContaining({ path: 'empty.txt', status: 'added', isBinary: false }),
            expect.objectContaining({ path: 'image.png', status: 'added', isBinary: true }),
            expect.objectContaining({ path: 'mode.txt', status: 'modified', isBinary: false }),
        ]);
        expect(await provider.getSummary()).toEqual({ filesChanged: 3, additions: 0, deletions: 0 });
    });

    it('retains pure rename/copy paths without marking them binary', async () => {
        const raw = [
            'diff --git a/old.txt b/new.txt', 'similarity index 100%', 'rename from old.txt', 'rename to new.txt',
            'diff --git a/source.txt b/copied.txt', 'similarity index 100%', 'copy from source.txt', 'copy to copied.txt',
        ].join('\n');
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), async () => raw, CONTEXT);
        expect(await provider.listFiles()).toEqual([
            expect.objectContaining({ path: 'copied.txt', originalPath: 'source.txt', status: 'copied', isBinary: false }),
            expect.objectContaining({ path: 'new.txt', originalPath: 'old.txt', status: 'renamed', isBinary: false }),
        ]);
        expect((await provider.prefetchAll()).get('new.txt')?.raw).toContain('rename from old.txt');
    });

    it('applies native truncation with original line counts, including missing files', async () => {
        const raw = FILE_DIFF_FOO + '\n\n';
        const provider = createPullRequestDiffProvider(makePrSource(), mockPrService(raw), CONTEXT);
        for (const maxLines of [-1, 0, 2, 2.9, 100]) {
            const limit = Math.floor(maxLines);
            const lines = raw.split('\n');
            expect(await provider.getFileDiff('src/foo.ts', { maxLines, full: true })).toEqual({
                raw: limit <= 0 ? '' : lines.slice(0, limit).join('\n'),
                truncated: limit <= 0 || lines.length > limit,
                totalLines: lines.length,
            });
        }
        expect(await provider.getFileDiff('missing', { maxLines: 0 })).toEqual({ raw: '', truncated: true, totalLines: 0 });
        expect(await provider.getFileDiff('missing')).toEqual({ raw: '', truncated: false, totalLines: 0 });
    });

    it('observes changed PR base and head data through every operation', async () => {
        let raw = FILE_DIFF_FOO;
        const service = mockPrService('');
        vi.mocked(service.getDiff!).mockImplementation(async () => raw);
        const provider = createPullRequestDiffProvider(makePrSource(), service, CONTEXT);
        await provider.listFiles();
        await provider.prefetchAll();
        // Transport now supplies a different comparison (base change, unchanged head).
        raw = FILE_DIFF_BAR;
        expect((await provider.listFiles()).map(f => f.path)).toEqual(['src/bar.ts']);
        expect(await provider.getFileDiff('src/foo.ts')).toEqual({ raw: '', truncated: false, totalLines: 0 });
        expect((await provider.prefetchAll()).has('src/foo.ts')).toBe(false);
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 2, deletions: 0 });
        expect((await provider.getFullDiff()).raw).toBe(raw);
        // Transport now supplies another revision (head change).
        raw = FILE_DIFF_DELETED;
        expect((await provider.listFiles())[0].status).toBe('deleted');
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 0, deletions: 3 });
    });

    it('keeps concurrent same-path workspaces, remote repositories and iterations isolated', async () => {
        const sources = [
            makeIterationSource({ repositoryRoot: path.resolve('clone-a'), remoteRepositoryId: 'host-a/repo', baseIterationId: 1 }),
            makeIterationSource({ repositoryRoot: path.resolve('clone-b'), remoteRepositoryId: 'host-a/repo', baseIterationId: 2 }),
            makeIterationSource({ repositoryRoot: path.resolve('clone-a'), remoteRepositoryId: 'host-b/repo', iterationId: 4 }),
        ];
        const pending: Array<(raw: string) => void> = [];
        const providers = sources.map(source => createPullRequestIterationDiffProvider(source,
            () => new Promise<string>(resolve => pending.push(resolve)), { ...CONTEXT, repository: source.remoteRepositoryId }));
        const requests = providers.map(p => p.getFileDiff('src/foo.ts'));
        for (let i = sources.length - 1; i >= 0; i--) pending[i](FILE_DIFF_FOO.replace('+new line', `+workspace ${i}`));
        const results = await Promise.all(requests);
        results.forEach((result, i) => {
            expect(result.raw).toContain(`+workspace ${i}`);
            expect(providers[i].source).toEqual(sources[i]);
        });
    });

    it('does not install stale data from an older concurrent fetch', async () => {
        let finishOld!: (raw: string) => void;
        const fetch = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finishOld = resolve; }))
            .mockResolvedValue(FILE_DIFF_BAR);
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetch, CONTEXT);
        const old = provider.listFiles();
        expect((await provider.listFiles())[0].path).toBe('src/bar.ts');
        finishOld(FILE_DIFF_FOO);
        expect((await old)[0].path).toBe('src/foo.ts');
        expect((await provider.listFiles())[0].path).toBe('src/bar.ts');
    });

    it('propagates transport errors after successful reads and retries without cached results', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(FILE_DIFF_FOO)
            .mockRejectedValueOnce(new Error('authentication failed')).mockResolvedValue(FILE_DIFF_BAR);
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetch, CONTEXT);
        await provider.listFiles();
        await expect(provider.getSummary()).rejects.toThrow('authentication failed');
        expect((await provider.listFiles())[0].path).toBe('src/bar.ts');
    });

    const operations: Array<[string, (provider: RemoteDiffProvider) => Promise<unknown>]> = [
        ['listFiles', p => p.listFiles()],
        ['getFileDiff', p => p.getFileDiff('src/foo.ts')],
        ['getFullDiff', p => p.getFullDiff()],
        ['prefetchAll', p => p.prefetchAll()],
        ['getSummary', p => p.getSummary()],
    ];

    it.each(operations)('refresh rejects delayed %s output captured before authenticated I/O', async (_name, call) => {
        let finish!: (raw: string) => void;
        const fetch = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }))
            .mockResolvedValue(FILE_DIFF_BAR);
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetch, CONTEXT);
        const old = call(provider);
        const rejected = expect(old).rejects.toThrow('patch store: Stale');
        provider.refresh();
        finish(FILE_DIFF_FOO);
        await rejected;
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 2, deletions: 0 });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each(operations)('dispose rejects delayed and subsequent %s requests without more transport', async (_name, call) => {
        let finish!: (raw: string) => void;
        const fetch = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetch, CONTEXT);
        const pending = call(provider);
        const rejected = expect(pending).rejects.toThrow('patch store: Closed');
        provider.dispose();
        provider.dispose();
        finish(FILE_DIFF_FOO);
        await rejected;
        await expect(call(provider)).rejects.toThrow('patch store: Closed');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('passes exact scope identity, reuses one native handle and snapshots caller descriptors', async () => {
        const addon = loadNativeGit();
        const open = vi.spyOn(addon, 'openRemoteGitPatchStore');
        const stateless = vi.spyOn(addon, 'processGitPatch');
        const source = makeIterationSource({ baseIterationId: 1 });
        const context = { ...CONTEXT };
        const provider = createPullRequestIterationDiffProvider(source, async () => FULL_DIFF, context);
        source.pullRequestId = 99;
        context.host = 'other.example';
        await Promise.all([provider.listFiles(), provider.prefetchAll(), provider.getSummary(), provider.getFullDiff()]);
        expect(open).toHaveBeenCalledExactlyOnceWith(CONTEXT.workspaceId, ROOT, {
            provider: 'ado', host: CONTEXT.host, repository: CONTEXT.repository,
            sourceId: '7', iteration: '3', baseIteration: '1',
        }, undefined);
        expect(stateless).not.toHaveBeenCalled();
        expect(provider.source).toEqual(makeIterationSource({ baseIterationId: 1 }));
        expect(Object.isFrozen(provider.source)).toBe(true);
    });

    it('keeps workspace, clone, host, repository, PR and iteration lifetimes independent', async () => {
        const sources = [
            makeIterationSource(),
            makeIterationSource(),
            makeIterationSource({ repositoryRoot: path.resolve('clone-b') }),
            makeIterationSource(),
            makeIterationSource(),
            makeIterationSource({ pullRequestId: 8 }),
            makeIterationSource({ iterationId: 4 }),
            makeIterationSource({ baseIterationId: 1 }),
        ];
        const contexts = sources.map(() => ({ ...CONTEXT }));
        contexts[1].workspaceId = 'workspace-b';
        contexts[3].host = 'other.example';
        contexts[4].repository = 'other/project/repo';
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        const pending: Array<(raw: string) => void> = [];
        const providers = sources.map((source, i) => createPullRequestIterationDiffProvider(source,
            () => new Promise<string>(resolve => pending.push(resolve)), contexts[i]));
        const requests = providers.map(p => p.getFullDiff());
        const rejected = expect(requests[0]).rejects.toThrow('patch store: Stale');
        providers[0].refresh();
        pending.forEach((finish, i) => finish(FILE_DIFF_FOO.replace('+new line', `+scope ${i}`)));
        await rejected;
        const results = await Promise.all(requests.slice(1));
        results.forEach((result, i) => expect(result.raw).toContain(`+scope ${i + 1}`));
        expect(new Set(open.mock.calls.map(args => JSON.stringify(args))).size).toBe(sources.length);
        providers.forEach(p => p.dispose());
    });

    it('translates explicit WSL workspace roots into native execution scopes without host Git', async () => {
        const open = vi.spyOn(loadNativeGit(), 'openRemoteGitPatchStore');
        const roots = ['\\\\wsl$\\Ubuntu\\home\\fixture\\repo', '\\\\wsl$\\Debian\\home\\fixture\\repo'];
        const providers = roots.map(repositoryRoot => createPullRequestDiffProvider(
            makePrSource({ repositoryRoot }), mockPrService(FILE_DIFF_FOO), CONTEXT));
        expect((await Promise.all(providers.map(p => p.getSummary()))).map(s => s.filesChanged)).toEqual([1, 1]);
        for (const distro of ['Ubuntu', 'Debian']) {
            expect(open).toHaveBeenCalledWith(CONTEXT.workspaceId, '/home/fixture/repo', {
                provider: 'github', host: CONTEXT.host, repository: CONTEXT.repository,
                sourceId: '42', iteration: undefined, baseIteration: undefined,
            }, distro);
        }
        providers.forEach(p => p.dispose());
    });

    it.each(['workspaceId', 'host', 'repository'] as const)('rejects empty %s before authenticated transport', async field => {
        const fetch = vi.fn().mockResolvedValue(FILE_DIFF_FOO);
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetch, { ...CONTEXT, [field]: ' ' });
        await expect(provider.getSummary()).rejects.toThrow('patch store: InvalidIdentity');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects relative roots rather than deriving remote scope identity from process cwd', async () => {
        const fetch = vi.fn().mockResolvedValue(FILE_DIFF_FOO);
        const provider = createPullRequestIterationDiffProvider(
            makeIterationSource({ repositoryRoot: 'relative-root' }), fetch, CONTEXT);
        await expect(provider.getSummary()).rejects.toThrow('patch store: InvalidIdentity');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('retires a continuation when authenticated transport fails', async () => {
        const addon = loadNativeGit();
        const original = addon.openRemoteGitPatchStore;
        const cancels: Array<ReturnType<typeof vi.spyOn>> = [];
        vi.spyOn(addon, 'openRemoteGitPatchStore').mockImplementation((...args) => {
            const store = original(...args);
            const begin = store.beginTransport.bind(store);
            vi.spyOn(store, 'beginTransport').mockImplementation(() => {
                const request = begin();
                cancels.push(vi.spyOn(request, 'cancel'));
                return request;
            });
            return store;
        });
        const fetch = vi.fn().mockRejectedValueOnce(new Error('transport failed')).mockResolvedValue(FILE_DIFF_FOO);
        const provider = createPullRequestIterationDiffProvider(makeIterationSource(), fetch, CONTEXT);
        await expect(provider.getSummary()).rejects.toThrow('transport failed');
        expect(await provider.getSummary()).toEqual({ filesChanged: 1, additions: 1, deletions: 1 });
        expect(cancels).toHaveLength(2);
        cancels.forEach(cancel => expect(cancel).toHaveBeenCalledTimes(1));
    });
});
