/**
 * POST /api/processes/:id/note — move a Notes chat onto a different note.
 *
 * The note a chat operates on lives in two places: the enqueue payload (read
 * once, for the first turn) and `metadata.notePath` (read by FollowUpExecutor
 * for every turn after that). Only the second decides which file a follow-up
 * snapshots and diffs, so this endpoint's single job — rewriting that field —
 * is what makes a chat actually follow the note you're looking at.
 *
 * The regression that matters is the last describe block: after a move, the
 * pre/post snapshot a follow-up takes must land on the NEW note. Without it a
 * "moved" chat keeps diffing the note it was created against and silently
 * credits its edits to the wrong file.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import { readNoteContent } from '../../../src/server/executors/note-chat-executor';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

const WS = 'ws-notes';

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        json: () => (bodyStr ? JSON.parse(bodyStr) : undefined),
                    });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

describe('POST /api/processes/:id/note', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    let notesRoot: string;

    /** Seed a note-chat process already pointing at `notePath`. */
    async function seedChat(id: string, notePath: string, scope?: string): Promise<void> {
        await store.addProcess({
            id,
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            workingDirectory: '/tmp/project',
            metadata: {
                type: 'chat',
                workspaceId: WS,
                notePath,
                noteTitle: path.posix.basename(notePath, '.md'),
                ...(scope ? { noteChatScope: scope } : {}),
            },
        } as any);
    }

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-note-route-'));
        notesRoot = path.join(dataDir, 'repos', WS, 'notes');
        fs.mkdirSync(path.join(notesRoot, 'MultiModal', 'sub'), { recursive: true });
        fs.mkdirSync(path.join(notesRoot, 'Other'), { recursive: true });
        fs.writeFileSync(path.join(notesRoot, 'MultiModal', 'first-five-days.md'), '# five days\n');
        fs.writeFileSync(path.join(notesRoot, 'MultiModal', 'project.md'), '# project\n');
        fs.writeFileSync(path.join(notesRoot, 'MultiModal', 'sub', 'deep.md'), '# deep\n');
        fs.writeFileSync(path.join(notesRoot, 'Other', 'elsewhere.md'), '# elsewhere\n');

        store = createMockProcessStore();
        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            dataDir,
            gitOpsStore: {} as any,
            getWsServer: (() => undefined) as any,
        });
        server = http.createServer(createRouter({ routes }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        store.processes.clear();
    });

    // ── Happy path ───────────────────────────────────────────────────────────

    it('rewrites metadata.notePath and noteTitle', async () => {
        await seedChat('p1', 'MultiModal/first-five-days.md');

        const res = await request(baseUrl, '/api/processes/p1/note', {
            method: 'POST',
            body: { notePath: 'MultiModal/project.md', noteTitle: 'project' },
        });

        expect(res.status).toBe(200);
        expect(res.json()).toEqual({ notePath: 'MultiModal/project.md', noteTitle: 'project' });
        const proc = store.processes.get('p1')!;
        expect(proc.metadata!.notePath).toBe('MultiModal/project.md');
        expect(proc.metadata!.noteTitle).toBe('project');
    });

    it('derives the title from the file name when noteTitle is omitted', async () => {
        await seedChat('p2', 'MultiModal/first-five-days.md');

        const res = await request(baseUrl, '/api/processes/p2/note', {
            method: 'POST',
            body: { notePath: 'MultiModal/project.md' },
        });

        expect(res.status).toBe(200);
        expect(res.json().noteTitle).toBe('project');
    });

    it('normalizes backslash spellings of the path', async () => {
        await seedChat('p3', 'MultiModal/first-five-days.md');

        const res = await request(baseUrl, '/api/processes/p3/note', {
            method: 'POST',
            body: { notePath: 'MultiModal\\project.md' },
        });

        expect(res.status).toBe(200);
        expect(store.processes.get('p3')!.metadata!.notePath).toBe('MultiModal/project.md');
    });

    it('preserves unrelated metadata', async () => {
        await store.addProcess({
            id: 'p4',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            metadata: { type: 'chat', workspaceId: WS, notePath: 'MultiModal/first-five-days.md', provider: 'codex' },
        } as any);

        await request(baseUrl, '/api/processes/p4/note', {
            method: 'POST',
            body: { notePath: 'MultiModal/project.md' },
        });

        expect(store.processes.get('p4')!.metadata!.provider).toBe('codex');
    });

    it('returns 404 for an unknown process', async () => {
        const res = await request(baseUrl, '/api/processes/nope/note', {
            method: 'POST',
            body: { notePath: 'MultiModal/project.md' },
        });
        expect(res.status).toBe(404);
    });

    it('rejects a missing notePath', async () => {
        await seedChat('p5', 'MultiModal/first-five-days.md');
        const res = await request(baseUrl, '/api/processes/p5/note', { method: 'POST', body: {} });
        expect(res.status).toBe(400);
    });

    // ── Path validation ──────────────────────────────────────────────────────
    // This endpoint retargets where an agent reads and writes, so a caller must
    // not be able to point it outside the notes root.

    describe('path validation', () => {
        it.each([
            ['traversal', '../../../etc/passwd'],
            ['absolute', '/etc/passwd'],
            ['traversal mid-path', 'MultiModal/../../secrets.md'],
            ['backslash traversal', '..\\..\\secrets.md'],
        ])('rejects %s', async (_label, notePath) => {
            await seedChat('pv', 'MultiModal/first-five-days.md');
            const res = await request(baseUrl, '/api/processes/pv/note', {
                method: 'POST',
                body: { notePath },
            });
            expect(res.status).toBe(400);
            // The rejected move must leave the chat where it was.
            expect(store.processes.get('pv')!.metadata!.notePath).toBe('MultiModal/first-five-days.md');
        });
    });

    // ── Section-scope boundary ───────────────────────────────────────────────

    describe('section scope', () => {
        it('allows a move to a sibling inside the bound folder', async () => {
            await seedChat('s1', 'MultiModal/first-five-days.md', 'per-section');
            const res = await request(baseUrl, '/api/processes/s1/note', {
                method: 'POST',
                body: { notePath: 'MultiModal/project.md' },
            });
            expect(res.status).toBe(200);
            expect(store.processes.get('s1')!.metadata!.notePath).toBe('MultiModal/project.md');
        });

        it('rejects a move to a note in a different folder', async () => {
            await seedChat('s2', 'MultiModal/first-five-days.md', 'per-section');
            const res = await request(baseUrl, '/api/processes/s2/note', {
                method: 'POST',
                body: { notePath: 'Other/elsewhere.md' },
            });
            expect(res.status).toBe(400);
            expect(store.processes.get('s2')!.metadata!.notePath).toBe('MultiModal/first-five-days.md');
        });

        it('rejects a move into a nested subfolder — that is a section of its own', async () => {
            await seedChat('s3', 'MultiModal/first-five-days.md', 'per-section');
            const res = await request(baseUrl, '/api/processes/s3/note', {
                method: 'POST',
                body: { notePath: 'MultiModal/sub/deep.md' },
            });
            expect(res.status).toBe(400);
        });

        it('does not constrain a per-note chat to any folder', async () => {
            await seedChat('s4', 'MultiModal/first-five-days.md', 'per-note');
            const res = await request(baseUrl, '/api/processes/s4/note', {
                method: 'POST',
                body: { notePath: 'Other/elsewhere.md' },
            });
            expect(res.status).toBe(200);
        });
    });

    // ── The regression that matters ──────────────────────────────────────────

    describe('follow-up snapshots after a move', () => {
        it('reads the note the chat moved TO, not the one it was created against', async () => {
            await seedChat('reg', 'MultiModal/first-five-days.md', 'per-section');

            // Before the move, the field a follow-up reads points at the original.
            const before = store.processes.get('reg')!.metadata!.notePath as string;
            expect(await readNoteContent(dataDir, WS, before)).toContain('# five days');

            await request(baseUrl, '/api/processes/reg/note', {
                method: 'POST',
                body: { notePath: 'MultiModal/project.md' },
            });

            // FollowUpExecutor snapshots `process.metadata.notePath` via exactly
            // this call. After the move it must resolve to the new note's content.
            const after = store.processes.get('reg')!.metadata!.notePath as string;
            expect(after).toBe('MultiModal/project.md');
            const snapshot = await readNoteContent(dataDir, WS, after);
            expect(snapshot).toContain('# project');
            expect(snapshot).not.toContain('# five days');
        });
    });
});
