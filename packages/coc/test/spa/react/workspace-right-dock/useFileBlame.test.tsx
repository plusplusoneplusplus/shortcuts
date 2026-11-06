/**
 * Blame reads (`features.fileBlame`): owner-routed through the tab's local or
 * remote clone client, with loading/error/retry states, and stale answers
 * (another path, or blame turned off) dropped.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const getFileBlame = vi.hoisted(() => vi.fn());
const getCocClientForWorkspace = vi.hoisted(() => vi.fn());
const resolveCloneRoute = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace,
    lookupCloneBaseUrl: () => null,
    resolveCloneRoute,
}));

import { useFileBlame, type UseFileBlameOptions } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useFileBlame';

const BLAME = { lines: [{ hash: 'h1', text: 'x' }], commits: {} };

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const BASE: UseFileBlameOptions = { enabled: true, workspaceId: 'ws-1', filePath: 'src/app.ts' };

beforeEach(() => {
    getFileBlame.mockReset();
    getCocClientForWorkspace.mockReset().mockReturnValue({ git: { getFileBlame } });
    resolveCloneRoute.mockReset().mockReturnValue({ kind: 'local' });
});
afterEach(cleanup);

describe('useFileBlame', () => {
    it('stays off and reads nothing while disabled', () => {
        const { result } = renderHook(() => useFileBlame({ ...BASE, enabled: false }));
        expect(result.current).toEqual({ status: 'off' });
        expect(getFileBlame).not.toHaveBeenCalled();
    });

    it('loads from the local owner', async () => {
        getFileBlame.mockResolvedValue(BLAME);
        const { result } = renderHook(() => useFileBlame(BASE));
        expect(result.current.status).toBe('loading');
        await waitFor(() => expect(result.current).toEqual({ status: 'loaded', blame: BLAME }));
        expect(getCocClientForWorkspace).toHaveBeenCalledWith('ws-1');
        expect(getFileBlame).toHaveBeenCalledWith('ws-1', 'src/app.ts');
    });

    it('routes a remote clone read to its clone client, not the page origin', async () => {
        getFileBlame.mockResolvedValue(BLAME);
        const { result } = renderHook(() => useFileBlame({ ...BASE, routingRef: 'remote:host:ws-1' }));
        await waitFor(() => expect(result.current.status).toBe('loaded'));
        expect(getCocClientForWorkspace).toHaveBeenCalledWith('remote:host:ws-1');
        expect(getCocClientForWorkspace).not.toHaveBeenCalledWith('ws-1');
    });

    it('fails without a read when the remote owner is unavailable', async () => {
        resolveCloneRoute.mockReturnValue({ kind: 'unresolved-remote' });
        const { result } = renderHook(() => useFileBlame({ ...BASE, routingRef: 'remote:gone:ws-1' }));
        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(getCocClientForWorkspace).not.toHaveBeenCalled();
    });

    it('shows an error and retries', async () => {
        getFileBlame.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(BLAME);
        const { result } = renderHook(() => useFileBlame(BASE));
        await waitFor(() => expect(result.current).toMatchObject({ status: 'error', message: 'boom' }));
        act(() => { (result.current as { retry: () => void }).retry(); });
        await waitFor(() => expect(result.current).toEqual({ status: 'loaded', blame: BLAME }));
    });

    it('drops a stale answer for a previous path', async () => {
        const first = deferred<typeof BLAME>();
        const second = deferred<typeof BLAME>();
        getFileBlame.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { result, rerender } = renderHook((props: UseFileBlameOptions) => useFileBlame(props), { initialProps: BASE });
        rerender({ ...BASE, filePath: 'src/other.ts' });
        const fresh = { lines: [], commits: {} };
        await act(async () => { second.resolve(fresh); });
        await act(async () => { first.resolve(BLAME); });
        expect(result.current).toEqual({ status: 'loaded', blame: fresh });
    });

    it('drops a pending answer once blame is turned off', async () => {
        const pending = deferred<typeof BLAME>();
        getFileBlame.mockReturnValueOnce(pending.promise);
        const { result, rerender } = renderHook((props: UseFileBlameOptions) => useFileBlame(props), { initialProps: BASE });
        rerender({ ...BASE, enabled: false });
        await act(async () => { pending.resolve(BLAME); });
        expect(result.current).toEqual({ status: 'off' });
    });
});
