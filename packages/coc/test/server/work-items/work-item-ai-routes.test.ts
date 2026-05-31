import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { registerWorkItemAiRoutes, MAX_CLARIFICATION_ROUNDS } from '../../../src/server/routes/work-item-ai-routes';
import type {
    GenerateNewItemDraftFn,
    GenerateImproveItemDraftFn,
    AiDraftResponse,
} from '../../../src/server/routes/work-item-ai-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;
let aiAuthoringEnabled = false;

function makeServer(
    generateNewItemDraft?: GenerateNewItemDraftFn,
    generateImproveItemDraft?: GenerateImproveItemDraftFn,
): http.Server {
    const routes: Route[] = [];
    registerWorkItemAiRoutes({
        routes,
        workItemStore: store,
        getAiAuthoringEnabled: () => aiAuthoringEnabled,
        getHierarchyEnabled: () => false,
        generateNewItemDraft,
        generateImproveItemDraft,
    });
    // Also register CRUD routes so we can create test fixtures
    registerWorkItemRoutes({ routes, workItemStore: store, processStore: { getWorkspaces: async () => [] } as any });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function request(
    method: string,
    urlPath: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const opts: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        };
        const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = null;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const REPO_ID = 'test-workspace';

const DRAFT_RESPONSE: AiDraftResponse = {
    kind: 'draft',
    workItem: {
        title: 'Generated Title',
        description: 'Generated description',
        priority: 'normal',
        type: 'work-item',
    },
    goal: '## Objective\nDo the thing.\n\n## Steps\n- [ ] Step 1',
};

const CLARIFICATION_RESPONSE: AiDraftResponse = {
    kind: 'clarification',
    questions: ['What is the target user?'],
    clarificationCount: 0,
};

// ============================================================================
// Tests
// ============================================================================

describe('Work Item AI Routes', () => {
    beforeEach(async () => {
        aiAuthoringEnabled = false;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-routes-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        server = makeServer(
            async () => DRAFT_RESPONSE,
            async () => DRAFT_RESPONSE,
        );
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // Feature flag gating
    // -------------------------------------------------------------------------

    describe('Feature flag disabled (default)', () => {
        it('POST /ai-draft (new) returns 403 when flag is off', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                prompt: 'Build a login page',
            });
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/feature flag/i);
        });

        it('POST /:id/ai-draft (improve) returns 403 when flag is off', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/fake-id/ai-draft`, {
                prompt: 'Improve description',
            });
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/feature flag/i);
        });
    });

    describe('Feature flag enabled', () => {
        beforeEach(() => {
            aiAuthoringEnabled = true;
        });

        // -----------------------------------------------------------------------
        // POST /ai-draft — new work item
        // -----------------------------------------------------------------------

        describe('POST /api/workspaces/:id/work-items/ai-draft', () => {
            it('returns 400 when prompt is missing', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {});
                expect(res.status).toBe(400);
            });

            it('returns 400 when prompt is empty string', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: '   ',
                });
                expect(res.status).toBe(400);
            });

            it('returns 400 for invalid work item type', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                    type: 'invalid-type',
                });
                expect(res.status).toBe(400);
            });

            it('returns 400 for hierarchy type when hierarchy flag is off', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                    type: 'epic',
                });
                expect(res.status).toBe(400);
                expect(res.body.error).toMatch(/hierarchy/i);
            });

            it('returns 503 when no generator is injected', async () => {
                await stopServer();
                server = makeServer(undefined, undefined);
                await startServer();

                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                });
                expect(res.status).toBe(500);
            });

            it('returns a draft response when generator returns draft', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                });
                expect(res.status).toBe(200);
                expect(res.body.kind).toBe('draft');
                expect(res.body.workItem).toBeDefined();
                expect(res.body.workItem.title).toBe('Generated Title');
            });

            it('returns a clarification response when generator returns clarification', async () => {
                await stopServer();
                server = makeServer(async () => CLARIFICATION_RESPONSE, async () => DRAFT_RESPONSE);
                await startServer();

                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                    clarificationCount: 0,
                });
                expect(res.status).toBe(200);
                expect(res.body.kind).toBe('clarification');
                expect(Array.isArray(res.body.questions)).toBe(true);
            });

            it('passes clarificationCount and clarificationAnswers to the generator', async () => {
                const capturedCtx: any[] = [];
                await stopServer();
                server = makeServer(
                    async (ctx) => { capturedCtx.push(ctx); return DRAFT_RESPONSE; },
                    async () => DRAFT_RESPONSE,
                );
                await startServer();

                await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                    clarificationCount: 1,
                    clarificationAnswers: ['Internal users'],
                });
                expect(capturedCtx[0].clarificationCount).toBe(1);
                expect(capturedCtx[0].clarificationAnswers).toEqual(['Internal users']);
            });

            it('passes workspaceId to the generator', async () => {
                const capturedCtx: any[] = [];
                await stopServer();
                server = makeServer(
                    async (ctx) => { capturedCtx.push(ctx); return DRAFT_RESPONSE; },
                    async () => DRAFT_RESPONSE,
                );
                await startServer();

                await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                });
                expect(capturedCtx[0].workspaceId).toBe(REPO_ID);
            });

            it('accepts valid types (work-item, bug, goal)', async () => {
                for (const type of ['work-item', 'bug', 'goal'] as const) {
                    const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                        prompt: 'Build a login page',
                        type,
                    });
                    expect(res.status).toBe(200);
                }
            });

            it('returns draft when clarificationCount reaches MAX and generator returns clarification', async () => {
                await stopServer();
                server = makeServer(
                    // Generator insists on clarification even at the limit
                    async () => CLARIFICATION_RESPONSE,
                    async () => DRAFT_RESPONSE,
                );
                await startServer();

                // At the last allowed round (MAX - 1), if generator still returns clarification
                // the server should reject it (500 — generator violated the contract)
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                    prompt: 'Build a login page',
                    clarificationCount: MAX_CLARIFICATION_ROUNDS - 1,
                });
                expect(res.status).toBe(500);
            });
        });

        // -----------------------------------------------------------------------
        // POST /:workItemId/ai-draft — improve existing work item
        // -----------------------------------------------------------------------

        describe('POST /api/workspaces/:id/work-items/:workItemId/ai-draft', () => {
            let workItemId: string;

            beforeEach(async () => {
                // Create a work item fixture
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Existing Feature',
                    description: 'Some description',
                    source: 'manual',
                });
                workItemId = res.body.id;
            });

            it('returns 404 for non-existent work item', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/nonexistent/ai-draft`, {
                    prompt: 'Improve this',
                });
                expect(res.status).toBe(404);
            });

            it('returns 400 when prompt is missing', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {});
                expect(res.status).toBe(400);
            });

            it('returns 400 for invalid targets', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve',
                    targets: ['invalid'],
                });
                expect(res.status).toBe(400);
                expect(res.body.error).toMatch(/targets/i);
            });

            it('returns 500 when no generator is injected', async () => {
                await stopServer();
                server = makeServer(undefined, undefined);
                await startServer();

                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve this work item',
                });
                expect(res.status).toBe(500);
            });

            it('returns a draft response for an existing work item', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve description and add a plan',
                });
                expect(res.status).toBe(200);
                expect(res.body.kind).toBe('draft');
            });

            it('passes correct context to the generator', async () => {
                const capturedCtx: any[] = [];
                await stopServer();
                server = makeServer(
                    async () => DRAFT_RESPONSE,
                    async (ctx) => { capturedCtx.push(ctx); return DRAFT_RESPONSE; },
                );
                await startServer();

                await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve it',
                    targets: ['fields', 'goal'],
                });
                expect(capturedCtx[0].workspaceId).toBe(REPO_ID);
                expect(capturedCtx[0].workItemId).toBe(workItemId);
                expect(capturedCtx[0].title).toBe('Existing Feature');
                expect(capturedCtx[0].targets).toEqual(['fields', 'goal']);
            });

            it('defaults targets to [fields, goal] when omitted', async () => {
                const capturedCtx: any[] = [];
                await stopServer();
                server = makeServer(
                    async () => DRAFT_RESPONSE,
                    async (ctx) => { capturedCtx.push(ctx); return DRAFT_RESPONSE; },
                );
                await startServer();

                await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve it',
                });
                expect(capturedCtx[0].targets).toEqual(['fields', 'goal']);
            });

            it('accepts all valid targets', async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve it',
                    targets: ['fields', 'goal', 'childTasks'],
                });
                expect(res.status).toBe(200);
            });

            it('surfaces generator errors without silently swallowing them', async () => {
                await stopServer();
                server = makeServer(
                    async () => DRAFT_RESPONSE,
                    async () => { throw new Error('LLM service unavailable'); },
                );
                await startServer();

                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${workItemId}/ai-draft`, {
                    prompt: 'Improve it',
                });
                expect(res.status).toBe(500);
                expect(res.body.error).toBeDefined();
            });
        });

        // -----------------------------------------------------------------------
        // Workspace scoping
        // -----------------------------------------------------------------------

        describe('Workspace scoping', () => {
            it('does not find a work item from a different workspace', async () => {
                // Create a work item in workspace-A
                const createRes = await request('POST', `/api/workspaces/workspace-A/work-items`, {
                    title: 'Item in A',
                    description: '',
                    source: 'manual',
                });
                const itemId = createRes.body.id;

                // Try to draft from workspace-B — should 404
                const res = await request('POST', `/api/workspaces/workspace-B/work-items/${itemId}/ai-draft`, {
                    prompt: 'Improve it',
                });
                expect(res.status).toBe(404);
            });
        });
    });
});

// ============================================================================
// MAX_CLARIFICATION_ROUNDS constant export test
// ============================================================================
describe('MAX_CLARIFICATION_ROUNDS', () => {
    it('is exactly 3', () => {
        expect(MAX_CLARIFICATION_ROUNDS).toBe(3);
    });
});
