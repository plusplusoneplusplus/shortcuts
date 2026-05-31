/**
 * End-to-end smoke tests for the AI authoring create-with-AI flow
 * in hierarchy-enabled workspaces (AC-04 DoD 1-3, AC-05 DoD 1).
 *
 * These tests verify:
 *   1. The ai-draft route accepts hierarchy container types (epic/feature/pbi)
 *      when getHierarchyEnabled returns true.
 *   2. hierarchyEnabled=true is passed to the generator context.
 *   3. Draft responses can include childTasks.
 *   4. The full approval round-trip: create parent PBI + child work items
 *      in the same workspace via the standard work-item routes.
 *   5. Child items are always created in the same workspace as the parent
 *      (workspace-scoping invariant).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { registerWorkItemAiRoutes } from '../../../src/server/routes/work-item-ai-routes';
import type {
    GenerateNewItemDraftFn,
    GenerateImproveItemDraftFn,
    AiDraftResponse,
    NewItemDraftContext,
} from '../../../src/server/routes/work-item-ai-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;
let hierarchyEnabled = true;

function makeServer(
    generateNewItemDraft?: GenerateNewItemDraftFn,
    generateImproveItemDraft?: GenerateImproveItemDraftFn,
): http.Server {
    const routes: Route[] = [];
    registerWorkItemAiRoutes({
        routes,
        workItemStore: store,
        getAiAuthoringEnabled: () => true,
        getHierarchyEnabled: () => hierarchyEnabled,
        generateNewItemDraft,
        generateImproveItemDraft,
    });
    // Pass the same hierarchy flag so container types and parentId are accepted.
    registerWorkItemRoutes({
        routes,
        workItemStore: store,
        processStore: { getWorkspaces: async () => [] } as any,
        getHierarchyEnabled: () => hierarchyEnabled,
    });
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

const WS = 'hierarchy-test-ws';

// Draft response with child tasks (simulates hierarchy-aware AI output)
const DRAFT_WITH_CHILDREN: AiDraftResponse = {
    kind: 'draft',
    workItem: {
        title: 'User Authentication PBI',
        description: 'Implement secure login and registration',
        priority: 'high',
        type: 'pbi',
    },
    goal: '## Goal\nDeliver secure user authentication.\n\n## Acceptance Criteria\n- Login flow works\n- JWT issued',
    childTasks: [
        { title: 'Build login endpoint', description: 'POST /auth/login', type: 'work-item' },
        { title: 'Build registration endpoint', description: 'POST /auth/register', type: 'work-item' },
        { title: 'Add JWT middleware', type: 'work-item' },
    ],
};

// ============================================================================
// Tests
// ============================================================================

describe('AI Authoring — hierarchy-enabled route acceptance', () => {
    beforeEach(async () => {
        hierarchyEnabled = true;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-hierarchy-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        server = makeServer(async () => DRAFT_WITH_CHILDREN, async () => DRAFT_WITH_CHILDREN);
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('accepts "pbi" type when hierarchy is enabled', async () => {
        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add user authentication',
            type: 'pbi',
        });
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe('draft');
    });

    it('accepts "feature" type when hierarchy is enabled', async () => {
        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Create a user management feature',
            type: 'feature',
        });
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe('draft');
    });

    it('accepts "epic" type when hierarchy is enabled', async () => {
        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Build the entire authentication epic',
            type: 'epic',
        });
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe('draft');
    });

    it('rejects "epic" type when hierarchy is disabled', async () => {
        await stopServer();
        hierarchyEnabled = false;
        server = makeServer(async () => DRAFT_WITH_CHILDREN, async () => DRAFT_WITH_CHILDREN);
        await startServer();

        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Build an epic',
            type: 'epic',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/hierarchy/i);
    });

    it('rejects "pbi" type when hierarchy is disabled', async () => {
        await stopServer();
        hierarchyEnabled = false;
        server = makeServer(async () => DRAFT_WITH_CHILDREN, async () => DRAFT_WITH_CHILDREN);
        await startServer();

        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Build a PBI',
            type: 'pbi',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/hierarchy/i);
    });

    it('returns childTasks in the draft when generator provides them', async () => {
        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add user authentication',
            type: 'pbi',
        });
        expect(res.status).toBe(200);
        expect(res.body.kind).toBe('draft');
        expect(Array.isArray(res.body.childTasks)).toBe(true);
        expect(res.body.childTasks.length).toBe(3);
        expect(res.body.childTasks[0].title).toBe('Build login endpoint');
    });

    it('passes hierarchyEnabled=true to the generator context', async () => {
        const capturedCtx: NewItemDraftContext[] = [];
        await stopServer();
        server = makeServer(
            async (ctx) => { capturedCtx.push(ctx); return DRAFT_WITH_CHILDREN; },
            async () => DRAFT_WITH_CHILDREN,
        );
        await startServer();

        await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add auth',
            type: 'pbi',
        });
        expect(capturedCtx[0].hierarchyEnabled).toBe(true);
    });

    it('passes parentId to the generator when provided', async () => {
        const capturedCtx: NewItemDraftContext[] = [];
        await stopServer();
        server = makeServer(
            async (ctx) => { capturedCtx.push(ctx); return DRAFT_WITH_CHILDREN; },
            async () => DRAFT_WITH_CHILDREN,
        );
        await startServer();

        await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add auth PBI under feature',
            type: 'pbi',
            parentId: 'feature-123',
        });
        expect(capturedCtx[0].parentId).toBe('feature-123');
    });
});

// ============================================================================
// Full approval round-trip (hierarchy-enabled scenario)
// ============================================================================

describe('AI Authoring — full hierarchy-enabled approval round-trip (AC-04 DoD)', () => {
    beforeEach(async () => {
        hierarchyEnabled = true;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-roundtrip-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        server = makeServer(async () => DRAFT_WITH_CHILDREN, async () => DRAFT_WITH_CHILDREN);
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    /**
     * Simulates the complete approval flow that WorkItemAiComposer performs:
     *   1. ai-draft → receives draft with childTasks
     *   2. POST /work-items to create the parent PBI
     *   3. POST /work-items to create each child under the parent
     */
    it('round-trip: ai-draft → create parent → create children in same workspace', async () => {
        // Step 1: Generate draft
        const draftRes = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add user authentication system',
            type: 'pbi',
        });
        expect(draftRes.status).toBe(200);
        expect(draftRes.body.kind).toBe('draft');
        const { workItem, goal, childTasks } = draftRes.body;

        // Step 2: Approval — create the parent PBI
        const parentCreateRes = await request('POST', `/api/workspaces/${WS}/work-items`, {
            title: workItem.title,
            description: workItem.description,
            priority: workItem.priority,
            type: workItem.type,
            source: 'manual',
            plan: goal ? { content: goal } : undefined,
        });
        expect(parentCreateRes.status).toBe(201);
        const parentId = parentCreateRes.body.id;
        expect(typeof parentId).toBe('string');
        expect(parentCreateRes.body.title).toBe('User Authentication PBI');
        expect(parentCreateRes.body.plan?.content).toContain('Deliver secure user authentication');

        // Step 3: Create each child work item under the parent
        const childIds: string[] = [];
        for (const child of childTasks) {
            const childRes = await request('POST', `/api/workspaces/${WS}/work-items`, {
                title: child.title,
                description: child.description,
                type: child.type || 'work-item',
                parentId,
                source: 'manual',
            });
            expect(childRes.status).toBe(201);
            expect(childRes.body.parentId).toBe(parentId);
            childIds.push(childRes.body.id);
        }

        expect(childIds).toHaveLength(3);

        // Verify all children are in the same workspace by fetching them
        for (const childId of childIds) {
            const fetchRes = await request('GET', `/api/workspaces/${WS}/work-items/${childId}`);
            expect(fetchRes.status).toBe(200);
            expect(fetchRes.body.parentId).toBe(parentId);
        }
    });

    it('round-trip: child creation with a parentId from a different workspace is rejected (AC-04 DoD 3)', async () => {
        // Create parent in WS-A
        const parentRes = await request('POST', `/api/workspaces/ws-A/work-items`, {
            title: 'Parent PBI',
            description: '',
            type: 'pbi',
            source: 'manual',
        });
        expect(parentRes.status).toBe(201);
        const parentId = parentRes.body.id;

        // Try to create a child in WS-B referencing a parentId from WS-A.
        // The route looks up parentId within WS-B; since the item lives in WS-A,
        // the lookup returns "not found" → 400. This enforces workspace isolation.
        const childInBRes = await request('POST', `/api/workspaces/ws-B/work-items`, {
            title: 'Child in wrong workspace',
            source: 'manual',
            parentId,  // parentId is from ws-A, not visible in ws-B
        });
        expect(childInBRes.status).toBe(400);
        expect(childInBRes.body.error).toMatch(/parent work item not found/i);
    });

    it('approval does not start Ralph or any execution — no /execute endpoint called', async () => {
        // Record any calls that hit an execution-related path
        const executionCalls: string[] = [];

        await stopServer();
        server = makeServer(async () => DRAFT_WITH_CHILDREN, async () => DRAFT_WITH_CHILDREN);
        // Wrap the handler to spy on requests
        const routes: Route[] = [];
        registerWorkItemAiRoutes({
            routes,
            workItemStore: store,
            getAiAuthoringEnabled: () => true,
            getHierarchyEnabled: () => true,
            generateNewItemDraft: async () => DRAFT_WITH_CHILDREN,
        });
        registerWorkItemRoutes({
            routes,
            workItemStore: store,
            processStore: { getWorkspaces: async () => [] } as any,
            getHierarchyEnabled: () => true,
        });
        const baseHandler = createRouter({ routes, spaHtml: '' });
        const spyServer = http.createServer((req, res) => {
            if (req.url?.includes('/execute') || req.url?.includes('/ralph')) {
                executionCalls.push(req.url);
            }
            baseHandler(req, res);
        });
        await new Promise<void>((resolve, reject) => {
            spyServer.on('error', reject);
            spyServer.listen(0, '127.0.0.1', () => {
                const addr = spyServer.address() as any;
                baseUrl = `http://127.0.0.1:${addr.port}`;
                resolve();
            });
        });

        // Simulate the approval flow: draft → create parent → create children
        const draftRes = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add auth',
        });
        expect(draftRes.body.kind).toBe('draft');

        const parentRes = await request('POST', `/api/workspaces/${WS}/work-items`, {
            title: draftRes.body.workItem.title,
            source: 'manual',
        });
        expect(parentRes.status).toBe(201);

        for (const child of draftRes.body.childTasks) {
            await request('POST', `/api/workspaces/${WS}/work-items`, {
                title: child.title,
                parentId: parentRes.body.id,
                source: 'manual',
            });
        }

        // No execution-related endpoints should have been called
        expect(executionCalls).toHaveLength(0);

        await new Promise<void>(resolve => spyServer.close(() => resolve()));
    });
});

// ============================================================================
// Hierarchy fallback — checklist (AC-04 DoD 2)
// ============================================================================

describe('AI Authoring — hierarchy-disabled checklist fallback (AC-04 DoD 2)', () => {
    beforeEach(async () => {
        hierarchyEnabled = false;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-ai-checklist-'));
        store = new FileWorkItemStore({ dataDir: tmpDir });
        server = makeServer(async () => DRAFT_WITH_CHILDREN, async () => DRAFT_WITH_CHILDREN);
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('ai-draft still returns childTasks even when hierarchy is disabled', async () => {
        // The server returns the raw draft — it's the client (WorkItemAiComposer) that
        // folds childTasks into a plan checklist when hierarchy is disabled.
        // The route should not strip childTasks from the response.
        const res = await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add auth',
        });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.childTasks)).toBe(true);
        expect(res.body.childTasks.length).toBeGreaterThan(0);
    });

    it('passes hierarchyEnabled=false to the generator context', async () => {
        const capturedCtx: NewItemDraftContext[] = [];
        await stopServer();
        server = makeServer(
            async (ctx) => { capturedCtx.push(ctx); return DRAFT_WITH_CHILDREN; },
            async () => DRAFT_WITH_CHILDREN,
        );
        await startServer();

        await request('POST', `/api/workspaces/${WS}/work-items/ai-draft`, {
            prompt: 'Add auth',
        });
        expect(capturedCtx[0].hierarchyEnabled).toBe(false);
    });

    it('approval flow: creates one item with checklist in plan (no child records)', async () => {
        // Simulate the client-side fold: child tasks become a checklist appended to goal
        const goal = DRAFT_WITH_CHILDREN.goal ?? '';
        const checklist = (DRAFT_WITH_CHILDREN.childTasks ?? [])
            .map(ct => `- [ ] ${ct.title}`)
            .join('\n');
        const planContent = `${goal}\n\n## Tasks\n${checklist}`;

        // Create ONE work item with the checklist folded into the plan.
        // Use the default 'work-item' type since hierarchy is disabled.
        const res = await request('POST', `/api/workspaces/${WS}/work-items`, {
            title: 'User Authentication Work Item',
            source: 'manual',
            plan: { content: planContent },
        });
        expect(res.status).toBe(201);
        expect(res.body.plan?.content).toContain('- [ ] Build login endpoint');
        expect(res.body.plan?.content).toContain('- [ ] Build registration endpoint');
        expect(res.body.plan?.content).toContain('- [ ] Add JWT middleware');

        // Verify no child items were created — only one item exists
        const listRes = await request('GET', `/api/workspaces/${WS}/work-items`);
        expect(listRes.status).toBe(200);
        const items: any[] = listRes.body.items ?? listRes.body;
        expect(Array.isArray(items) ? items : (items as any).items).toHaveLength(1);
    });
});
