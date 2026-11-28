import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { LLM_TOOL_REGISTRY } from '../../../src/server/llm-tools/llm-tool-registry';
import { createCanvasTools } from '../../../src/server/llm-tools/canvas-tools';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';

const WS = 'tool-workspace';
const PROCESS_ID = 'proc-42';

describe('canvas LLM tools', () => {
    let dataDir: string;
    let store: CanvasStore;
    let emitProcessEvent: ReturnType<typeof vi.fn>;
    let processStore: ProcessStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-tools-'));
        store = new CanvasStore(dataDir);
        emitProcessEvent = vi.fn();
        processStore = { emitProcessEvent } as unknown as ProcessStore;
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function buildTools() {
        return createCanvasTools({
            dataDir,
            workspaceId: WS,
            processId: PROCESS_ID,
            processStore,
            canvasStore: store,
        });
    }

    it('preserves the Kusto kind when write_canvas edits an existing query result', async () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Query', type: 'kusto', content: '{}', processId: PROCESS_ID });
        const result: any = await buildTools().write.handler({ canvasId: canvas.id, expectedRevision: canvas.revision, title: 'Renamed query' });
        expect(result.success).toBe(true);
        expect(emitProcessEvent).toHaveBeenCalledWith(PROCESS_ID, expect.objectContaining({
            canvasUpdate: expect.objectContaining({ canvasId: canvas.id, canvasType: 'kusto' }),
        }));
    });

    it('registers ordinary canvas tools independently of extensions', () => {
        const { write, read } = buildTools();
        expect(write.name).toBe('write_canvas');
        expect(read.name).toBe('read_canvas');
    });

    describe('write_canvas — create', () => {
        it('creates a canvas linked to the process and emits an SSE event', async () => {
            const { write } = buildTools();
            const result = await write.handler({ title: 'Spec', content: '# Spec' }) as any;

            expect(result.success).toBe(true);
            expect(result.created).toBe(true);
            expect(result.revision).toBe(1);

            const persisted = store.getCanvas(WS, result.canvasId);
            expect(persisted?.content).toBe('# Spec');
            expect(persisted?.processId).toBe(PROCESS_ID);

            expect(emitProcessEvent).toHaveBeenCalledWith(PROCESS_ID, expect.objectContaining({
                type: 'canvas-updated',
                canvasUpdate: expect.objectContaining({ canvasId: result.canvasId, revision: 1, editor: 'ai' }),
            }));
        });

        it('rejects create without title or content', async () => {
            const { write } = buildTools();
            expect(((await write.handler({ content: 'x' } as any)) as any).success).toBe(false);
            expect(((await write.handler({ title: 't' } as any)) as any).success).toBe(false);
        });

        it('creates a code canvas with a language', async () => {
            const { write } = buildTools();
            const result = await write.handler({
                title: 'Parser',
                content: 'def parse(): pass',
                type: 'code',
                language: 'python',
            }) as any;

            expect(result.success).toBe(true);
            expect(result.type).toBe('code');
            expect(result.language).toBe('python');
            expect(store.getCanvas(WS, result.canvasId)?.language).toBe('python');
        });

        it('creates an SVG code canvas and persists it with language "svg" (AC-05)', async () => {
            const { write } = buildTools();
            const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="green"/></svg>';
            const result = await write.handler({
                title: 'Circle',
                content: svgContent,
                type: 'code',
                language: 'svg',
            }) as any;

            expect(result.success).toBe(true);
            expect(result.type).toBe('code');
            expect(result.language).toBe('svg');

            const persisted = store.getCanvas(WS, result.canvasId);
            expect(persisted?.type).toBe('code');
            expect(persisted?.language).toBe('svg');
            expect(persisted?.content).toBe(svgContent);
        });

        it('rejects an unknown canvas type', async () => {
            const { write } = buildTools();
            const result = await write.handler({ title: 'X', content: 'x', type: 'webview' } as any) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('type');
        });

        it('persists a declared purpose on the canvas descriptor', async () => {
            const { write } = buildTools();
            const result = await write.handler({ title: 'Plan', content: '# Plan', purpose: 'plan' }) as any;

            expect(result.success).toBe(true);
            expect(store.getCanvas(WS, result.canvasId)?.purpose).toBe('plan');
        });
    });

    describe('write_canvas — update', () => {
        it('applies targeted edits with the expected revision and emits an SSE event', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'alpha beta' }) as any;
            emitProcessEvent.mockClear();

            const result = await write.handler({
                canvasId: created.canvasId,
                edits: [{ oldText: 'beta', newText: 'gamma' }],
                expectedRevision: 1,
            }) as any;

            expect(result.success).toBe(true);
            expect(result.revision).toBe(2);
            expect(store.getCanvas(WS, created.canvasId)?.content).toBe('alpha gamma');
            expect(emitProcessEvent).toHaveBeenCalledTimes(1);
        });

        it('reports a revision conflict and tells the model to re-read', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'v1' }) as any;
            // Simulate a user edit bumping the revision
            store.updateCanvas(WS, created.canvasId, { content: 'v2 (user)', editor: 'user' });
            emitProcessEvent.mockClear();

            const result = await write.handler({
                canvasId: created.canvasId,
                content: 'v2 (ai)',
                expectedRevision: 1,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.currentRevision).toBe(2);
            expect(result.error).toContain('read_canvas');
            expect(store.getCanvas(WS, created.canvasId)?.content).toBe('v2 (user)');
            expect(emitProcessEvent).not.toHaveBeenCalled();
        });

        it('returns an error updating an unknown canvas', async () => {
            const { write } = buildTools();
            const result = await write.handler({ canvasId: 'missing-000000', content: 'x' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('rejects an update with no edits, content, or title', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'v1' }) as any;
            const result = await write.handler({ canvasId: created.canvasId } as any) as any;
            expect(result.success).toBe(false);
        });
    });

    describe('write_canvas — excalidraw', () => {
        const SKELETON_SCENE = JSON.stringify({
            type: 'excalidraw',
            elements: [{ id: 'box1', type: 'rectangle', x: 0, y: 0, width: 120, height: 60 }],
            appState: { viewBackgroundColor: '#ffffff' },
        });

        it('creates an excalidraw canvas and persists a normalized complete scene', async () => {
            const { write, read } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;

            expect(created.success).toBe(true);
            expect(created.type).toBe('excalidraw');
            expect(store.getCanvas(WS, created.canvasId)?.type).toBe('excalidraw');

            const result = await read.handler({ canvasId: created.canvasId }) as any;
            expect(result.success).toBe(true);
            const scene = JSON.parse(result.content);
            expect(Array.isArray(scene.elements)).toBe(true);
            expect(typeof scene.appState).toBe('object');
            // Skeleton element completed with Excalidraw bookkeeping fields.
            const el = scene.elements[0];
            expect(el.id).toBe('box1');
            expect(el.isDeleted).toBe(false);
            expect(el.groupIds).toEqual([]);
            expect(typeof el.versionNonce).toBe('number');
            expect(typeof el.seed).toBe('number');
            // read_canvas flags excalidraw canvases so the model uses full rewrites.
            expect(result.note).toMatch(/scene JSON/i);
        });

        it('rejects targeted edits on an excalidraw canvas with a clear error', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;

            const result = await write.handler({
                canvasId: created.canvasId,
                edits: [{ oldText: 'rectangle', newText: 'ellipse' }],
                expectedRevision: 1,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/excalidraw/i);
            expect(result.error).toMatch(/full scene|content|rewrite/i);
            // Unchanged on disk.
            expect(store.getCanvas(WS, created.canvasId)?.revision).toBe(1);
        });

        it('normalizes a full-scene content rewrite on update', async () => {
            const { write, read } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;

            const next = JSON.stringify({
                elements: [{ id: 'circle1', type: 'ellipse', x: 10, y: 10, width: 40, height: 40 }],
                appState: {},
            });
            const updated = await write.handler({
                canvasId: created.canvasId,
                content: next,
                expectedRevision: 1,
            }) as any;

            expect(updated.success).toBe(true);
            expect(updated.revision).toBe(2);
            const scene = JSON.parse(store.getCanvas(WS, created.canvasId)!.content);
            expect(scene.elements[0].id).toBe('circle1');
            expect(scene.elements[0].isDeleted).toBe(false);
        });

        it('returns a canvas:// embed marker on create and update', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;
            expect(created.embed).toBe(`canvas://${created.canvasId}`);

            const updated = await write.handler({
                canvasId: created.canvasId,
                content: JSON.stringify({ elements: [], appState: {} }),
                expectedRevision: 1,
            }) as any;
            expect(updated.success).toBe(true);
            expect(updated.embed).toBe(`canvas://${created.canvasId}`);
        });

        it('does not return an embed marker for non-excalidraw canvases', async () => {
            const { write } = buildTools();
            const md = await write.handler({ title: 'Doc', content: '# hi' }) as any;
            expect(md.embed).toBeUndefined();
        });

        it('rejects an invalid scene on create', async () => {
            const { write } = buildTools();
            const badJson = await write.handler({ title: 'Bad', content: '{ not json', type: 'excalidraw' }) as any;
            expect(badJson.success).toBe(false);

            const notArray = await write.handler({
                title: 'Bad2',
                content: JSON.stringify({ elements: 'nope', appState: {} }),
                type: 'excalidraw',
            }) as any;
            expect(notArray.success).toBe(false);
            expect(notArray.error).toMatch(/elements/i);
        });
    });

    describe('read_canvas', () => {
        it('returns content and revision', async () => {
            const { write, read } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'hello' }) as any;

            const result = await read.handler({ canvasId: created.canvasId }) as any;
            expect(result).toMatchObject({
                success: true,
                canvasId: created.canvasId,
                title: 'Doc',
                revision: 1,
                content: 'hello',
            });
        });

        it('returns an error for an unknown canvas', async () => {
            const { read } = buildTools();
            const result = await read.handler({ canvasId: 'missing-000000' }) as any;
            expect(result.success).toBe(false);
        });
    });

    it('does not emit SSE events when process context is missing', async () => {
        const { write } = createCanvasTools({ dataDir, workspaceId: WS, canvasStore: store });
        const result = await write.handler({ title: 'Doc', content: 'x' }) as any;
        expect(result.success).toBe(true);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });
});
