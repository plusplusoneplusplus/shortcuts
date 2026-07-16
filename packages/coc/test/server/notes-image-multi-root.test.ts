/**
 * Notes Image Handler — Multi-Root Tests
 *
 * Covers image upload and serving for both the default managed root
 * and repo-folder roots:
 * - Default root: images stored in `.attachments/` (backward compat)
 * - Repo-folder root: images stored co-located in `.images/`
 * - Security: unconfigured root rejected, path traversal rejected
 * - Response includes rootId
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { writeRepoPreferences } from '../../src/server/preferences-handler';
import { safeRm } from '../helpers/safe-rm';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; rawBody: Buffer }> {
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
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode ?? 0,
                        body: rawBody.toString('utf-8'),
                        rawBody,
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown): Promise<{ status: number; body: string; rawBody: Buffer }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

// Minimal valid 1x1 PNG (base64)
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

// ============================================================================
// Tests
// ============================================================================

describe('Notes Image Handler — Multi-Root', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-img-mr-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-img-mr-ws-'));
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

    function configureRoots(roots: string[]): void {
        writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: roots });
    }

    function writeTaskSettings(folderPaths: string[]): void {
        const settingsPath = getRepoDataPath(dataDir, wsId, 'tasks-settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ folderPaths }, null, 2), 'utf-8');
    }

    async function listRoots(srv: ExecutionServer): Promise<any[]> {
        const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/roots`);
        expect(res.status).toBe(200);
        return JSON.parse(res.body).roots;
    }

    // ========================================================================
    // Upload (POST) — default root backward compat
    // ========================================================================

    describe('POST — default root', () => {
        it('stores image in .attachments/ and returns rootId=default', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'shot.png',
                data: TINY_PNG_DATA_URL,
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/^\.attachments\/[0-9a-f-]+\.png$/);
            expect(body.rootId).toBe('default');

            // Verify file exists in managed area
            const notesRoot = getRepoDataPath(dataDir, wsId, 'notes');
            expect(fs.existsSync(path.join(notesRoot, body.path))).toBe(true);
        });

        it('stores image in .attachments/ when root=default explicitly', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'shot.png',
                data: TINY_PNG_DATA_URL,
                root: 'default',
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/^\.attachments\//);
            expect(body.rootId).toBe('default');
        });
    });

    // ========================================================================
    // Upload (POST) — repo-folder root
    // ========================================================================

    describe('POST — repo-folder root', () => {
        it('stores image co-located in .images/ under the repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Create the repo-folder root directory
            const repoRoot = 'docs/notes';
            fs.mkdirSync(path.join(workspaceDir, repoRoot), { recursive: true });
            configureRoots([repoRoot]);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'diagram.png',
                data: TINY_PNG_DATA_URL,
                root: repoRoot,
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/^\.images\/[0-9a-f-]+\.png$/);
            expect(body.rootId).toBe(repoRoot);

            // Verify file is co-located in the workspace repo
            const absPath = path.join(workspaceDir, repoRoot, body.path);
            expect(fs.existsSync(absPath)).toBe(true);

            // Verify NOT in managed area
            const managedImagesDir = path.join(getRepoDataPath(dataDir, wsId, 'notes'), '.images');
            expect(fs.existsSync(managedImagesDir)).toBe(false);
        });

        it('rejects upload to an unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'shot.png',
                data: TINY_PNG_DATA_URL,
                root: 'not-configured',
            });

            expect(res.status).toBe(400);
            expect(res.body).toContain('not configured');
        });

        it('rejects task-root image access through symlinks and Windows-style paths', async () => {
            const primaryRoot = getRepoDataPath(dataDir, wsId, 'tasks');
            const outsideRoot = getRepoDataPath(dataDir, wsId, 'outside-image-root');
            fs.mkdirSync(primaryRoot, { recursive: true });
            fs.mkdirSync(outsideRoot, { recursive: true });
            fs.writeFileSync(path.join(outsideRoot, 'secret.png'), Buffer.from(TINY_PNG_BASE64, 'base64'));
            fs.symlinkSync(
                outsideRoot,
                path.join(primaryRoot, '.images'),
                process.platform === 'win32' ? 'junction' : 'dir',
            );

            const srv = await startServer();
            await registerWorkspace(srv);
            const rootsRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/roots`);
            expect(rootsRes.status).toBe(200);
            const rootId = JSON.parse(rootsRes.body).roots.find((root: any) => root.label === 'Task Plans')?.rootId;
            expect(rootId).toMatch(/^task:[a-f0-9]{64}$/);

            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'diagram.png',
                data: TINY_PNG_DATA_URL,
                root: rootId,
            });
            expect(uploadRes.status).toBe(403);

            const symlinkRead = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent('.images/secret.png')}&root=${encodeURIComponent(rootId)}`,
            );
            expect(symlinkRead.status).toBe(403);

            for (const invalidPath of ['C:\\outside\\secret.png', '\\\\server\\share\\secret.png']) {
                const response = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(invalidPath)}&root=${encodeURIComponent(rootId)}`,
                );
                expect(response.status, invalidPath).toBe(403);
            }

            expect(fs.readdirSync(outsideRoot)).toEqual(['secret.png']);
        });
    });

    describe('task-derived collections', () => {
        it('uploads and serves images in isolation across every task-root source', async () => {
            const primaryRoot = getRepoDataPath(dataDir, wsId, 'tasks');
            const legacyRoot = path.join(workspaceDir, '.vscode', 'tasks');
            const relativeRoot = path.join(workspaceDir, 'plans', 'relative');
            const absoluteRoot = path.join(workspaceDir, 'configured-absolute-plans');
            const taskRoots = [
                { label: 'Task Plans', directory: primaryRoot },
                { label: 'Legacy Plans (.vscode/tasks)', directory: legacyRoot },
                { label: 'plans/relative', directory: relativeRoot },
                { label: absoluteRoot, directory: absoluteRoot },
            ];
            const basePng = Buffer.from(TINY_PNG_BASE64, 'base64');
            const seededImages = taskRoots.map((root, index) => {
                const image = Buffer.concat([basePng, Buffer.from(`seed-root-${index}`)]);
                fs.mkdirSync(path.join(root.directory, '.images'), { recursive: true });
                fs.writeFileSync(path.join(root.directory, '.images', 'shared.png'), image);
                return image;
            });
            writeTaskSettings(['plans/relative', absoluteRoot]);

            const srv = await startServer();
            await registerWorkspace(srv);
            const listed = await listRoots(srv);
            const entries = taskRoots.map(root => {
                const entry = listed.find(candidate => candidate.label === root.label);
                expect(entry).toMatchObject({ isDefault: false, isProtected: true });
                expect(entry.rootId).toMatch(/^task:[a-f0-9]{64}$/);
                return { ...root, rootId: entry.rootId as string };
            });
            expect(new Set(entries.map(entry => entry.rootId)).size).toBe(taskRoots.length);

            for (const [index, entry] of entries.entries()) {
                const rootQuery = encodeURIComponent(entry.rootId);
                const seededRes = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent('.images/shared.png')}&root=${rootQuery}`,
                );
                expect(seededRes.status).toBe(200);
                expect(seededRes.rawBody).toEqual(seededImages[index]);

                const uploadedImage = Buffer.concat([basePng, Buffer.from(`uploaded-root-${index}`)]);
                const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                    fileName: 'diagram.png',
                    data: `data:image/png;base64,${uploadedImage.toString('base64')}`,
                    root: entry.rootId,
                });
                expect(uploadRes.status).toBe(201);
                const upload = JSON.parse(uploadRes.body);
                expect(upload.rootId).toBe(entry.rootId);
                expect(upload.path).toMatch(/^\.images\/[0-9a-f-]+\.png$/);
                expect(fs.readFileSync(path.join(entry.directory, upload.path))).toEqual(uploadedImage);

                const reloadRes = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(upload.path)}&root=${rootQuery}`,
                );
                expect(reloadRes.status).toBe(200);
                expect(reloadRes.rawBody).toEqual(uploadedImage);

                for (const otherEntry of entries) {
                    if (otherEntry.rootId === entry.rootId) {
                        continue;
                    }
                    expect(fs.existsSync(path.join(otherEntry.directory, upload.path))).toBe(false);
                }
            }
        });
    });

    // ========================================================================
    // Serve (GET) — default root backward compat
    // ========================================================================

    describe('GET — default root', () => {
        it('serves image from .attachments/ in default root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Upload first
            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'shot.png',
                data: TINY_PNG_DATA_URL,
            });
            expect(uploadRes.status).toBe(201);
            const { path: imgPath } = JSON.parse(uploadRes.body);

            // Serve
            const getRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(imgPath)}`,
            );
            expect(getRes.status).toBe(200);
        });
    });

    // ========================================================================
    // Serve (GET) — repo-folder root
    // ========================================================================

    describe('GET — repo-folder root', () => {
        it('serves image from .images/ in repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const repoRoot = 'docs/notes';
            fs.mkdirSync(path.join(workspaceDir, repoRoot), { recursive: true });
            configureRoots([repoRoot]);

            // Upload
            const uploadRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/image`, {
                fileName: 'diagram.png',
                data: TINY_PNG_DATA_URL,
                root: repoRoot,
            });
            expect(uploadRes.status).toBe(201);
            const { path: imgPath } = JSON.parse(uploadRes.body);

            // Serve with root param
            const getRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(imgPath)}&root=${encodeURIComponent(repoRoot)}`,
            );
            expect(getRes.status).toBe(200);
        });

        it('rejects serving from an unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const getRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=.images/test.png&root=unconfigured`,
            );
            expect(getRes.status).toBe(400);
            expect(getRes.body).toContain('not configured');
        });

        it('rejects path traversal outside .images/ in repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const repoRoot = 'docs/notes';
            fs.mkdirSync(path.join(workspaceDir, repoRoot), { recursive: true });
            configureRoots([repoRoot]);

            // Try to escape .images/ directory
            const getRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=../../../etc/passwd&root=${encodeURIComponent(repoRoot)}`,
            );
            expect(getRes.status).toBe(403);
        });

        it('rejects serving file outside .images/ dir in repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const repoRoot = 'docs/notes';
            fs.mkdirSync(path.join(workspaceDir, repoRoot), { recursive: true });
            // Create a file at root level (not inside .images/)
            fs.writeFileSync(path.join(workspaceDir, repoRoot, 'secret.txt'), 'secret');
            configureRoots([repoRoot]);

            const getRes = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/image?path=secret.txt&root=${encodeURIComponent(repoRoot)}`,
            );
            expect(getRes.status).toBe(403);
        });
    });
});
