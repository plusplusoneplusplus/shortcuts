/**
 * @vitest-environment jsdom
 *
 * `useRepoGroupMembers` degrades to `undefined` on failure — including a
 * synchronous throw from `getRepoGroup`. Regression: the chat composer started
 * calling this hook for `#repo_name` mentions, and a synchronous throw escaped
 * the effect and tore down the whole composer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getRepoGroup } = vi.hoisted(() => ({ getRepoGroup: vi.fn() }));

vi.mock('../../../../src/server/spa/client/react/repos/repoGroupService', () => ({
    getRepoGroup,
}));

import { useRepoGroupMembers } from '../../../../src/server/spa/client/react/repos/useRepoGroupMembers';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useRepoGroupMembers', () => {
    it('resolves the group members', async () => {
        getRepoGroup.mockResolvedValue({ members: [{ workspaceId: 'ws-a', stale: false, name: 'alpha' }] });
        const { result } = renderHook(() => useRepoGroupMembers('group-demo', undefined, true));
        await waitFor(() => expect(result.current).toHaveLength(1));
        expect(result.current![0].name).toBe('alpha');
    });

    it('stays undefined when the request rejects', async () => {
        getRepoGroup.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useRepoGroupMembers('group-demo', undefined, true));
        await waitFor(() => expect(getRepoGroup).toHaveBeenCalled());
        expect(result.current).toBeUndefined();
    });

    it('stays undefined when the request throws synchronously', () => {
        getRepoGroup.mockImplementation(() => { throw new TypeError('request is not a function'); });
        const { result } = renderHook(() => useRepoGroupMembers('group-demo', undefined, true));
        expect(result.current).toBeUndefined();
    });

    it('skips the request entirely when disabled', () => {
        const { result } = renderHook(() => useRepoGroupMembers('ws-1', undefined, false));
        expect(getRepoGroup).not.toHaveBeenCalled();
        expect(result.current).toBeUndefined();
    });
});
