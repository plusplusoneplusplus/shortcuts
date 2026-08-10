/**
 * AC-02 — removing a repo must reach the CoC server that OWNS it.
 *
 * A remote (agent-hosted) workspace is registered on another CoC server, so the
 * DELETE has to be routed there via the clone registry. A local workspace stays
 * on the default page-origin client. These tests pin both directions by
 * inspecting the URL the client actually fetches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeWorkspace } from '../../../../src/server/spa/client/react/repos/repositoryService';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    resetCloneRegistryForTests();
    resetSpaCocClientForTests();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetCloneRegistryForTests();
    resetSpaCocClientForTests();
});

function requestedUrl(): string {
    const [input] = fetchMock.mock.calls[0];
    return typeof input === 'string' ? input : String((input as Request).url ?? input);
}

function requestedMethod(): string | undefined {
    const [input, init] = fetchMock.mock.calls[0];
    return (init as RequestInit | undefined)?.method ?? (input as Request | undefined)?.method;
}

describe('removeWorkspace routing', () => {
    it('DELETEs a remote workspace against the owning server baseUrl', async () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: 'http://127.0.0.1:4000' }]);

        await removeWorkspace('remote-ws');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestedUrl()).toBe('http://127.0.0.1:4000/api/workspaces/remote-ws');
        expect(requestedMethod()).toBe('DELETE');
    });

    it('DELETEs a local workspace against the page origin (no remote baseUrl)', async () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-ws', baseUrl: 'http://127.0.0.1:4000' }]);

        await removeWorkspace('local-ws');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestedUrl()).toBe('/api/workspaces/local-ws');
        expect(requestedMethod()).toBe('DELETE');
    });
});
