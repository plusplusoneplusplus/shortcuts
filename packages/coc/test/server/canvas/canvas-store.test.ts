import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasStore, generateCanvasId, isValidCanvasId } from '../../../src/server/canvas/canvas-store';

const WS = 'test-workspace';

describe('CanvasStore', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-store-'));
        store = new CanvasStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    describe('createCanvas', () => {
        it('creates a markdown canvas at revision 1 with descriptor and artifact on disk', () => {
            const canvas = store.createCanvas({
                workspaceId: WS,
                title: 'Auth migration plan',
                content: '# Plan\n\nStep 1',
                processId: 'proc-1',
            });

            expect(canvas.revision).toBe(1);
            expect(canvas.type).toBe('markdown');
            expect(canvas.title).toBe('Auth migration plan');
            expect(canvas.processId).toBe('proc-1');
            expect(canvas.lastEditor).toBe('ai');
            expect(canvas.content).toBe('# Plan\n\nStep 1');

            const dir = path.join(dataDir, 'repos', WS, 'canvases', canvas.id);
            expect(fs.existsSync(path.join(dir, 'canvas.json'))).toBe(true);
            expect(fs.readFileSync(path.join(dir, 'artifact.md'), 'utf-8')).toBe('# Plan\n\nStep 1');
        });

        it('derives a slug id from the title', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Hello World!', content: 'x' });
            expect(canvas.id).toMatch(/^hello-world-[0-9a-f]{6}$/);
        });
    });

    describe('getCanvas', () => {
        it('round-trips a created canvas', () => {
            const created = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'body' });
            const loaded = store.getCanvas(WS, created.id);
            expect(loaded).toEqual(created);
        });

        it('returns null for missing or invalid ids', () => {
            expect(store.getCanvas(WS, 'nope-000000')).toBeNull();
            expect(store.getCanvas(WS, '../escape')).toBeNull();
            expect(store.getCanvas(WS, '')).toBeNull();
        });
    });

    describe('listCanvases', () => {
        it('lists descriptors without content, newest first', () => {
            const a = store.createCanvas({ workspaceId: WS, title: 'A', content: 'aaa' });
            const b = store.createCanvas({ workspaceId: WS, title: 'B', content: 'bbb' });
            // Make B strictly newer
            store.updateCanvas(WS, b.id, { content: 'bbb2', editor: 'ai' });

            const list = store.listCanvases(WS);
            expect(list.map(c => c.id)).toContain(a.id);
            expect(list[0].id).toBe(b.id);
            expect((list[0] as Record<string, unknown>).content).toBeUndefined();
        });

        it('filters by processId', () => {
            store.createCanvas({ workspaceId: WS, title: 'A', content: 'a', processId: 'p1' });
            const b = store.createCanvas({ workspaceId: WS, title: 'B', content: 'b', processId: 'p2' });

            const list = store.listCanvases(WS, { processId: 'p2' });
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe(b.id);
        });

        it('returns empty list for a workspace with no canvases', () => {
            expect(store.listCanvases('other-ws')).toEqual([]);
        });
    });

    describe('updateCanvas', () => {
        it('replaces full content and bumps the revision', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'old' });
            const result = store.updateCanvas(WS, c.id, { content: 'new', editor: 'user', expectedRevision: 1 });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.canvas.content).toBe('new');
                expect(result.canvas.revision).toBe(2);
                expect(result.canvas.lastEditor).toBe('user');
            }
        });

        it('applies targeted edits in order', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'one two three' });
            const result = store.updateCanvas(WS, c.id, {
                edits: [
                    { oldText: 'two', newText: '2' },
                    { oldText: 'one 2', newText: '1 2' },
                ],
                editor: 'ai',
            });
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.canvas.content).toBe('1 2 three');
        });

        it('returns a revision conflict when expectedRevision is stale', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
            store.updateCanvas(WS, c.id, { content: 'v2', editor: 'user' });

            const result = store.updateCanvas(WS, c.id, { content: 'v3', editor: 'ai', expectedRevision: 1 });
            expect(result).toEqual({ ok: false, reason: 'revision-conflict', currentRevision: 2 });
            expect(store.getCanvas(WS, c.id)!.content).toBe('v2');
        });

        it('rejects an edit whose oldText is missing', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'abc' });
            const result = store.updateCanvas(WS, c.id, { edits: [{ oldText: 'zzz', newText: 'y' }], editor: 'ai' });
            expect(result.ok).toBe(false);
            if (!result.ok && result.reason === 'edit-mismatch') {
                expect(result.error).toContain('not found');
            } else {
                expect.unreachable('expected edit-mismatch');
            }
        });

        it('rejects an edit whose oldText is ambiguous', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'dup dup' });
            const result = store.updateCanvas(WS, c.id, { edits: [{ oldText: 'dup', newText: 'x' }], editor: 'ai' });
            expect(result.ok).toBe(false);
            if (!result.ok && result.reason === 'edit-mismatch') {
                expect(result.error).toContain('more than once');
            } else {
                expect.unreachable('expected edit-mismatch');
            }
        });

        it('updates the title alone', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Old title', content: 'body' });
            const result = store.updateCanvas(WS, c.id, { title: 'New title', editor: 'user' });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.canvas.title).toBe('New title');
                expect(result.canvas.content).toBe('body');
                expect(result.canvas.revision).toBe(2);
            }
        });

        it('returns not-found for a missing canvas', () => {
            const result = store.updateCanvas(WS, 'missing-000000', { content: 'x', editor: 'ai' });
            expect(result).toEqual({ ok: false, reason: 'not-found' });
        });

        it('rejects an update with no changes', () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'body' });
            const result = store.updateCanvas(WS, c.id, { editor: 'user' });
            expect(result.ok).toBe(false);
        });
    });
});

describe('canvas id helpers', () => {
    it('generateCanvasId produces valid filesystem-safe ids', () => {
        expect(isValidCanvasId(generateCanvasId('Hello World'))).toBe(true);
        expect(isValidCanvasId(generateCanvasId('!!!'))).toBe(true);
        expect(generateCanvasId('!!!')).toMatch(/^canvas-[0-9a-f]{6}$/);
    });

    it('isValidCanvasId rejects traversal and separators', () => {
        expect(isValidCanvasId('../x')).toBe(false);
        expect(isValidCanvasId('a/b')).toBe(false);
        expect(isValidCanvasId('a\\b')).toBe(false);
        expect(isValidCanvasId('UPPER')).toBe(false);
        expect(isValidCanvasId('ok-id-123')).toBe(true);
    });
});
