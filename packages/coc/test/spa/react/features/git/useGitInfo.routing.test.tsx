/**
 * AC-07 — useGitInfo routes to the workspace's clone.
 *
 * The Git tab reads `/workspaces/:id/git-info` through useGitInfo, which now uses
 * useCocClient(workspaceId). A remote clone must read its sync status from its own
 * server; a local clone from the default origin client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── client factory: LOCAL stub + per-baseUrl stubs ────────────────────────────
const gitInfoCalls: Array<{ baseUrl: string; workspaceId: string }> = [];

function makeClient(baseUrl: string) {
    return {
        options: { baseUrl },
        workspaces: {
            gitInfo: vi.fn(async (workspaceId: string) => {
                gitInfoCalls.push({ baseUrl, workspaceId });
                return { branch: 'main', ahead: 1, behind: 2, dirty: true };
            }),
        },
    };
}
const LOCAL = makeClient('');
const remoteClients = new Map<string, ReturnType<typeof makeClient>>();
vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => LOCAL,
    getCocClientFor: (baseUrl?: string) => {
        if (!baseUrl) return LOCAL;
        let c = remoteClients.get(baseUrl);
        if (!c) { c = makeClient(baseUrl); remoteClients.set(baseUrl, c); }
        return c;
    },
}));

// The clone registry (not React context) drives bare-id resolution in useCocClient.
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../../src/server/spa/client/react/repos/cloneRegistry';
import { useGitInfo } from '../../../../../src/server/spa/client/react/features/git/hooks/useGitInfo';

beforeEach(() => {
    resetCloneRegistryForTests();
    gitInfoCalls.length = 0;
    remoteClients.clear();
    LOCAL.workspaces.gitInfo.mockClear();
    registerCloneBaseUrls([{ workspaceId: 'w1', baseUrl: 'http://127.0.0.1:4000' }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

describe('useGitInfo routing', () => {
    it('reads a remote clone git-info from the remote server', async () => {
        const { result } = renderHook(() => useGitInfo('w1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(gitInfoCalls).toEqual([{ baseUrl: 'http://127.0.0.1:4000', workspaceId: 'w1' }]);
        expect(LOCAL.workspaces.gitInfo).not.toHaveBeenCalled();
        expect(result.current.branch).toBe('main');
    });

    it('reads a LOCAL clone git-info from the default origin client', async () => {
        // 'w2' is not registered → resolves to the default local client.
        const { result } = renderHook(() => useGitInfo('w2'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(LOCAL.workspaces.gitInfo).toHaveBeenCalledWith('w2');
        expect(gitInfoCalls).toEqual([{ baseUrl: '', workspaceId: 'w2' }]);
    });
});
