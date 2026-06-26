/**
 * createCiChecksFetcher Tests
 *
 * Verifies the production CI-checks fetcher adapts the headless server-side
 * checks snapshot (`fetchOriginPullRequestChecksHeadless`) into the evaluator's
 * `CiPrChecksSnapshot` shape: field projection only, identical status vocab,
 * and that the workspace/origin/PR scope is forwarded verbatim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchHeadless = vi.fn();

vi.mock('../../../src/server/repos/pr-routes', () => ({
    fetchOriginPullRequestChecksHeadless: (...args: unknown[]) => fetchHeadless(...args),
}));

import { createCiChecksFetcher } from '../../../src/server/triggers/ci-checks-fetcher';

describe('createCiChecksFetcher', () => {
    beforeEach(() => {
        fetchHeadless.mockReset();
    });

    it('forwards workspace/origin/pr scope and dataDir/store to the headless fetch', async () => {
        fetchHeadless.mockResolvedValue({ prStatus: 'open', prNumber: 7, checks: [] });
        const store = { marker: 'store' } as any;
        const fetcher = createCiChecksFetcher({ dataDir: '/tmp/data', store });

        await fetcher({ workspaceId: 'ws_a', originId: 'origin_1', prId: '42' });

        expect(fetchHeadless).toHaveBeenCalledTimes(1);
        expect(fetchHeadless).toHaveBeenCalledWith({
            dataDir: '/tmp/data',
            workspaceId: 'ws_a',
            originId: 'origin_1',
            prId: '42',
            store,
        });
    });

    it('maps provider checks to minimal snapshots (id/name/status/detailsUrl)', async () => {
        fetchHeadless.mockResolvedValue({
            prStatus: 'open',
            prNumber: 99,
            checks: [
                { id: 'c1', name: 'build', status: 'failure', source: 'check', detailsUrl: 'https://ci/c1', extra: 'dropped' },
                { id: 'c2', name: 'lint', status: 'success', source: 'status' },
            ],
        });
        const fetcher = createCiChecksFetcher({ dataDir: '/tmp/data' });

        const snapshot = await fetcher({ workspaceId: 'ws_a', originId: 'origin_1', prId: '5' });

        expect(snapshot).toEqual({
            prStatus: 'open',
            prNumber: 99,
            checks: [
                { id: 'c1', name: 'build', status: 'failure', detailsUrl: 'https://ci/c1' },
                { id: 'c2', name: 'lint', status: 'success' },
            ],
        });
        // detailsUrl is omitted (not undefined) when absent.
        expect('detailsUrl' in snapshot.checks[1]!).toBe(false);
    });

    it('propagates errors from the headless fetch (caller decides how to react)', async () => {
        fetchHeadless.mockRejectedValue(new Error('no-credentials'));
        const fetcher = createCiChecksFetcher({ dataDir: '/tmp/data' });

        await expect(fetcher({ workspaceId: 'ws_a', originId: 'origin_1', prId: '1' }))
            .rejects.toThrow('no-credentials');
    });
});
