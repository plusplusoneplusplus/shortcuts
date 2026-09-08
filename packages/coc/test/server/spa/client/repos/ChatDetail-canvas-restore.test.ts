/**
 * @vitest-environment node
 *
 * Source-level regression guard for two things that must stay true of
 * `ChatDetail.tsx` after the chat-owned AI canvas column was removed:
 *
 *  - **Nothing chat-side renders an AI canvas any more.** No collapsed/popped-out
 *    rail, no resize handle, no `CanvasPanel` mount, no per-chat closed flag or
 *    canvas width preference. These are text assertions because the surface is
 *    absent — the jsdom test in `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx`
 *    is what proves the shared panel's editor is still reachable.
 *  - **The session-scoped per-chat open-view memory survives** for source /
 *    note / folder / whisper-diff views: held in an in-memory ref map, restored
 *    on chat switch, never persisted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const chatDir = resolve(__dirname, '../../../../../src/server/spa/client/react/features/chat');
const src = readFileSync(resolve(chatDir, 'ChatDetail.tsx'), 'utf-8');
const memorySrc = readFileSync(resolve(chatDir, 'openCanvasMemory.ts'), 'utf-8');

describe('ChatDetail — the chat-owned AI canvas surface is gone', () => {
    it('mounts no CanvasPanel and imports none', () => {
        expect(src).not.toContain('<CanvasPanel');
        expect(src).not.toContain('canvas/CanvasPanel');
    });

    it('renders no canvas rail, reopen button, or resize handle', () => {
        for (const marker of [
            'canvas-collapsed-rail',
            'canvas-poppedout-rail',
            'canvas-poppedout-focus',
            'canvas-reopen',
            'canvas-panel-resize-handle',
        ]) {
            expect(src, `expected no "${marker}" in ChatDetail.tsx`).not.toContain(marker);
        }
    });

    it('keeps no state or width reservation for a chat-side canvas', () => {
        for (const symbol of [
            'activeCanvasId',
            'canvasPanelClosed',
            'conversationCanvases',
            'canvasLiveEvent',
            'canvasFullscreen',
            'poppedOutCanvasId',
            'canvasResize',
            'coc.canvasPanel.width',
        ]) {
            expect(src, `expected no "${symbol}" in ChatDetail.tsx`).not.toContain(symbol);
        }
    });

    it('reads and writes no retired canvas preference', () => {
        expect(src).not.toContain('canvasClosedPreference');
        expect(src).not.toContain('readCanvasClosed');
        expect(src).not.toContain('writeCanvasClosed');
    });

    it('routes AI canvas updates to the shared panel only', () => {
        expect(src).toContain('routeUnifiedCanvasUpdate');
        // A background chat (no host) still refreshes an already-mounted view,
        // but opens nothing.
        expect(src).toContain('publishUnifiedCanvasEvent');
    });

    it('publishes the chat’s canvas actions for the shared panel’s tab', () => {
        expect(src).toContain('publishUnifiedChatCanvasActions');
        expect(src).toContain('withdrawUnifiedChatCanvasActions');
    });
});

describe('ChatDetail — open source/diff view restore wiring', () => {
    it('imports the open-view memory helper', () => {
        expect(src).toContain("from './openCanvasMemory'");
        expect(src).toContain('deriveOpenCanvasMemory');
    });

    it('holds the memory in an in-memory ref map keyed by pid (not state/storage)', () => {
        expect(src).toContain('openCanvasMemoryRef = useRef<Map<string, OpenCanvasMemory>>(new Map())');
        expect(src).toContain('openCanvasDescriptorRef = useRef<OpenCanvasMemory>(null)');
        // Writes go through the ref map's `.set`, never persistence helpers.
        expect(src).toContain('openCanvasMemoryRef.current.set(pid, openCanvasDescriptorRef.current)');
    });

    it('the reset closes source/folder/note/diff views only WITH a restore path', () => {
        expect(src).toContain('sourceCanvas.close()');
        expect(src).toContain('whisperDiff.close()');
        expect(src).toContain('sourceCanvas.open(remembered.fileRef)');
        expect(src).toContain('whisperDiff.open(remembered.ctx)');
    });

    it('models only the source and whisper-diff views — AI canvases are panel tabs', () => {
        expect(memorySrc).toContain("kind: 'source'");
        expect(memorySrc).toContain("kind: 'whisper-diff'");
        expect(memorySrc).not.toContain("kind: 'agent'");
        expect(memorySrc).not.toContain('activeCanvasId');
        expect(memorySrc).not.toContain('canvasPanelClosed');
    });

    it('never persists the open-view memory to localStorage or disk', () => {
        // The memory helper is pure in-memory: no storage-API CALLS anywhere in
        // it (the doc comment may mention "localStorage" in prose, so match the
        // `.`-qualified API usage rather than the bare word).
        expect(memorySrc).not.toContain('localStorage.');
        expect(memorySrc).not.toContain('sessionStorage.');
        expect(memorySrc).not.toContain('setItem');
        expect(memorySrc).not.toContain('getItem');
    });

    it('leaves no new TODOs in the open-view memory module', () => {
        expect(memorySrc).not.toContain('TODO');
    });
});
