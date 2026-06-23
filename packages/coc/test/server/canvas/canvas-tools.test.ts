import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
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

    it('registers three consolidated canvas tool names', () => {
        const { write, read, extension } = buildTools();
        expect(write.name).toBe('write_canvas');
        expect(read.name).toBe('read_canvas');
        expect(extension.name).toBe('extension_canvas');
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

    describe('extension_canvas', () => {
        const BUILD_ARGS = {
            title: 'Kanban',
            description: 'A simple board',
            capabilities: [{ name: 'add_card', description: 'Add a card' }],
            capabilitiesJs: 'capabilities = { add_card: function (s, p) { var c = (s.cards||[]).slice(); c.push({ id: p.id, title: p.title }); return { cards: c }; } };',
            uiHtml: '<div id="board"></div>',
            initialState: { cards: [] },
        };

        it('builds an extension canvas with documents and links it to the process', async () => {
            const { extension } = buildTools();
            const result = await extension.handler(BUILD_ARGS as any) as any;

            expect(result.success).toBe(true);
            expect(result.created).toBe(true);

            const canvas = store.getCanvas(WS, result.canvasId);
            expect(canvas?.type).toBe('extension');
            expect(canvas?.processId).toBe(PROCESS_ID);
            const ext = store.getExtension(WS, result.canvasId);
            expect(ext?.manifest.capabilities[0].name).toBe('add_card');
            expect(emitProcessEvent).toHaveBeenCalled();
        });

        it('updates extension documents without resetting state', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;
            await extension.handler({ canvasId: created.canvasId, capability: 'add_card', params: { id: 'c1', title: 'A' } } as any);

            const updated = await extension.handler({
                canvasId: created.canvasId,
                description: 'Updated board',
                capabilities: [{ name: 'add_card', description: 'Add a card' }, { name: 'clear', description: 'Clear' }],
                capabilitiesJs: 'capabilities = { add_card: function (s) { return s; }, clear: function () { return { cards: [] }; } };',
                uiHtml: '<div id="board2"></div>',
            } as any) as any;

            expect(updated.success).toBe(true);
            expect(updated.updated).toBe(true);
            // State preserved across the extension-document update
            expect(JSON.parse(store.getCanvas(WS, created.canvasId)!.content).cards).toHaveLength(1);
            expect(store.getExtension(WS, created.canvasId)?.uiHtml).toBe('<div id="board2"></div>');
        });

        it('rejects malformed build input', async () => {
            const { extension } = buildTools();
            const noCapName = await extension.handler({ ...BUILD_ARGS, capabilities: [{ name: 'Bad Name', description: 'x' }] } as any) as any;
            expect(noCapName.success).toBe(false);

            const noUi = await extension.handler({ ...BUILD_ARGS, uiHtml: '' } as any) as any;
            expect(noUi.success).toBe(false);
        });

        it('runs a capability and returns the new state', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;
            emitProcessEvent.mockClear();

            const result = await extension.handler({
                canvasId: created.canvasId,
                capability: 'add_card',
                params: { id: 'c1', title: 'First' },
            } as any) as any;

            expect(result.success).toBe(true);
            expect(JSON.parse(result.state).cards).toEqual([{ id: 'c1', title: 'First' }]);
            expect(emitProcessEvent).toHaveBeenCalledTimes(1);
        });

        it('requires a canvasId to run a capability', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({ capability: 'add_card' } as any) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('canvasId');
        });

        it('surfaces capability errors and an unknown extension canvas', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;

            const badCap = await extension.handler({ canvasId: created.canvasId, capability: 'nope' } as any) as any;
            expect(badCap.success).toBe(false);

            const missing = await extension.handler({ canvasId: 'missing-000000', capability: 'add_card' } as any) as any;
            expect(missing.success).toBe(false);
        });

        it('read_canvas returns the manifest for extension canvases', async () => {
            const { extension, read } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;

            const result = await read.handler({ canvasId: created.canvasId } as any) as any;
            expect(result.success).toBe(true);
            expect(result.type).toBe('extension');
            expect(result.extensionManifest.capabilities[0].name).toBe('add_card');
        });
    });

    it('does not emit SSE events when process context is missing', async () => {
        const { write } = createCanvasTools({ dataDir, workspaceId: WS, canvasStore: store });
        const result = await write.handler({ title: 'Doc', content: 'x' }) as any;
        expect(result.success).toBe(true);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });
});
