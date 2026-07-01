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
import { FileWorkItemStore, createWorkItemStorageScopeResolver } from '../../../src/server/work-items/work-item-store';

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;
let aiAuthoringEnabled = false;
let workflowEnabled = false;

const REPO_ID = 'test-workspace';
const ORIGIN_ID = `local_${REPO_ID}`;
const AI_DRAFT_PATH = `/api/origins/${ORIGIN_ID}/work-items/ai-draft`;

function aiImprovePath(workItemId: string): string {
    return `/api/origins/${ORIGIN_ID}/work-items/${encodeURIComponent(workItemId)}/ai-draft`;
}

function aiApplyPath(workItemId: string): string {
    return `/api/origins/${ORIGIN_ID}/work-items/${encodeURIComponent(workItemId)}/ai-draft/apply`;
}

function testProcessStore() {
    const workspaceIds = [REPO_ID, 'workspace-A', 'workspace-B'];
    return {
        getWorkspaces: async () => workspaceIds.map(id => ({ id, name: id })),
        updateWorkspace: async (id: string, updates: Record<string, unknown>) => ({ id, name: id, ...updates }),
    } as any;
}

function makeServer(
    generateNewItemDraft?: GenerateNewItemDraftFn,
    generateImproveItemDraft?: GenerateImproveItemDraftFn,
): http.Server {
    const routes: Route[] = [];
    const processStore = testProcessStore();
    registerWorkItemAiRoutes({
        routes,
        workItemStore: store,
        processStore,
        getAiAuthoringEnabled: () => aiAuthoringEnabled,
        getWorkflowEnabled: () => workflowEnabled,
        getHierarchyEnabled: () => false,
        generateNewItemDraft,
        generateImproveItemDraft,
    });
    // Also register CRUD routes so we can create test fixtures
    registerWorkItemRoutes({ routes, workItemStore: store, processStore });
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
        const requestBody = (
            method === 'POST' &&
            urlPath.startsWith(`/api/origins/${ORIGIN_ID}/work-items`) &&
            urlPath.includes('/ai-draft') &&
            body &&
            typeof body === 'object' &&
            !Array.isArray(body) &&
            !Object.prototype.hasOwnProperty.call(body, 'workspaceId')
        )
            ? { ...(body as Record<string, unknown>), workspaceId: REPO_ID }
            : body;
        if (requestBody) req.write(JSON.stringify(requestBody));
        req.end();
    });
}

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
        workflowEnabled = false;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-routes-'));
        store = new FileWorkItemStore({
            dataDir: tmpDir,
            scopeResolver: createWorkItemStorageScopeResolver(testProcessStore()),
        });
        server = makeServer(
            async () => DRAFT_RESPONSE,
            async () => DRAFT_RESPONSE,
        );
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
        await store.drainWrites();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // Feature flag gating
    // -------------------------------------------------------------------------

    describe('Feature flag disabled (default)', () => {
        it('POST /ai-draft (new) returns 403 when flag is off', async () => {
            const res = await request('POST', AI_DRAFT_PATH, {
                prompt: 'Build a login page',
            });
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/feature flag/i);
        });

        it('POST /:id/ai-draft (improve) returns 403 when flag is off', async () => {
            const res = await request('POST', aiImprovePath("fake-id"), {
                prompt: 'Improve description',
            });
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/feature flag/i);
        });

        it('does not register workspace-scoped AI draft aliases', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/ai-draft`, {
                prompt: 'Build a login page',
            });
            expect(res.status).toBe(404);
        });
    });

    describe('Feature flag enabled', () => {
        beforeEach(() => {
            aiAuthoringEnabled = true;
        });

        // -----------------------------------------------------------------------
        // POST /ai-draft — new work item
        // -----------------------------------------------------------------------

        describe('POST /api/origins/:originId/work-items/ai-draft', () => {
            it('returns 400 when prompt is missing', async () => {
                const res = await request('POST', AI_DRAFT_PATH, {});
                expect(res.status).toBe(400);
            });

            it('returns 400 when origin AI routes omit workspaceId', async () => {
                const res = await request('POST', AI_DRAFT_PATH, {
                    prompt: 'Build a login page',
                    workspaceId: '',
                });
                expect(res.status).toBe(400);
                expect(res.body.error).toMatch(/workspaceId/i);
            });

            it('returns 400 when prompt is empty string', async () => {
                const res = await request('POST', AI_DRAFT_PATH, {
                    prompt: '   ',
                });
                expect(res.status).toBe(400);
            });

            it('returns 400 for invalid work item type', async () => {
                const res = await request('POST', AI_DRAFT_PATH, {
                    prompt: 'Build a login page',
                    type: 'invalid-type',
                });
                expect(res.status).toBe(400);
            });

            it('returns 400 for hierarchy type when hierarchy flag is off', async () => {
                const res = await request('POST', AI_DRAFT_PATH, {
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

                const res = await request('POST', AI_DRAFT_PATH, {
                    prompt: 'Build a login page',
                });
                expect(res.status).toBe(500);
            });

            it('returns a draft response when generator returns draft', async () => {
                const res = await request('POST', AI_DRAFT_PATH, {
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

                const res = await request('POST', AI_DRAFT_PATH, {
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

                await request('POST', AI_DRAFT_PATH, {
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

                await request('POST', AI_DRAFT_PATH, {
                    prompt: 'Build a login page',
                });
                expect(capturedCtx[0].workspaceId).toBe(REPO_ID);
            });

            it('accepts valid types (work-item, bug, goal)', async () => {
                for (const type of ['work-item', 'bug', 'goal'] as const) {
                    const res = await request('POST', AI_DRAFT_PATH, {
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
                const res = await request('POST', AI_DRAFT_PATH, {
                    prompt: 'Build a login page',
                    clarificationCount: MAX_CLARIFICATION_ROUNDS - 1,
                });
                expect(res.status).toBe(500);
            });
        });

        // -----------------------------------------------------------------------
        // POST /:workItemId/ai-draft — improve existing work item
        // -----------------------------------------------------------------------

        describe('POST /api/origins/:originId/work-items/:workItemId/ai-draft', () => {
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
                const res = await request('POST', aiImprovePath("nonexistent"), {
                    prompt: 'Improve this',
                });
                expect(res.status).toBe(404);
            });

            it('returns 400 when prompt is missing', async () => {
                const res = await request('POST', aiImprovePath(workItemId), {});
                expect(res.status).toBe(400);
            });

            it('returns 400 for invalid targets', async () => {
                const res = await request('POST', aiImprovePath(workItemId), {
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

                const res = await request('POST', aiImprovePath(workItemId), {
                    prompt: 'Improve this work item',
                });
                expect(res.status).toBe(500);
            });

            it('returns a draft response for an existing work item', async () => {
                const res = await request('POST', aiImprovePath(workItemId), {
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

                await request('POST', aiImprovePath(workItemId), {
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

                await request('POST', aiImprovePath(workItemId), {
                    prompt: 'Improve it',
                });
                expect(capturedCtx[0].targets).toEqual(['fields', 'goal']);
            });

            it('accepts all valid targets', async () => {
                const res = await request('POST', aiImprovePath(workItemId), {
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

                const res = await request('POST', aiImprovePath(workItemId), {
                    prompt: 'Improve it',
                });
                expect(res.status).toBe(500);
                expect(res.body.error).toBeDefined();
            });
        });

        // -----------------------------------------------------------------------
        // POST /:workItemId/ai-draft/apply — explicit workflow draft application
        // -----------------------------------------------------------------------

        describe('POST /api/origins/:originId/work-items/:workItemId/ai-draft/apply', () => {
            let workItemId: string;
            let createdAtBase: string;

            beforeEach(async () => {
                const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Title-only shell',
                    source: 'manual',
                });
                expect(res.status).toBe(201);
                workItemId = res.body.id;
                createdAtBase = res.body.updatedAt;
            });

            it('returns 403 when workflow flag is disabled', async () => {
                workflowEnabled = false;

                const res = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft this item',
                    baseUpdatedAt: createdAtBase,
                    baseContentVersion: null,
                });

                expect(res.status).toBe(403);
                expect(res.body.error).toMatch(/workflow feature flag/i);
            });

            it('applies an AI draft to a title-only local work-item as immutable v1', async () => {
                workflowEnabled = true;

                const res = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft this item',
                    baseUpdatedAt: createdAtBase,
                    baseContentVersion: null,
                });

                expect(res.status).toBe(200);
                expect(res.body.kind).toBe('applied');
                expect(res.body.version).toBe(1);
                expect(res.body.plan).toMatchObject({
                    version: 1,
                    content: DRAFT_RESPONSE.goal,
                    resolvedBy: 'ai',
                    source: 'ai',
                    authorType: 'ai',
                });
                expect(res.body.item).toMatchObject({
                    id: workItemId,
                    title: 'Title-only shell',
                    description: 'Generated description',
                    status: 'planning',
                    plan: {
                        version: 1,
                        currentVersion: 1,
                        content: DRAFT_RESPONSE.goal,
                        resolvedBy: 'ai',
                        source: 'ai',
                    },
                    currentContentVersion: 1,
                });

                const versions = await store.getPlanVersions(workItemId, ORIGIN_ID);
                expect(versions).toHaveLength(1);
                expect(versions[0]).toMatchObject({ version: 1, content: DRAFT_RESPONSE.goal, source: 'ai' });
            });

            it('creates a new AI version for a later requested revision instead of overwriting v1', async () => {
                workflowEnabled = true;
                const planned = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Already planned shell',
                    source: 'manual',
                    plan: { content: '## Original Plan', resolvedBy: 'user' },
                });
                expect(planned.status).toBe(201);
                const plannedId = planned.body.id;
                const current = await request('GET', `/api/workspaces/${REPO_ID}/work-items/${plannedId}`);

                const res = await request('POST', aiApplyPath(plannedId), {
                    prompt: 'Revise the plan',
                    baseUpdatedAt: current.body.updatedAt,
                    baseContentVersion: 1,
                    summary: 'AI revision summary',
                    reason: 'User requested AI revision',
                });

                expect(res.status).toBe(200);
                expect(res.body.version).toBe(2);
                expect(res.body.previousVersion).toBe(1);
                expect(res.body.plan).toMatchObject({
                    version: 2,
                    summary: 'AI revision summary',
                    reason: 'User requested AI revision',
                    source: 'ai',
                });

                const versions = await store.getPlanVersions(plannedId, ORIGIN_ID);
                expect(versions.map(version => version.version)).toEqual([1, 2]);
                expect(versions[0].content).toBe('## Original Plan');
                expect(versions[1].content).toBe(DRAFT_RESPONSE.goal);
            });

            it('returns clarification without persisting a version', async () => {
                workflowEnabled = true;
                await stopServer();
                server = makeServer(async () => DRAFT_RESPONSE, async () => CLARIFICATION_RESPONSE);
                await startServer();

                const res = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft this item',
                    baseUpdatedAt: createdAtBase,
                    baseContentVersion: null,
                });

                expect(res.status).toBe(200);
                expect(res.body.kind).toBe('clarification');
                await expect(store.getPlanVersions(workItemId, ORIGIN_ID)).resolves.toEqual([]);
            });

            it('rejects stale base snapshots before invoking the generator', async () => {
                workflowEnabled = true;
                const improve = vi.fn<GenerateImproveItemDraftFn>(async () => DRAFT_RESPONSE);
                await stopServer();
                server = makeServer(async () => DRAFT_RESPONSE, improve);
                await startServer();

                const updated = await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${workItemId}`, {
                    description: 'User edited before AI apply',
                });
                expect(updated.status).toBe(200);

                const res = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft this item',
                    baseUpdatedAt: createdAtBase,
                    baseContentVersion: null,
                });

                expect(res.status).toBe(409);
                expect(res.body.code).toBe('WORK_ITEM_AI_DRAFT_STALE');
                expect(improve).not.toHaveBeenCalled();
            });

            it('rejects missing optimistic base metadata', async () => {
                workflowEnabled = true;

                const res = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft this item',
                });

                expect(res.status).toBe(400);
                expect(res.body.error).toMatch(/baseUpdatedAt/i);
            });

            it('rejects unsupported targets that cannot be applied as a plan version', async () => {
                workflowEnabled = true;

                const fieldsOnly = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft fields only',
                    targets: ['fields'],
                    baseUpdatedAt: createdAtBase,
                    baseContentVersion: null,
                });
                expect(fieldsOnly.status).toBe(400);
                expect(fieldsOnly.body.error).toMatch(/goal target/i);

                const childTasks = await request('POST', aiApplyPath(workItemId), {
                    prompt: 'Draft tasks',
                    targets: ['fields', 'goal', 'childTasks'],
                    baseUpdatedAt: createdAtBase,
                    baseContentVersion: null,
                });
                expect(childTasks.status).toBe(400);
                expect(childTasks.body.error).toMatch(/fields and goal targets only/i);
            });

            it('rejects non-work-item and remote-backed items for the workflow apply action', async () => {
                workflowEnabled = true;

                const goal = await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                    title: 'Goal shell',
                    type: 'goal',
                });
                expect(goal.status).toBe(201);
                const goalApply = await request('POST', aiApplyPath(goal.body.id), {
                    prompt: 'Draft this goal',
                    baseUpdatedAt: goal.body.updatedAt,
                    baseContentVersion: null,
                });
                expect(goalApply.status).toBe(400);

                const now = '2026-01-01T00:00:00.000Z';
                await store.addWorkItem({
                    id: 'remote-work-item',
                    repoId: ORIGIN_ID,
                    title: 'Remote item',
                    description: '',
                    status: 'created',
                    type: 'work-item',
                    createdAt: now,
                    updatedAt: now,
                    source: 'manual',
                    githubMirror: { issueNumber: 123 },
                });
                const remoteApply = await request('POST', aiApplyPath("remote-work-item"), {
                    prompt: 'Draft this remote item',
                    baseUpdatedAt: now,
                    baseContentVersion: null,
                });
                expect(remoteApply.status).toBe(400);
                expect(remoteApply.body.error).toMatch(/local-only work-item/i);
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
                const res = await request('POST', `/api/origins/local_workspace-b/work-items/${itemId}/ai-draft`, {
                    prompt: 'Improve it',
                    workspaceId: 'workspace-B',
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
