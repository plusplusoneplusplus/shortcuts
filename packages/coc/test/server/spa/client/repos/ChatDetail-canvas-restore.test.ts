/**
 * @vitest-environment node
 *
 * Source-level regression guard for the session-scoped per-chat open-canvas
 * memory (restore-open-canvas-on-chat-switch). Runs in node, so it asserts on
 * the ChatDetail / openCanvasMemory source text rather than behaviour — the
 * jsdom integration test in `test/spa/react/repos/ChatDetailCanvasClosed.test.tsx`
 * covers the runtime flow.
 *
 * Invariants guarded here (mirrors the goal's code-search Definition of Done):
 *  - The open-canvas memory helper is imported and held in an in-memory ref map.
 *  - The chat-switch effect restores a remembered source / whisper / agent canvas.
 *  - The reset closes source/folder/note/diff canvases only WITH a restore path.
 *  - The memory store is NEVER persisted to localStorage or disk.
 *  - No new TODOs were left behind.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const chatDir = resolve(__dirname, '../../../../../src/server/spa/client/react/features/chat');
const src = readFileSync(resolve(chatDir, 'ChatDetail.tsx'), 'utf-8');
const memorySrc = readFileSync(resolve(chatDir, 'openCanvasMemory.ts'), 'utf-8');

describe('ChatDetail — open-canvas restore wiring', () => {
    it('imports the open-canvas memory helper', () => {
        expect(src).toContain("from './openCanvasMemory'");
        expect(src).toContain('deriveOpenCanvasMemory');
    });

    it('holds the memory in an in-memory ref map keyed by pid (not state/storage)', () => {
        expect(src).toContain('openCanvasMemoryRef = useRef<Map<string, OpenCanvasMemory>>(new Map())');
        expect(src).toContain('openCanvasDescriptorRef = useRef<OpenCanvasMemory>(null)');
        // Writes go through the ref map's `.set`, never persistence helpers.
        expect(src).toContain('openCanvasMemoryRef.current.set(pid, openCanvasDescriptorRef.current)');
    });

    it('restores a remembered source / whisper / agent canvas on chat switch', () => {
        expect(src).toContain('sourceCanvas.open(remembered.fileRef)');
        expect(src).toContain('whisperDiff.open(remembered.ctx)');
        // The agent canvas is restored by id through the discovery callback.
        expect(src).toContain('remembered.canvasId');
    });

    it('silently falls back when a remembered agent canvas was deleted', () => {
        // Discovery validates the remembered id against the linked-canvas list and
        // only restores it when present — a deleted one falls back instead of
        // surfacing CanvasPanel's load error (AC-03 silent fallback).
        expect(src).toContain('ids.has(remembered.canvasId)');
    });

    it('the reset closes source/folder/note/diff canvases only WITH a restore path', () => {
        // The switch effect both clears the previous surfaces AND reopens the
        // remembered one — there is no orphan close without a restore path.
        expect(src).toContain('sourceCanvas.close()');
        expect(src).toContain('whisperDiff.close()');
        expect(src).toContain('sourceCanvas.open(remembered.fileRef)');
        expect(src).toContain('whisperDiff.open(remembered.ctx)');
    });

    it('never persists the open-canvas memory to localStorage or disk', () => {
        // The memory helper is pure in-memory: no storage-API CALLS anywhere in
        // it (the doc comment may mention "localStorage" in prose, so match the
        // `.`-qualified API usage rather than the bare word).
        expect(memorySrc).not.toContain('localStorage.');
        expect(memorySrc).not.toContain('sessionStorage.');
        expect(memorySrc).not.toContain('setItem');
        expect(memorySrc).not.toContain('getItem');
    });

    it('leaves no new TODOs in the open-canvas memory module', () => {
        expect(memorySrc).not.toContain('TODO');
    });
});
