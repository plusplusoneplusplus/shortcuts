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
import { resetWipeToken, resetImportToken } from '../../src/server/admin-handler';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

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
        resetImportToken();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        resetWipeToken();
        resetImportToken();
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
    // GET /api/admin/export
    // ========================================================================

    describe('GET /api/admin/export', () => {
        it('should return 200 with JSON body', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/export`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.version).toBeDefined();
            expect(body.exportedAt).toBeDefined();
            expect(body.metadata).toBeDefined();
        });

        it('should have Content-Disposition header with attachment and .json filename', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/export`);

            expect(res.status).toBe(200);
            const disposition = res.headers['content-disposition'];
            expect(disposition).toBeDefined();
            expect(disposition).toContain('attachment');
            expect(disposition).toMatch(/filename="coc-export-.*\.json"/);
        });

        it('should return valid CoCExportPayload structure', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/export`);

            const body = JSON.parse(res.body);
            expect(typeof body.version).toBe('number');
            expect(typeof body.exportedAt).toBe('string');
            expect(typeof body.metadata).toBe('object');
            expect(body.metadata.processCount).toBe(0);
            expect(body.metadata.workspaceCount).toBe(0);
            expect(Array.isArray(body.processes)).toBe(true);
            expect(Array.isArray(body.workspaces)).toBe(true);
            expect(Array.isArray(body.wikis)).toBe(true);
            expect(Array.isArray(body.queueHistory)).toBe(true);
            expect(typeof body.preferences).toBe('object');
        });

        it('should include seeded process in export response', async () => {
            const srv = await startServer();

            // Seed a process
            await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'export-p1',
                    promptPreview: 'export test',
                    fullPrompt: 'export test prompt',
                    status: 'completed',
                    startTime: new Date().toISOString(),
                    type: 'clarification',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const res = await request(`${srv.url}/api/admin/export`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.metadata.processCount).toBe(1);
            expect(body.processes).toHaveLength(1);
            expect(body.processes[0].id).toBe('export-p1');
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

        it('should return chat.followUpSuggestions with source indicators', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'chat:\n  followUpSuggestions:\n    enabled: false\n', 'utf-8');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`);
            expect(res.status).toBe(200);

            const body = JSON.parse(res.body);
            expect(body.resolved.chat.followUpSuggestions.enabled).toBe(false);
            expect(body.resolved.chat.followUpSuggestions.count).toBe(3); // default
            expect(body.sources['chat.followUpSuggestions.enabled']).toBe('file');
            expect(body.sources['chat.followUpSuggestions.count']).toBe('default');
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

        it('should accept timeout null to clear the field', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const yaml = require('js-yaml');
            fs.writeFileSync(configPath, yaml.dump({ model: 'gpt-4', timeout: 120 }), 'utf-8');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ timeout: null }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.timeout).toBeUndefined();

            // Verify on disk: timeout key should be absent
            const diskConfig = yaml.load(fs.readFileSync(configPath, 'utf-8'));
            expect(diskConfig.timeout).toBeUndefined();
            // Other keys preserved
            expect(diskConfig.model).toBe('gpt-4');
        });

        it('should reject timeout: negative number', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ timeout: -5 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('timeout');
        });

        it('should reject timeout: string', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ timeout: 'abc' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('timeout');
        });

        it('should save chat.followUpSuggestions.enabled=false to config file', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ 'chat.followUpSuggestions.enabled': false }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.chat.followUpSuggestions.enabled).toBe(false);
            expect(body.sources['chat.followUpSuggestions.enabled']).toBe('file');
        });

        it('should save chat.followUpSuggestions.count=2 to config file', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ 'chat.followUpSuggestions.count': 2 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.chat.followUpSuggestions.count).toBe(2);
            expect(body.sources['chat.followUpSuggestions.count']).toBe('file');
        });

        it('should reject chat.followUpSuggestions.count=0 with validation error', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ 'chat.followUpSuggestions.count': 0 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('chat.followUpSuggestions.count');
        });

        it('should reject chat.followUpSuggestions.count=6 with validation error', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ 'chat.followUpSuggestions.count': 6 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('chat.followUpSuggestions.count');
        });

        it('should accept toolCompactness 0', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ toolCompactness: 0 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.toolCompactness).toBe(0);
            expect(body.sources.toolCompactness).toBe('file');
        });

        it('should accept toolCompactness 2', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ toolCompactness: 2 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.toolCompactness).toBe(2);
        });

        it('should reject toolCompactness 3', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ toolCompactness: 3 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('toolCompactness');
        });

        it('should reject non-integer toolCompactness (1.5)', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ toolCompactness: 1.5 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('toolCompactness');
        });

        it('should persist toolCompactness and not lose other config', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            // First PUT: set model
            await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ model: 'gpt-4' }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Second PUT: set toolCompactness
            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ toolCompactness: 1 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.toolCompactness).toBe(1);
            expect(body.resolved.model).toBe('gpt-4');
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

        it('should accept showReportIntent boolean true', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ showReportIntent: true }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.showReportIntent).toBe(true);
            expect(body.sources.showReportIntent).toBe('file');
        });

        it('should accept showReportIntent boolean false', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ showReportIntent: false }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.resolved.showReportIntent).toBe(false);
        });

        it('should reject non-boolean showReportIntent', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            const srv = await startServerWithConfig(configPath);

            const res = await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ showReportIntent: 'yes' }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('showReportIntent');
        });

        it('should persist showReportIntent and not lose other config', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: test-model\n', 'utf-8');
            const srv = await startServerWithConfig(configPath);

            await request(`${srv.url}/api/admin/config`, {
                method: 'PUT',
                body: JSON.stringify({ showReportIntent: true }),
                headers: { 'Content-Type': 'application/json' },
            });

            const getRes = await request(`${srv.url}/api/admin/config`);
            const body = JSON.parse(getRes.body);
            expect(body.resolved.showReportIntent).toBe(true);
            expect(body.resolved.model).toBe('test-model');
        });
    });

    // ========================================================================
    // GET /api/admin/import-token
    // ========================================================================

    describe('GET /api/admin/import-token', () => {
        it('should return a token and expiry', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/import-token`);

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.token).toBeDefined();
            expect(typeof body.token).toBe('string');
            expect(body.token.length).toBeGreaterThan(0);
            expect(body.expiresIn).toBe(300);
        });

        it('should return a different token each time', async () => {
            const srv = await startServer();
            const res1 = await request(`${srv.url}/api/admin/import-token`);
            const res2 = await request(`${srv.url}/api/admin/import-token`);

            const body1 = JSON.parse(res1.body);
            const body2 = JSON.parse(res2.body);
            expect(body1.token).not.toBe(body2.token);
        });

        it('should return a token different from wipe token', async () => {
            const srv = await startServer();
            const wipeRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const importRes = await request(`${srv.url}/api/admin/import-token`);

            const wipeBody = JSON.parse(wipeRes.body);
            const importBody = JSON.parse(importRes.body);
            expect(wipeBody.token).not.toBe(importBody.token);
        });
    });

    // ========================================================================
    // POST /api/admin/import/preview
    // ========================================================================

    describe('POST /api/admin/import/preview', () => {
        function validPayload() {
            return {
                version: 1,
                exportedAt: new Date().toISOString(),
                metadata: { processCount: 2, workspaceCount: 1, wikiCount: 0, queueFileCount: 0 },
                processes: [
                    { id: 'p1', promptPreview: 'test1', fullPrompt: 'f1', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
                    { id: 'p2', promptPreview: 'test2', fullPrompt: 'f2', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
                ],
                workspaces: [{ id: 'ws1', name: 'WS1', rootPath: '/tmp/ws1' }],
                wikis: [],
                queueHistory: [],
                preferences: {},
            };
        }

        it('should return 200 and preview for valid payload', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/import/preview`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.valid).toBe(true);
            expect(body.preview.processCount).toBe(2);
            expect(body.preview.workspaceCount).toBe(1);
            expect(body.preview.wikiCount).toBe(0);
            expect(body.preview.queueFileCount).toBe(0);
            expect(body.preview.sampleProcessIds).toEqual(['p1', 'p2']);
        });

        it('should return 400 and error for invalid payload', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/import/preview`, {
                method: 'POST',
                body: JSON.stringify({ version: 999 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.valid).toBe(false);
            expect(body.error).toBeDefined();
        });

        it('should return 400 for invalid JSON body', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/import/preview`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
        });

        it('should limit sampleProcessIds to 5', async () => {
            const srv = await startServer();
            const payload = validPayload();
            payload.metadata.processCount = 7;
            for (let i = 3; i <= 7; i++) {
                payload.processes.push({
                    id: `p${i}`, promptPreview: `test${i}`, fullPrompt: `f${i}`,
                    status: 'completed', startTime: new Date().toISOString(), type: 'clarification',
                } as any);
            }
            const res = await request(`${srv.url}/api/admin/import/preview`, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.preview.sampleProcessIds).toHaveLength(5);
        });
    });

    // ========================================================================
    // POST /api/admin/import
    // ========================================================================

    describe('POST /api/admin/import', () => {
        function validPayload() {
            return {
                version: 1,
                exportedAt: new Date().toISOString(),
                metadata: { processCount: 1, workspaceCount: 1, wikiCount: 0, queueFileCount: 0 },
                processes: [
                    { id: 'imported-p1', promptPreview: 'imported', fullPrompt: 'imported full', status: 'completed', startTime: new Date().toISOString(), type: 'clarification' },
                ],
                workspaces: [{ id: 'imported-ws1', name: 'Imported WS', rootPath: '/tmp/imported' }],
                wikis: [],
                queueHistory: [],
                preferences: {},
            };
        }

        it('should reject without confirmation token', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/import`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Missing confirmation token');
        });

        it('should reject with invalid token', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/admin/import?confirm=invalid-token`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(403);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid or expired');
        });

        it('should reject wipe token used for import', async () => {
            const srv = await startServer();
            // Get wipe token (not import token)
            const wipeTokenRes = await request(`${srv.url}/api/admin/data/wipe-token`);
            const { token } = JSON.parse(wipeTokenRes.body);

            const res = await request(`${srv.url}/api/admin/import?confirm=${token}`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(403);
        });

        it('should execute import with valid token (replace mode)', async () => {
            const srv = await startServer();

            // Seed existing process
            await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'existing-p1',
                    promptPreview: 'existing',
                    fullPrompt: 'existing full',
                    status: 'completed',
                    startTime: new Date().toISOString(),
                    type: 'clarification',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Get import token
            const tokenRes = await request(`${srv.url}/api/admin/import-token`);
            const { token } = JSON.parse(tokenRes.body);

            // Execute import (default mode = replace)
            const importRes = await request(`${srv.url}/api/admin/import?confirm=${token}`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(importRes.status).toBe(200);
            const result = JSON.parse(importRes.body);
            expect(result.importedProcesses).toBe(1);
            expect(result.importedWorkspaces).toBe(1);
            expect(result.errors).toEqual([]);

            // Verify imported data exists and old data is gone
            const processRes = await request(`${srv.url}/api/processes`);
            const processBody = JSON.parse(processRes.body);
            expect(processBody.processes).toHaveLength(1);
            expect(processBody.processes[0].id).toBe('imported-p1');

            const wsRes = await request(`${srv.url}/api/workspaces`);
            const wsBody = JSON.parse(wsRes.body);
            expect(wsBody.workspaces).toHaveLength(1);
            expect(wsBody.workspaces[0].id).toBe('imported-ws1');
        });

        it('should execute import with merge mode', async () => {
            const srv = await startServer();

            // Seed existing process
            await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: JSON.stringify({
                    id: 'existing-p1',
                    promptPreview: 'existing',
                    fullPrompt: 'existing full',
                    status: 'completed',
                    startTime: new Date().toISOString(),
                    type: 'clarification',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Get import token
            const tokenRes = await request(`${srv.url}/api/admin/import-token`);
            const { token } = JSON.parse(tokenRes.body);

            // Execute import (merge mode)
            const importRes = await request(`${srv.url}/api/admin/import?confirm=${token}&mode=merge`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(importRes.status).toBe(200);
            const result = JSON.parse(importRes.body);
            expect(result.importedProcesses).toBe(1);

            // Verify both old and new data exist
            const processRes = await request(`${srv.url}/api/processes`);
            const processBody = JSON.parse(processRes.body);
            expect(processBody.processes).toHaveLength(2);
            const ids = processBody.processes.map((p: any) => p.id).sort();
            expect(ids).toEqual(['existing-p1', 'imported-p1']);
        });

        it('should not allow import token reuse', async () => {
            const srv = await startServer();

            const tokenRes = await request(`${srv.url}/api/admin/import-token`);
            const { token } = JSON.parse(tokenRes.body);

            // First use — succeeds
            const res1 = await request(`${srv.url}/api/admin/import?confirm=${token}`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res1.status).toBe(200);

            // Second use — fails
            const res2 = await request(`${srv.url}/api/admin/import?confirm=${token}`, {
                method: 'POST',
                body: JSON.stringify(validPayload()),
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res2.status).toBe(403);
        });

        it('should reject invalid payload even with valid token', async () => {
            const srv = await startServer();

            const tokenRes = await request(`${srv.url}/api/admin/import-token`);
            const { token } = JSON.parse(tokenRes.body);

            const res = await request(`${srv.url}/api/admin/import?confirm=${token}`, {
                method: 'POST',
                body: JSON.stringify({ version: 999 }),
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid payload');
        });
    });
});
