/**
 * Notes Write Handler Tests
 *
 * Tests for PUT /api/workspaces/:id/notes/content path resolution:
 * - Relative paths resolve against notesRoot (~/.coc/repos/<wsId>/notes/)
 * - Absolute paths inside wsDataDir or ~/.copilot are allowed
 * - Absolute paths outside allowed directories are rejected with 403
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { safeRm } from '../helpers/safe-rm';

// ============================================================================
// HTTP helpers
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

function postJSON(
    url: string,
    data: unknown,
): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

function putJSON(
    url: string,
    data: unknown,
): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Write Handler — PUT /notes/content security', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-write-handler-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-write-ws-'));
        wsId = 'test-ws-' + Date.now();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        await safeRm(dataDir);
        await safeRm(workspaceDir);
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: '127.0.0.1', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer): Promise<void> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
    }

    function wsDataDir(): string {
        return path.join(dataDir, 'repos', wsId);
    }

    function contentUrl(srv: ExecutionServer): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/content`;
    }

    // -------------------------------------------------------------------------
    // Happy path — notes directory (relative paths resolve against notesRoot)
    // -------------------------------------------------------------------------

    it('returns 200 when saving a file inside the notes directory (relative path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Relative path resolved against notesRoot — no "notes/" prefix needed
        const res = await putJSON(contentUrl(srv), { path: 'hello.md', content: '# Hello' });
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.updated).toBe(true);

        // File should be written inside the notes/ subdirectory
        const abs = path.join(wsDataDir(), 'notes', 'hello.md');
        expect(fs.readFileSync(abs, 'utf-8')).toBe('# Hello');
    });

    it('returns 200 when saving a nested note via relative path (regression: notes tree paths)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // This mirrors how the note editor saves a note selected from the tree
        const res = await putJSON(contentUrl(srv), { path: 'Meeting/Rollout-Weekly-Sync.md', content: '# Sync' });
        expect(res.status).toBe(200);

        const abs = path.join(wsDataDir(), 'notes', 'Meeting', 'Rollout-Weekly-Sync.md');
        expect(fs.readFileSync(abs, 'utf-8')).toBe('# Sync');
    });

    it('returns 200 when saving a file inside the notes directory (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const abs = path.join(wsDataDir(), 'notes', 'page.md');
        const res = await putJSON(contentUrl(srv), { path: abs, content: '# Page' });
        expect(res.status).toBe(200);
        expect(fs.readFileSync(abs, 'utf-8')).toBe('# Page');
    });

    // -------------------------------------------------------------------------
    // Happy path — tasks directory (scratchpad uses absolute paths)
    // -------------------------------------------------------------------------

    it('returns 200 when saving a .plan.md file inside the tasks directory (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Pre-create the file (simulating what the AI wrote)
        const taskDir = path.join(wsDataDir(), 'tasks', 'coc', 'chat');
        fs.mkdirSync(taskDir, { recursive: true });
        const abs = path.join(taskDir, 'my-feature.plan.md');
        fs.writeFileSync(abs, '## Old', 'utf-8');

        const res = await putJSON(contentUrl(srv), { path: abs, content: '## Updated' });
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.updated).toBe(true);
        expect(fs.readFileSync(abs, 'utf-8')).toBe('## Updated');
    });

    it('creates missing parent directories for a tasks path (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const abs = path.join(wsDataDir(), 'tasks', 'deep', 'new-file.md');
        const res = await putJSON(contentUrl(srv), { path: abs, content: '# New' });
        expect(res.status).toBe(200);
        expect(fs.existsSync(abs)).toBe(true);
        expect(fs.readFileSync(abs, 'utf-8')).toBe('# New');
    });

    // -------------------------------------------------------------------------
    // Happy path — ~/.copilot directory (session state files)
    // -------------------------------------------------------------------------

    it('returns 200 when saving a file inside ~/.copilot (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const copilotDir = path.join(os.homedir(), '.copilot', 'test-notes-write-handler-' + wsId);
        const testFile = path.join(copilotDir, 'plan.md');
        fs.mkdirSync(copilotDir, { recursive: true });
        try {
            const res = await putJSON(contentUrl(srv), { path: testFile, content: '# Plan' });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.updated).toBe(true);
            expect(fs.readFileSync(testFile, 'utf-8')).toBe('# Plan');
        } finally {
            fs.rmSync(copilotDir, { recursive: true, force: true });
        }
    });

    // -------------------------------------------------------------------------
    // Security — reject paths outside workspace data directory
    // -------------------------------------------------------------------------

    it('returns 403 for an absolute path outside the workspace data directory', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const outsidePath = path.join(os.tmpdir(), 'evil.md');
        const res = await putJSON(contentUrl(srv), { path: outsidePath, content: 'evil' });
        expect(res.status).toBe(403);
        const data = JSON.parse(res.body);
        expect(data.error).toMatch(/outside workspace data directory/);
    });

    it('returns 403 when path traverses out of workspace data directory via ..', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Relative path with traversal
        const res = await putJSON(contentUrl(srv), { path: '../../etc/passwd', content: 'evil' });
        expect(res.status).toBe(403);
    });

    // -------------------------------------------------------------------------
    // Validation errors
    // -------------------------------------------------------------------------

    it('returns 400 when path field is missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await putJSON(contentUrl(srv), { content: 'no path' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when content field is missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await putJSON(contentUrl(srv), { path: 'notes/hello.md' });
        expect(res.status).toBe(400);
    });
});
