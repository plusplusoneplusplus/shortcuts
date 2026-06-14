/**
 * LLM Tools Config API Endpoint Tests
 *
 * Tests for the llm-tools-config API routes:
 * - GET /api/workspaces/:id/llm-tools-config
 * - PUT /api/workspaces/:id/llm-tools-config
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import { getEffectiveLlmToolRegistry, getEffectiveDefaultDisabledTools } from '../../src/server/llm-tools/llm-tool-registry';

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

describe('LLM Tools Config API endpoints', () => {
    let server: http.Server;
    let port: number;
    let mockStore: ReturnType<typeof createMockProcessStore>;
    let tmpDir: string;

    const WORKSPACE_ID = 'ws-llm-tools-1';

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-tools-api-'));
        // Create the repos directory structure for preferences
        fs.mkdirSync(path.join(tmpDir, 'repos', WORKSPACE_ID), { recursive: true });

        mockStore = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'LLM Tools Project', rootPath: '/projects/llm-tools' }],
        });
        (mockStore as any).searchConversations = vi.fn();
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'LLM Tools Project', rootPath: '/projects/llm-tools' },
        ]);

        mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: {} });

        const routes: Route[] = [];
        registerApiRoutes(routes, mockStore, undefined, tmpDir);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        (mockStore as any).searchConversations = vi.fn();
        // Clean preferences files between tests
        const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
        if (fs.existsSync(prefsPath)) fs.unlinkSync(prefsPath);
        const globalPrefsPath = path.join(tmpDir, 'preferences.json');
        if (fs.existsSync(globalPrefsPath)) fs.unlinkSync(globalPrefsPath);
    });

    const base = () => `http://127.0.0.1:${port}`;

    // ========================================================================
    // GET /api/workspaces/:id/llm-tools-config
    // ========================================================================

    describe('GET /api/workspaces/:id/llm-tools-config', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/llm-tools-config`);
            expect(res.status).toBe(404);
        });

        it('returns all tools from the registry', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.tools).toHaveLength(getEffectiveLlmToolRegistry({ loopsEnabled: false }).length);
            const names = data.tools.map((t: any) => t.name);
            expect(names).toContain('tavily_web_search');
            expect(names).toContain('suggest_follow_ups');
            expect(names).toContain('create_update_work_item');
            expect(names).not.toContain('create_bug');
            expect(names).not.toContain('scheduleWakeup');
        });

        it('returns classic-mode defaults when no preferences are set', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledLlmTools).toEqual(getEffectiveDefaultDisabledTools(undefined));
            expect(data.disabledLlmTools).toEqual(
                expect.arrayContaining(['create_update_work_item', 'tavily_web_search']),
            );
            expect(data.disabledLlmTools).not.toContain('create_bug');
        });

        it('returns classic-mode defaults when global layout mode is classic', async () => {
            fs.writeFileSync(
                path.join(tmpDir, 'preferences.json'),
                JSON.stringify({ global: { uiLayoutMode: 'classic' } }),
            );

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledLlmTools).toEqual(getEffectiveDefaultDisabledTools('classic'));
        });

        it('returns dev-workflow defaults when global layout mode is dev-workflow', async () => {
            fs.writeFileSync(
                path.join(tmpDir, 'preferences.json'),
                JSON.stringify({ global: { uiLayoutMode: 'dev-workflow' } }),
            );

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledLlmTools).toEqual(getEffectiveDefaultDisabledTools('dev-workflow'));
            expect(data.disabledLlmTools).not.toEqual(
                expect.arrayContaining(['create_update_work_item']),
            );
            expect(data.disabledLlmTools).not.toContain('create_bug');
        });

        it('returns custom disabled list from preferences', async () => {
            // Pre-write preferences
            const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
            fs.writeFileSync(prefsPath, JSON.stringify({ disabledLlmTools: ['memory', 'ask_user'] }));

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledLlmTools).toEqual(['memory', 'ask_user']);
        });

        it('filters stale create_bug from saved disabled-tool preferences', async () => {
            const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
            fs.writeFileSync(prefsPath, JSON.stringify({ disabledLlmTools: ['create_bug', 'ask_user'] }));

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            expect(res.json().disabledLlmTools).toEqual(['ask_user']);
        });

        it('returns empty disabled list when explicitly set to empty', async () => {
            fs.writeFileSync(
                path.join(tmpDir, 'preferences.json'),
                JSON.stringify({ global: { uiLayoutMode: 'classic' } }),
            );
            const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
            fs.writeFileSync(prefsPath, JSON.stringify({ disabledLlmTools: [] }));

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledLlmTools).toEqual([]);
        });

        it('each tool entry has required metadata', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            const data = res.json();
            for (const tool of data.tools) {
                expect(tool.name).toBeTruthy();
                expect(tool.label).toBeTruthy();
                expect(tool.description).toBeTruthy();
                expect(typeof tool.enabledByDefault).toBe('boolean');
            }
        });

        it('attaches compact param metadata derived from tool schemas', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            const data = res.json();
            const byName = (n: string) => data.tools.find((t: any) => t.name === n);

            // Single required array param -> compact `[...]` shape.
            expect(byName('suggest_follow_ups').params).toEqual([
                { name: 'suggestions', type: '[...]', required: true },
            ]);

            // Mixed required/optional primitives preserve declaration order.
            expect(byName('get_conversation').params).toEqual([
                { name: 'processId', type: 'string', required: true },
                { name: 'maxChars', type: 'number', required: false },
                { name: 'includeToolCalls', type: 'boolean', required: false },
                { name: 'fromTurn', type: 'number', required: false },
                { name: 'toTurn', type: 'number', required: false },
            ]);

            // Nested object param -> compact `{...}` shape; union/oneOf -> `any`.
            const createWi = byName('create_update_work_item').params as Array<{ name: string; type: string; required: boolean }>;
            expect(createWi.find(p => p.name === 'tags')).toEqual({ name: 'tags', type: '[...]', required: false });
            expect(createWi.find(p => p.name === 'workItemNumber')).toEqual({ name: 'workItemNumber', type: 'any', required: false });
        });

        it('omits param metadata for tools without an available schema', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            const data = res.json();
            const memory = data.tools.find((t: any) => t.name === 'memory');
            // The built-in memory tool has no locally-declared schema -> field absent.
            expect(memory).toBeTruthy();
            expect(memory.params).toBeUndefined();
        });

        it('preserves the existing tool contract fields unchanged', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            const data = res.json();
            const registryBase = getEffectiveLlmToolRegistry({ loopsEnabled: false });
            for (const expected of registryBase) {
                const tool = data.tools.find((t: any) => t.name === expected.name);
                expect(tool).toBeTruthy();
                expect(tool.label).toBe(expected.label);
                expect(tool.description).toBe(expected.description);
                expect(tool.enabledByDefault).toBe(expected.enabledByDefault);
            }
        });

        it('reports conversation retrieval availability from the process store', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.json().conversationRetrievalAvailable).toBe(true);
        });

        it('reports conversation retrieval unavailable when the store cannot search conversations', async () => {
            delete (mockStore as any).searchConversations;

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);

            expect(res.json().conversationRetrievalAvailable).toBe(false);
        });
    });

    // ========================================================================
    // PUT /api/workspaces/:id/llm-tools-config
    // ========================================================================

    describe('PUT /api/workspaces/:id/llm-tools-config', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: [] }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when disabledLlmTools field is absent', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            expect(res.json().error).toContain('disabledLlmTools');
        });

        it('returns 400 when disabledLlmTools is not an array', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: 'tavily_web_search' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when disabledLlmTools array contains non-string items', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: ['tavily_web_search', 42] }),
            });
            expect(res.status).toBe(400);
        });

        it('saves disabledLlmTools and returns updated config', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: ['tavily_web_search', 'memory'] }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.disabledLlmTools).toEqual(['tavily_web_search', 'memory']);
            expect(data.tools).toHaveLength(getEffectiveLlmToolRegistry({ loopsEnabled: false }).length);
            expect(data.conversationRetrievalAvailable).toBe(true);
            // The PUT response carries the same additive param metadata as GET.
            const followUps = data.tools.find((t: any) => t.name === 'suggest_follow_ups');
            expect(followUps.params).toEqual([{ name: 'suggestions', type: '[...]', required: true }]);
        });

        it('persists disabledLlmTools to disk', async () => {
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: ['ask_user'] }),
            });

            const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            expect(prefs.disabledLlmTools).toEqual(['ask_user']);
        });

        it('saves empty array to enable all tools', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: [] }),
            });
            expect(res.status).toBe(200);
            expect(res.json().disabledLlmTools).toEqual([]);
        });

        it('preserves other preferences when updating disabledLlmTools', async () => {
            // Pre-set some other prefs
            const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
            fs.writeFileSync(prefsPath, JSON.stringify({ lastModel: 'gpt-4', disabledLlmTools: ['tavily_web_search'] }));

            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: ['memory'] }),
            });

            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            expect(prefs.lastModel).toBe('gpt-4');
            expect(prefs.disabledLlmTools).toEqual(['memory']);
        });

        it('filters stale create_bug when saving disabled-tool preferences', async () => {
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`, {
                method: 'PUT',
                body: JSON.stringify({ disabledLlmTools: ['suggest_follow_ups', 'create_bug'] }),
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/llm-tools-config`);
            expect(res.status).toBe(200);
            expect(res.json().disabledLlmTools).toEqual(['suggest_follow_ups']);

            const prefsPath = path.join(tmpDir, 'repos', WORKSPACE_ID, 'preferences.json');
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            expect(prefs.disabledLlmTools).toEqual(['suggest_follow_ups']);
        });
    });
});
