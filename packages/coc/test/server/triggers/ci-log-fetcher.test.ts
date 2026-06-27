/**
 * createCiLogFetcher / pure-helper Tests (AC-02)
 *
 * Covers the production failing-check log fetcher: run-id extraction from check
 * `detailsUrl`s, de-duplication across jobs of one run, last-N-lines truncation,
 * and the fetcher's fault-tolerant contract (resolve `undefined` rather than
 * throw when there is no repo root, no resolvable run, or `gh` fails). The
 * impure pieces (workspace-root resolution + `gh` invocation) are injected so
 * the test needs no real subprocess or repo.
 */

import { describe, it, expect } from 'vitest';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    createCiLogFetcher,
    extractGithubRunId,
    collectFailingRunIds,
    truncateToLastLines,
    DEFAULT_MAX_LOG_LINES,
    type CiLogCommandRunner,
} from '../../../src/server/triggers/ci-log-fetcher';
import type { CiCheckSnapshot } from '../../../src/server/triggers/ci-failure-evaluator';

const failing = (id: string, detailsUrl?: string): CiCheckSnapshot => ({
    id,
    name: id,
    status: 'failure',
    ...(detailsUrl ? { detailsUrl } : {}),
});

describe('extractGithubRunId', () => {
    it('extracts the run id from a job URL', () => {
        expect(extractGithubRunId('https://github.com/o/r/actions/runs/123456789/job/987654321')).toBe('123456789');
    });
    it('extracts the run id from a run-only URL', () => {
        expect(extractGithubRunId('https://github.com/o/r/actions/runs/42')).toBe('42');
    });
    it('returns undefined for the legacy /runs/<id> check URL', () => {
        expect(extractGithubRunId('https://github.com/o/r/runs/987654321')).toBeUndefined();
    });
    it('returns undefined for blank/missing/non-matching URLs', () => {
        expect(extractGithubRunId()).toBeUndefined();
        expect(extractGithubRunId('')).toBeUndefined();
        expect(extractGithubRunId('https://example.com/whatever')).toBeUndefined();
    });
});

describe('collectFailingRunIds', () => {
    it('de-duplicates run ids across jobs of the same run, preserving order', () => {
        const ids = collectFailingRunIds([
            failing('a', 'https://github.com/o/r/actions/runs/100/job/1'),
            failing('b', 'https://github.com/o/r/actions/runs/100/job/2'),
            failing('c', 'https://github.com/o/r/actions/runs/200/job/3'),
            failing('d'), // no URL — skipped
        ]);
        expect(ids).toEqual(['100', '200']);
    });
    it('returns an empty array when no check has a resolvable run id', () => {
        expect(collectFailingRunIds([failing('a'), failing('b', 'https://github.com/o/r/runs/5')])).toEqual([]);
    });
});

describe('truncateToLastLines', () => {
    it('keeps the text unchanged when within the limit', () => {
        expect(truncateToLastLines('a\nb\nc', 10)).toBe('a\nb\nc');
    });
    it('keeps the LAST N lines and prepends a truncation marker', () => {
        const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
        const out = truncateToLastLines(text, 5);
        const lines = out.split('\n');
        expect(lines[0]).toMatch(/truncated: showing last 5 of 50 lines; 45 omitted/);
        expect(lines.slice(1)).toEqual(['line 46', 'line 47', 'line 48', 'line 49', 'line 50']);
    });
    it('trims trailing whitespace so a final newline is not a blank kept line', () => {
        expect(truncateToLastLines('a\nb\n\n  ', 10)).toBe('a\nb');
        expect(truncateToLastLines('   \n  ')).toBe('');
    });
    it('defaults to DEFAULT_MAX_LOG_LINES', () => {
        const text = Array.from({ length: DEFAULT_MAX_LOG_LINES + 10 }, (_, i) => `l${i}`).join('\n');
        const out = truncateToLastLines(text);
        expect(out.split('\n').length).toBe(DEFAULT_MAX_LOG_LINES + 1); // +1 marker line
    });
});

describe('createCiLogFetcher', () => {
    const repoRootResolver = async () => '/repo/root';

    it('runs `gh run view --log-failed` per unique run and returns a labeled, truncated excerpt', async () => {
        const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
        const runCommand: CiLogCommandRunner = async (file, args, options) => {
            calls.push({ file, args, cwd: options.cwd });
            const runId = args[2];
            return { stdout: `failed step output for run ${runId}\nError: boom`, stderr: '' };
        };
        const fetch = createCiLogFetcher({
            store: {} as unknown as ProcessStore,
            resolveRepoRoot: repoRootResolver,
            runCommand,
        });

        const excerpt = await fetch({
            workspaceId: 'ws1',
            originId: 'o1',
            prId: '7',
            failingChecks: [
                failing('a', 'https://github.com/o/r/actions/runs/100/job/1'),
                failing('b', 'https://github.com/o/r/actions/runs/100/job/2'),
                failing('c', 'https://github.com/o/r/actions/runs/200/job/3'),
            ],
        });

        // one gh call per unique run id (100, 200), in the resolved repo root
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({ file: 'gh', args: ['run', 'view', '100', '--log-failed'], cwd: '/repo/root' });
        expect(calls[1].args).toEqual(['run', 'view', '200', '--log-failed']);
        expect(excerpt).toContain('gh run view 100 --log-failed');
        expect(excerpt).toContain('gh run view 200 --log-failed');
        expect(excerpt).toContain('Error: boom');
    });

    it('returns undefined when no check has a resolvable run id (no gh call)', async () => {
        let called = false;
        const fetch = createCiLogFetcher({
            store: {} as unknown as ProcessStore,
            resolveRepoRoot: repoRootResolver,
            runCommand: async () => { called = true; return { stdout: 'x', stderr: '' }; },
        });
        const excerpt = await fetch({ workspaceId: 'ws1', originId: 'o1', prId: '7', failingChecks: [failing('a')] });
        expect(excerpt).toBeUndefined();
        expect(called).toBe(false);
    });

    it('returns undefined when the repo root cannot be resolved (no gh call)', async () => {
        let called = false;
        const fetch = createCiLogFetcher({
            store: {} as unknown as ProcessStore,
            resolveRepoRoot: async () => undefined,
            runCommand: async () => { called = true; return { stdout: 'x', stderr: '' }; },
        });
        const excerpt = await fetch({
            workspaceId: 'ws1',
            originId: 'o1',
            prId: '7',
            failingChecks: [failing('a', 'https://github.com/o/r/actions/runs/100/job/1')],
        });
        expect(excerpt).toBeUndefined();
        expect(called).toBe(false);
    });

    it('tolerates a failing gh invocation per run and skips it (never throws)', async () => {
        const runCommand: CiLogCommandRunner = async (_file, args) => {
            if (args[2] === '100') throw new Error('gh: not installed');
            return { stdout: 'ok output for 200', stderr: '' };
        };
        const fetch = createCiLogFetcher({
            store: {} as unknown as ProcessStore,
            resolveRepoRoot: repoRootResolver,
            runCommand,
        });
        const excerpt = await fetch({
            workspaceId: 'ws1',
            originId: 'o1',
            prId: '7',
            failingChecks: [
                failing('a', 'https://github.com/o/r/actions/runs/100/job/1'),
                failing('b', 'https://github.com/o/r/actions/runs/200/job/2'),
            ],
        });
        expect(excerpt).toContain('ok output for 200');
        expect(excerpt).not.toContain('run 100'); // the failed run produced nothing
    });

    it('returns undefined when every gh invocation fails', async () => {
        const fetch = createCiLogFetcher({
            store: {} as unknown as ProcessStore,
            resolveRepoRoot: repoRootResolver,
            runCommand: async () => { throw new Error('boom'); },
        });
        const excerpt = await fetch({
            workspaceId: 'ws1',
            originId: 'o1',
            prId: '7',
            failingChecks: [failing('a', 'https://github.com/o/r/actions/runs/100/job/1')],
        });
        expect(excerpt).toBeUndefined();
    });

    it('truncates the combined excerpt to the configured maxLines', async () => {
        const big = Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n');
        const fetch = createCiLogFetcher({
            store: {} as unknown as ProcessStore,
            resolveRepoRoot: repoRootResolver,
            runCommand: async () => ({ stdout: big, stderr: '' }),
            maxLines: 10,
        });
        const excerpt = await fetch({
            workspaceId: 'ws1',
            originId: 'o1',
            prId: '7',
            failingChecks: [failing('a', 'https://github.com/o/r/actions/runs/100/job/1')],
        });
        expect(excerpt).toBeDefined();
        expect((excerpt as string).split('\n')).toHaveLength(11); // 10 kept + 1 marker
        expect(excerpt).toMatch(/truncated: showing last 10 of/);
    });

    it('default resolver reads the workspace root path from the process store', async () => {
        const store = {
            getWorkspaces: async () => [
                { id: 'ws1', name: 'ws1', rootPath: '/from/store' },
                { id: 'other', name: 'other', rootPath: '/nope' },
            ],
        } as unknown as ProcessStore;
        let seenCwd = '';
        const fetch = createCiLogFetcher({
            store,
            runCommand: async (_file, _args, options) => { seenCwd = options.cwd; return { stdout: 'out', stderr: '' }; },
        });
        await fetch({
            workspaceId: 'ws1',
            originId: 'o1',
            prId: '7',
            failingChecks: [failing('a', 'https://github.com/o/r/actions/runs/100/job/1')],
        });
        expect(seenCwd).toBe('/from/store');
    });
});
