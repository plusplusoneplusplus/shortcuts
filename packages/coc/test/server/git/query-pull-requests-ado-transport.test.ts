import { beforeEach, describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => ({
    getRepository: vi.fn(),
    getPullRequests: vi.fn(),
    getPullRequestById: vi.fn(),
    getPullRequestIterations: vi.fn(),
    getPullRequestStatuses: vi.fn(),
    getStatuses: vi.fn(),
}));
const sdk = vi.hoisted(() => ({ getGitApi: vi.fn() }));

vi.mock('azure-devops-node-api', async (importOriginal) => ({
    ...await importOriginal<typeof import('azure-devops-node-api')>(),
    WebApi: vi.fn(function () { return { getGitApi: sdk.getGitApi }; }),
    getBearerHandler: vi.fn(() => ({})),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/forge')>(),
    resolveAdoAccessTokenValue: vi.fn(async () => 'test-token'),
    // Exercise the production factory, adapter and service with stubbed SDK I/O.
    // Source import lets Vitest intercept the SDK dependency of the real adapter.
    ...await import('../../../../forge/src/ado/create-ado-adapter'),
}));

import {
    createPrProviderClientFactory,
    parsePrQueryRequest,
    runPrQuery,
} from '../../../src/server/git/query-pull-requests-service';

const pr = {
    pullRequestId: 42, title: 'PR', status: 1,
    lastMergeSourceCommit: { commitId: 'head' },
    repository: { id: 'repo-id', name: 'repo', project: { id: 'project-id', name: 'project' } },
};

const run = (args: Record<string, unknown> = {}, signal?: AbortSignal) => runPrQuery(
    parsePrQueryRequest({ provider: 'ado', repository: 'org/project/repo', ...args }),
    { createClient: createPrProviderClientFactory('/unused'), signal },
) as Promise<any>;

beforeEach(() => {
    vi.resetAllMocks();
    sdk.getGitApi.mockResolvedValue(git);
    git.getRepository.mockResolvedValue({ id: 'repo-id', project: { id: 'project-id' } });
    git.getPullRequests.mockResolvedValue([pr]);
    git.getPullRequestById.mockResolvedValue(pr);
    git.getPullRequestIterations.mockResolvedValue([{ id: 2, sourceRefCommit: { commitId: 'head' } }]);
    git.getPullRequestStatuses.mockResolvedValue([]);
    git.getStatuses.mockResolvedValue([]);
});

describe('ADO cancellation through the real adapter and service', () => {
    for (const mode of ['query', 'get']) {
        it.each(['api-probe', 'api-pr', 'api-checks', 'probe', 'pr', 'iterations', 'pr-statuses', 'commit-statuses'])(
            `starts no requests after a delayed %s completes following ${mode} cancellation`,
            async (stage) => {
                const controller = new AbortController();
                const operation = stage.startsWith('api-') ? sdk.getGitApi : stage === 'probe' ? git.getRepository
                    : stage === 'pr' ? (mode === 'query' ? git.getPullRequests : git.getPullRequestById)
                    : stage === 'iterations' ? git.getPullRequestIterations
                    : stage === 'pr-statuses' ? git.getPullRequestStatuses : git.getStatuses;
                const response = await operation();
                operation.mockClear();
                const precedingApiCalls = stage === 'api-checks' ? 2 : stage === 'api-pr' ? 1 : 0;
                for (let i = 0; i < precedingApiCalls; i++) operation.mockResolvedValueOnce(git);
                let release!: () => void;
                let started!: () => void;
                const gate = new Promise<void>(resolve => { release = resolve; });
                const entered = new Promise<void>(resolve => { started = resolve; });
                operation.mockImplementationOnce(async () => { started(); await gate; return response; });
                const pending = run(mode === 'get' ? { ids: 42 } : {}, controller.signal);
                await entered;
                controller.abort();
                await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
                const operations = [sdk.getGitApi, ...Object.values(git)];
                const counts = operations.map(mock => mock.mock.calls.length);
                release();
                await new Promise(resolve => setImmediate(resolve));
                expect(operations.map(mock => mock.mock.calls.length)).toEqual(counts);
            },
        );
    }

    it('does not dispatch for an already cancelled invocation', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(run({ ids: 42 }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
        expect(sdk.getGitApi).not.toHaveBeenCalled();
    });
});

describe('ADO strict CI through the real adapter and service', () => {
    for (const operation of ['getPullRequestIterations', 'getPullRequestStatuses', 'getStatuses'] as const) {
        describe(operation, () => {
            it.each([401, 403, 429])('propagates HTTP %i as a whole-call failure in both modes', async (statusCode) => {
                git[operation].mockRejectedValue(Object.assign(new Error('private provider response'), { statusCode }));
                const code = statusCode === 429 ? 'provider-unavailable' : 'auth-failed';
                await expect(run()).rejects.toMatchObject({ code });
                await expect(run({ ids: 42 })).rejects.toMatchObject({ code });
            });

            it('reports HTTP 500 as unavailable and excludes it under CI filters', async () => {
                git[operation].mockRejectedValue(Object.assign(new Error('private provider response'), { statusCode: 500 }));
                const listed = await run();
                expect(listed.items[0].ci).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('HTTP 500') });
                const filtered = await run({ ci: 'passing' });
                expect(filtered.items).toEqual([]);
                expect(filtered.ciUnavailableExcluded).toBe(1);
                const detail = (await run({ ids: 42 })).results[0];
                expect(detail.ok).toBe(true);
                expect(detail.pullRequest).toMatchObject({
                    checks: null, ci: { state: 'unavailable' }, unavailable: ['checks'],
                    reason: expect.stringContaining('HTTP 500'),
                });
                expect(JSON.stringify([listed, filtered, detail])).not.toContain('private provider response');
            });

            it('does not interpret a missing response as an empty check list', async () => {
                git[operation].mockResolvedValue(null);
                expect((await run()).items[0].ci.state).toBe('unavailable');
                expect((await run({ ids: 42 })).results[0].pullRequest.checks).toBeNull();
            });
        });
    }

    it('combines current-iteration and head-commit statuses', async () => {
        git.getPullRequestStatuses.mockResolvedValue([
            { id: 1, state: 3, iterationId: 1, context: { name: 'old failure' } },
            { id: 2, state: 2, iterationId: 2, context: { name: 'build' } },
        ]);
        git.getStatuses.mockResolvedValue([{ id: 3, state: 3, context: { name: 'tests' } }]);
        expect((await run()).items[0].ci).toMatchObject({ state: 'failing', counts: { success: 1, failure: 1 } });
        const detail = (await run({ ids: 42 })).results[0].pullRequest;
        expect(detail.ci.state).toBe('failing');
        expect(detail.checks).toHaveLength(2);
        expect(git.getPullRequestStatuses).toHaveBeenCalledWith('repo', 42, 'project');
        expect(git.getStatuses).toHaveBeenCalledWith('head', 'repo', 'project', 1000, 0, true);
    });

    describe('ADO complete commit-status pagination through the real adapter and service', () => {
        const passingPage = Array.from({ length: 1000 }, (_, id) => ({
            id, state: 2, context: { name: `check-${id}` },
        }));

        beforeEach(() => {
            git.getStatuses.mockImplementation(async (_sha, _repo, _project, _top, skip) =>
                skip === 0 ? passingPage : [{ id: 1001, state: 3, context: { name: 'later failure' } }]);
        });

        it('aggregates a later-page failure before filtering and capping returned details', async () => {
            expect((await run()).items[0].ci).toMatchObject({
                state: 'failing', counts: { success: 1000, failure: 1 },
            });
            expect((await run({ ci: 'passing' })).items).toEqual([]);
            expect((await run({ ci: 'failing' })).items).toHaveLength(1);
            const detail = (await run({ ids: 42 })).results[0].pullRequest;
            expect(detail.ci).toMatchObject({ state: 'failing', counts: { success: 1000, failure: 1 } });
            expect(detail.checks).toHaveLength(100);
            expect(detail.checksTruncated).toBe(true);
            expect(git.getStatuses.mock.calls).toEqual(Array.from({ length: 4 }, () => [
                ['head', 'repo', 'project', 1000, 0, true],
                ['head', 'repo', 'project', 1000, 1000, true],
            ]).flat());
        });

        it('reads an empty page to confirm completion at the exact page boundary', async () => {
            git.getStatuses.mockResolvedValueOnce(passingPage).mockResolvedValueOnce([]);
            expect((await run()).items[0].ci).toMatchObject({ state: 'passing', counts: { success: 1000 } });
            expect(git.getStatuses).toHaveBeenCalledTimes(2);
        });

        it('counts unavailable CI excluded by a filter after a later-page failure', async () => {
            git.getStatuses.mockResolvedValueOnce(passingPage).mockRejectedValueOnce(
                Object.assign(new Error('private provider response'), { statusCode: 500 }),
            );
            const result = await run({ ci: 'passing' });
            expect(result.items).toEqual([]);
            expect(result.ciUnavailableExcluded).toBe(1);
        });

        for (const mode of ['query', 'get'] as const) {
            const args = mode === 'get' ? { ids: 42 } : {};
            it.each([401, 403, 429])(`propagates later-page HTTP %i in ${mode} mode`, async (statusCode) => {
                git.getStatuses.mockResolvedValueOnce(passingPage)
                    .mockRejectedValueOnce(Object.assign(new Error('private provider response'), { statusCode }));
                await expect(run(args)).rejects.toMatchObject({
                    code: statusCode === 429 ? 'provider-unavailable' : 'auth-failed',
                });
                expect(git.getStatuses).toHaveBeenCalledTimes(2);
            });

            it.each(['http-500', 'missing'])(`discards partial statuses for a later-page %s in ${mode} mode`, async (failure) => {
                git.getStatuses.mockResolvedValueOnce(passingPage);
                if (failure === 'missing') git.getStatuses.mockResolvedValueOnce(null);
                else git.getStatuses.mockRejectedValueOnce(
                    Object.assign(new Error('private provider response'), { statusCode: 500 }),
                );
                const result = await run(args);
                const item = mode === 'query' ? result.items[0] : result.results[0].pullRequest;
                expect(item.ci.state).toBe('unavailable');
                if (mode === 'get') expect(item.checks).toBeNull();
                expect(JSON.stringify(result)).not.toContain('private provider response');
            });

            it.each([0, 1000])(`starts no later requests after a held page at offset %i is cancelled in ${mode} mode`, async (skip) => {
                const controller = new AbortController();
                let release!: () => void;
                let started!: () => void;
                const gate = new Promise<void>(resolve => { release = resolve; });
                const entered = new Promise<void>(resolve => { started = resolve; });
                git.getStatuses.mockImplementation(async (_sha, _repo, _project, _top, offset) => {
                    if (offset === skip) { started(); await gate; }
                    return passingPage;
                });
                const pending = run(args, controller.signal);
                await entered;
                controller.abort();
                await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
                const operations = [sdk.getGitApi, ...Object.values(git)];
                const counts = operations.map(mock => mock.mock.calls.length);
                release();
                await new Promise(resolve => setImmediate(resolve));
                expect(operations.map(mock => mock.mock.calls.length)).toEqual(counts);
            });
        }
    });

    it('accepts successful empty sources as no CI', async () => {
        expect((await run()).items[0].ci.state).toBe('none');
        expect((await run({ ids: 42 })).results[0].pullRequest).toMatchObject({ checks: [], ci: { state: 'none' } });
    });

    it('does not use best-effort checks when the listed head is unknown', async () => {
        git.getPullRequests.mockResolvedValue([{ ...pr, lastMergeSourceCommit: undefined }]);
        expect((await run()).items[0].ci.state).toBe('unavailable');
        expect(git.getPullRequestStatuses).not.toHaveBeenCalled();
        expect(git.getStatuses).not.toHaveBeenCalled();
    });
});
