/**
 * Template Wiring Integration Tests
 *
 * Verifies that template routes (read, write, replicate-apply) and the
 * TemplateWatcher are correctly wired into createExecutionServer().
 *
 * Tests the integration points added in server/index.ts:
 * - registerTemplateRoutes / registerTemplateWriteRoutes are mounted
 * - TemplateWatcher starts watching when workspaces are registered
 * - TemplateWatcher stops watching when workspaces are removed
 * - templates-changed WebSocket events are broadcast on file changes
 *
 * Uses port 0 (OS-assigned) and temp directories for test isolation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { WebSocket } from 'ws';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createMockSDKService } from '../helpers/mock-sdk-service';

// ============================================================================
// Helpers
// ============================================================================

function httpRequest(
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
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
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
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectWs(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
}

function collectWsMessages(ws: WebSocket, durationMs: number): Promise<any[]> {
    return new Promise((resolve) => {
        const messages: any[] = [];
        const onMessage = (data: any) => {
            try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
        };
        ws.on('message', onMessage);
        setTimeout(() => {
            ws.removeListener('message', onMessage);
            resolve(messages);
        }, durationMs);
    });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Template Wiring in createExecutionServer', () => {
    let server: ExecutionServer;
    let store: FileProcessStore;
    let baseUrl: string;
    let tmpDir: string;
    let wsRootPath: string;

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-wire-'));
        store = new FileProcessStore({ dataDir: tmpDir });
        const { service: mockAiService } = createMockSDKService();
        server = await createExecutionServer({
            store,
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
            aiService: mockAiService as any,
        });
        baseUrl = server.url;

        // Create a workspace root with a templates directory
        wsRootPath = path.join(tmpDir, 'test-workspace');
        fs.mkdirSync(path.join(wsRootPath, '.vscode', 'templates'), { recursive: true });

        // Register workspace via API
        await httpRequest(`${baseUrl}/api/workspaces`, {
            method: 'POST',
            body: JSON.stringify({ id: 'ws-tmpl', name: 'tmpl-workspace', rootPath: wsRootPath }),
        });
    });

    afterAll(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }, 10_000);

    // ------------------------------------------------------------------
    // Template Read Routes
    // ------------------------------------------------------------------

    describe('template read routes', () => {
        it('GET /api/workspaces/:id/templates should return 200 with empty list', async () => {
            const res = await httpRequest(`${baseUrl}/api/workspaces/ws-tmpl/templates`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.templates).toEqual([]);
        });

        it('GET /api/workspaces/:id/templates/:name should return 404 for missing template', async () => {
            const res = await httpRequest(`${baseUrl}/api/workspaces/ws-tmpl/templates/nonexistent`);
            expect(res.status).toBe(404);
        });

        it('GET /api/workspaces/:id/templates should return templates after file creation', async () => {
            // Create a template file directly on disk
            const tmplPath = path.join(wsRootPath, '.vscode', 'templates', 'my-tmpl.yaml');
            const templateContent = {
                kind: 'commit',
                name: 'my-tmpl',
                description: 'Test template',
                commit: { sha: 'abc123', message: 'test commit', files: [] },
            };
            fs.writeFileSync(tmplPath, yaml.dump(templateContent));

            const res = await httpRequest(`${baseUrl}/api/workspaces/ws-tmpl/templates`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.templates.length).toBeGreaterThanOrEqual(1);
            const names = body.templates.map((t: any) => t.name);
            expect(names).toContain('my-tmpl');

            // Cleanup
            fs.unlinkSync(tmplPath);
        });
    });

    // ------------------------------------------------------------------
    // Template Write Routes
    // ------------------------------------------------------------------

    describe('template write routes', () => {
        it('POST /api/workspaces/:id/templates should create a template and return 201', async () => {
            const res = await httpRequest(`${baseUrl}/api/workspaces/ws-tmpl/templates`, {
                method: 'POST',
                body: JSON.stringify({
                    kind: 'commit',
                    name: 'created-via-api',
                    description: 'Created through API',
                    commitHash: 'def456',
                }),
            });
            expect(res.status).toBe(201);

            // Verify file exists on disk
            const filePath = path.join(wsRootPath, '.vscode', 'templates', 'created-via-api.yaml');
            expect(fs.existsSync(filePath)).toBe(true);

            // Cleanup
            fs.unlinkSync(filePath);
        });

        it('DELETE /api/workspaces/:id/templates/:name should delete a template and return 200', async () => {
            // Create a template first
            const filePath = path.join(wsRootPath, '.vscode', 'templates', 'to-delete.yaml');
            fs.writeFileSync(filePath, yaml.dump({
                kind: 'commit',
                name: 'to-delete',
                description: 'Will be deleted',
                commit: { sha: 'fff', message: 'delete me', files: [] },
            }));

            const res = await httpRequest(`${baseUrl}/api/workspaces/ws-tmpl/templates/to-delete`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);
            expect(fs.existsSync(filePath)).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // Replicate-Apply Routes
    // ------------------------------------------------------------------

    describe('replicate-apply route', () => {
        it('POST /api/workspaces/:id/replicate/:processId/apply should return 404 for missing process', async () => {
            const res = await httpRequest(`${baseUrl}/api/workspaces/ws-tmpl/replicate/nonexistent-proc/apply`, {
                method: 'POST',
            });
            // Expected: 404 since process doesn't exist
            expect(res.status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // WebSocket broadcast on template file change
    // ------------------------------------------------------------------

    describe('templates-changed WebSocket broadcast', () => {
        it('should broadcast templates-changed event when a template file is created', async () => {
            const parsed = new URL(baseUrl);
            const wsPort = parsed.port;

            const messages = await new Promise<any[]>((resolve, reject) => {
                const collected: any[] = [];
                const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`);

                ws.on('open', async () => {
                    // Wait for watcher to be ready, then create a file
                    setTimeout(() => {
                        const tmplPath = path.join(wsRootPath, '.vscode', 'templates', 'ws-event.yaml');
                        fs.writeFileSync(tmplPath, yaml.dump({
                            kind: 'commit',
                            name: 'ws-event',
                            description: 'Trigger watcher',
                            commit: { sha: 'aaa', message: 'ws test', files: [] },
                        }));
                    }, 200);
                });

                ws.on('message', (data: any) => {
                    try { collected.push(JSON.parse(data.toString())); } catch { /* ignore */ }
                    if (collected.some(m => m.type === 'templates-changed')) {
                        ws.close();
                    }
                });

                ws.on('close', () => resolve(collected));
                ws.on('error', reject);
                setTimeout(() => {
                    ws.close();
                    resolve(collected);
                }, 3000);
            });

            // Should have received a templates-changed event
            const templatesChanged = messages.filter(
                (m: any) => m.type === 'templates-changed' && m.workspaceId === 'ws-tmpl'
            );
            expect(templatesChanged.length).toBeGreaterThanOrEqual(1);
            expect(templatesChanged[0].timestamp).toBeTypeOf('number');

            // Cleanup
            const tmplPath = path.join(wsRootPath, '.vscode', 'templates', 'ws-event.yaml');
            try { fs.unlinkSync(tmplPath); } catch { /* ignore */ }
        });
    });

    // ------------------------------------------------------------------
    // Workspace removal stops watching
    // ------------------------------------------------------------------

    describe('workspace lifecycle', () => {
        it('should stop template watching after workspace removal', async () => {
            // Register a fresh workspace
            const ws2Root = path.join(tmpDir, 'ws2-root');
            fs.mkdirSync(path.join(ws2Root, '.vscode', 'templates'), { recursive: true });

            await httpRequest(`${baseUrl}/api/workspaces`, {
                method: 'POST',
                body: JSON.stringify({ id: 'ws-remove', name: 'remove-test', rootPath: ws2Root }),
            });

            // Give the watcher time to register
            await wait(500);

            // Remove workspace
            await httpRequest(`${baseUrl}/api/workspaces/ws-remove`, { method: 'DELETE' });
            await wait(300);

            // Connect WebSocket and write a template file — should NOT trigger broadcast
            const parsed = new URL(baseUrl);
            const wsPort = parsed.port;

            const messages = await new Promise<any[]>((resolve) => {
                const collected: any[] = [];
                const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`);

                ws.on('open', () => {
                    // Write a file after workspace removed
                    setTimeout(() => {
                        fs.writeFileSync(
                            path.join(ws2Root, '.vscode', 'templates', 'after-remove.yaml'),
                            yaml.dump({ kind: 'commit', name: 'after-remove', description: 'ignored', commit: { sha: 'x', message: 'x', files: [] } })
                        );
                    }, 200);
                });

                ws.on('message', (data: any) => {
                    try { collected.push(JSON.parse(data.toString())); } catch { /* ignore */ }
                });

                setTimeout(() => {
                    ws.close();
                    resolve(collected);
                }, 2000);
            });

            const templatesChanged = messages.filter(
                (m: any) => m.type === 'templates-changed' && m.workspaceId === 'ws-remove'
            );
            expect(templatesChanged).toHaveLength(0);

            // Cleanup
            fs.rmSync(ws2Root, { recursive: true, force: true });
        });
    });

    // ------------------------------------------------------------------
    // Graceful shutdown closes watchers
    // ------------------------------------------------------------------

    describe('server close', () => {
        it('should shut down cleanly with template watchers active', async () => {
            // Create a separate server instance to test close behavior
            const closeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-close-'));
            const closeStore = new FileProcessStore({ dataDir: closeTmpDir });
            const { service: closeMock } = createMockSDKService();
            const closeServer = await createExecutionServer({
                store: closeStore,
                port: 0,
                host: '127.0.0.1',
                dataDir: closeTmpDir,
                aiService: closeMock as any,
            });

            // Register a workspace so a template watcher is active
            const closeWsRoot = path.join(closeTmpDir, 'close-ws');
            fs.mkdirSync(path.join(closeWsRoot, '.vscode', 'templates'), { recursive: true });
            await httpRequest(`${closeServer.url}/api/workspaces`, {
                method: 'POST',
                body: JSON.stringify({ id: 'ws-close', name: 'close-test', rootPath: closeWsRoot }),
            });

            // Give watcher time to start
            await wait(200);

            // Close should not throw
            await expect(closeServer.close()).resolves.toBeDefined();

            // Cleanup
            fs.rmSync(closeTmpDir, { recursive: true, force: true });
        });
    });
});
