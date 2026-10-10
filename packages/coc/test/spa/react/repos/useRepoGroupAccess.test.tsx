/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useRepoGroupAccess } from '../../../../src/server/spa/client/react/repos/useRepoGroupAccess';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/repos/repoGroupAccess', () => ({
    getRepoGroupAccess: (...args: unknown[]) => request(...args),
}));

beforeEach(() => request.mockReset());
afterEach(cleanup);
describe('owning-server access snapshots', () => {
    it('discards late responses from a different owner, then refreshes after a mutation', async () => {
        let resolveLocal!: (value: any) => void;
        request.mockImplementationOnce(() => new Promise(resolve => { resolveLocal = resolve; }))
            .mockResolvedValue({ enabled: true, members: [] });
        const { result, rerender } = renderHook(({ baseUrl }) => useRepoGroupAccess('group-one', baseUrl), {
            initialProps: { baseUrl: undefined as string | undefined },
        });
        await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        rerender({ baseUrl: 'http://remote:3000' });
        await waitFor(() => expect(result.current.access?.enabled).toBe(true));
        act(() => resolveLocal({ enabled: false, members: [] }));
        await act(async () => {});
        expect(result.current.access?.enabled).toBe(true);
        act(() => result.current.refresh());
        await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
        expect(request.mock.lastCall).toEqual(['group-one', 'http://remote:3000']);
    });

    it('keeps older owner servers flag-off and exposes actual diagnostic failures', async () => {
        request.mockRejectedValueOnce({ status: 404 }).mockRejectedValueOnce(new Error('Unavailable'));
        const { result } = renderHook(() => useRepoGroupAccess(undefined, undefined));
        await waitFor(() => expect(result.current.access).toEqual({ enabled: false, members: [] }));
        act(() => result.current.refresh());
        await waitFor(() => expect(result.current.error).toContain('Sharing status unavailable'));
        expect(result.current.access).toBeUndefined();
    });
});
