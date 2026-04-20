/**
 * Notes Edits Handler Tests
 *
 * Tests for GET /api/processes/:id/note-edits and POST .../undo endpoints.
 * Uses SqliteProcessStore for integration testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import type { NoteEditSnapshot } from '../../src/server/executors/note-chat-executor';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Edits Handler', () => {
    let server: ExecutionServer | undefined;
    let store: SqliteProcessStore;
    let dataDir: string;
    const wsId = 'test-ws';
    const processId = 'q-test-proc-1';

    function makeSnapshot(overrides: Partial<NoteEditSnapshot> = {}): NoteEditSnapshot {
        return {
            editId: `${processId}-0`,
            notePath: 'test-note.md',
            preEditContent: '# Before\n\nOriginal content.',
            postEditContent: '# After\n\nModified content.',
            timestamp: new Date().toISOString(),
            turnIndex: 0,
            ...overrides,
        };
    }

    async function seedProcess(metadata: Record<string, unknown> = {}) {
        await store.addProcess({
            id: processId,
            type: 'ai',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            metadata: { type: 'ai', workspaceId: wsId, ...metadata },
        });
    }

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-edits-test-'));
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'test.db') });
        await store.registerWorkspace({
            id: wsId,
            name: 'Test Workspace',
            rootPath: '/tmp/test-repo',
        });
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ========================================================================
    // GET /api/processes/:id/note-edits
    // ========================================================================

    describe('GET /api/processes/:id/note-edits', () => {
        it('returns empty array when process has no noteEdits', async () => {
            await seedProcess();
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits`);
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual([]);
        });

        it('returns noteEdits array from process metadata', async () => {
            const snapshot = makeSnapshot();
            await seedProcess({ noteEdits: [snapshot] });
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits`);
            expect(res.status).toBe(200);
            const edits = JSON.parse(res.body);
            expect(edits).toHaveLength(1);
            expect(edits[0].editId).toBe(snapshot.editId);
            expect(edits[0].notePath).toBe('test-note.md');
            expect(edits[0].preEditContent).toBe(snapshot.preEditContent);
        });

        it('returns 404 for unknown process', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/nonexistent/note-edits`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/processes/:id/note-edits/:editId/undo
    // ========================================================================

    describe('POST /api/processes/:id/note-edits/:editId/undo', () => {
        it('restores pre-edit content when current file matches post-edit', async () => {
            const snapshot = makeSnapshot();
            await seedProcess({ noteEdits: [snapshot] });

            // Write the post-edit content to the note file
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            const noteFile = path.join(notesDir, snapshot.notePath);
            fs.mkdirSync(path.dirname(noteFile), { recursive: true });
            fs.writeFileSync(noteFile, snapshot.postEditContent!, 'utf-8');

            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits/${encodeURIComponent(snapshot.editId)}/undo`,
                { method: 'POST' },
            );
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ success: true });

            // Verify file was reverted
            const content = fs.readFileSync(noteFile, 'utf-8');
            expect(content).toBe(snapshot.preEditContent);
        });

        it('returns 409 when file was modified since edit', async () => {
            const snapshot = makeSnapshot();
            await seedProcess({ noteEdits: [snapshot] });

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            const noteFile = path.join(notesDir, snapshot.notePath);
            fs.mkdirSync(path.dirname(noteFile), { recursive: true });
            fs.writeFileSync(noteFile, 'User modified content', 'utf-8');

            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits/${encodeURIComponent(snapshot.editId)}/undo`,
                { method: 'POST' },
            );
            expect(res.status).toBe(409);
            expect(JSON.parse(res.body).reason).toBe('modified');
        });

        it('force undo succeeds even when file was modified', async () => {
            const snapshot = makeSnapshot();
            await seedProcess({ noteEdits: [snapshot] });

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            const noteFile = path.join(notesDir, snapshot.notePath);
            fs.mkdirSync(path.dirname(noteFile), { recursive: true });
            fs.writeFileSync(noteFile, 'User modified content', 'utf-8');

            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits/${encodeURIComponent(snapshot.editId)}/undo?force=true`,
                { method: 'POST' },
            );
            expect(res.status).toBe(200);

            const content = fs.readFileSync(noteFile, 'utf-8');
            expect(content).toBe(snapshot.preEditContent);
        });

        it('returns 404 for unknown edit ID', async () => {
            await seedProcess({ noteEdits: [makeSnapshot()] });
            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits/nonexistent/undo`,
                { method: 'POST' },
            );
            expect(res.status).toBe(404);
        });

        it('returns 400 for tooLarge snapshot', async () => {
            const snapshot = makeSnapshot({ tooLarge: true, preEditContent: '', postEditContent: '' });
            await seedProcess({ noteEdits: [snapshot] });
            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/processes/${encodeURIComponent(processId)}/note-edits/${encodeURIComponent(snapshot.editId)}/undo`,
                { method: 'POST' },
            );
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown process', async () => {
            const srv = await startServer();
            const res = await request(
                `${srv.url}/api/processes/nonexistent/note-edits/some-edit/undo`,
                { method: 'POST' },
            );
            expect(res.status).toBe(404);
        });
    });
});
