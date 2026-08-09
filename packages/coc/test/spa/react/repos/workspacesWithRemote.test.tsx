/**
 * Tests for the shared "workspaces including remote clones" seam.
 *
 * `ReposContext` dispatches only LOCAL workspaces into AppContext, so every
 * path→workspace resolution surface has to fold the remote rows back in. This
 * covers both entry points: the hook (inside ReposProvider) and the non-hook
 * snapshot fallback (App.tsx's handler, which lives above the provider).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const appWorkspaces: { current: any[] } = { current: [] };
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: appWorkspaces.current }, dispatch: vi.fn() }),
}));

const reposList: { current: any[] | undefined } = { current: undefined };
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useReposOptional: () => (reposList.current ? { repos: reposList.current } : null),
}));

const snapshot: { current: any[] } = { current: [] };
vi.mock('../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation')>();
    return { ...actual, getRemoteWorkspacesSnapshot: () => snapshot.current };
});

import {
    useWorkspacesWithRemote,
    withRemoteWorkspaces,
} from '../../../../src/server/spa/client/react/repos/workspacesWithRemote';

const LOCAL = { id: 'local-1', rootPath: '/home/u/proj' };
const REMOTE = {
    id: 'ws-v2-8777024115df4e9eb71f789e',
    rootPath: '/home/u/remote-proj',
    baseUrl: 'http://127.0.0.1:4000',
    remote: { baseUrl: 'http://127.0.0.1:4000', serverId: 's1', serverLabel: 's1', offline: false },
};

beforeEach(() => {
    appWorkspaces.current = [LOCAL];
    reposList.current = undefined;
    snapshot.current = [];
});

describe('useWorkspacesWithRemote', () => {
    it('folds remote workspaces from the repos list in after the local ones', () => {
        reposList.current = [{ workspace: LOCAL }, { workspace: REMOTE }];

        const { result } = renderHook(() => useWorkspacesWithRemote());

        expect(result.current.map((w) => w.id)).toEqual([LOCAL.id, REMOTE.id]);
    });

    it('ignores non-remote entries in the repos list (no local duplicates)', () => {
        reposList.current = [{ workspace: LOCAL }];

        const { result } = renderHook(() => useWorkspacesWithRemote());

        expect(result.current).toBe(appWorkspaces.current);
    });

    it('falls back to the aggregation snapshot when no ReposContext is mounted', () => {
        snapshot.current = [REMOTE];

        const { result } = renderHook(() => useWorkspacesWithRemote());

        expect(result.current.map((w) => w.id)).toEqual([LOCAL.id, REMOTE.id]);
    });
});

describe('withRemoteWorkspaces', () => {
    it('appends the snapshot rows', () => {
        snapshot.current = [REMOTE];

        expect(withRemoteWorkspaces([LOCAL] as any).map((w) => w.id))
            .toEqual([LOCAL.id, REMOTE.id]);
    });

    it('returns the input array unchanged when no remote workspaces exist', () => {
        const input = [LOCAL];
        expect(withRemoteWorkspaces(input as any)).toBe(input);
    });
});
