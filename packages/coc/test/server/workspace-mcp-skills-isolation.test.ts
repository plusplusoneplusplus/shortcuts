/**
 * Workspace MCP Config and Skills Config Isolation Tests — Section 8
 *
 * Verifies that MCP config and skills config in workspace A are completely
 * isolated from workspace B.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Mock loadDefaultMcpConfig (used by api-handler internals)
// ============================================================================

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadDefaultMcpConfig: vi.fn().mockReturnValue({ mcpServers: {} }),
        sdkServiceRegistry: {
            getOrThrow: () => ({ sendMessage: vi.fn(), isAvailable: vi.fn().mockResolvedValue({ available: false }) }),
        },
    };
});

// ============================================================================
// HTTP Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
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
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function jsonReq(url: string, method: string, data: unknown) {
    return request(url, {
        method,
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace MCP Config and Skills Config Isolation', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let wsDirA: string;
    let wsDirB: string;
    const wsIdA = 'ws-mcp-a';
    const wsIdB = 'ws-mcp-b';

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mcp-iso-'));
        wsDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mcp-dir-a-'));
        wsDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mcp-dir-b-'));

        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });

        // Register both workspaces
        await jsonReq(`${server.url}/api/workspaces`, 'POST', { id: wsIdA, name: 'WS A', rootPath: wsDirA });
        await jsonReq(`${server.url}/api/workspaces`, 'POST', { id: wsIdB, name: 'WS B', rootPath: wsDirB });
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(wsDirA, { recursive: true, force: true });
        fs.rmSync(wsDirB, { recursive: true, force: true });
    });

    // ========================================================================
    // MCP Config
    // ========================================================================

    describe('MCP Config Isolation', () => {
        it('GET /api/workspaces/A/mcp-config returns A\'s MCP config', async () => {
            const res = await request(`${server!.url}/api/workspaces/${wsIdA}/mcp-config`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Response contains availableServers and enabledMcpServers
            expect(body.availableServers).toBeDefined();
        });

        it('GET /api/workspaces/B/mcp-config returns B\'s MCP config (independent)', async () => {
            const resA = await request(`${server!.url}/api/workspaces/${wsIdA}/mcp-config`);
            const resB = await request(`${server!.url}/api/workspaces/${wsIdB}/mcp-config`);
            expect(resA.status).toBe(200);
            expect(resB.status).toBe(200);
        });

        it('PUT /api/workspaces/A/mcp-config updates only A\'s config', async () => {
            // enabledMcpServers is an array of server names to enable (or null for all)
            const putRes = await jsonReq(
                `${server!.url}/api/workspaces/${wsIdA}/mcp-config`,
                'PUT',
                { enabledMcpServers: ['server-for-a'] }
            );
            expect(putRes.status).toBe(200);

            // A should have enabledMcpServers set
            const resA = await request(`${server!.url}/api/workspaces/${wsIdA}/mcp-config`);
            const bodyA = JSON.parse(resA.body);
            expect(bodyA.enabledMcpServers).toContain('server-for-a');
        });

        it('After PUT A mcp-config, B\'s config is unchanged', async () => {
            // Set B's config first
            await jsonReq(`${server!.url}/api/workspaces/${wsIdB}/mcp-config`, 'PUT', {
                enabledMcpServers: ['server-for-b'],
            });

            // Update A's config
            await jsonReq(`${server!.url}/api/workspaces/${wsIdA}/mcp-config`, 'PUT', {
                enabledMcpServers: ['server-for-a'],
            });

            // B's config should still have server-for-b enabled
            const resB = await request(`${server!.url}/api/workspaces/${wsIdB}/mcp-config`);
            const bodyB = JSON.parse(resB.body);
            expect(Array.isArray(bodyB.enabledMcpServers)).toBe(true);
            expect(bodyB.enabledMcpServers).toContain('server-for-b');
            expect(bodyB.enabledMcpServers).not.toContain('server-for-a');
        });

        it('MCP config for nonexistent workspace → 404', async () => {
            const res = await request(`${server!.url}/api/workspaces/ghost-workspace/mcp-config`);
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Skills Config
    // ========================================================================

    describe('Skills Config Isolation', () => {
        it('GET /api/workspaces/A/skills-config returns A-specific config', async () => {
            const res = await request(`${server!.url}/api/workspaces/${wsIdA}/skills-config`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Skills config should be a valid object (even if empty)
            expect(body).toBeDefined();
        });

        it('PUT /api/workspaces/A/skills-config → B\'s skills config unaffected', async () => {
            // Set A's skills config with a disabled skill
            const aSkillsConfig = { disabledSkills: ['skill-x', 'skill-y'] };
            const putResA = await jsonReq(
                `${server!.url}/api/workspaces/${wsIdA}/skills-config`,
                'PUT',
                aSkillsConfig
            );
            expect(putResA.status).toBe(200);

            // B's skills config should not include A's disabled skills
            const resB = await request(`${server!.url}/api/workspaces/${wsIdB}/skills-config`);
            expect(resB.status).toBe(200);
            const bodyB = JSON.parse(resB.body);
            const bDisabled: string[] = bodyB.disabledSkills ?? [];
            expect(bDisabled).not.toContain('skill-x');
            expect(bDisabled).not.toContain('skill-y');
        });

        it('A and B can have independent skills configurations', async () => {
            await jsonReq(`${server!.url}/api/workspaces/${wsIdA}/skills-config`, 'PUT', {
                disabledSkills: ['skill-a-only'],
            });
            await jsonReq(`${server!.url}/api/workspaces/${wsIdB}/skills-config`, 'PUT', {
                disabledSkills: ['skill-b-only'],
            });

            const resA = await request(`${server!.url}/api/workspaces/${wsIdA}/skills-config`);
            const resB = await request(`${server!.url}/api/workspaces/${wsIdB}/skills-config`);
            const bodyA = JSON.parse(resA.body);
            const bodyB = JSON.parse(resB.body);

            const aDisabled: string[] = bodyA.disabledSkills ?? [];
            const bDisabled: string[] = bodyB.disabledSkills ?? [];

            expect(aDisabled).toContain('skill-a-only');
            expect(aDisabled).not.toContain('skill-b-only');
            expect(bDisabled).toContain('skill-b-only');
            expect(bDisabled).not.toContain('skill-a-only');
        });
    });
});
