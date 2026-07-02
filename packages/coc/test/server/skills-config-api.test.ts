/**
 * Skills Config API Endpoint Tests
 *
 * Tests for the skills-config API routes:
 * - GET /api/workspaces/:id/skills-config
 * - PUT /api/workspaces/:id/skills-config
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock loadDefaultMcpConfig (required by registerApiRoutes)
// ============================================================================

const mockLoadDefaultMcpConfig = vi.hoisted(() => vi.fn());
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, loadDefaultMcpConfig: mockLoadDefaultMcpConfig };
});

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
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
// Test Suite
// ============================================================================

describe('Skills Config API endpoints', () => {
    let server: http.Server;
    let port: number;
    let mockStore: ReturnType<typeof createMockProcessStore>;

    const WORKSPACE_ID = 'ws-skills-1';

    beforeAll(async () => {
        mockStore = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'Skills Project', rootPath: '/projects/skills' }],
        });
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Skills Project', rootPath: '/projects/skills' },
        ]);
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            return { id, name: 'Skills Project', rootPath: '/projects/skills', ...updates };
        });

        mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: {} });

        const routes: Route[] = [];
        registerApiRoutes(routes, mockStore);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Skills Project', rootPath: '/projects/skills' },
        ]);
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            return { id, name: 'Skills Project', rootPath: '/projects/skills', ...updates };
        });
    });

    const base = () => `http://127.0.0.1:${port}`;

    // ========================================================================
    // GET /api/workspaces/:id/skills-config
    // ========================================================================

    describe('GET /api/workspaces/:id/skills-config', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/skills-config`);
            expect(res.status).toBe(404);
        });

        it('returns disabledSkills: [] when not set on workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledSkills).toEqual([]);
        });

        it('returns extraSkillFolders: [] when not set on workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.extraSkillFolders).toEqual([]);
        });

        it('returns disabledSkills array when workspace has disabledSkills set', async () => {
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Skills Project', rootPath: '/projects/skills', disabledSkills: ['impl', 'draft'] },
            ]);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledSkills).toEqual(['impl', 'draft']);
        });

        it('returns extraSkillFolders when workspace has extraSkillFolders set', async () => {
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'Skills Project', rootPath: '/projects/skills', extraSkillFolders: ['/team/skills', './custom'] },
            ]);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.extraSkillFolders).toEqual(['/team/skills', './custom']);
        });
    });

    // ========================================================================
    // PUT /api/workspaces/:id/skills-config
    // ========================================================================

    describe('PUT /api/workspaces/:id/skills-config', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: ['impl'] }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 with MISSING_FIELDS when disabledSkills field is absent', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            expect(res.json().error).toContain('disabledSkills');
        });

        it('returns 400 with BAD_REQUEST when disabledSkills is not an array', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: 'impl' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when disabledSkills array contains non-string items', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: ['impl', 42] }),
            });
            expect(res.status).toBe(400);
        });

        it('saves disabledSkills array and returns 200 with updated workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: ['impl', 'draft'] }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { disabledSkills: ['impl', 'draft'] });
            const data = res.json();
            expect(data.workspace.disabledSkills).toEqual(['impl', 'draft']);
        });

        it('saves disabledSkills: [] (empty array) and returns 200', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: [] }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { disabledSkills: [] });
        });

        it('saves extraSkillFolders when provided alongside disabledSkills', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: [], extraSkillFolders: ['/team/skills', './custom'] }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, {
                disabledSkills: [],
                extraSkillFolders: ['/team/skills', './custom'],
            });
        });

        it('does not include extraSkillFolders in update when not provided', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: ['impl'] }),
            });
            expect(res.status).toBe(200);
            const callArg = (mockStore.updateWorkspace as any).mock.calls.at(-1)[1];
            expect('extraSkillFolders' in callArg).toBe(false);
        });

        it('returns 400 when extraSkillFolders is not an array', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: [], extraSkillFolders: '/bad' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when extraSkillFolders contains non-string items', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: [], extraSkillFolders: ['/ok', 42] }),
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Multi-workspace isolation (AC #3)
    //
    // With two workspaces registered, the per-repo skills-config endpoint must
    // return (and update) only the requested workspace's config, proving
    // extraSkillFolders / disabledSkills never leak between workspaces.
    // ========================================================================

    describe('multi-workspace isolation (AC #3)', () => {
        const WS_A = 'ws-iso-a';
        const WS_B = 'ws-iso-b';

        beforeEach(() => {
            // Override the single-workspace default set by the outer beforeEach.
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WS_A, name: 'Repo A', rootPath: '/projects/a', extraSkillFolders: ['/a/skills'], disabledSkills: ['skill-a'] },
                { id: WS_B, name: 'Repo B', rootPath: '/projects/b', extraSkillFolders: ['/b/skills'], disabledSkills: ['skill-b'] },
            ]);
        });

        it('GET returns only workspace A config, without workspace B folders leaking', async () => {
            const res = await request(`${base()}/api/workspaces/${WS_A}/skills-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.extraSkillFolders).toEqual(['/a/skills']);
            expect(data.disabledSkills).toEqual(['skill-a']);
            expect(data.extraSkillFolders).not.toContain('/b/skills');
            expect(data.disabledSkills).not.toContain('skill-b');
        });

        it('GET returns only workspace B config, without workspace A folders leaking', async () => {
            const res = await request(`${base()}/api/workspaces/${WS_B}/skills-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.extraSkillFolders).toEqual(['/b/skills']);
            expect(data.disabledSkills).toEqual(['skill-b']);
            expect(data.extraSkillFolders).not.toContain('/a/skills');
            expect(data.disabledSkills).not.toContain('skill-a');
        });

        it('PUT updates only the targeted workspace and never the other one', async () => {
            const res = await request(`${base()}/api/workspaces/${WS_A}/skills-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledSkills: [], extraSkillFolders: ['/a/new'] }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WS_A, {
                disabledSkills: [],
                extraSkillFolders: ['/a/new'],
            });
            // Workspace B is never mutated by an update targeting workspace A.
            expect(mockStore.updateWorkspace).not.toHaveBeenCalledWith(WS_B, expect.anything());
        });
    });
});
