/**
 * useFileMentionRepos — which repos the file-mention popup searches.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFileMentionRepos } from '../../../../../src/server/spa/client/react/features/chat/hooks/useFileMentionRepos';
import type { RepoGroupMember } from '../../../../../src/server/spa/client/react/repos/repoGroupService';

const members: RepoGroupMember[] = [
    { workspaceId: 'ws-a', stale: false, name: 'alpha' },
    { workspaceId: 'ws-b', stale: false, name: 'beta' },
    { workspaceId: 'ws-gone', stale: true, staleReason: 'workspace-removed' },
];

describe('useFileMentionRepos', () => {
    it('returns every live group member in group order', () => {
        const { result } = renderHook(() => useFileMentionRepos('group-demo', members));
        expect(result.current).toEqual([
            { workspaceId: 'ws-a', name: 'alpha' },
            { workspaceId: 'ws-b', name: 'beta' },
        ]);
    });

    it('falls back to the workspace id when a member has no name', () => {
        const { result } = renderHook(() => useFileMentionRepos('group-demo', [
            { workspaceId: 'ws-a', stale: false },
        ]));
        expect(result.current).toEqual([{ workspaceId: 'ws-a', name: 'ws-a' }]);
    });

    it('searches only itself in a plain single-repo chat', () => {
        const { result } = renderHook(() => useFileMentionRepos('ws-solo', undefined));
        expect(result.current).toEqual([{ workspaceId: 'ws-solo', name: 'ws-solo' }]);
    });

    it('returns nothing without a workspace, so the popup never opens', () => {
        const { result } = renderHook(() => useFileMentionRepos(undefined, undefined));
        expect(result.current).toEqual([]);
    });

    it('returns nothing while a group membership is still loading', () => {
        const { result } = renderHook(() => useFileMentionRepos('group-demo', undefined));
        expect(result.current).toEqual([]);
    });
});
