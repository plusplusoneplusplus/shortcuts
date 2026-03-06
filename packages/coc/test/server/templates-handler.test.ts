/**
 * Templates Handler Tests
 *
 * Comprehensive tests for the Template CRUD REST API endpoints:
 * list, read single (with commit enrichment), create, update (merge), delete.
 *
 * Tests handlers in isolation with a lightweight HTTP server and mock store.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { registerTemplateRoutes, registerTemplateWriteRoutes } from '../../src/server/templates-handler';
import type { Route } from '@plusplusoneplusplus/coc-server';
import type { ProcessStore, Workspace } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Mock GitLogService
// ============================================================================

const mockGetCommit = vi.fn();
const mockDispose = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core/git', () => ({
    GitLogService: vi.fn().mockImplementation(() => ({
        getCommit: mockGetCommit,
        dispose: mockDispose,
    })),
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockStore(workspaces: Workspace[]): ProcessStore {
    return {
        getWorkspaces: vi.fn().mockResolvedValue(workspaces),
    } as unknown as ProcessStore;
}

function createTmpWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'templates-handler-test-'));
}

function createTemplatesDir(rootPath: string): string {
    const dir = path.join(rootPath, '.vscode', 'templates');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function writeTemplate(rootPath: string, name: string, content: Record<string, unknown>): void {
    const dir = createTemplatesDir(rootPath);
    fs.writeFileSync(path.join(dir, `${name}.yaml`), yaml.dump(content), 'utf-8');
}

/**
 * Lightweight test HTTP server that routes requests through registered Route handlers.
 */
function createTestServer(routes: Route[]): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve) => {
        const server = http.createServer(async (req, res) => {
            const method = req.method || 'GET';
            const pathname = new URL(req.url || '/', `http://localhost`).pathname;

            for (const route of routes) {
                if (route.method && route.method !== method) continue;

                if (route.pattern instanceof RegExp) {
                    const match = pathname.match(route.pattern);
                    if (match) {
                        try {
                            await route.handler(req, res, match);
                        } catch (err: any) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: err.message }));
                        }
                        return;
                    }
                }
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        });

        server.listen(0, 'localhost', () => {
            const addr = server.address() as { port: number };
            resolve({ server, url: `http://localhost:${addr.port}` });
        });
    });
}

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
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteReq(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Templates Handler', () => {
    let workspaceDir: string;
    let testServer: { server: http.Server; url: string } | undefined;
    const cleanupDirs: string[] = [];

    beforeEach(() => {
        workspaceDir = createTmpWorkspace();
        cleanupDirs.push(workspaceDir);
        mockGetCommit.mockReset();
        mockDispose.mockReset();
    });

    afterEach(async () => {
        if (testServer) {
            await new Promise<void>((resolve) => testServer!.server.close(() => resolve()));
            testServer = undefined;
        }
        for (const dir of cleanupDirs) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        cleanupDirs.length = 0;
    });

    async function startServer(opts?: { onTemplatesChanged?: (id: string) => void }): Promise<string> {
        const workspace: Workspace = {
            id: 'ws1',
            name: 'Test Workspace',
            rootPath: workspaceDir,
        };
        const store = createMockStore([workspace]);
        const routes: Route[] = [];
        registerTemplateRoutes(routes, store);
        registerTemplateWriteRoutes(routes, store, opts?.onTemplatesChanged);
        testServer = await createTestServer(routes);
        return testServer.url;
    }

    // ========================================================================
    // GET /api/workspaces/:id/templates — List
    // ========================================================================

    describe('GET /api/workspaces/:id/templates', () => {
        it('should return empty array when templates directory does not exist', async () => {
            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates`);
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.templates).toEqual([]);
        });

        it('should list YAML files in templates directory', async () => {
            writeTemplate(workspaceDir, 'tmpl-a', { name: 'tmpl-a', kind: 'commit', commitHash: 'abc123' });
            writeTemplate(workspaceDir, 'tmpl-b', { name: 'tmpl-b', kind: 'commit', commitHash: 'def456' });

            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.templates).toHaveLength(2);

            const names = data.templates.map((t: any) => t._fileName).sort();
            expect(names).toEqual(['tmpl-a', 'tmpl-b']);
        });

        it('should skip malformed YAML files', async () => {
            const templatesDir = createTemplatesDir(workspaceDir);
            writeTemplate(workspaceDir, 'good', { name: 'good', kind: 'commit', commitHash: 'abc' });
            fs.writeFileSync(path.join(templatesDir, 'bad.yaml'), '{ invalid: [yaml:', 'utf-8');

            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.templates).toHaveLength(1);
            expect(data.templates[0]._fileName).toBe('good');
        });

        it('should filter to only .yaml and .yml files', async () => {
            const templatesDir = createTemplatesDir(workspaceDir);
            writeTemplate(workspaceDir, 'valid', { name: 'valid', kind: 'commit', commitHash: 'abc' });
            fs.writeFileSync(path.join(templatesDir, 'readme.md'), '# Not a template', 'utf-8');
            fs.writeFileSync(path.join(templatesDir, 'data.json'), '{}', 'utf-8');

            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.templates).toHaveLength(1);
        });

        it('should return 404 for unknown workspace', async () => {
            const url = await startServer();
            const res = await request(`${url}/api/workspaces/nonexistent/templates`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/templates/:name — Read Single
    // ========================================================================

    describe('GET /api/workspaces/:id/templates/:name', () => {
        it('should return 404 for missing template', async () => {
            createTemplatesDir(workspaceDir);
            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates/nonexistent`);
            expect(res.status).toBe(404);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('Template not found');
        });

        it('should return single template with _fileName', async () => {
            writeTemplate(workspaceDir, 'my-tmpl', {
                name: 'my-tmpl',
                kind: 'commit',
                commitHash: 'abc123',
                description: 'A test template',
            });

            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates/my-tmpl`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data._fileName).toBe('my-tmpl');
            expect(data.name).toBe('my-tmpl');
            expect(data.kind).toBe('commit');
            expect(data.commitHash).toBe('abc123');
            expect(data.description).toBe('A test template');
        });

        it('should enrich commit templates with git metadata', async () => {
            writeTemplate(workspaceDir, 'commit-tmpl', {
                name: 'commit-tmpl',
                kind: 'commit',
                commitHash: 'abc123def',
            });

            mockGetCommit.mockReturnValue({
                shortHash: 'abc123d',
                subject: 'feat: add feature',
                authorName: 'Test Author',
                date: '2025-01-01',
                relativeDate: '3 months ago',
            });

            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates/commit-tmpl`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data._commit).toBeDefined();
            expect(data._commit.shortHash).toBe('abc123d');
            expect(data._commit.subject).toBe('feat: add feature');
            expect(data._commit.authorName).toBe('Test Author');
            expect(data._commit.date).toBe('2025-01-01');
            expect(data._commit.relativeDate).toBe('3 months ago');
        });

        it('should not include _commit when kind is not commit', async () => {
            writeTemplate(workspaceDir, 'other-tmpl', {
                name: 'other-tmpl',
                kind: 'other',
            });

            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates/other-tmpl`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data._commit).toBeUndefined();
        });

        it('should return 403 for path traversal attempt', async () => {
            createTemplatesDir(workspaceDir);
            const url = await startServer();
            const res = await request(`${url}/api/workspaces/ws1/templates/..%2F..%2Fetc%2Fpasswd`);
            expect(res.status).toBe(403);
        });

        it('should return 404 for unknown workspace', async () => {
            const url = await startServer();
            const res = await request(`${url}/api/workspaces/nonexistent/templates/test`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/templates — Create
    // ========================================================================

    describe('POST /api/workspaces/:id/templates', () => {
        it('should create a new template file', async () => {
            const onChanged = vi.fn();
            const url = await startServer({ onTemplatesChanged: onChanged });

            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'new-tmpl',
                kind: 'commit',
                commitHash: 'abc123',
                description: 'A new template',
            });

            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.name).toBe('new-tmpl');

            // Verify file was written
            const filePath = path.join(workspaceDir, '.vscode', 'templates', 'new-tmpl.yaml');
            expect(fs.existsSync(filePath)).toBe(true);

            const content = yaml.load(fs.readFileSync(filePath, 'utf-8')) as any;
            expect(content.name).toBe('new-tmpl');
            expect(content.kind).toBe('commit');
            expect(content.commitHash).toBe('abc123');
            expect(content.description).toBe('A new template');
        });

        it('should call onTemplatesChanged after create', async () => {
            const onChanged = vi.fn();
            const url = await startServer({ onTemplatesChanged: onChanged });

            await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'callback-test',
                kind: 'commit',
                commitHash: 'abc123',
            });

            expect(onChanged).toHaveBeenCalledWith('ws1');
        });

        it('should create .vscode/templates/ directory if missing', async () => {
            const url = await startServer();
            const templatesDir = path.join(workspaceDir, '.vscode', 'templates');
            expect(fs.existsSync(templatesDir)).toBe(false);

            await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'first-tmpl',
                kind: 'commit',
                commitHash: 'abc123',
            });

            expect(fs.existsSync(templatesDir)).toBe(true);
        });

        it('should return 409 on duplicate template', async () => {
            writeTemplate(workspaceDir, 'existing', {
                name: 'existing',
                kind: 'commit',
                commitHash: 'abc123',
            });

            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'existing',
                kind: 'commit',
                commitHash: 'def456',
            });

            expect(res.status).toBe(409);
        });

        it('should return 400 when name is missing', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                kind: 'commit',
                commitHash: 'abc123',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('name');
        });

        it('should return 400 when kind is missing', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'test',
                commitHash: 'abc123',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('kind');
        });

        it('should return 400 for unsupported kind', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'test',
                kind: 'unknown',
                commitHash: 'abc123',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Unsupported template kind');
        });

        it('should return 400 when commitHash is missing for commit kind', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'test',
                kind: 'commit',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('commitHash');
        });

        it('should return 403 for path traversal in name', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: '../escape',
                kind: 'commit',
                commitHash: 'abc123',
            });
            expect(res.status).toBe(403);
        });

        it('should return 403 for name with backslash', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: '..\\escape',
                kind: 'commit',
                commitHash: 'abc123',
            });
            expect(res.status).toBe(403);
        });

        it('should filter non-string hints', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/ws1/templates`, {
                name: 'hints-test',
                kind: 'commit',
                commitHash: 'abc123',
                hints: ['valid-hint', 42, 'another-hint', null],
            });
            expect(res.status).toBe(201);

            const filePath = path.join(workspaceDir, '.vscode', 'templates', 'hints-test.yaml');
            const content = yaml.load(fs.readFileSync(filePath, 'utf-8')) as any;
            expect(content.hints).toEqual(['valid-hint', 'another-hint']);
        });

        it('should return 404 for unknown workspace', async () => {
            const url = await startServer();
            const res = await postJSON(`${url}/api/workspaces/nonexistent/templates`, {
                name: 'test',
                kind: 'commit',
                commitHash: 'abc123',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/templates/:name — Update
    // ========================================================================

    describe('PATCH /api/workspaces/:id/templates/:name', () => {
        it('should merge allowed fields into existing template', async () => {
            writeTemplate(workspaceDir, 'update-me', {
                name: 'update-me',
                kind: 'commit',
                commitHash: 'abc123',
                description: 'original',
            });

            const onChanged = vi.fn();
            const url = await startServer({ onTemplatesChanged: onChanged });
            const res = await patchJSON(`${url}/api/workspaces/ws1/templates/update-me`, {
                description: 'updated',
            });

            expect(res.status).toBe(200);

            // Verify file was updated
            const filePath = path.join(workspaceDir, '.vscode', 'templates', 'update-me.yaml');
            const content = yaml.load(fs.readFileSync(filePath, 'utf-8')) as any;
            expect(content.description).toBe('updated');
            expect(content.commitHash).toBe('abc123');
            expect(content.name).toBe('update-me');
            expect(onChanged).toHaveBeenCalledWith('ws1');
        });

        it('should not allow rename via PATCH', async () => {
            writeTemplate(workspaceDir, 'no-rename', {
                name: 'no-rename',
                kind: 'commit',
                commitHash: 'abc123',
            });

            const url = await startServer();
            await patchJSON(`${url}/api/workspaces/ws1/templates/no-rename`, {
                name: 'renamed',
            });

            const filePath = path.join(workspaceDir, '.vscode', 'templates', 'no-rename.yaml');
            const content = yaml.load(fs.readFileSync(filePath, 'utf-8')) as any;
            // name should remain pinned to the filename
            expect(content.name).toBe('no-rename');
        });

        it('should strip internal fields before writing', async () => {
            writeTemplate(workspaceDir, 'strip-internal', {
                name: 'strip-internal',
                kind: 'commit',
                commitHash: 'abc123',
                _fileName: 'should-be-stripped',
                _commit: { shortHash: 'x' },
            });

            const url = await startServer();
            await patchJSON(`${url}/api/workspaces/ws1/templates/strip-internal`, {
                description: 'test',
            });

            const filePath = path.join(workspaceDir, '.vscode', 'templates', 'strip-internal.yaml');
            const content = yaml.load(fs.readFileSync(filePath, 'utf-8')) as any;
            expect(content._fileName).toBeUndefined();
            expect(content._commit).toBeUndefined();
        });

        it('should return 404 for non-existent template', async () => {
            createTemplatesDir(workspaceDir);
            const url = await startServer();
            const res = await patchJSON(`${url}/api/workspaces/ws1/templates/ghost`, {
                description: 'test',
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 when removing commitHash from commit kind', async () => {
            writeTemplate(workspaceDir, 'bad-patch', {
                name: 'bad-patch',
                kind: 'commit',
                commitHash: 'abc123',
            });

            const url = await startServer();
            const res = await patchJSON(`${url}/api/workspaces/ws1/templates/bad-patch`, {
                commitHash: '',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('commitHash');
        });

        it('should return 403 for path traversal', async () => {
            const url = await startServer();
            const res = await patchJSON(`${url}/api/workspaces/ws1/templates/..%2F..%2Fhack`, {
                description: 'exploit',
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/templates/:name — Delete
    // ========================================================================

    describe('DELETE /api/workspaces/:id/templates/:name', () => {
        it('should delete an existing template file', async () => {
            writeTemplate(workspaceDir, 'doomed', {
                name: 'doomed',
                kind: 'commit',
                commitHash: 'abc123',
            });

            const onChanged = vi.fn();
            const url = await startServer({ onTemplatesChanged: onChanged });
            const res = await deleteReq(`${url}/api/workspaces/ws1/templates/doomed`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.deleted).toBe('doomed');

            // Verify file is gone
            const filePath = path.join(workspaceDir, '.vscode', 'templates', 'doomed.yaml');
            expect(fs.existsSync(filePath)).toBe(false);
            expect(onChanged).toHaveBeenCalledWith('ws1');
        });

        it('should return 404 for non-existent template', async () => {
            createTemplatesDir(workspaceDir);
            const url = await startServer();
            const res = await deleteReq(`${url}/api/workspaces/ws1/templates/ghost`);
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal', async () => {
            const url = await startServer();
            const res = await deleteReq(`${url}/api/workspaces/ws1/templates/..%2F..%2Fhack`);
            expect(res.status).toBe(403);
        });

        it('should return 404 for unknown workspace', async () => {
            const url = await startServer();
            const res = await deleteReq(`${url}/api/workspaces/nonexistent/templates/test`);
            expect(res.status).toBe(404);
        });
    });
});
