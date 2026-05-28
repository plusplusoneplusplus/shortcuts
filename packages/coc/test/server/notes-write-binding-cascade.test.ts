/**
 * Notes Write Handler — Rename/Delete Binding Cascade Tests
 *
 * Verifies that renaming or deleting a note (or folder of notes) cascades into
 * the per-note chat bindings table:
 *   - File rename moves the binding row
 *   - Folder rename moves all binding rows under the prefix
 *   - File delete unbinds the row
 *   - Folder delete drops all rows under the prefix
 *
 * Uses a real SqliteProcessStore + createExecutionServer so the cascade and
 * the HTTP route are exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { NoteChatBindingStore } from '../../src/server/notes/note-chat-binding-store';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
        if (options.body) headers['Content-Length'] = String(Buffer.byteLength(options.body));
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, { method: 'PATCH', body: JSON.stringify(data) });
}

function postJSON(url: string, data: unknown) {
    return request(url, { method: 'POST', body: JSON.stringify(data) });
}

describe('Notes write — rename/delete binding cascade', { timeout: 30_000 }, () => {
    const wsId = 'ws-cascade';
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let store: SqliteProcessStore;
    let bindings: NoteChatBindingStore;
    let notesRoot: string;

    function notesUrl(suffix: string) {
        return `${baseUrl}/api/workspaces/${encodeURIComponent(wsId)}${suffix}`;
    }

    function writeNote(rel: string, content = 'hello'): void {
        const abs = path.join(notesRoot, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }

    function mkdirNote(rel: string): void {
        fs.mkdirSync(path.join(notesRoot, rel), { recursive: true });
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-notes-cascade-'));
        store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
        await store.registerWorkspace({ id: wsId, name: 'Cascade WS', rootPath: tmpDir });
        server = await createExecutionServer({ port: 0, dataDir: tmpDir, store });
        baseUrl = server.url;
        notesRoot = path.join(tmpDir, 'repos', wsId, 'notes');
        fs.mkdirSync(notesRoot, { recursive: true });
        bindings = new NoteChatBindingStore(store.getDatabase());
    });

    afterEach(async () => {
        await server.close();
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ────────────────────────────────────────────────────────────────────────
    // File rename
    // ────────────────────────────────────────────────────────────────────────

    it('file rename moves the binding row', async () => {
        writeNote('old.md');
        bindings.bind(wsId, 'old.md', 'task-1');

        const res = await patchJSON(notesUrl('/notes/path'), { oldPath: 'old.md', newPath: 'new.md' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.bindingsMoved).toBe(1);

        expect(bindings.get(wsId, 'old.md')).toBeUndefined();
        expect(bindings.get(wsId, 'new.md')?.taskId).toBe('task-1');
    });

    it('file rename with no binding returns bindingsMoved=0', async () => {
        writeNote('plain.md');
        const res = await patchJSON(notesUrl('/notes/path'), { oldPath: 'plain.md', newPath: 'renamed.md' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).bindingsMoved).toBe(0);
    });

    it('file rename without .md moves the binding row to the effective markdown path', async () => {
        writeNote('old.md');
        bindings.bind(wsId, 'old.md', 'task-1');

        const res = await patchJSON(notesUrl('/notes/path'), { oldPath: 'old.md', newPath: 'new' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.newPath).toBe('new.md');
        expect(body.bindingsMoved).toBe(1);

        expect(bindings.get(wsId, 'old.md')).toBeUndefined();
        expect(bindings.get(wsId, 'new.md')?.taskId).toBe('task-1');
    });

    // ────────────────────────────────────────────────────────────────────────
    // Folder rename
    // ────────────────────────────────────────────────────────────────────────

    it('folder rename moves all binding rows under the prefix', async () => {
        mkdirNote('OldFolder');
        writeNote('OldFolder/a.md');
        writeNote('OldFolder/sub/b.md');
        writeNote('Other/c.md');
        bindings.bind(wsId, 'OldFolder/a.md', 'task-a');
        bindings.bind(wsId, 'OldFolder/sub/b.md', 'task-b');
        bindings.bind(wsId, 'Other/c.md', 'task-c');

        const res = await patchJSON(notesUrl('/notes/path'), { oldPath: 'OldFolder', newPath: 'NewFolder' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).bindingsMoved).toBe(2);

        expect(bindings.get(wsId, 'NewFolder/a.md')?.taskId).toBe('task-a');
        expect(bindings.get(wsId, 'NewFolder/sub/b.md')?.taskId).toBe('task-b');
        expect(bindings.get(wsId, 'Other/c.md')?.taskId).toBe('task-c');
        expect(bindings.get(wsId, 'OldFolder/a.md')).toBeUndefined();
    });

    it('folder rename does not match unrelated prefixes', async () => {
        mkdirNote('old');
        mkdirNote('oldfolder');
        writeNote('old/a.md');
        writeNote('oldfolder/keep.md');
        bindings.bind(wsId, 'old/a.md', 'task-move');
        bindings.bind(wsId, 'oldfolder/keep.md', 'task-keep');

        const res = await patchJSON(notesUrl('/notes/path'), { oldPath: 'old', newPath: 'renamed' });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).bindingsMoved).toBe(1);

        expect(bindings.get(wsId, 'renamed/a.md')?.taskId).toBe('task-move');
        expect(bindings.get(wsId, 'oldfolder/keep.md')?.taskId).toBe('task-keep');
    });

    // ────────────────────────────────────────────────────────────────────────
    // File / folder delete
    // ────────────────────────────────────────────────────────────────────────

    it('file delete unbinds the row', async () => {
        writeNote('gone.md');
        bindings.bind(wsId, 'gone.md', 'task-1');

        const res = await request(notesUrl('/notes/path?path=' + encodeURIComponent('gone.md')), { method: 'DELETE' });
        expect(res.status).toBe(204);
        expect(bindings.get(wsId, 'gone.md')).toBeUndefined();
    });

    it('folder delete drops all rows under the prefix', async () => {
        mkdirNote('GoneFolder');
        writeNote('GoneFolder/a.md');
        writeNote('GoneFolder/sub/b.md');
        writeNote('Keep/c.md');
        bindings.bind(wsId, 'GoneFolder/a.md', 'task-a');
        bindings.bind(wsId, 'GoneFolder/sub/b.md', 'task-b');
        bindings.bind(wsId, 'Keep/c.md', 'task-c');

        const res = await request(notesUrl('/notes/path?path=' + encodeURIComponent('GoneFolder')), { method: 'DELETE' });
        expect(res.status).toBe(204);

        expect(bindings.get(wsId, 'GoneFolder/a.md')).toBeUndefined();
        expect(bindings.get(wsId, 'GoneFolder/sub/b.md')).toBeUndefined();
        expect(bindings.get(wsId, 'Keep/c.md')?.taskId).toBe('task-c');
    });

    it('delete without a binding succeeds (no-op cascade)', async () => {
        writeNote('plain.md');
        const res = await request(notesUrl('/notes/path?path=' + encodeURIComponent('plain.md')), { method: 'DELETE' });
        expect(res.status).toBe(204);
    });
});
