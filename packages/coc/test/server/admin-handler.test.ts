/**
 * Admin Handler Tests
 *
 * Tests for admin API endpoints: wipe token generation, data stats,
 * and data wipe with token confirmation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { resetWipeToken } from '../../src/server/admin-handler';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
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
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Admin Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-handler-test-'));
        resetWipeToken();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        resetWipeToken();
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function startServerWithConfig(configPath: string): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir, configPath });
        return server;
    }

    // ========================================================================
    // GET /api/admin/data/wipe-token
    // ========================================================================

    describe('GET /api/admin/data/wipe-token', () => {
        it('should return a token and expiry', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/data/wipe-token`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.token).toBeDefined();
            expect(typeof body.token).toBe('string');
            expect(body.token.length).toBeGreaterThan(0);
            expect(body.expiresIn).toBe(300);
        });

        it('should return a different token each time', async () => {
            const srv = await startServer();
            const res1 = await request(`${srv.url}/api/admin/data/wipe-token`);
            const res2 = await request(`${srv.url}/api/admin/data/wipe-token`);

            const body1 = JSON.parse(res1.body);
            const body2 = JSON.parse(res2.body);
            expect(body1.token).not.toBe(body2.token);
        });
    });

    // ========================================================================
    // GET /api/admin/data/stats
    // ========================================================================

    describe('GET /api/admin/data/stats', () => {
        it('should return storage statistics', async () => {
            const srv = await startServer();

            // Seed some data
            await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'p1',
                    promptPreview: 'test',
                    fullPrompt: 'test',
                    status: 'completed',
                    startTime: new Date().toISOString(),
                    type: 'clarification',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const res = await request(`${srv.url}/api/admin/data/stats`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.deletedProcesses).toBe(1);
            expect(body.deletedWorkspaces).toBe(0);
            expect(body.deletedWikis).toBe(0);
            expect(body.errors).toEqual([]);
        });
    });

    // ========================================================================
    // DELETE /api/admin/data
    // ========================================================================

    describe('DELETE /api/admin/data', () => {
        it('should reject without confirmation token', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/data`, { method: 'DELETE' });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Missing confirmation token');
        });

        it('should reject with invalid token', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/data?confirm=invalid-token`, {
                method: 'DELETE',
            });

            expect(res.status).toBe(403);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid or expired');
        });

        it('should wipe data with valid token', async () => {
            const srv = await startServer();

            // Seed process
            await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'p1',
                    promptPreview: 'test',
                    fullPrompt: 'test',
                    status: 'completed',
                    startTime: new Date().toISOString(),
                    type: 'clarification',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Seed workspace
            await request(`${srv.url}/api/workspaces`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'ws1',
                    name: 'Test Workspace',
                    rootPath: dataDir,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Get token
            const tokenRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const { token } = JSON.parse(tokenRes.body);

            // Wipe
            const wipeRes = await request(`${srv.url}/api/admin/data?confirm=${token}`, {
                method: 'DELETE',
            });

            expect(wipeRes.status).toBe(200);
            const result = JSON.parse(wipeRes.body);
            expect(result.deletedProcesses).toBe(1);
            expect(result.deletedWorkspaces).toBe(1);
            expect(result.errors).toEqual([]);

            // Verify data is gone
            const processRes = await request(`${srv.url}/api/processes`);
            const processBody = JSON.parse(processRes.body);
            expect(processBody.processes).toHaveLength(0);

            const wsRes = await request(`${srv.url}/api/workspaces`);
            const wsBody = JSON.parse(wsRes.body);
            expect(wsBody.workspaces).toHaveLength(0);
        });

        it('should not allow token reuse', async () => {
            const srv = await startServer();

            // Get token
            const tokenRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const { token } = JSON.parse(tokenRes.body);

            // Use once — succeeds
            const wipeRes1 = await request(`${srv.url}/api/admin/data?confirm=${token}`, {
                method: 'DELETE',
            });
            expect(wipeRes1.status).toBe(200);

            // Use again — fails
            const wipeRes2 = await request(`${srv.url}/api/admin/data?confirm=${token}`, {
                method: 'DELETE',
            });
            expect(wipeRes2.status).toBe(403);
        });

        it('should delete preferences when wiping', async () => {
            const srv = await startServer();

            // Create preferences
            const prefsPath = path.join(dataDir, 'preferences.json');
            fs.writeFileSync(prefsPath, JSON.stringify({ lastModel: 'gpt-4' }), 'utf-8');

            // Get token and wipe
            const tokenRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const { token } = JSON.parse(tokenRes.body);

            const wipeRes = await request(`${srv.url}/api/admin/data?confirm=${token}`, {
                method: 'DELETE',
            });

            expect(wipeRes.status).toBe(200);
            const result = JSON.parse(wipeRes.body);
            expect(result.deletedPreferences).toBe(true);
            expect(fs.existsSync(prefsPath)).toBe(false);
        });

        it('should delete queue files when wiping', async () => {
            const srv = await startServer();

            // Create queue files
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });
            fs.writeFileSync(
                path.join(queuesDir, 'repo-abc123.json'),
                JSON.stringify({ version: 2, pending: [] }),
                'utf-8',
            );

            // Get token and wipe
            const tokenRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const { token } = JSON.parse(tokenRes.body);

            const wipeRes = await request(`${srv.url}/api/admin/data?confirm=${token}`, {
                method: 'DELETE',
            });

            expect(wipeRes.status).toBe(200);
            const result = JSON.parse(wipeRes.body);
            expect(result.deletedQueues).toBe(1);
            expect(fs.existsSync(path.join(queuesDir, 'repo-abc123.json'))).toBe(false);
        });

        it('should preserve config.yaml', async () => {
            const srv = await startServer();

            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\n', 'utf-8');

            const tokenRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const { token } = JSON.parse(tokenRes.body);

            await request(`${srv.url}/api/admin/data?confirm=${token}`, { method: 'DELETE' });

            expect(fs.existsSync(configPath)).toBe(true);
        });
    });

    // ========================================================================
    // GET /api/admin/config
    // ========================================================================

    describe('GET /api/admin/config', () => {
        it('should return resolved config with sources and configFilePath', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\nparallel: 10\n', 'utf-8');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.resolved).toBeDefined();
            expect(body.sources).toBeDefined();
            expect(body.configFilePath).toBeDefined();
            expect(body.resolved.model).toBe('gpt-4');
            expect(body.resolved.parallel).toBe(10);
            expect(body.sources.model).toBe('file');
            expect(body.sources.parallel).toBe('file');
            expect(body.sources.output).toBe('default');
        });

        it('should return defaults when no config file exists', async () => {
            const configPath = path.join(dataDir, 'nonexistent.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.resolved.parallel).toBe(5);
            expect(body.resolved.output).toBe('table');
            expect(body.sources.parallel).toBe('default');
        });
    });

    // ========================================================================
    // PUT /api/admin/config
    // ========================================================================

    describe('PUT /api/admin/config', () => {
        it('should update config and return resolved result', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'gpt-4', parallel: 8 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.model).toBe('gpt-4');
            expect(body.resolved.parallel).toBe(8);
            expect(body.sources.model).toBe('file');
            expect(body.sources.parallel).toBe('file');
        });

        it('should merge with existing config without wiping other keys', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: gpt-3\ntimeout: 120\n', 'utf-8');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ parallel: 3 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // New value applied
            expect(body.resolved.parallel).toBe(3);
            // Existing values preserved
            expect(body.resolved.model).toBe('gpt-3');
            expect(body.resolved.timeout).toBe(120);
        });

        it('should accept all editable fields', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'claude', parallel: 2, timeout: 60, output: 'json' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.model).toBe('claude');
            expect(body.resolved.parallel).toBe(2);
            expect(body.resolved.timeout).toBe(60);
            expect(body.resolved.output).toBe('json');
        });

        it('should reject invalid parallel (non-positive)', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ parallel: -1 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('parallel');
        });

        it('should reject invalid timeout (zero)', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ timeout: 0 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('timeout');
        });

        it('should reject invalid output format', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ output: 'xml' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('output');
        });

        it('should reject empty model string', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: '' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('model');
        });

        it('should reject invalid JSON body', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
        });

        it('should persist changes to disk', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'persisted-model' }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Read file directly to confirm persistence
            const content = fs.readFileSync(configPath, 'utf-8');
            expect(content).toContain('persisted-model');
        });

        it('should create config file when none exists', async () => {
            const configPath = path.join(dataDir, 'brand-new-config.yaml');
            expect(fs.existsSync(configPath)).toBe(false);

            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'new-model', parallel: 4 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            expect(fs.existsSync(configPath)).toBe(true);

            const content = fs.readFileSync(configPath, 'utf-8');
            expect(content).toContain('new-model');
            expect(content).toContain('4');
        });

        it('should preserve serve.* keys when only updating model', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const yaml = require('js-yaml');
            fs.writeFileSync(configPath, yaml.dump({
                model: 'old-model',
                serve: { port: 5000, host: '0.0.0.0', dataDir: '/tmp/coc', theme: 'dark' },
            }), 'utf-8');

            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'updated-model' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.model).toBe('updated-model');
            expect(body.resolved.serve.port).toBe(5000);
            expect(body.resolved.serve.host).toBe('0.0.0.0');
            expect(body.resolved.serve.dataDir).toBe('/tmp/coc');
            expect(body.resolved.serve.theme).toBe('dark');

            // Verify on disk
            const diskConfig = yaml.load(fs.readFileSync(configPath, 'utf-8'));
            expect(diskConfig.serve.port).toBe(5000);
            expect(diskConfig.serve.host).toBe('0.0.0.0');
        });

        it('should preserve approvePermissions and persist when updating other fields', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const yaml = require('js-yaml');
            fs.writeFileSync(configPath, yaml.dump({
                approvePermissions: true,
                persist: false,
                mcpConfig: '/path/to/mcp.json',
                parallel: 10,
            }), 'utf-8');

            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ timeout: 300 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.timeout).toBe(300);
            expect(body.resolved.approvePermissions).toBe(true);
            expect(body.resolved.persist).toBe(false);
            expect(body.resolved.mcpConfig).toBe('/path/to/mcp.json');
            expect(body.resolved.parallel).toBe(10);
        });

        it('should reject non-object body (array)', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify([1, 2, 3]),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
        });

        it('should reject empty body', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: '',
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Integration: GET → PUT → GET round-trip
    // ========================================================================

    describe('Admin Config Integration', () => {
        it('GET → PUT → GET round-trip should reflect updates', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            // Initial GET: defaults
            const get1 = await request(`${srv.url}/api/admin/config`);
            expect(get1.status).toBe(200);
            const initial = JSON.parse(get1.body);
            expect(initial.resolved.parallel).toBe(5);
            expect(initial.sources.parallel).toBe('default');

            // PUT: change parallel
            const putRes = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ parallel: 12, model: 'round-trip-model' }),
                headers: { 'Content-Type': 'application/json' },
            });
            expect(putRes.status).toBe(200);

            // Second GET: should see updated values
            const get2 = await request(`${srv.url}/api/admin/config`);
            expect(get2.status).toBe(200);
            const updated = JSON.parse(get2.body);
            expect(updated.resolved.parallel).toBe(12);
            expect(updated.resolved.model).toBe('round-trip-model');
            expect(updated.sources.parallel).toBe('file');
            expect(updated.sources.model).toBe('file');
        });

        it('multiple PUTs should accumulate changes without losing earlier edits', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            // First PUT: set model
            await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'first-model' }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Second PUT: set parallel (model should persist)
            await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ parallel: 7 }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Third PUT: set timeout (model and parallel should persist)
            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ timeout: 180 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.model).toBe('first-model');
            expect(body.resolved.parallel).toBe(7);
            expect(body.resolved.timeout).toBe(180);
        });
    });
});
