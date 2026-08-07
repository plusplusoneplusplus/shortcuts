/**
 * @vitest-environment jsdom
 *
 * useCanvasVersions — version navigation plus restore-as-latest, which writes
 * the old content back as a NEW revision rather than rewriting history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

import { useCanvasVersions } from '../../../../../src/server/spa/client/react/features/canvas/hooks/useCanvasVersions';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123', workspaceId: 'ws-1', title: 'My Plan', type: 'markdown', revision: 3,
        createdAt: '2026-06-12T00:00:00.000Z', updatedAt: '2026-06-12T00:00:00.000Z',
        lastEditor: 'ai', content: '# rev3', ...overrides,
    } as any;
}

// Newest-first, matching the server's list order.
const META = [
    { revision: 3, editor: 'ai', createdAt: '2026-06-12T03:00:00.000Z' },
    { revision: 2, editor: 'user', createdAt: '2026-06-12T02:00:00.000Z' },
    { revision: 1, editor: 'ai', createdAt: '2026-06-12T01:00:00.000Z' },
] as any[];

describe('useCanvasVersions', () => {
    let listVersions: ReturnType<typeof vi.fn>;
    let getVersion: ReturnType<typeof vi.fn>;
    let save: ReturnType<typeof vi.fn>;
    let adoptSaved: ReturnType<typeof vi.fn>;
    let setSaveState: ReturnType<typeof vi.fn>;
    let client: any;

    beforeEach(() => {
        listVersions = vi.fn().mockResolvedValue(META);
        getVersion = vi.fn().mockResolvedValue({ revision: 2, editor: 'user', content: '# rev2' });
        save = vi.fn().mockResolvedValue(makeCanvas({ revision: 4, content: '# rev2' }));
        adoptSaved = vi.fn();
        setSaveState = vi.fn();
        client = { canvases: { listVersions, getVersion, save } };
    });

    function mount(canvas: any = makeCanvas(), loadNonce = 1) {
        return renderHook(
            ({ canvas: c, loadNonce: n, canvasId }: any) => {
                const canvasRef = useRef(c);
                canvasRef.current = c;
                return useCanvasVersions({
                    client, workspaceId: 'ws-1', canvasId, canvas: c, canvasRef,
                    loadNonce: n, adoptSaved, setSaveState,
                });
            },
            { initialProps: { canvas, loadNonce, canvasId: 'doc-abc123' } as any },
        );
    }

    it('does not fetch history before the first successful load', () => {
        mount(null, 0);
        expect(listVersions).not.toHaveBeenCalled();
    });

    it('lists versions after a load and derives the older/newer steps from the live revision', async () => {
        const { result } = mount();

        await waitFor(() => expect(result.current.versions).toHaveLength(3));
        expect(result.current.viewingRevision).toBe(3);
        expect(result.current.olderMeta?.revision).toBe(2);
        // Nothing newer than the live revision.
        expect(result.current.newerMeta).toBeUndefined();
    });

    it('re-lists on every subsequent load so a live AI update refreshes history', async () => {
        const { result, rerender } = mount();
        await waitFor(() => expect(listVersions).toHaveBeenCalledTimes(1));

        rerender({ canvas: makeCanvas({ revision: 4 }), loadNonce: 2, canvasId: 'doc-abc123' } as any);

        await waitFor(() => expect(listVersions).toHaveBeenCalledTimes(2));
        expect(result.current.viewingRevision).toBe(4);
    });

    it('opens an older revision read-only and steps back to latest', async () => {
        const { result } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));

        act(() => result.current.openVersion(META[1]));
        await waitFor(() => expect(result.current.viewingVersion?.revision).toBe(2));
        expect(getVersion).toHaveBeenCalledWith('ws-1', 'doc-abc123', 2);
        expect(result.current.viewingRevision).toBe(2);
        expect(result.current.newerMeta?.revision).toBe(3);

        act(() => result.current.backToLatest());
        expect(result.current.viewingVersion).toBeNull();
    });

    it('treats stepping to the live revision as leaving history, with no fetch', async () => {
        const { result } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));
        act(() => result.current.openVersion(META[1]));
        await waitFor(() => expect(result.current.viewingVersion).not.toBeNull());
        getVersion.mockClear();

        act(() => result.current.openVersion(META[0]));

        expect(getVersion).not.toHaveBeenCalled();
        expect(result.current.viewingVersion).toBeNull();
    });

    it('keeps the current view when the version fetch fails', async () => {
        getVersion.mockRejectedValue(new Error('gone'));
        const { result } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));

        await act(async () => { result.current.openVersion(META[1]); });

        expect(result.current.viewingVersion).toBeNull();
    });

    it('tolerates a failed history list without breaking the panel', async () => {
        listVersions.mockRejectedValue(new Error('no history'));
        const { result } = mount();

        await waitFor(() => expect(listVersions).toHaveBeenCalled());
        expect(result.current.versions).toEqual([]);
        expect(result.current.viewingRevision).toBe(3);
    });

    it('restores an old revision as a NEW revision against the current one', async () => {
        const { result } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));
        act(() => result.current.openVersion(META[1]));
        await waitFor(() => expect(result.current.viewingVersion?.revision).toBe(2));
        listVersions.mockClear();

        await act(async () => { await result.current.restore(); });

        expect(save).toHaveBeenCalledWith('ws-1', 'doc-abc123', { content: '# rev2', expectedRevision: 3 });
        expect(adoptSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
        expect(result.current.viewingVersion).toBeNull();
        // History is re-listed so the stepper sees the newly written revision.
        await waitFor(() => expect(listVersions).toHaveBeenCalled());
    });

    it('surfaces a 409 restore as a conflict and any other failure as an error', async () => {
        save.mockRejectedValueOnce(new CocApiError({ status: 409, statusText: 'Conflict', url: '/x', message: 'c' }));
        const { result } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));
        act(() => result.current.openVersion(META[1]));
        await waitFor(() => expect(result.current.viewingVersion).not.toBeNull());

        await act(async () => { await result.current.restore(); });
        expect(setSaveState).toHaveBeenCalledWith('conflict');
        expect(result.current.restoring).toBe(false);

        save.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { await result.current.restore(); });
        expect(setSaveState).toHaveBeenCalledWith('error');
    });

    it('ignores restore when not browsing history', async () => {
        const { result } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));

        await act(async () => { await result.current.restore(); });

        expect(save).not.toHaveBeenCalled();
    });

    it('clears the browsed revision and the list when the canvas changes', async () => {
        const { result, rerender } = mount();
        await waitFor(() => expect(result.current.versions).toHaveLength(3));
        act(() => result.current.openVersion(META[1]));
        await waitFor(() => expect(result.current.viewingVersion).not.toBeNull());

        listVersions.mockResolvedValue([]);
        rerender({ canvas: makeCanvas({ id: 'doc-def456' }), loadNonce: 1, canvasId: 'doc-def456' } as any);

        expect(result.current.viewingVersion).toBeNull();
        expect(result.current.versions).toEqual([]);
    });
});

// A restore that lands while the panel is unmounting must not leave `restoring`
// stuck — covered above via the finally block; this guard documents the intent.
describe('useCanvasVersions restoring flag', () => {
    it('is set while the save is in flight and cleared afterwards', async () => {
        let release: (v: unknown) => void = () => {};
        const client: any = {
            canvases: {
                listVersions: vi.fn().mockResolvedValue([{ revision: 1, editor: 'ai', createdAt: 'x' }]),
                getVersion: vi.fn().mockResolvedValue({ revision: 1, editor: 'ai', content: 'old' }),
                save: vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve; })),
            },
        };
        const { result } = renderHook(() => {
            const [canvas] = useState(makeCanvas({ revision: 2 }));
            const canvasRef = useRef(canvas);
            canvasRef.current = canvas;
            return useCanvasVersions({
                client, workspaceId: 'ws-1', canvasId: 'doc-abc123', canvas, canvasRef,
                loadNonce: 1, adoptSaved: vi.fn(), setSaveState: vi.fn(),
            });
        });

        await waitFor(() => expect(result.current.versions).toHaveLength(1));
        act(() => result.current.openVersion({ revision: 1 } as any));
        await waitFor(() => expect(result.current.viewingVersion).not.toBeNull());

        act(() => { void result.current.restore(); });
        await waitFor(() => expect(result.current.restoring).toBe(true));

        await act(async () => { release(makeCanvas({ revision: 3 })); });
        expect(result.current.restoring).toBe(false);
    });
});
