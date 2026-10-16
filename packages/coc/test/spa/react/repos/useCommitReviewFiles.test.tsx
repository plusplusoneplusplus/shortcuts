import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCommitReviewFiles } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitReviewFiles';
const mocks = vi.hoisted(() => ({ list: vi.fn(), owner: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({ resolveCloneRoute: () => ({ kind: 'remote' }), getCocClientForWorkspace: (id: string) => { mocks.owner(id); return { git: { listCommitFiles: mocks.list } }; } }));

describe('commit review metadata lifetime', () => {
    it('loads metadata through the concrete owning client without a combined patch', async () => {
        mocks.list.mockResolvedValue({ files: [{ path: 'a.ts', status: 'R', oldPath: 'b.ts' }] });
        const view = renderHook(() => useCommitReviewFiles('remote-ws', 'abc', 'remote:one:ws'));
        await waitFor(() => expect(view.result.current.loading).toBe(false));
        expect(mocks.owner).toHaveBeenLastCalledWith('remote:one:ws');
        expect(mocks.list).toHaveBeenLastCalledWith('remote-ws', 'abc');
        expect(view.result.current.files[0].oldPath).toBe('b.ts');
    });
    it('rejects delayed results after owner/hash changes including A→B→A', async () => {
        const pending: Array<(data: any) => void> = [];
        mocks.list.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
        const view = renderHook(({ hash, owner }) => useCommitReviewFiles('ws', hash, owner), { initialProps: { hash: 'a', owner: 'one' } });
        await act(async () => {});
        view.rerender({ hash: 'b', owner: 'two' }); await act(async () => {});
        view.rerender({ hash: 'a', owner: 'one' }); await act(async () => {});
        await act(async () => pending[2]({ files: [{ path: 'current', status: 'M' }] }));
        await act(async () => { pending[0]({ files: [{ path: 'obsolete', status: 'M' }] }); pending[1]({ files: [{ path: 'foreign', status: 'M' }] }); });
        expect(view.result.current.files.map(file => file.path)).toEqual(['current']);
    });
    it('retries failures and does not load an absent commit', async () => {
        mocks.list.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ files: [] });
        const view = renderHook(({ hash }: { hash?: string }) => useCommitReviewFiles('ws', hash), { initialProps: { hash: 'a' } });
        await waitFor(() => expect(view.result.current.error).toBe('Offline'));
        act(() => view.result.current.retry());
        await waitFor(() => expect(view.result.current.error).toBeUndefined());
        expect(view.result.current.files).toEqual([]);
        view.rerender({ hash: undefined });
        expect(view.result.current.loading).toBe(false);
    });
    it('pins explicit local ownership even when the same workspace has a remote clone', async () => {
        mocks.list.mockResolvedValue({ files: [] });
        const view = renderHook(() => useCommitReviewFiles('ws', 'a', 'ws'));
        await waitFor(() => expect(view.result.current.loading).toBe(false));
        expect(mocks.owner).toHaveBeenLastCalledWith(null);
        expect(mocks.list).toHaveBeenLastCalledWith('ws', 'a');
    });

});
