/**
 * Notes Read Handler Tests
 *
 * Tests for GET /api/workspaces/:id/notes/content path resolution:
 * - Relative paths resolve against notesRoot (~/.coc/repos/<wsId>/notes/)
 * - Absolute paths inside wsDataDir or ~/.copilot are allowed
 * - Absolute paths outside allowed directories are rejected with 403
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
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

// ============================================================================
// Tests
// ============================================================================

describe('Notes Read Handler — GET /notes/content security', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-read-handler-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-read-ws-'));
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

    function writeFile(relPath: string, content: string): string {
        const abs = path.join(wsDataDir(), relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
        return abs;
    }

    function contentUrl(srv: ExecutionServer, filePath: string): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/content?path=${encodeURIComponent(filePath)}`;
    }

    // -------------------------------------------------------------------------
    // Happy path — notes directory (relative paths resolve against notesRoot)
    // -------------------------------------------------------------------------

    it('returns 200 for a file inside the notes directory (relative path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        writeFile('notes/hello.md', '# Hello');

        // Relative path resolved against notesRoot — no "notes/" prefix needed
        const res = await request(contentUrl(srv, 'hello.md'));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.content).toBe('# Hello');
    });

    it('returns 200 for a nested note via relative path (regression: notes tree paths)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        writeFile('notes/Meeting/Rollout-Weekly-Sync.md', '# Rollout Sync');

        // This is what the notes tree API returns: paths relative to notesRoot
        const res = await request(contentUrl(srv, 'Meeting/Rollout-Weekly-Sync.md'));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.content).toBe('# Rollout Sync');
    });

    it('returns 200 for a file inside the notes directory (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        const abs = writeFile('notes/page.md', '# Page');

        const res = await request(contentUrl(srv, abs));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.content).toBe('# Page');
    });

    // -------------------------------------------------------------------------
    // Happy path — tasks directory (scratchpad uses absolute paths)
    // -------------------------------------------------------------------------

    it('returns 200 for a .plan.md file inside the tasks directory (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        const abs = writeFile('tasks/coc/chat/my-feature.plan.md', '## Plan\n\nDo things.');

        const res = await request(contentUrl(srv, abs));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.content).toBe('## Plan\n\nDo things.');
    });

    it('returns 200 for any .md file inside the workspace data directory (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        const abs = writeFile('tasks/notes.md', '# Notes');

        const res = await request(contentUrl(srv, abs));
        expect(res.status).toBe(200);
    });

    // -------------------------------------------------------------------------
    // Happy path — ~/.copilot directory (session state files)
    // -------------------------------------------------------------------------

    it('returns 200 for a file inside ~/.copilot (absolute path)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const copilotDir = path.join(os.homedir(), '.copilot', 'test-notes-read-handler-' + wsId);
        const testFile = path.join(copilotDir, 'session.md');
        fs.mkdirSync(copilotDir, { recursive: true });
        fs.writeFileSync(testFile, '# Session Note', 'utf-8');
        try {
            const res = await request(contentUrl(srv, testFile));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.content).toBe('# Session Note');
        } finally {
            fs.rmSync(copilotDir, { recursive: true, force: true });
        }
    });

    // -------------------------------------------------------------------------
    // Happy path — workspace root directory (repo files via absolute path)
    // -------------------------------------------------------------------------

    it('returns 200 for an absolute path inside the workspace rootPath (regression: repo skill files)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Create a file inside the workspace root directory (simulating a repo file)
        const skillFile = path.join(workspaceDir, '.github', 'skills', 'help-me-review', 'SKILL.md');
        fs.mkdirSync(path.dirname(skillFile), { recursive: true });
        fs.writeFileSync(skillFile, '# Help Me Review\n\nSkill content.', 'utf-8');

        const res = await request(contentUrl(srv, skillFile));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.content).toBe('# Help Me Review\n\nSkill content.');
    });

    // -------------------------------------------------------------------------
    // Security — reject paths outside workspace data directory
    // -------------------------------------------------------------------------

    it('returns 403 for an absolute path outside the workspace data directory', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Pick a path that definitely exists but is outside wsDataDir
        const outsidePath = os.tmpdir();
        const res = await request(contentUrl(srv, path.join(outsidePath, 'evil.md')));
        expect(res.status).toBe(403);
        const data = JSON.parse(res.body);
        expect(data.error).toMatch(/outside workspace data directory/);
    });

    it('returns 400 when path query param is missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/content`);
        expect(res.status).toBe(400);
    });

    it('returns 404 when file does not exist inside workspace data directory', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const abs = path.join(wsDataDir(), 'tasks', 'nonexistent.md');
        const res = await request(contentUrl(srv, abs));
        expect(res.status).toBe(404);
    });
});
