/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    NOTE_ZOOM_MIN,
    NOTE_ZOOM_MAX,
    NOTE_ZOOM_STEP,
    NOTE_ZOOM_DEFAULT,
    NOTE_ZOOM_PRESETS,
    clampNoteZoom,
    noteZoomStorageKey,
    readNoteZoom,
    useNoteZoom,
} from '../../../../../src/server/spa/client/react/features/notes/editor/useNoteZoom';

const WS = 'ws1';
const NOTE_A = 'folder/a.md';
const NOTE_B = 'folder/b.md';

function keyFor(ws: string): string {
    return noteZoomStorageKey(ws);
}

function seed(ws: string, blob: Record<string, number>): void {
    localStorage.setItem(keyFor(ws), JSON.stringify(blob));
}

describe('useNoteZoom store', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('exposes the documented bounds, step, default, and presets', () => {
        expect(NOTE_ZOOM_MIN).toBe(50);
        expect(NOTE_ZOOM_MAX).toBe(200);
        expect(NOTE_ZOOM_STEP).toBe(10);
        expect(NOTE_ZOOM_DEFAULT).toBe(100);
        expect([...NOTE_ZOOM_PRESETS]).toEqual([50, 67, 80, 90, 100, 110, 125, 150, 175, 200]);
    });

    it('builds the per-workspace key under the coc-notes convention', () => {
        expect(noteZoomStorageKey('ws1')).toBe('coc-notes-zoom-ws1');
        expect(noteZoomStorageKey('my_life')).toBe('coc-notes-zoom-my_life');
    });

    it('clamps to the [50, 200] range and rounds', () => {
        expect(clampNoteZoom(10)).toBe(50);
        expect(clampNoteZoom(999)).toBe(200);
        expect(clampNoteZoom(124.6)).toBe(125);
        expect(clampNoteZoom(Number.NaN)).toBe(NOTE_ZOOM_DEFAULT);
    });

    it('reads the default when a note has never been zoomed', () => {
        expect(readNoteZoom(keyFor(WS), NOTE_A)).toBe(100);
        seed(WS, { [NOTE_A]: 150 });
        expect(readNoteZoom(keyFor(WS), NOTE_A)).toBe(150);
        // A different, unseen path still defaults.
        expect(readNoteZoom(keyFor(WS), NOTE_B)).toBe(100);
    });

    it('tolerates corrupt / non-object blobs by defaulting', () => {
        localStorage.setItem(keyFor(WS), 'not json');
        expect(readNoteZoom(keyFor(WS), NOTE_A)).toBe(100);
        localStorage.setItem(keyFor(WS), '[1,2,3]');
        expect(readNoteZoom(keyFor(WS), NOTE_A)).toBe(100);
    });

    it('defaults to 100% and steps by 10% via zoomIn / zoomOut, clamped', () => {
        const { result } = renderHook(() => useNoteZoom(WS, NOTE_A));
        expect(result.current.zoom).toBe(100);

        act(() => { result.current.zoomIn(); });
        act(() => { result.current.zoomIn(); });
        expect(result.current.zoom).toBe(120);

        act(() => { result.current.zoomOut(); });
        act(() => { result.current.zoomOut(); });
        act(() => { result.current.zoomOut(); });
        expect(result.current.zoom).toBe(90);
    });

    it('clamps at 50 and 200 and reflects canZoomIn / canZoomOut', () => {
        const { result } = renderHook(() => useNoteZoom(WS, NOTE_A));
        act(() => { result.current.setZoom(200); });
        expect(result.current.zoom).toBe(200);
        expect(result.current.canZoomIn).toBe(false);
        expect(result.current.canZoomOut).toBe(true);
        act(() => { result.current.zoomIn(); });
        expect(result.current.zoom).toBe(200);

        act(() => { result.current.setZoom(50); });
        expect(result.current.canZoomOut).toBe(false);
        expect(result.current.canZoomIn).toBe(true);
        act(() => { result.current.zoomOut(); });
        expect(result.current.zoom).toBe(50);
    });

    it('setZoom selects an exact preset level and reset returns to 100%', () => {
        const { result } = renderHook(() => useNoteZoom(WS, NOTE_A));
        act(() => { result.current.setZoom(150); });
        expect(result.current.zoom).toBe(150);
        act(() => { result.current.reset(); });
        expect(result.current.zoom).toBe(100);
    });

    it('persists an explicit zoom to the per-workspace blob keyed by note path', () => {
        const { result } = renderHook(() => useNoteZoom(WS, NOTE_A));
        act(() => { result.current.setZoom(150); });
        expect(readNoteZoom(keyFor(WS), NOTE_A)).toBe(150);
        const blob = JSON.parse(localStorage.getItem(keyFor(WS))!);
        expect(blob).toEqual({ [NOTE_A]: 150 });
    });

    it('rehydrates a previously persisted level on mount', () => {
        seed(WS, { [NOTE_A]: 80 });
        const { result } = renderHook(() => useNoteZoom(WS, NOTE_A));
        expect(result.current.zoom).toBe(80);
    });

    it('does not write to storage on mount (an un-zoomed note stays clean)', () => {
        renderHook(() => useNoteZoom(WS, NOTE_A));
        expect(localStorage.getItem(keyFor(WS))).toBeNull();
    });

    it('keeps two note paths isolated within one workspace', () => {
        seed(WS, { [NOTE_A]: 150, [NOTE_B]: 80 });
        const { result, rerender } = renderHook(
            ({ note }) => useNoteZoom(WS, note),
            { initialProps: { note: NOTE_A } },
        );
        expect(result.current.zoom).toBe(150);
        rerender({ note: NOTE_B });
        expect(result.current.zoom).toBe(80);
        rerender({ note: NOTE_A });
        expect(result.current.zoom).toBe(150);
    });

    it('does not persist the read when switching notes (skipPersistRef)', () => {
        seed(WS, { [NOTE_A]: 150, [NOTE_B]: 80 });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const { rerender } = renderHook(
            ({ note }) => useNoteZoom(WS, note),
            { initialProps: { note: NOTE_A } },
        );
        setItem.mockClear();
        rerender({ note: NOTE_B });
        rerender({ note: NOTE_A });
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
    });

    it('does not persist the read when switching workspaces', () => {
        seed('ws-a', { [NOTE_A]: 150 });
        seed('ws-b', { [NOTE_A]: 80 });
        const { result, rerender } = renderHook(
            ({ ws }) => useNoteZoom(ws, NOTE_A),
            { initialProps: { ws: 'ws-a' } },
        );
        expect(result.current.zoom).toBe(150);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        rerender({ ws: 'ws-b' });
        expect(result.current.zoom).toBe(80);
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
    });
});
