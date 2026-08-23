/**
 * repoGroupService — per-server routing for the repo-group REST calls
 * (remote-server repo groups AC-01/AC-04).
 *
 * Covers: every call routes through the client for the given base URL (and the
 * default origin client when none is given), and the Server dropdown's option
 * list is Local + ONLINE remotes only, degrading to Local-only when the server
 * registry is unreachable.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const mockServersList = vi.fn();
const clientForCalls: (string | undefined)[] = [];

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getCocClientFor: (baseUrl?: string) => {
        clientForCalls.push(baseUrl);
        return { request: mockRequest };
    },
    getSpaCocClient: () => ({ request: mockRequest, servers: { list: mockServersList } }),
}));

import {
    createRepoGroup,
    deleteRepoGroup,
    getRepoGroup,
    listRepoGroupServerOptions,
    updateRepoGroup,
} from '../../../../src/server/spa/client/react/repos/repoGroupService';

const REMOTE = 'http://127.0.0.1:4000';

beforeEach(() => {
    clientForCalls.length = 0;
    mockRequest.mockReset().mockResolvedValue({});
    mockServersList.mockReset();
});

describe('repo-group requests route to the owning server', () => {
    it('creates on the remote server when a base URL is given', async () => {
        await createRepoGroup({ name: 'Platform', members: ['a'] }, REMOTE);

        expect(clientForCalls).toEqual([REMOTE]);
        expect(mockRequest).toHaveBeenCalledWith('/repo-groups', {
            method: 'POST',
            body: { name: 'Platform', members: ['a'] },
        });
    });

    it('reads, updates and deletes against the same base URL', async () => {
        await getRepoGroup('group-platform', REMOTE);
        await updateRepoGroup('group-platform', { name: 'P2' }, REMOTE);
        await deleteRepoGroup('group-platform', REMOTE);

        expect(clientForCalls).toEqual([REMOTE, REMOTE, REMOTE]);
        expect(mockRequest.mock.calls.map(call => call[0]))
            .toEqual(['/repo-groups/group-platform', '/repo-groups/group-platform', '/repo-groups/group-platform']);
        expect(mockRequest.mock.calls[1][1]).toEqual({ method: 'PATCH', body: { name: 'P2' } });
        expect(mockRequest.mock.calls[2][1]).toEqual({ method: 'DELETE' });
    });

    it('falls back to the default origin client with no base URL', async () => {
        await createRepoGroup({ name: 'Local', members: [] });
        await deleteRepoGroup('group-local');

        expect(clientForCalls).toEqual([undefined, undefined]);
    });

    it('encodes the group id into the path', async () => {
        await getRepoGroup('group-a b', REMOTE);

        expect(mockRequest).toHaveBeenCalledWith('/repo-groups/group-a%20b');
    });
});

describe('listRepoGroupServerOptions', () => {
    it('offers Local plus online remotes, skipping offline and url-less servers', async () => {
        mockServersList.mockResolvedValue([
            { id: 'srv-1', label: 'devbox', status: 'online', effectiveUrl: REMOTE },
            { id: 'srv-2', label: 'laptop', status: 'offline', effectiveUrl: 'http://127.0.0.1:4001' },
            { id: 'srv-3', label: 'starting', status: 'connecting' },
            { id: 'srv-4', label: 'no-url', status: 'online', effectiveUrl: '' },
        ]);

        expect(await listRepoGroupServerOptions()).toEqual([
            { id: 'local', label: 'Local' },
            { id: 'srv-1', label: 'devbox', baseUrl: REMOTE },
        ]);
    });

    it('labels an unlabelled server by its id', async () => {
        mockServersList.mockResolvedValue([{ id: 'srv-1', label: '', status: 'online', effectiveUrl: REMOTE }]);

        expect((await listRepoGroupServerOptions())[1]).toEqual({ id: 'srv-1', label: 'srv-1', baseUrl: REMOTE });
    });

    it('degrades to Local-only when the server registry is unreachable', async () => {
        mockServersList.mockRejectedValue(new Error('offline'));

        expect(await listRepoGroupServerOptions()).toEqual([{ id: 'local', label: 'Local' }]);
    });
});
