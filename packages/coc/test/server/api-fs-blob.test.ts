/**
 * Tests for GET /api/fs/blob — trusted-directory file content endpoint.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRouter } from '../../src/server/shared/router';
import { registerApiFsRoutes } from '../../src/server/routes/api-fs-routes';
import type { Route } from '../../src/server/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let cleanupDirs: string[] = [];

function makeServer(dataDir?: string, workspaceRoots: string[] = []): http.Server {
    const routes: Route[] = [];
    registerApiFsRoutes(routes, {
        dataDir,
        workspaceProvider: {
            getWorkspaces: async () => workspaceRoots.map((rootPath, index) => ({
                id: `repo-${index}`,
                name: path.basename(rootPath),
                rootPath,
            })),
        },
    });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(dataDir?: string, workspaceRoots: string[] = []): Promise<void> {
    server = makeServer(dataDir, workspaceRoots);
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiGet(urlPath: string): Promise<{ status: number; body: any; raw: string }> {
    const res = await fetch(`${baseUrl}${urlPath}`);
    const raw = await res.text();
    let body: any;
    try { body = JSON.parse(raw); } catch { body = raw; }
    return { status: res.status, body, raw };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(async () => {
    // Create a temp directory under ~/.copilot for trusted access
    tmpDir = path.join(os.homedir(), '.copilot', '_test_fs_blob_' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    cleanupDirs = [];
});

afterEach(async () => {
    if (server) await stopServer();
    // Clean up temp files
    if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    for (const dir of cleanupDirs) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/fs/blob', () => {
    it('returns 404 when path query param is missing', async () => {
        await startServer();
        const { status } = await apiGet('/api/fs/blob');
        expect(status).toBe(404);
    });

    it('returns 403 for paths outside trusted directories', async () => {
        await startServer();
        const outsidePath = path.join(os.tmpdir(), 'not-trusted.txt');
        fs.writeFileSync(outsidePath, 'secret');
        try {
            const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(outsidePath)}`);
            expect(status).toBe(403);
            expect(body.error).toContain('outside trusted directories');
        } finally {
            fs.unlinkSync(outsidePath);
        }
    });

    it('returns utf-8 text content for text files within ~/.copilot', async () => {
        await startServer();
        const filePath = path.join(tmpDir, 'hello.md');
        fs.writeFileSync(filePath, '# Hello World');

        const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);
        expect(status).toBe(200);
        expect(body.content).toBe('# Hello World');
        expect(body.encoding).toBe('utf-8');
        expect(body.mimeType).toBe('text/markdown');
    });

    it('returns base64 content for binary files', async () => {
        await startServer();
        const filePath = path.join(tmpDir, 'image.png');
        // Write a buffer with null bytes to trigger binary detection
        const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
        fs.writeFileSync(filePath, buf);

        const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);
        expect(status).toBe(200);
        expect(body.encoding).toBe('base64');
        expect(body.mimeType).toBe('image/png');
    });

    it('returns 404 for non-existent files within trusted directory', async () => {
        await startServer();
        const filePath = path.join(tmpDir, 'does-not-exist.txt');
        const { status } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);
        expect(status).toBe(404);
    });

    it('returns 404 for directories', async () => {
        await startServer();
        const { status } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(tmpDir)}`);
        expect(status).toBe(404);
    });

    it('accepts paths within dataDir', async () => {
        const dataDirTmp = path.join(os.tmpdir(), '_test_datadir_' + Date.now());
        fs.mkdirSync(dataDirTmp, { recursive: true });
        const filePath = path.join(dataDirTmp, 'config.yaml');
        fs.writeFileSync(filePath, 'key: value');

        try {
            await startServer(dataDirTmp);
            const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);
            expect(status).toBe(200);
            expect(body.content).toBe('key: value');
            expect(body.encoding).toBe('utf-8');
        } finally {
            fs.rmSync(dataDirTmp, { recursive: true, force: true });
        }
    });

    it('accepts absolute paths within registered workspaces', async () => {
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), '_test_fs_blob_repo_'));
        cleanupDirs.push(repoDir);
        const filePath = path.join(repoDir, 'plans', 'goal.md');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '## Goal\nAllow repo files');

        await startServer(undefined, [repoDir]);

        const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);

        expect(status).toBe(200);
        expect(body.content).toBe('## Goal\nAllow repo files');
        expect(body.encoding).toBe('utf-8');
        expect(body.mimeType).toBe('text/markdown');
    });

    it('rejects sibling paths outside registered workspaces', async () => {
        const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), '_test_fs_blob_parent_'));
        cleanupDirs.push(parentDir);
        const repoDir = path.join(parentDir, 'repo');
        const siblingDir = path.join(parentDir, 'repo-sibling');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.mkdirSync(siblingDir, { recursive: true });
        const filePath = path.join(siblingDir, 'secret.md');
        fs.writeFileSync(filePath, 'not in repo');

        await startServer(undefined, [repoDir]);

        const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);

        expect(status).toBe(403);
        expect(body.error).toContain('outside trusted directories');
    });

    it('expands tilde in paths', async () => {
        await startServer();
        const filePath = path.join(tmpDir, 'tilde-test.txt');
        fs.writeFileSync(filePath, 'tilde works');

        // Replace homedir with ~ in the path
        const tildePath = filePath.replace(os.homedir(), '~');
        const { status, body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(tildePath)}`);
        expect(status).toBe(200);
        expect(body.content).toBe('tilde works');
    });

    it('detects correct mime types', async () => {
        await startServer();
        const cases = [
            { ext: '.ts', expected: 'application/typescript' },
            { ext: '.json', expected: 'application/json' },
            { ext: '.css', expected: 'text/css' },
            { ext: '.txt', expected: 'text/plain' },
        ];

        for (const { ext, expected } of cases) {
            const filePath = path.join(tmpDir, `test${ext}`);
            fs.writeFileSync(filePath, 'content');
            const { body } = await apiGet(`/api/fs/blob?path=${encodeURIComponent(filePath)}`);
            expect(body.mimeType).toBe(expected);
        }
    });
});
