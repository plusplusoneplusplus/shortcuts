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

    it('registers the three canvas tool names', () => {
        const { create, update, read } = buildTools();
        expect(create.name).toBe('create_canvas');
        expect(update.name).toBe('update_canvas');
        expect(read.name).toBe('read_canvas');
    });

    describe('create_canvas', () => {
        it('creates a canvas linked to the process and emits an SSE event', async () => {
            const { create } = buildTools();
            const result = await create.handler({ title: 'Spec', content: '# Spec' }) as any;

            expect(result.success).toBe(true);
            expect(result.revision).toBe(1);

            const persisted = store.getCanvas(WS, result.canvasId);
            expect(persisted?.content).toBe('# Spec');
            expect(persisted?.processId).toBe(PROCESS_ID);

            expect(emitProcessEvent).toHaveBeenCalledWith(PROCESS_ID, expect.objectContaining({
                type: 'canvas-updated',
                canvasUpdate: expect.objectContaining({ canvasId: result.canvasId, revision: 1, editor: 'ai' }),
            }));
        });

        it('rejects missing title or content', async () => {
            const { create } = buildTools();
            expect(((await create.handler({ content: 'x' } as any)) as any).success).toBe(false);
            expect(((await create.handler({ title: 't' } as any)) as any).success).toBe(false);
        });
    });

    describe('update_canvas', () => {
        it('applies targeted edits with the expected revision and emits an SSE event', async () => {
            const { create, update } = buildTools();
            const created = await create.handler({ title: 'Doc', content: 'alpha beta' }) as any;
            emitProcessEvent.mockClear();

            const result = await update.handler({
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
            const { create, update } = buildTools();
            const created = await create.handler({ title: 'Doc', content: 'v1' }) as any;
            // Simulate a user edit bumping the revision
            store.updateCanvas(WS, created.canvasId, { content: 'v2 (user)', editor: 'user' });
            emitProcessEvent.mockClear();

            const result = await update.handler({
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

        it('returns an error for an unknown canvas', async () => {
            const { update } = buildTools();
            const result = await update.handler({ canvasId: 'missing-000000', content: 'x' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });
    });

    describe('read_canvas', () => {
        it('returns content and revision', async () => {
            const { create, read } = buildTools();
            const created = await create.handler({ title: 'Doc', content: 'hello' }) as any;

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
        const { create } = createCanvasTools({ dataDir, workspaceId: WS, canvasStore: store });
        const result = await create.handler({ title: 'Doc', content: 'x' }) as any;
        expect(result.success).toBe(true);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });
});
