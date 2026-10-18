import { beforeEach, describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => ({
    getRepository: vi.fn(),
    getPullRequests: vi.fn(),
    getPullRequestById: vi.fn(),
    getPullRequestIterations: vi.fn(),
    getPullRequestStatuses: vi.fn(),
    getStatuses: vi.fn(),
}));

vi.mock('azure-devops-node-api', async (importOriginal) => ({
    ...await importOriginal<typeof import('azure-devops-node-api')>(),
    WebApi: vi.fn(function () { return { getGitApi: async () => git }; }),
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

const run = (args: Record<string, unknown> = {}) => runPrQuery(
    parsePrQueryRequest({ provider: 'ado', repository: 'org/project/repo', ...args }),
    { createClient: createPrProviderClientFactory('/unused') },
) as Promise<any>;

beforeEach(() => {
    vi.resetAllMocks();
    git.getRepository.mockResolvedValue({ id: 'repo-id', project: { id: 'project-id' } });
    git.getPullRequests.mockResolvedValue([pr]);
    git.getPullRequestById.mockResolvedValue(pr);
    git.getPullRequestIterations.mockResolvedValue([{ id: 2, sourceRefCommit: { commitId: 'head' } }]);
    git.getPullRequestStatuses.mockResolvedValue([]);
    git.getStatuses.mockResolvedValue([]);
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
        expect(git.getStatuses).toHaveBeenCalledWith('head', 'repo', 'project', undefined, undefined, true);
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
