import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CanvasStore,
    MAX_CANVAS_VERSIONS,
    MAX_CANVAS_FILE_ENTRIES,
    MAX_CANVAS_TEXT_FILE_BYTES,
    generateCanvasId,
    isValidCanvasId,
    isSafeCanvasFilePath,
} from '../../../src/server/canvas/canvas-store';

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

        it('persists a trimmed purpose and survives a reload', () => {
            const canvas = store.createCanvas({
                workspaceId: WS,
                title: 'Plan',
                content: '# Plan',
                purpose: '  plan  ',
            });
            expect(canvas.purpose).toBe('plan');

            const reloaded = store.getCanvas(WS, canvas.id);
            expect(reloaded?.purpose).toBe('plan');

            // Descriptor on disk carries the purpose (survives server restart).
            const descriptorPath = path.join(dataDir, 'repos', WS, 'canvases', canvas.id, 'canvas.json');
            const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf-8'));
            expect(descriptor.purpose).toBe('plan');
        });

        it('omits purpose when missing or blank', () => {
            const none = store.createCanvas({ workspaceId: WS, title: 'A', content: 'a' });
            expect(none.purpose).toBeUndefined();

            const blank = store.createCanvas({ workspaceId: WS, title: 'B', content: 'b', purpose: '   ' });
            expect(blank.purpose).toBeUndefined();
        });

        it('preserves purpose across an update', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'v1', purpose: 'plan' });
            const updated = store.updateCanvas(WS, canvas.id, { content: 'v2', editor: 'ai', expectedRevision: 1 });
            expect(updated.ok).toBe(true);
            if (updated.ok) expect(updated.canvas.purpose).toBe('plan');
            expect(store.getCanvas(WS, canvas.id)?.purpose).toBe('plan');
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

    // --- JSX-authored extensions (ui.js / ui.jsx) --------------------------

    const JSX_EXTENSION = {
        manifest: {
            description: 'Chart',
            capabilities: [{ name: 'refresh', description: 'Refresh' }],
            libraries: ['react', 'recharts'],
        },
        uiHtml: '',
        capabilitiesJs: 'capabilities = { refresh: function (s) { return s; } };',
        uiJs: 'window.CanvasExtension = { mount: function () {} };',
        uiJsx: 'window.CanvasExtension = { mount: () => <div /> };',
    };

    it('round-trips the ui.js / ui.jsx documents and the manifest libraries', () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Chart', content: '{}', type: 'extension' });
        expect(store.saveExtension(WS, canvas.id, JSX_EXTENSION, 'ai')).not.toBeNull();

        const loaded = store.getExtension(WS, canvas.id);
        expect(loaded).toEqual(JSX_EXTENSION);
        expect(loaded!.manifest.libraries).toEqual(['react', 'recharts']);
        // A JSX extension writes no ui.html at all — it must not shadow ui.js.
        const extDir = path.join(dataDir, 'repos', WS, 'canvases', canvas.id, 'extension');
        expect(fs.existsSync(path.join(extDir, 'ui.js'))).toBe(true);
        expect(fs.existsSync(path.join(extDir, 'ui.jsx'))).toBe(true);
        expect(fs.existsSync(path.join(extDir, 'ui.html'))).toBe(false);
    });

    it('loads a legacy ui.html-only extension unchanged, with no uiJs/uiJsx keys', () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Board', content: '{}', type: 'extension' });
        store.saveExtension(WS, canvas.id, EXTENSION, 'ai');

        const loaded = store.getExtension(WS, canvas.id);
        expect(loaded).toEqual(EXTENSION);
        expect(loaded).not.toHaveProperty('uiJs');
        expect(loaded).not.toHaveProperty('uiJsx');
    });

    it('removes the stale UI document when an extension switches authoring path', () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Chart', content: '{}', type: 'extension' });
        store.saveExtension(WS, canvas.id, JSX_EXTENSION, 'ai');

        // JSX → HTML: a leftover ui.js would keep winning over the new ui.html.
        store.saveExtension(WS, canvas.id, EXTENSION, 'ai');
        const backToHtml = store.getExtension(WS, canvas.id);
        expect(backToHtml).toEqual(EXTENSION);

        // HTML → JSX: the old ui.html must not linger either.
        store.saveExtension(WS, canvas.id, JSX_EXTENSION, 'ai');
        expect(store.getExtension(WS, canvas.id)).toEqual(JSX_EXTENSION);
    });

    it('returns null when the manifest exists but no UI document does', () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Board', content: '{}', type: 'extension' });
        store.saveExtension(WS, canvas.id, EXTENSION, 'ai');
        fs.unlinkSync(path.join(dataDir, 'repos', WS, 'canvases', canvas.id, 'extension', 'ui.html'));

        expect(store.getExtension(WS, canvas.id)).toBeNull();
    });
});

describe('excalidraw canvases inherit canvas features (AC-06)', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-excalidraw-'));
        store = new CanvasStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const scene = (boxId: string): string => JSON.stringify({
        type: 'excalidraw',
        elements: [{ id: boxId, type: 'rectangle', x: 0, y: 0, width: 100, height: 40 }],
        appState: { viewBackgroundColor: '#ffffff' },
    });

    it('writes a versions/<rev>.json snapshot on a second write', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw' });
        const result = store.updateCanvas(WS, c.id, { content: scene('box2'), editor: 'ai', expectedRevision: 1 });
        expect(result.ok).toBe(true);

        // The second write must drop a per-revision snapshot on disk, not just bump revision.
        const versionsDir = path.join(dataDir, 'repos', WS, 'canvases', c.id, 'versions');
        expect(fs.existsSync(path.join(versionsDir, '1.json'))).toBe(true);
        expect(fs.existsSync(path.join(versionsDir, '2.json'))).toBe(true);

        const v2 = JSON.parse(fs.readFileSync(path.join(versionsDir, '2.json'), 'utf-8'));
        expect(JSON.parse(v2.content).elements[0].id).toBe('box2');
        expect(store.listVersions(WS, c.id).map(v => v.revision)).toEqual([2, 1]);
        expect(store.getVersion(WS, c.id, 1)?.content).toBe(scene('box1'));
    });

    it('returns a revision conflict on a stale expectedRevision', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw' });
        store.updateCanvas(WS, c.id, { content: scene('box2'), editor: 'ai' }); // -> revision 2

        const stale = store.updateCanvas(WS, c.id, { content: scene('box3'), editor: 'ai', expectedRevision: 1 });
        expect(stale).toEqual({ ok: false, reason: 'revision-conflict', currentRevision: 2 });
        // Content unchanged by the rejected write.
        expect(JSON.parse(store.getCanvas(WS, c.id)!.content).elements[0].id).toBe('box2');
    });

    it('supports anchored comments on an excalidraw canvas', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw' });
        const comment = store.addComment(WS, c.id, { anchorText: 'box1', body: 'rename this box' });

        expect(comment).not.toBeNull();
        expect(comment!.status).toBe('open');
        expect(store.listComments(WS, c.id)).toHaveLength(1);
        expect(store.setCommentStatus(WS, c.id, comment!.id, 'resolved')?.status).toBe('resolved');
    });

    it('lists an excalidraw canvas filtered by processId', () => {
        const diagram = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw', processId: 'p-diagram' });
        store.createCanvas({ workspaceId: WS, title: 'Notes', content: '# notes', processId: 'p-other' });

        const list = store.listCanvases(WS, { processId: 'p-diagram' });
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(diagram.id);
        expect(list[0].type).toBe('excalidraw');
    });
});

describe('Kusto canvases persist state as content JSON (AC-01)', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-kusto-'));
        store = new CanvasStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const state = (query: string): string => JSON.stringify({
        query,
        clusterUrl: 'https://help.kusto.windows.net',
        database: 'Samples',
        columns: [{ name: 'State', type: 'string' }],
        rows: [['TEXAS'], ['KANSAS']],
        truncated: false,
        lastRun: { timestamp: '2026-07-18T00:00:00.000Z', status: 'success', rowCount: 2 },
    });

    it('creates a Kusto canvas of type "kusto"', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Storms', content: state('StormEvents | take 2'), type: 'kusto' });
        expect(c.type).toBe('kusto');
        expect(JSON.parse(c.content).query).toBe('StormEvents | take 2');
    });

    it('survives a reload (fresh store instance) with state intact', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Storms', content: state('StormEvents | take 2'), type: 'kusto' });
        const reloaded = new CanvasStore(dataDir).getCanvas(WS, c.id);
        expect(reloaded?.type).toBe('kusto');
        expect(JSON.parse(reloaded!.content).database).toBe('Samples');
    });

    it('re-runs (query edits) bump revision and snapshot versions', () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Storms', content: state('StormEvents | take 2'), type: 'kusto' });
        const r = store.updateCanvas(WS, c.id, { content: state('StormEvents | take 5'), editor: 'user', expectedRevision: 1 });
        expect(r.ok).toBe(true);
        expect(store.getCanvas(WS, c.id)?.revision).toBe(2);
        expect(JSON.parse(store.getVersion(WS, c.id, 1)!.content).query).toBe('StormEvents | take 2');
        expect(JSON.parse(store.getVersion(WS, c.id, 2)!.content).query).toBe('StormEvents | take 5');
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

// ============================================================================
// Canvas files — the read-only scope an extension canvas is given
// ============================================================================

/**
 * Path safety is the whole security story for this feature, so it is tested as
 * a table rather than as a handful of examples: every row is a way out of the
 * files root that has worked on some system, and each has to be refused by
 * BOTH the pure shape check and the store method that uses it.
 */
const UNSAFE_PATHS: Array<[label: string, value: string]> = [
    ['parent traversal', '../secret.txt'],
    ['traversal mid-path', 'sub/../../secret.txt'],
    ['traversal at the end', 'sub/..'],
    ['traversal disguised by a valid prefix', 'data/../../../etc/passwd'],
    ['bare ..', '..'],
    ['percent-encoded dot-dot (lowercase)', '%2e%2e/secret.txt'],
    ['percent-encoded dot-dot (uppercase)', '%2E%2E/secret.txt'],
    ['double-encoded dot-dot', '%252e%252e/secret.txt'],
    ['percent-encoded separator', 'data%2f..%2fsecret.txt'],
    ['percent-encoded backslash', 'data%5c..%5csecret.txt'],
    ['residual percent-escape of an ordinary character', 'data%20file.csv'],
    ['percent-encoded NUL', 'data.csv%00.png'],
    ['absolute posix path', '/etc/passwd'],
    ['absolute path to the root itself', '/'],
    ['windows drive letter', 'C:\\Windows\\win.ini'],
    ['windows drive letter, forward slashes', 'C:/Windows/win.ini'],
    ['UNC path', '\\\\server\\share\\file'],
    ['backslash separator', 'sub\\..\\..\\secret.txt'],
    ['lone backslash in a name', 'data\\file.csv'],
    ['literal NUL byte', 'data.csv\u0000.png'],
    ['control character', 'data\u0001.csv'],
    ['empty path', ''],
    ['current directory', '.'],
    ['dot segment', 'sub/./data.csv'],
    ['empty segment', 'sub//data.csv'],
    ['trailing separator', 'sub/'],
];

const SAFE_PATHS = [
    'data.csv',
    'raw/january.json',
    'a/b/c/deep.txt',
    'name with spaces.csv',
    'UPPER.CSV',
    'no-extension',
    'dots.in.the.name.json',
];

describe('isSafeCanvasFilePath', () => {
    it.each(UNSAFE_PATHS)('rejects %s', (_label, value) => {
        expect(isSafeCanvasFilePath(value)).toBe(false);
    });

    it.each(SAFE_PATHS)('accepts %s', (value) => {
        expect(isSafeCanvasFilePath(value)).toBe(true);
    });

    it('rejects non-strings and absurdly long paths', () => {
        expect(isSafeCanvasFilePath(undefined)).toBe(false);
        expect(isSafeCanvasFilePath(null)).toBe(false);
        expect(isSafeCanvasFilePath(42)).toBe(false);
        expect(isSafeCanvasFilePath({ path: 'data.csv' })).toBe(false);
        expect(isSafeCanvasFilePath('a'.repeat(1025))).toBe(false);
    });
});

describe('CanvasStore — canvas files', () => {
    let dataDir: string;
    let store: CanvasStore;
    let canvasId: string;
    let filesRoot: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-files-'));
        store = new CanvasStore(dataDir);
        canvasId = store.createCanvas({ workspaceId: WS, title: 'Sales', content: '{}', type: 'extension' }).id;
        filesRoot = store.getCanvasFilesRoot(WS, canvasId);
        fs.mkdirSync(filesRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    /** Put a file on disk directly, bypassing the store's write path. */
    function seed(relativePath: string, contents: string | Buffer): void {
        const full = path.join(filesRoot, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }

    describe('path safety (through the store)', () => {
        it.each(UNSAFE_PATHS)('readCanvasFile refuses %s without touching disk', (_label, value) => {
            seed('data.csv', 'a,b\n1,2\n');
            const result = store.readCanvasFile(WS, canvasId, value);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('invalid-path');
        });

        it.each(UNSAFE_PATHS)('writeCanvasFile refuses %s', (_label, value) => {
            const result = store.writeCanvasFile(WS, canvasId, value, 'pwned');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('invalid-path');
        });

        it('refuses a symlink inside the files dir that points OUTSIDE it', () => {
            // The case shape checks and path.resolve both miss: a perfectly
            // well-formed relative path whose target is elsewhere on disk.
            const outside = path.join(dataDir, 'outside-secret.txt');
            fs.writeFileSync(outside, 'TOP SECRET');
            try {
                fs.symlinkSync(outside, path.join(filesRoot, 'link.txt'));
            } catch {
                return; // Windows without developer mode — no symlink privilege
            }

            const result = store.readCanvasFile(WS, canvasId, 'link.txt');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('invalid-path');
        });

        it('refuses a file reached through a symlinked DIRECTORY pointing outside', () => {
            const outsideDir = path.join(dataDir, 'outside-dir');
            fs.mkdirSync(outsideDir, { recursive: true });
            fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'TOP SECRET');
            try {
                fs.symlinkSync(outsideDir, path.join(filesRoot, 'escape'), 'dir');
            } catch {
                return;
            }

            const result = store.readCanvasFile(WS, canvasId, 'escape/secret.txt');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('invalid-path');
        });

        it('refuses a WRITE through a symlinked directory pointing outside', () => {
            const outsideDir = path.join(dataDir, 'outside-write');
            fs.mkdirSync(outsideDir, { recursive: true });
            try {
                fs.symlinkSync(outsideDir, path.join(filesRoot, 'escape'), 'dir');
            } catch {
                return;
            }

            const result = store.writeCanvasFile(WS, canvasId, 'escape/planted.txt', 'pwned');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('invalid-path');
            expect(fs.existsSync(path.join(outsideDir, 'planted.txt'))).toBe(false);
        });

        it('allows a symlink that stays INSIDE the files root', () => {
            seed('real.csv', 'a,b\n');
            try {
                fs.symlinkSync(path.join(filesRoot, 'real.csv'), path.join(filesRoot, 'alias.csv'));
            } catch {
                return;
            }

            const result = store.readCanvasFile(WS, canvasId, 'alias.csv');
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.file.content).toBe('a,b\n');
        });

        it('rejects an invalid canvas id before resolving anything', () => {
            const result = store.readCanvasFile(WS, '../other', 'data.csv');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toBe('invalid-path');
        });
    });

    describe('readCanvasFile', () => {
        it('reads a text file as utf-8', () => {
            seed('data.csv', 'month,revenue\njan,10\n');
            const result = store.readCanvasFile(WS, canvasId, 'data.csv');
            expect(result).toMatchObject({
                ok: true,
                file: { path: 'data.csv', encoding: 'utf-8', content: 'month,revenue\njan,10\n', size: 21 },
            });
        });

        it('reads a nested file', () => {
            seed('raw/january.json', '{"n":1}');
            const result = store.readCanvasFile(WS, canvasId, 'raw/january.json');
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.file.content).toBe('{"n":1}');
        });

        it('reads an unrecognized/binary file as base64', () => {
            const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
            seed('logo.png', bytes);
            const result = store.readCanvasFile(WS, canvasId, 'logo.png');
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.file.encoding).toBe('base64');
                expect(Buffer.from(result.file.content, 'base64')).toEqual(bytes);
            }
        });

        it('honours a base64 override on a text file, and never the reverse', () => {
            seed('data.csv', 'a,b\n');
            const forced = store.readCanvasFile(WS, canvasId, 'data.csv', { encoding: 'base64' });
            expect(forced.ok).toBe(true);
            if (forced.ok) {
                expect(forced.file.encoding).toBe('base64');
                expect(Buffer.from(forced.file.content, 'base64').toString('utf-8')).toBe('a,b\n');
            }

            // Asking for utf-8 on binary content is ignored — it would hand back
            // silently corrupted bytes.
            seed('blob.bin', Buffer.from([0xff, 0xfe]));
            const notForced = store.readCanvasFile(WS, canvasId, 'blob.bin', { encoding: 'utf-8' });
            expect(notForced.ok).toBe(true);
            if (notForced.ok) expect(notForced.file.encoding).toBe('base64');
        });

        it('returns not-found for a missing file, a directory, and a canvas with no files dir', () => {
            seed('sub/x.txt', 'x');
            expect(store.readCanvasFile(WS, canvasId, 'nope.csv')).toMatchObject({ ok: false, reason: 'not-found' });
            expect(store.readCanvasFile(WS, canvasId, 'sub')).toMatchObject({ ok: false, reason: 'not-found' });

            const bare = store.createCanvas({ workspaceId: WS, title: 'Bare', content: '{}' });
            expect(store.readCanvasFile(WS, bare.id, 'data.csv')).toMatchObject({ ok: false, reason: 'not-found' });
        });

        it('refuses a text file over the 1 MB cap', () => {
            seed('big.csv', 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1));
            const result = store.readCanvasFile(WS, canvasId, 'big.csv');
            expect(result.ok).toBe(false);
            if (!result.ok && result.reason === 'too-large') {
                expect(result.limit).toBe(MAX_CANVAS_TEXT_FILE_BYTES);
                expect(result.size).toBe(MAX_CANVAS_TEXT_FILE_BYTES + 1);
            } else {
                expect.unreachable('expected too-large');
            }
        });

        it('allows a binary file above the text cap but under the binary cap', () => {
            seed('mid.bin', Buffer.alloc(MAX_CANVAS_TEXT_FILE_BYTES + 1024));
            const result = store.readCanvasFile(WS, canvasId, 'mid.bin');
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.file.encoding).toBe('base64');
        });

        it('caps by the file\'s own type, so a base64 override cannot raise the ceiling', () => {
            seed('big.csv', 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1));
            const result = store.readCanvasFile(WS, canvasId, 'big.csv', { encoding: 'base64' });
            expect(result).toMatchObject({ ok: false, reason: 'too-large', limit: MAX_CANVAS_TEXT_FILE_BYTES });
        });
    });

    describe('listCanvasFiles', () => {
        it('lists files recursively, sorted, with size and encoding', () => {
            seed('data.csv', 'a,b\n');
            seed('raw/january.json', '{}');
            seed('logo.png', Buffer.from([0x00, 0x01]));

            expect(store.listCanvasFiles(WS, canvasId)).toEqual([
                { path: 'data.csv', size: 4, encoding: 'utf-8' },
                { path: 'logo.png', size: 2, encoding: 'base64' },
                { path: 'raw/january.json', size: 2, encoding: 'utf-8' },
            ]);
        });

        it('returns an empty list for a canvas with no files, and for a bad id', () => {
            expect(store.listCanvasFiles(WS, canvasId)).toEqual([]);
            expect(store.listCanvasFiles(WS, '../other')).toEqual([]);
        });

        it('omits symlinks rather than advertising an entry readFile would refuse', () => {
            seed('real.csv', 'a\n');
            const outside = path.join(dataDir, 'outside.txt');
            fs.writeFileSync(outside, 'secret');
            try {
                fs.symlinkSync(outside, path.join(filesRoot, 'link.txt'));
            } catch {
                return;
            }

            expect(store.listCanvasFiles(WS, canvasId).map(f => f.path)).toEqual(['real.csv']);
        });

        it('stops at the entry cap', () => {
            for (let i = 0; i < MAX_CANVAS_FILE_ENTRIES + 5; i++) {
                seed(`f${i}.txt`, 'x');
            }
            expect(store.listCanvasFiles(WS, canvasId)).toHaveLength(MAX_CANVAS_FILE_ENTRIES);
        });
    });

    describe('writeCanvasFile', () => {
        it('writes text and reads it straight back', () => {
            const written = store.writeCanvasFile(WS, canvasId, 'data.csv', 'a,b\n1,2\n');
            expect(written).toMatchObject({ ok: true, file: { path: 'data.csv', size: 8, encoding: 'utf-8' } });
            expect(fs.readFileSync(path.join(filesRoot, 'data.csv'), 'utf-8')).toBe('a,b\n1,2\n');

            const read = store.readCanvasFile(WS, canvasId, 'data.csv');
            expect(read.ok).toBe(true);
            if (read.ok) expect(read.file.content).toBe('a,b\n1,2\n');
        });

        it('creates intermediate directories', () => {
            expect(store.writeCanvasFile(WS, canvasId, 'raw/2026/jan.json', '{}').ok).toBe(true);
            expect(fs.existsSync(path.join(filesRoot, 'raw', '2026', 'jan.json'))).toBe(true);
        });

        it('decodes base64 content to real bytes', () => {
            const bytes = Buffer.from([0x00, 0xff, 0x10]);
            const written = store.writeCanvasFile(WS, canvasId, 'blob.bin', bytes.toString('base64'), 'base64');
            expect(written.ok).toBe(true);
            expect(fs.readFileSync(path.join(filesRoot, 'blob.bin'))).toEqual(bytes);
        });

        it('refuses to write for a canvas that does not exist', () => {
            expect(store.writeCanvasFile(WS, 'no-such-canvas', 'data.csv', 'x'))
                .toMatchObject({ ok: false, reason: 'not-found' });
        });

        it('refuses content over the cap', () => {
            const result = store.writeCanvasFile(WS, canvasId, 'big.csv', 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1));
            expect(result).toMatchObject({ ok: false, reason: 'too-large', limit: MAX_CANVAS_TEXT_FILE_BYTES });
            expect(fs.existsSync(path.join(filesRoot, 'big.csv'))).toBe(false);
        });
    });

    it('files live inside the canvas directory the store already owns', () => {
        expect(filesRoot).toBe(path.join(dataDir, 'repos', WS, 'canvases', canvasId, 'files'));
    });
});
