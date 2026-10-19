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
const run = (args: Record<string, unknown> = {}, signal?: AbortSignal) => runPrQuery(
    parsePrQueryRequest({ provider: 'github', repository: 'owner/repo', ...args }),
    { createClient: createPrProviderClientFactory(dataDir), signal },
) as Promise<any>;
const check = (id: number, conclusion = 'success') => ({ id, name: `check-${id}`, status: 'completed', conclusion });
const status = (id: number, state = 'success') => ({ id, context: `status-${id}`, state });
const review = (id: number, state = 'APPROVED', userId = 1) => ({
    id, state, user: { id: userId, login: `reviewer-${userId}` },
});

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

describe('GitHub cancellation through the real adapter', () => {
    for (const mode of ['query', 'get']) {
        it.each(['checks-empty', 'checks-full', 'checks-error', 'statuses-full'])(
            `starts no requests after a delayed %s completes following ${mode} cancellation`,
            async (stage) => {
                const controller = new AbortController();
                let release!: () => void;
                let started!: () => void;
                const gate = new Promise<void>(resolve => { release = resolve; });
                const entered = new Promise<void>(resolve => { started = resolve; });
                const operation = stage.startsWith('checks') ? transport.checks.listForRef : transport.repos.getCombinedStatusForRef;
                operation.mockImplementationOnce(async () => {
                    started();
                    await gate;
                    if (stage === 'checks-error') throw new Error('late failure');
                    return { data: stage === 'statuses-full'
                        ? { statuses: Array.from({ length: 100 }, (_, id) => status(id)) }
                        : { check_runs: stage === 'checks-full' ? Array.from({ length: 100 }, (_, id) => check(id)) : [] } };
                });
                const pending = run(mode === 'get' ? { ids: 42 } : {}, controller.signal);
                await entered;
                controller.abort();
                await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
                const operations = [transport.graphql, transport.repos.get, transport.pulls.get, transport.pulls.listReviews,
                    transport.checks.listForRef, transport.repos.getCombinedStatusForRef];
                const counts = operations.map(mock => mock.mock.calls.length);
                release();
                await new Promise(resolve => setImmediate(resolve));
                expect(operations.map(mock => mock.mock.calls.length)).toEqual(counts);
            },
        );
    }

    it.each(['probe', 'list', 'detail', 'reviews'])('does not continue after a delayed %s response', async (stage) => {
        const controller = new AbortController();
        const operation = stage === 'probe' ? transport.repos.get : stage === 'list' ? transport.graphql
            : stage === 'detail' ? transport.pulls.get : transport.pulls.listReviews;
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        const response = await operation();
        operation.mockClear();
        operation.mockImplementationOnce(async () => { started(); await gate; return response; });
        const pending = run(stage === 'list' ? {} : { ids: [42, 43, 44, 45, 46] }, controller.signal);
        await entered;
        controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
        const operations = [transport.graphql, transport.repos.get, transport.pulls.get, transport.pulls.listReviews,
            transport.checks.listForRef, transport.repos.getCombinedStatusForRef];
        const counts = operations.map(mock => mock.mock.calls.length);
        release();
        await new Promise(resolve => setImmediate(resolve));
        expect(operations.map(mock => mock.mock.calls.length)).toEqual(counts);
    });

    it('does not dispatch for an already cancelled invocation', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(run({ ids: 42 }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
        expect(transport.repos.get).not.toHaveBeenCalled();
    });
});

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

    describe('GitHub review history through the real adapter', () => {
        it('uses a later-page rejection over approval and includes later reviewers', async () => {
            transport.pulls.listReviews.mockImplementation(async ({ page }) => ({
                data: page === 1 ? Array.from({ length: 100 }, (_, id) => review(id))
                    : [review(100, 'CHANGES_REQUESTED'), review(101, 'APPROVED', 2)],
            }));
            const detail = (await run({ ids: 42 })).results[0].pullRequest;
            expect(detail.reviews).toEqual([
                { reviewer: { id: '1', login: 'reviewer-1', displayName: 'reviewer-1' }, vote: 'rejected', isRequired: false },
                { reviewer: { id: '2', login: 'reviewer-2', displayName: 'reviewer-2' }, vote: 'approved', isRequired: false },
            ]);
            expect(transport.pulls.listReviews).toHaveBeenCalledTimes(2);
            expect(transport.pulls.listReviews).toHaveBeenNthCalledWith(2, {
                owner: 'owner', repo: 'repo', pull_number: 42, per_page: 100, page: 2,
            });
        });

        it('preserves deciding-vote policy across three pages of comments and dismissed reviews', async () => {
            transport.pulls.listReviews.mockImplementation(async ({ page }) => ({
                data: page === 1 ? Array.from({ length: 100 }, (_, id) => review(id))
                    : page === 2 ? Array.from({ length: 100 }, (_, id) => review(100 + id, 'COMMENTED'))
                        : [review(200, 'DISMISSED'), review(201, 'COMMENTED', 2)],
            }));
            const detail = (await run({ ids: 42 })).results[0].pullRequest;
            expect(detail.reviews.map((item: { vote: string }) => item.vote)).toEqual(['approved', 'no-vote']);
            expect(transport.pulls.listReviews).toHaveBeenCalledTimes(3);
        });

        it('checks the next page at the exact 100-review boundary', async () => {
            transport.pulls.listReviews.mockImplementation(async ({ page }) => ({
                data: page === 1 ? Array.from({ length: 100 }, (_, id) => review(id)) : [],
            }));
            const detail = (await run({ ids: 42 })).results[0].pullRequest;
            expect(detail.reviews).toHaveLength(1);
            expect(detail.reviews[0].vote).toBe('approved');
            expect(transport.pulls.listReviews).toHaveBeenCalledTimes(2);
        });

        it.each([401, 403, 429, 500])('does not publish partial reviews after later-page HTTP %i', async (httpStatus) => {
            transport.pulls.listReviews.mockImplementation(async ({ page }) => {
                if (page === 2) throw Object.assign(new Error('private review response'), { status: httpStatus });
                return { data: Array.from({ length: 100 }, (_, id) => review(id)) };
            });
            if (httpStatus === 500) {
                const detail = (await run({ ids: 42 })).results[0].pullRequest;
                expect(detail.reviews).toBeNull();
                expect(detail.unavailable).toEqual(['reviews']);
                expect(detail.checks).toEqual([]);
                expect(JSON.stringify(detail)).not.toContain('private review response');
            } else {
                await expect(run({ ids: 42 })).rejects.toMatchObject({
                    code: httpStatus === 429 ? 'provider-unavailable' : 'auth-failed',
                });
                expect(transport.checks.listForRef).not.toHaveBeenCalled();
            }
        });

        it('rejects a missing later-page review payload without using earlier approvals', async () => {
            transport.pulls.listReviews
                .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, id) => review(id)) })
                .mockResolvedValueOnce({ data: null });
            const detail = (await run({ ids: 42 })).results[0].pullRequest;
            expect(detail.reviews).toBeNull();
            expect(detail.unavailable).toEqual(['reviews']);
        });

        it.each([1, 2])('starts no more requests after cancelling a held review page %i', async (heldPage) => {
            const controller = new AbortController();
            let release!: () => void;
            let started!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const entered = new Promise<void>(resolve => { started = resolve; });
            transport.pulls.listReviews.mockImplementation(async ({ page }) => {
                if (page === heldPage) {
                    started();
                    await gate;
                }
                return { data: Array.from({ length: 100 }, (_, id) => review((page - 1) * 100 + id)) };
            });
            const pending = run({ ids: 42 }, controller.signal);
            await entered;
            controller.abort();
            await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
            release();
            await new Promise(resolve => setImmediate(resolve));
            expect(transport.pulls.listReviews).toHaveBeenCalledTimes(heldPage);
            expect(transport.checks.listForRef).not.toHaveBeenCalled();
            expect(transport.repos.getCombinedStatusForRef).not.toHaveBeenCalled();
        });

        it('scopes every review page to the requested repository', async () => {
            transport.pulls.listReviews.mockImplementation(async ({ owner, page }) => ({
                data: page === 1 ? Array.from({ length: 100 }, (_, id) => review(id))
                    : [review(100, owner === 'other' ? 'CHANGES_REQUESTED' : 'APPROVED')],
            }));
            const first = (await run({ ids: 42 })).results[0].pullRequest;
            const second = (await run({ repository: 'other/project', ids: 42 })).results[0].pullRequest;
            expect(first.reviews[0].vote).toBe('approved');
            expect(second.reviews[0].vote).toBe('rejected');
            expect(transport.pulls.listReviews).toHaveBeenLastCalledWith({
                owner: 'other', repo: 'project', pull_number: 42, per_page: 100, page: 2,
            });
        });
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
