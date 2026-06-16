import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasStore, MAX_CANVAS_VERSIONS, generateCanvasId, isValidCanvasId } from '../../../src/server/canvas/canvas-store';

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

        it('creates code canvases with a normalized language', () => {
            const canvas = store.createCanvas({
                workspaceId: WS,
                title: 'Parser',
                content: 'def parse(): pass',
                type: 'code',
                language: ' Python ',
            });
            expect(canvas.type).toBe('code');
            expect(canvas.language).toBe('python');

            const reloaded = store.getCanvas(WS, canvas.id);
            expect(reloaded?.type).toBe('code');
            expect(reloaded?.language).toBe('python');
        });

        it('drops unusable language hints and ignores language for markdown', () => {
            const code = store.createCanvas({ workspaceId: WS, title: 'X', content: 'x', type: 'code', language: 'not a language!!' });
            expect(code.language).toBeUndefined();

            const md = store.createCanvas({ workspaceId: WS, title: 'Y', content: 'y', language: 'python' });
            expect(md.type).toBe('markdown');
            expect(md.language).toBeUndefined();
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

        it('orders the most recently touched canvas first when updatedAt timestamps collide', () => {
            // Freeze the clock so every createdAt/updatedAt is byte-identical — the
            // millisecond collision that made ordering flaky when it relied on the
            // timestamp string alone. The monotonic per-store seq must still place
            // the most recently touched canvas first.
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
            try {
                const a = store.createCanvas({ workspaceId: WS, title: 'A', content: 'aaa' });
                const b = store.createCanvas({ workspaceId: WS, title: 'B', content: 'bbb' });
                // Touch A last; it must sort ahead of the more recently created B
                // even though both carry the same updatedAt timestamp.
                const updated = store.updateCanvas(WS, a.id, { content: 'aaa2', editor: 'ai' });

                expect(updated.ok).toBe(true);
                expect(a.updatedAt).toBe(b.updatedAt); // the tie is real

                const list = store.listCanvases(WS);
                expect(list.map(c => c.id)).toEqual([a.id, b.id]);
            } finally {
                vi.useRealTimers();
            }
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

describe('version snapshots', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-versions-'));
        store = new CanvasStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('snapshots every revision and lists them newest first', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        store.updateCanvas(WS, c.id, { content: 'v2', editor: 'user' });
        store.updateCanvas(WS, c.id, { content: 'v3', editor: 'ai' });

        const versions = store.listVersions(WS, c.id);
        expect(versions.map(v => v.revision)).toEqual([3, 2, 1]);
        expect(versions[0].editor).toBe('ai');
        expect((versions[0] as Record<string, unknown>).content).toBeUndefined();
    });

    it('returns full historical content via getVersion', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        store.updateCanvas(WS, c.id, { content: 'v2', editor: 'user' });

        expect(store.getVersion(WS, c.id, 1)?.content).toBe('v1');
        expect(store.getVersion(WS, c.id, 2)?.content).toBe('v2');
        expect(store.getVersion(WS, c.id, 99)).toBeNull();
        expect(store.getVersion(WS, c.id, 0)).toBeNull();
    });

    it('prunes snapshots beyond the retention cap', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        for (let i = 2; i <= MAX_CANVAS_VERSIONS + 3; i++) {
            store.updateCanvas(WS, c.id, { content: `v${i}`, editor: 'ai' });
        }

        const versions = store.listVersions(WS, c.id);
        expect(versions).toHaveLength(MAX_CANVAS_VERSIONS);
        expect(versions[0].revision).toBe(MAX_CANVAS_VERSIONS + 3);
        expect(store.getVersion(WS, c.id, 1)).toBeNull();
        expect(store.getVersion(WS, c.id, 3)).toBeNull();
        expect(store.getVersion(WS, c.id, 4)).not.toBeNull();
    });

    it('returns empty version list for unknown canvases', () => {
        expect(store.listVersions(WS, 'missing-000000')).toEqual([]);
        expect(store.listVersions(WS, '../escape')).toEqual([]);
    });
});

describe('comments', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-comments-'));
        store = new CanvasStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('adds and lists open comments anchored to text', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'alpha beta' });
        const comment = store.addComment(WS, c.id, { anchorText: 'alpha', body: 'rename this' });

        expect(comment).not.toBeNull();
        expect(comment!.status).toBe('open');

        const listed = store.listComments(WS, c.id);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toEqual(comment);
    });

    it('refuses comments on unknown canvases', () => {
        expect(store.addComment(WS, 'missing-000000', { anchorText: 'a', body: 'b' })).toBeNull();
    });

    it('filters by status and transitions open -> sent -> resolved', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'text' });
        const comment = store.addComment(WS, c.id, { anchorText: 'text', body: 'fix' })!;

        expect(store.setCommentStatus(WS, c.id, comment.id, 'sent')?.status).toBe('sent');
        expect(store.listComments(WS, c.id, { status: 'open' })).toHaveLength(0);
        expect(store.listComments(WS, c.id, { status: 'sent' })).toHaveLength(1);

        expect(store.setCommentStatus(WS, c.id, comment.id, 'resolved')?.status).toBe('resolved');
        expect(store.setCommentStatus(WS, c.id, 'missing', 'sent')).toBeNull();
    });

    it('deletes comments', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'text' });
        const comment = store.addComment(WS, c.id, { anchorText: 'text', body: 'fix' })!;

        expect(store.deleteComment(WS, c.id, comment.id)).toBe(true);
        expect(store.deleteComment(WS, c.id, comment.id)).toBe(false);
        expect(store.listComments(WS, c.id)).toHaveLength(0);
    });

    it('truncates oversized anchors and bodies', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'text' });
        const comment = store.addComment(WS, c.id, { anchorText: 'x'.repeat(2000), body: 'y'.repeat(10000) })!;
        expect(comment.anchorText.length).toBe(500);
        expect(comment.body.length).toBe(4000);
    });
});

describe('extension canvases', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-ext-'));
        store = new CanvasStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const EXTENSION = {
        manifest: { description: 'Kanban', capabilities: [{ name: 'add_card', description: 'Add a card' }] },
        uiHtml: '<div>board</div>',
        capabilitiesJs: 'capabilities = { add_card: function (s) { return s; } };',
    };

    it('creates an extension canvas and round-trips its documents', () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Board', content: '{}', type: 'extension' });
        expect(canvas.type).toBe('extension');

        const updated = store.saveExtension(WS, canvas.id, EXTENSION, 'ai');
        expect(updated).not.toBeNull();
        expect(updated!.revision).toBe(2);

        const loaded = store.getExtension(WS, canvas.id);
        expect(loaded).toEqual(EXTENSION);
    });

    it('refuses saveExtension on a non-extension canvas', () => {
        const md = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'hi' });
        expect(store.saveExtension(WS, md.id, EXTENSION, 'ai')).toBeNull();
    });

    it('returns null extension documents before they are written', () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Board', content: '{}', type: 'extension' });
        expect(store.getExtension(WS, canvas.id)).toBeNull();
        expect(store.getExtension(WS, 'missing-000000')).toBeNull();
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
