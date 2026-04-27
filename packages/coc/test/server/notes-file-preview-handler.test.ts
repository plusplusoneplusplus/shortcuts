/**
 * Notes File Preview Handler Tests
 *
 * Tests for GET /api/workspaces/:id/notes/file-preview?path=…
 * - File found in notes root → { exists: true, type: 'note' }
 * - File found in workspace root → { exists: true, type: 'file' }
 * - File not found → { exists: false }
 * - Missing path param → 400
 * - Content truncation for large files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method ?? 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }),
                );
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes File Preview Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-file-preview-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-file-preview-ws-'));
        wsId = 'test-ws-' + Date.now();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer): Promise<string> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    function createNoteFile(filePath: string, content: string): void {
        const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
        const fullPath = path.join(notesDir, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
    }

    function createWorkspaceFile(filePath: string, content: string): void {
        const fullPath = path.join(workspaceDir, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
    }

    it('returns 400 when path parameter is missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/file-preview`);
        expect(res.status).toBe(400);
    });

    it('returns exists: false when file is not found anywhere', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        const res = await request(
            `${srv.url}/api/workspaces/${wsId}/notes/file-preview?path=${encodeURIComponent('nonexistent/file.md')}`,
        );
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.exists).toBe(false);
    });

    it('returns note type when file exists in notes root', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        createNoteFile('Notebook/Page.md', '# Hello\nWorld');

        const res = await request(
            `${srv.url}/api/workspaces/${wsId}/notes/file-preview?path=${encodeURIComponent('Notebook/Page.md')}`,
        );
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.exists).toBe(true);
        expect(data.type).toBe('note');
        expect(data.content).toContain('# Hello');
        expect(data.content).toContain('World');
    });

    it('returns file type when file exists in workspace root', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        createWorkspaceFile('src/main.ts', 'console.log("hello");');

        const res = await request(
            `${srv.url}/api/workspaces/${wsId}/notes/file-preview?path=${encodeURIComponent('src/main.ts')}`,
        );
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.exists).toBe(true);
        expect(data.type).toBe('file');
        expect(data.content).toContain('console.log');
    });

    it('prefers notes root over workspace root', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        createNoteFile('shared/readme.md', 'from notes');
        createWorkspaceFile('shared/readme.md', 'from workspace');

        const res = await request(
            `${srv.url}/api/workspaces/${wsId}/notes/file-preview?path=${encodeURIComponent('shared/readme.md')}`,
        );
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.exists).toBe(true);
        expect(data.type).toBe('note');
        expect(data.content).toBe('from notes');
    });

    it('truncates large files at 4096 bytes', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        const bigContent = 'x'.repeat(8000);
        createNoteFile('big.md', bigContent);

        const res = await request(
            `${srv.url}/api/workspaces/${wsId}/notes/file-preview?path=${encodeURIComponent('big.md')}`,
        );
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.exists).toBe(true);
        expect(data.content.length).toBe(4096);
    });
});
