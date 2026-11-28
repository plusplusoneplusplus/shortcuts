/**
 * Canvas persistence kernel: atomic commits, serialized writers, and what a
 * corrupt file on disk does to a reader.
 *
 * Two `CanvasStore` instances over one data directory stand in for two writers
 * (a second server process, a CLI command) — they share nothing but the files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import pino from 'pino';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { setServerLogger } from '../../../src/server/logging/server-logger';

const WS = 'test-workspace';

describe('canvas persistence kernel', () => {
    let dataDir: string;
    let store: CanvasStore;
    let logs: Array<Record<string, unknown>>;

    const canvasDir = (canvasId: string): string => path.join(dataDir, 'repos', WS, 'canvases', canvasId);

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-kernel-'));
        store = new CanvasStore(dataDir);
        logs = [];
        setServerLogger(pino({ level: 'warn' }, { write: (line: string) => { logs.push(JSON.parse(line)); } } as never));
    });

    afterEach(() => {
        setServerLogger(pino({ level: 'silent' }));
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const warnings = (role: string): Array<Record<string, unknown>> =>
        logs.filter(entry => entry.component === 'canvas-store' && entry.role === role);

    // ------------------------------------------------------------------
    // Serialized writers
    // ------------------------------------------------------------------

    describe('concurrent writers', () => {
        it('lets exactly one writer win when both hold the same expectedRevision', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'base' });
            const other = new CanvasStore(dataDir);

            // Both read revision 1, then both try to write it.
            const first = store.updateCanvas(WS, canvas.id, { content: 'from A', expectedRevision: 1, editor: 'user' });
            const second = other.updateCanvas(WS, canvas.id, { content: 'from B', expectedRevision: 1, editor: 'ai' });

            expect(first).toMatchObject({ ok: true });
            expect(second).toEqual({ ok: false, reason: 'revision-conflict', currentRevision: 2 });
            // The loser sees the winner's revision and can retry against it.
            expect(other.getCanvas(WS, canvas.id)).toMatchObject({ revision: 2, content: 'from A' });

            const retry = other.updateCanvas(WS, canvas.id, { content: 'from B', expectedRevision: 2, editor: 'ai' });
            expect(retry).toMatchObject({ ok: true, canvas: { revision: 3, content: 'from B' } });
        });

        it('keeps one snapshot per revision with no gaps or duplicates', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'v1' });
            const other = new CanvasStore(dataDir);
            for (let i = 0; i < 5; i++) {
                const writer = i % 2 === 0 ? store : other;
                expect(writer.updateCanvas(WS, canvas.id, { content: `v${i + 2}`, editor: 'user' })).toMatchObject({ ok: true });
            }

            const revisions = store.listVersions(WS, canvas.id).map(v => v.revision);
            expect(revisions).toEqual([6, 5, 4, 3, 2, 1]);
            expect(store.getCanvas(WS, canvas.id)).toMatchObject({ revision: 6, content: 'v6' });
        });

        it('releases the canvas lock after a write, leaving no lock behind', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'x' });
            store.updateCanvas(WS, canvas.id, { content: 'y', editor: 'user' });
            store.addComment(WS, canvas.id, { anchorText: 'y', body: 'note' });

            const locksDir = path.join(dataDir, 'repos', WS, 'canvases', '.locks');
            expect(fs.existsSync(path.join(locksDir, `${canvas.id}.lock`))).toBe(false);
            // And the lock directory is never mistaken for a canvas.
            expect(store.listCanvases(WS).map(c => c.id)).toEqual([canvas.id]);
        });
    });

    // ------------------------------------------------------------------
    // Staged commits
    // ------------------------------------------------------------------

    describe('staged commits', () => {

        it('ignores a staging file a dead writer left in the versions directory', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'v1' });
            const versionsDir = path.join(canvasDir(canvas.id), 'versions');
            fs.writeFileSync(path.join(versionsDir, '.tmp-2.json-deadbeef'), 'half written');

            expect(store.listVersions(WS, canvas.id).map(v => v.revision)).toEqual([1]);
            expect(warnings('version')).toEqual([]);
        });

        it('recovers content from the revision snapshot when the artifact is unreadable', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'the real content' });
            // What a commit torn between the artifact rename and a later write leaves.
            fs.rmSync(path.join(canvasDir(canvas.id), 'artifact.md'));

            expect(store.getCanvas(WS, canvas.id)).toMatchObject({ revision: 1, content: 'the real content' });
        });

        it('reports an empty artifact only when neither the file nor its snapshot survives', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'gone' });
            fs.rmSync(path.join(canvasDir(canvas.id), 'artifact.md'));
            fs.rmSync(path.join(canvasDir(canvas.id), 'versions'), { recursive: true });

            expect(store.getCanvas(WS, canvas.id)).toMatchObject({ revision: 1, content: '' });
        });
    });

    // ------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------

    describe('comment mutations', () => {
        it('keeps both writers\' comments when two stores mutate the same canvas', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'alpha beta' });
            const other = new CanvasStore(dataDir);

            const a = store.addComment(WS, canvas.id, { anchorText: 'alpha', body: 'from A' });
            const b = other.addComment(WS, canvas.id, { anchorText: 'beta', body: 'from B' });
            other.setCommentStatus(WS, canvas.id, a!.id, 'resolved');

            const comments = store.listComments(WS, canvas.id);
            expect(comments).toHaveLength(2);
            expect(comments.find(c => c.id === a!.id)?.status).toBe('resolved');
            expect(comments.find(c => c.id === b!.id)?.status).toBe('open');
        });

        it('does not rewrite the comments file for a mutation that changes nothing', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'alpha' });
            store.addComment(WS, canvas.id, { anchorText: 'alpha', body: 'note' });
            const commentsPath = path.join(canvasDir(canvas.id), 'comments.json');
            const before = fs.readFileSync(commentsPath, 'utf-8');

            expect(store.deleteComment(WS, canvas.id, 'no-such-id')).toBe(false);
            expect(store.setCommentStatus(WS, canvas.id, 'no-such-id', 'resolved')).toBeNull();
            expect(fs.readFileSync(commentsPath, 'utf-8')).toBe(before);
        });

        it('does not create a comments file for a canvas that does not exist', () => {
            expect(store.addComment(WS, 'ghost-canvas-abc123', { anchorText: 'a', body: 'b' })).toBeNull();
            expect(store.deleteComment(WS, 'ghost-canvas-abc123', 'x')).toBe(false);
            expect(fs.existsSync(path.join(canvasDir('ghost-canvas-abc123'), 'comments.json'))).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // Corruption diagnostics
    // ------------------------------------------------------------------

    describe('corruption diagnostics', () => {
        it('reports a descriptor that will not parse instead of silently losing the canvas', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'body' });
            fs.writeFileSync(path.join(canvasDir(canvas.id), 'canvas.json'), '{ truncated');

            expect(store.getCanvas(WS, canvas.id)).toBeNull();
            expect(store.listCanvases(WS)).toEqual([]);

            const reported = warnings('descriptor');
            expect(reported.length).toBeGreaterThan(0);
            expect(reported[0]).toMatchObject({ workspaceId: WS, canvasId: canvas.id, file: 'canvas.json' });
        });

        it('never logs canvas content or an absolute path', () => {
            const secret = 'SECRET-CANVAS-BODY';
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: secret });
            fs.writeFileSync(path.join(canvasDir(canvas.id), 'canvas.json'), `{ "leak": "${secret}"`);
            store.getCanvas(WS, canvas.id);

            const serialized = JSON.stringify(logs);
            expect(serialized).not.toContain(secret);
            expect(serialized).not.toContain(dataDir);
            expect(serialized).not.toContain(path.sep === '\\' ? 'C:\\' : '/tmp');
        });

        it('reports a corrupt version snapshot and keeps the readable ones', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'v1' });
            store.updateCanvas(WS, canvas.id, { content: 'v2', editor: 'user' });
            fs.writeFileSync(path.join(canvasDir(canvas.id), 'versions', '1.json'), 'not json');

            expect(store.listVersions(WS, canvas.id).map(v => v.revision)).toEqual([2]);
            expect(store.getVersion(WS, canvas.id, 1)).toBeNull();
            expect(warnings('version').length).toBeGreaterThan(0);
            expect(warnings('version')[0]).toMatchObject({ file: '1.json' });
        });

        it('reports corrupt comments and drops only the malformed entries', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'alpha' });
            const good = store.addComment(WS, canvas.id, { anchorText: 'alpha', body: 'keep me' });
            const commentsPath = path.join(canvasDir(canvas.id), 'comments.json');
            fs.writeFileSync(commentsPath, JSON.stringify([good, { id: 'broken' }, null], null, 2));

            expect(store.listComments(WS, canvas.id).map(c => c.id)).toEqual([good!.id]);
            expect(warnings('comments').length).toBeGreaterThan(0);
        });

        it('reports a comments file that is not an array', () => {
            const canvas = store.createCanvas({ workspaceId: WS, title: 'Plan', content: 'alpha' });
            fs.writeFileSync(path.join(canvasDir(canvas.id), 'comments.json'), '{"comments":[]}');

            expect(store.listComments(WS, canvas.id)).toEqual([]);
            expect(warnings('comments').length).toBeGreaterThan(0);
        });
    });
});
