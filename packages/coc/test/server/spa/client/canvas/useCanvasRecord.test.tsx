/**
 * @vitest-environment jsdom
 *
 * useCanvasRecord — the concurrency-critical kernel: load, live-update
 * reconciliation, reload nonce, and debounced revision-checked autosave.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

import { useCanvasRecord } from '../../../../../src/server/spa/client/react/features/canvas/hooks/useCanvasRecord';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123',
        workspaceId: 'ws-1',
        title: 'My Plan',
        type: 'markdown',
        revision: 1,
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        lastEditor: 'ai',
        content: '# Plan body',
        ...overrides,
    } as any;
}

function conflictError() {
    return new CocApiError({
        status: 409, statusText: 'Conflict', url: '/x', message: 'revision-conflict',
    });
}

describe('useCanvasRecord', () => {
    let get: ReturnType<typeof vi.fn>;
    let save: ReturnType<typeof vi.fn>;
    let client: any;

    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        get = vi.fn().mockResolvedValue(makeCanvas());
        save = vi.fn();
        client = { canvases: { get, save } };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function mount(props: Record<string, unknown> = {}) {
        return renderHook(
            (p: any) => useCanvasRecord(p),
            {
                initialProps: {
                    client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: null, ...props,
                } as any,
            },
        );
    }

    it('loads the canvas, seeds the draft, and bumps the load nonce', async () => {
        const { result } = mount();

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(get).toHaveBeenCalledWith('ws-1', 'doc-abc123');
        expect(result.current.canvas?.title).toBe('My Plan');
        expect(result.current.draft).toBe('# Plan body');
        expect(result.current.dirty).toBe(false);
        expect(result.current.loadNonce).toBe(1);
        expect(result.current.loadError).toBeNull();
    });

    it('surfaces a load error and leaves the nonce at zero so best-effort refetches are skipped', async () => {
        get.mockRejectedValue(new Error('boom'));
        const { result } = mount();

        await waitFor(() => expect(result.current.loadError).toBe('Failed to load canvas'));
        expect(result.current.loading).toBe(false);
        expect(result.current.loadNonce).toBe(0);
    });

    it('autosaves a debounced edit against the loaded revision', async () => {
        save.mockResolvedValue(makeCanvas({ revision: 2 }));
        const { result } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.editDraft('# Edited'));
        expect(result.current.dirty).toBe(true);
        expect(save).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(800); });

        expect(save).toHaveBeenCalledWith('ws-1', 'doc-abc123', { content: '# Edited', expectedRevision: 1 });
        await waitFor(() => expect(result.current.saveState).toBe('saved'));
        expect(result.current.dirty).toBe(false);
        // The server echo must not clobber the text the user actually typed.
        expect(result.current.canvas?.content).toBe('# Edited');
        expect(result.current.canvas?.revision).toBe(2);
    });

    it('keeps the dirty mark when the user types while a save is in flight', async () => {
        let release: (v: unknown) => void = () => {};
        save.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const { result } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.editDraft('first'));
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        expect(result.current.saveState).toBe('saving');

        act(() => result.current.editDraft('first + second'));
        await act(async () => { release(makeCanvas({ revision: 2 })); });

        expect(result.current.dirty).toBe(true);
        expect(result.current.saveState).not.toBe('saved');
        expect(result.current.draft).toBe('first + second');
    });

    it('flags a 409 as a conflict and any other failure as an error', async () => {
        save.mockRejectedValueOnce(conflictError());
        const { result } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.editDraft('a'));
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        await waitFor(() => expect(result.current.saveState).toBe('conflict'));

        save.mockRejectedValueOnce(new Error('offline'));
        act(() => result.current.editDraft('b'));
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        await waitFor(() => expect(result.current.saveState).toBe('error'));
    });

    it('refetches on a newer live update when the draft is clean', async () => {
        const { result, rerender } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));
        get.mockResolvedValue(makeCanvas({ revision: 2, content: '# From the AI' }));

        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: { canvasId: 'doc-abc123', revision: 2 } } as any);

        await waitFor(() => expect(result.current.draft).toBe('# From the AI'));
        expect(result.current.remoteUpdatePending).toBe(false);
        expect(result.current.loadNonce).toBe(2);
    });

    it('flags a pending remote update instead of clobbering a dirty draft', async () => {
        const { result, rerender } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.editDraft('my unsaved words'));
        get.mockClear();

        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: { canvasId: 'doc-abc123', revision: 2 } } as any);

        await waitFor(() => expect(result.current.remoteUpdatePending).toBe(true));
        expect(get).not.toHaveBeenCalled();
        expect(result.current.draft).toBe('my unsaved words');
    });

    it('ignores a live update for another canvas or at an already-seen revision', async () => {
        const { result, rerender } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));
        get.mockClear();

        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: { canvasId: 'other', revision: 9 } } as any);
        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: { canvasId: 'doc-abc123', revision: 1 } } as any);

        expect(get).not.toHaveBeenCalled();
        expect(result.current.remoteUpdatePending).toBe(false);
    });

    it('reloads when reloadNonce changes, but never over a dirty draft', async () => {
        const { result, rerender } = mount({ reloadNonce: 0 });
        await waitFor(() => expect(result.current.loading).toBe(false));
        get.mockClear().mockResolvedValue(makeCanvas({ revision: 5, content: '# Newer' }));

        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: null, reloadNonce: 1 } as any);
        await waitFor(() => expect(result.current.draft).toBe('# Newer'));

        act(() => result.current.editDraft('local work'));
        get.mockClear();
        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-abc123', liveEvent: null, reloadNonce: 2 } as any);

        expect(get).not.toHaveBeenCalled();
        expect(result.current.draft).toBe('local work');
    });

    it('reload discards the local draft and clears the conflict state', async () => {
        save.mockRejectedValue(conflictError());
        const { result } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.editDraft('doomed edit'));
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        await waitFor(() => expect(result.current.saveState).toBe('conflict'));

        get.mockResolvedValue(makeCanvas({ revision: 4, content: '# Server truth' }));
        await act(async () => { await result.current.reload(); });

        expect(result.current.draft).toBe('# Server truth');
        expect(result.current.dirty).toBe(false);
        expect(result.current.saveState).toBe('idle');
    });

    it('re-loads and resets state when the canvas id changes', async () => {
        const { result, rerender } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));
        get.mockResolvedValue(makeCanvas({ id: 'doc-def456', title: 'Other', content: '# Other' }));

        rerender({ client, workspaceId: 'ws-1', canvasId: 'doc-def456', liveEvent: null } as any);

        await waitFor(() => expect(result.current.canvas?.id).toBe('doc-def456'));
        expect(get).toHaveBeenLastCalledWith('ws-1', 'doc-def456');
        expect(result.current.draft).toBe('# Other');
    });

    it('adoptSaved takes an externally saved canvas as the clean current state', async () => {
        const { result } = mount();
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.editDraft('scratch'));

        act(() => result.current.adoptSaved(makeCanvas({ revision: 7, content: '# Saved elsewhere' })));

        expect(result.current.canvas?.revision).toBe(7);
        expect(result.current.draft).toBe('# Saved elsewhere');
        expect(result.current.dirty).toBe(false);
        expect(result.current.saveState).toBe('saved');
    });
});
