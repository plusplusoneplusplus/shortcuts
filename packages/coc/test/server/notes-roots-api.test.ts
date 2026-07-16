/**
 * Notes Roots Management API Tests
 *
 * Tests for the dedicated roots management endpoints:
 *   GET    /api/workspaces/:id/notes/roots       — list roots
 *   POST   /api/workspaces/:id/notes/roots       — add a root
 *   DELETE /api/workspaces/:id/notes/roots        — remove a root
 *
 * Verifies:
 * - Default root always present in list
 * - Adding valid roots persists them
 * - Duplicate rejection (409)
 * - Max limit enforcement
 * - Validation: path traversal, absolute paths, empty
 * - Cannot remove default root
 * - Removing non-existent root returns 404
 * - Removing a configured root works and persists
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { writeRepoPreferences, readRepoPreferences } from '../../src/server/preferences-handler';
import { safeRm } from '../helpers/safe-rm';
import { MAX_ADDITIONAL_NOTES_ROOTS } from '../../src/server/notes/notes-root-resolver';

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

function postJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

function deleteJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Roots Management API', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-roots-api-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-roots-api-ws-'));
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

    function rootsUrl(srv: ExecutionServer): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/roots`;
    }

    function writeTaskSettings(folderPaths: string[]): void {
        const settingsPath = getRepoDataPath(dataDir, wsId, 'tasks-settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ folderPaths }, null, 2), 'utf-8');
    }

    // ========================================================================
    // GET /api/workspaces/:id/notes/roots
    // ========================================================================

    describe('GET /notes/roots', () => {
        it('returns default root when no additional roots configured', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(rootsUrl(srv));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.roots).toHaveLength(1);
            expect(data.roots[0]).toEqual({ rootId: 'default', label: 'Notes', isDefault: true });
            expect(data.maxAdditionalRoots).toBe(MAX_ADDITIONAL_NOTES_ROOTS);
        });

        it('includes additional configured roots', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: ['docs/notes', 'wiki'] });

            const res = await request(rootsUrl(srv));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.roots).toHaveLength(3);
            expect(data.roots[0].isDefault).toBe(true);
            expect(data.roots[1]).toEqual({ rootId: 'docs/notes', label: 'docs/notes', isDefault: false });
            expect(data.roots[2]).toEqual({ rootId: 'wiki', label: 'wiki', isDefault: false });
        });

        it('discovers existing primary, legacy, relative, and absolute task roots with protected labels', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const primary = getRepoDataPath(dataDir, wsId, 'tasks');
            const legacy = path.join(workspaceDir, '.vscode', 'tasks');
            const relative = path.join(workspaceDir, 'plans', 'team');
            const absolute = path.join(workspaceDir, 'absolute-plans');
            for (const directory of [primary, legacy, relative, absolute]) {
                fs.mkdirSync(directory, { recursive: true });
            }
            writeTaskSettings(['plans/team', absolute]);

            const res = await request(rootsUrl(srv));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            const taskRoots = data.roots.filter((root: any) => root.isProtected && !root.isDefault);
            expect(taskRoots.map((root: any) => root.label)).toEqual([
                'Task Plans',
                'Legacy Plans (.vscode/tasks)',
                'plans/team',
                absolute,
            ]);
            expect(taskRoots.every((root: any) => /^task:[a-f0-9]{64}$/.test(root.rootId))).toBe(true);
            expect(readRepoPreferences(dataDir, wsId).additionalNotesRoots).toBeUndefined();
            expect(JSON.parse(fs.readFileSync(getRepoDataPath(dataDir, wsId, 'tasks-settings.json'), 'utf-8')))
                .toEqual({ folderPaths: ['plans/team', absolute] });
        });

        it('refreshes task-derived roots from directory existence without persisting discovery', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeTaskSettings(['plans/later']);

            let res = await request(rootsUrl(srv));
            expect(JSON.parse(res.body).roots.map((root: any) => root.label)).toEqual(['Notes']);

            const appearingRoot = path.join(workspaceDir, 'plans', 'later');
            fs.mkdirSync(appearingRoot, { recursive: true });
            res = await request(rootsUrl(srv));
            expect(JSON.parse(res.body).roots.map((root: any) => root.label)).toEqual(['Notes', 'plans/later']);

            fs.rmSync(appearingRoot, { recursive: true });
            res = await request(rootsUrl(srv));
            expect(JSON.parse(res.body).roots.map((root: any) => root.label)).toEqual(['Notes']);
        });

        it('deduplicates canonical task paths and hides an overlapping additional Notes root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            const sharedRoot = path.join(workspaceDir, 'plans', 'shared');
            fs.mkdirSync(sharedRoot, { recursive: true });
            writeTaskSettings(['plans/shared', sharedRoot, 'plans/shared/.']);
            writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: ['plans/shared', 'ordinary-notes'] });

            const res = await request(rootsUrl(srv));
            const roots = JSON.parse(res.body).roots;
            expect(roots.filter((root: any) => root.label === 'plans/shared')).toEqual([
                expect.objectContaining({ isProtected: true, isDefault: false }),
            ]);
            expect(roots.filter((root: any) => root.label === sharedRoot)).toHaveLength(0);
            expect(roots).toContainEqual({ rootId: 'ordinary-notes', label: 'ordinary-notes', isDefault: false });
        });

        it('keeps discovered task roots scoped to the requested workspace', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            fs.mkdirSync(getRepoDataPath(dataDir, wsId, 'tasks'), { recursive: true });

            const otherWsId = `${wsId}-other`;
            const otherWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-roots-api-other-ws-'));
            try {
                const registered = await postJSON(`${srv.url}/api/workspaces`, {
                    id: otherWsId,
                    name: 'Other Workspace',
                    rootPath: otherWorkspaceDir,
                });
                expect(registered.status).toBe(201);
                fs.mkdirSync(path.join(otherWorkspaceDir, '.vscode', 'tasks'), { recursive: true });

                const first = JSON.parse((await request(rootsUrl(srv))).body).roots;
                const second = JSON.parse((await request(
                    `${srv.url}/api/workspaces/${otherWsId}/notes/roots`,
                )).body).roots;
                expect(first.map((root: any) => root.label)).toEqual(['Notes', 'Task Plans']);
                expect(second.map((root: any) => root.label)).toEqual(['Notes', 'Legacy Plans (.vscode/tasks)']);
            } finally {
                await safeRm(otherWorkspaceDir);
            }
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/notes/roots
    // ========================================================================

    describe('POST /notes/roots', () => {
        it('adds a new root and returns 201', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: 'docs/notes' });
            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.rootId).toBe('docs/notes');
            expect(data.isDefault).toBe(false);

            // Verify persisted
            const prefs = readRepoPreferences(dataDir, wsId);
            expect(prefs.additionalNotesRoots).toContain('docs/notes');
        });

        it('normalizes backslashes in rootPath', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: 'docs\\notes' });
            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.rootId).toBe('docs/notes');
        });

        it('strips trailing slashes', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: 'docs/notes/' });
            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.rootId).toBe('docs/notes');
        });

        it('rejects duplicate root with 409', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            await postJSON(rootsUrl(srv), { rootPath: 'docs' });
            const dup = await postJSON(rootsUrl(srv), { rootPath: 'docs' });
            expect(dup.status).toBe(409);
        });

        it('rejects empty rootPath with 400', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: '' });
            expect(res.status).toBe(400);
        });

        it('rejects missing rootPath field with 400', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), {});
            expect(res.status).toBe(400);
        });

        it('rejects absolute paths with 400', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: '/absolute/path' });
            expect(res.status).toBe(400);
        });

        it('rejects parent traversal paths with 400', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: '../outside' });
            expect(res.status).toBe(400);
        });

        it('rejects workspace root itself with 400', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(rootsUrl(srv), { rootPath: '.' });
            expect(res.status).toBe(400);
        });

        it('enforces max additional roots limit', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Pre-fill to max
            const roots = Array.from({ length: MAX_ADDITIONAL_NOTES_ROOTS }, (_, i) => `root${i}`);
            writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: roots });

            const res = await postJSON(rootsUrl(srv), { rootPath: 'one-too-many' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toMatch(/maximum/i);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/notes/roots
    // ========================================================================

    describe('DELETE /notes/roots', () => {
        it('removes an existing root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: ['docs', 'wiki'] });

            const res = await deleteJSON(rootsUrl(srv), { rootPath: 'docs' });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.removed).toBe('docs');

            // Verify persisted
            const prefs = readRepoPreferences(dataDir, wsId);
            expect(prefs.additionalNotesRoots).toEqual(['wiki']);
        });

        it('returns 404 for non-existent root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await deleteJSON(rootsUrl(srv), { rootPath: 'nonexistent' });
            expect(res.status).toBe(404);
        });

        it('cannot remove the default root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await deleteJSON(rootsUrl(srv), { rootPath: 'default' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toMatch(/default/i);
        });

        it('rejects empty rootPath', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await deleteJSON(rootsUrl(srv), { rootPath: '' });
            expect(res.status).toBe(400);
        });

        it('normalizes backslashes before matching', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: ['docs/notes'] });

            const res = await deleteJSON(rootsUrl(srv), { rootPath: 'docs\\notes' });
            expect(res.status).toBe(200);

            const prefs = readRepoPreferences(dataDir, wsId);
            expect(prefs.additionalNotesRoots).toEqual([]);
        });

        it('rejects removal of a task-derived root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            fs.mkdirSync(getRepoDataPath(dataDir, wsId, 'tasks'), { recursive: true });
            const listed = JSON.parse((await request(rootsUrl(srv))).body).roots;
            const taskRoot = listed.find((root: any) => root.label === 'Task Plans');

            const res = await deleteJSON(rootsUrl(srv), { rootPath: taskRoot.rootId });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toMatch(/protected/i);
            expect(fs.existsSync(getRepoDataPath(dataDir, wsId, 'tasks'))).toBe(true);
        });
    });

    // ========================================================================
    // Round-trip
    // ========================================================================

    describe('round-trip: add → list → remove → list', () => {
        it('completes a full lifecycle', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Start empty
            let res = await request(rootsUrl(srv));
            expect(JSON.parse(res.body).roots).toHaveLength(1);

            // Add two roots
            await postJSON(rootsUrl(srv), { rootPath: 'docs' });
            await postJSON(rootsUrl(srv), { rootPath: 'wiki' });

            // List should show 3 (default + 2)
            res = await request(rootsUrl(srv));
            const listed = JSON.parse(res.body).roots;
            expect(listed).toHaveLength(3);
            expect(listed.map((r: any) => r.rootId)).toEqual(['default', 'docs', 'wiki']);

            // Remove one
            await deleteJSON(rootsUrl(srv), { rootPath: 'docs' });

            // List should show 2
            res = await request(rootsUrl(srv));
            const remaining = JSON.parse(res.body).roots;
            expect(remaining).toHaveLength(2);
            expect(remaining.map((r: any) => r.rootId)).toEqual(['default', 'wiki']);
        });
    });
});
