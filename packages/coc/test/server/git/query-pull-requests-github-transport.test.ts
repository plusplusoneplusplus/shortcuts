import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const transport = vi.hoisted(() => ({
    graphql: vi.fn(),
    repos: { get: vi.fn(), getCombinedStatusForRef: vi.fn() },
    checks: { listForRef: vi.fn() },
    pulls: { get: vi.fn(), listReviews: vi.fn() },
}));
vi.mock('@octokit/rest', () => ({ Octokit: vi.fn(function () { return transport; }) }));
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    // Keep the real factory and adapter; stub only SDK transport calls.
    ...await import('../../../../forge/src/github/create-github-adapter'),
}));
import { createPrProviderClientFactory, parsePrQueryRequest, runPrQuery } from '../../../src/server/git/query-pull-requests-service';

let dataDir: string;
const run = (args: Record<string, unknown> = {}) => runPrQuery(
    parsePrQueryRequest({ provider: 'github', repository: 'owner/repo', ...args }),
    { createClient: createPrProviderClientFactory(dataDir) },
) as Promise<any>;
const check = (id: number, conclusion = 'success') => ({ id, name: `check-${id}`, status: 'completed', conclusion });
const status = (id: number, state = 'success') => ({ id, context: `status-${id}`, state });

beforeEach(() => {
    vi.resetAllMocks();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-pr-gh-transport-'));
    fs.writeFileSync(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: { github: { token: 'test-token' } } }));
    transport.repos.get.mockResolvedValue({ data: {} });
    transport.pulls.get.mockResolvedValue({ data: {
        number: 42, title: 'PR', state: 'open', labels: [], head: { sha: 'head', ref: 'feature' }, base: { ref: 'main' },
    } });
    transport.pulls.listReviews.mockResolvedValue({ data: [] });
    transport.checks.listForRef.mockResolvedValue({ data: { check_runs: [] } });
    transport.repos.getCombinedStatusForRef.mockResolvedValue({ data: { statuses: [] } });
    transport.graphql.mockResolvedValue({ search: { pageInfo: { hasNextPage: false }, nodes: [{
        number: 42, title: 'PR', state: 'OPEN', commits: { nodes: [{ commit: { oid: 'head', statusCheckRollup: {
            state: 'SUCCESS', contexts: { pageInfo: { hasNextPage: true }, nodes: [] },
        } } }] },
    }] } });
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('GitHub checks through the real adapter', () => {
    it.each(['check', 'status'])('includes later-page %s failures in query filters and get summaries', async (source) => {
        transport.checks.listForRef.mockImplementation(async ({ page }) => ({ data: { check_runs:
            page === 1 ? Array.from({ length: 100 }, (_, id) => check(id)) : page === 2 ? [check(100, source === 'check' ? 'failure' : 'success')] : [],
        } }));
        transport.repos.getCombinedStatusForRef.mockImplementation(async ({ page }) => ({ data: { statuses:
            page === 1 ? Array.from({ length: 100 }, (_, id) => status(id)) : page === 2 ? [status(100, source === 'status' ? 'failure' : 'success')] : [],
        } }));
        expect((await run({ ci: 'passing' })).items).toEqual([]);
        const listed = (await run({ ci: 'failing' })).items[0];
        expect(listed.ci).toMatchObject({ state: 'failing', counts: { success: 201, failure: 1 } });
        const detail = (await run({ ids: 42 })).results[0].pullRequest;
        expect(detail.ci).toEqual(listed.ci);
        expect(detail.checks).toHaveLength(100);
        expect(detail.checksTruncated).toBe(true);
        for (const mock of [transport.checks.listForRef, transport.repos.getCombinedStatusForRef]) {
            expect(mock).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', ref: 'head', per_page: 100, page: 2 });
        }
        expect(transport.pulls.get).toHaveBeenCalledTimes(1);
    });

    it('keeps exactly 100 checks complete after checking the empty next page', async () => {
        transport.checks.listForRef.mockImplementation(async ({ page }) => ({ data: { check_runs:
            page === 1 ? Array.from({ length: 100 }, (_, id) => check(id)) : [],
        } }));
        const detail = (await run({ ids: 42 })).results[0].pullRequest;
        expect(detail.ci.counts.success).toBe(100);
        expect(detail.checks).toHaveLength(100);
        expect(detail.checksTruncated).toBeUndefined();
        expect(transport.checks.listForRef).toHaveBeenCalledTimes(2);
    });

    for (const source of ['checks', 'statuses']) {
        it.each([401, 403, 429, 500])(`does not publish partial CI when later ${source} return HTTP %i`, async (httpStatus) => {
            const mock = source === 'checks' ? transport.checks.listForRef : transport.repos.getCombinedStatusForRef;
            mock.mockImplementation(async ({ page }) => {
                if (page === 2) throw Object.assign(new Error('private provider body'), { status: httpStatus });
                return { data: source === 'checks'
                    ? { check_runs: Array.from({ length: 100 }, (_, id) => check(id)) }
                    : { statuses: Array.from({ length: 100 }, (_, id) => status(id)) } };
            });
            if (httpStatus !== 500) {
                const code = httpStatus === 429 ? 'provider-unavailable' : 'auth-failed';
                await expect(run()).rejects.toMatchObject({ code });
                await expect(run({ ids: 42 })).rejects.toMatchObject({ code });
            } else {
                expect((await run()).items[0].ci.state).toBe('unavailable');
                const filtered = await run({ ci: 'passing' });
                expect(filtered.items).toEqual([]);
                expect(filtered.ciUnavailableExcluded).toBe(1);
                const detail = (await run({ ids: 42 })).results[0].pullRequest;
                expect(detail.checks).toBeNull();
                expect(detail.ci.state).toBe('unavailable');
                expect(detail.checksTruncated).toBeUndefined();
                expect(JSON.stringify(detail)).not.toContain('private provider body');
            }
        });
    }

    it.each(['checks', 'statuses'])('rejects a missing %s payload as unavailable', async (source) => {
        const mock = source === 'checks' ? transport.checks.listForRef : transport.repos.getCombinedStatusForRef;
        mock.mockResolvedValue({ data: {} });
        expect((await run()).items[0].ci.state).toBe('unavailable');
        const detail = (await run({ ids: 42 })).results[0].pullRequest;
        expect(detail.checks).toBeNull();
        expect(detail.ci.state).toBe('unavailable');
    });

    it('accepts empty sources and preserves repository scoping', async () => {
        const detail = (await run({ ids: 42 })).results[0].pullRequest;
        expect(detail).toMatchObject({ checks: [], ci: { state: 'none' } });
        expect(detail.checksTruncated).toBeUndefined();
        await run({ repository: 'other/project', ids: 42 });
        expect(transport.checks.listForRef).toHaveBeenLastCalledWith(expect.objectContaining({ owner: 'other', repo: 'project' }));
        expect(transport.repos.getCombinedStatusForRef).toHaveBeenLastCalledWith(expect.objectContaining({ owner: 'other', repo: 'project' }));
    });
});
