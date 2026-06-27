/**
 * @vitest-environment node
 *
 * Source-level regression guard for the persisted per-chat agent-canvas
 * "closed" state (AC-02). Runs in node (no localStorage), so it asserts on the
 * ChatDetail source text rather than behaviour — the jsdom integration test in
 * `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx` covers the runtime flow.
 *
 * Invariants guarded here:
 *  - The persistence helper is imported and keyed off `canvasPid`.
 *  - A deliberate close (CanvasPanel `onClose`) persists "closed".
 *  - The collapsed-rail reopen and a fresh AI canvas edit clear the flag.
 *  - The discovery effect reads the persisted flag into `canvasPanelClosed`.
 *  - The `taskId`-keyed reset effect no longer force-opens the panel.
 *  - The transient source-canvas mutual-exclusion collapse does NOT persist.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
    resolve(__dirname, '../../../../../src/server/spa/client/react/features/chat/ChatDetail.tsx'),
    'utf-8',
);

/** Slice the source between `start` (inclusive) and the first `end` after it. */
function block(start: string, end: string): string {
    const i = src.indexOf(start);
    expect(i, `expected to find "${start}" in ChatDetail.tsx`).toBeGreaterThan(-1);
    const j = src.indexOf(end, i);
    expect(j, `expected to find "${end}" after "${start}"`).toBeGreaterThan(-1);
    return src.slice(i, j + end.length);
}

describe('ChatDetail — persisted canvas closed wiring', () => {
    it('imports the persistence helper', () => {
        expect(src).toContain("from './canvasClosedPreference'");
        expect(src).toContain('readCanvasClosed');
        expect(src).toContain('writeCanvasClosed');
    });

    it('derives a single canvasPid identity (processId ?? bareTaskId)', () => {
        expect(src).toContain('const canvasPid = processId ?? bareTaskId');
    });

    it('persists "closed" on the deliberate CanvasPanel close', () => {
        expect(src).toContain('writeCanvasClosed(workspaceId, canvasPid, true)');
    });

    it('clears the flag on collapsed-rail reopen and on a fresh AI canvas edit', () => {
        const clears = src.split('writeCanvasClosed(workspaceId, canvasPid, false)').length - 1;
        // One in the reopen-rail onClick, one in onCanvasUpdated.
        expect(clears).toBeGreaterThanOrEqual(2);
    });

    it('reads the persisted flag in the canvas discovery effect', () => {
        expect(src).toContain('setCanvasPanelClosed(readCanvasClosed(workspaceId, canvasPid))');
    });

    it('the taskId-keyed reset effect no longer force-opens the panel', () => {
        const resetEffect = block('setActiveCanvasId(null);', '[taskId]); // eslint-disable-line');
        expect(resetEffect).not.toContain('setCanvasPanelClosed');
    });

    it('the source-canvas onOpen collapse is transient (does NOT persist)', () => {
        const onOpen = block('const sourceCanvas = useSourceCanvasState({', '});');
        expect(onOpen).toContain('setCanvasPanelClosed(true)');
        expect(onOpen).not.toContain('writeCanvasClosed');
    });
});
