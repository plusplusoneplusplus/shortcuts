/**
 * Tests for Memory V2 REST routes.
 *
 * Covers:
 *   - Feature gate: 404 when not enabled
 *   - GET    /api/memory/v2/scopes                            — list scopes
 *   - POST   /api/workspaces/:wsId/memory/v2/facts          — create fact (happy path + blocked)
 *   - GET    /api/workspaces/:wsId/memory/v2/facts          — list facts
 *   - PATCH  /api/workspaces/:wsId/memory/v2/facts/:id      — update fact
 *   - DELETE /api/workspaces/:wsId/memory/v2/facts/:id      — delete fact
 *   - GET    /api/workspaces/:wsId/memory/v2/review         — list review queue
 *   - POST   /api/workspaces/:wsId/memory/v2/review/:id/approve
 *   - POST   /api/workspaces/:wsId/memory/v2/review/:id/reject
 *   - GET    /api/workspaces/:wsId/memory/v2/episodes       — list episodes
 *   - GET    /api/workspaces/:wsId/memory/v2/export
 *   - DELETE /api/workspaces/:wsId/memory/v2/wipe           — with/without confirm
 *   - Workspace isolation (each workspace has its own store)
 *   - Global scope via wsId="global"
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerMemoryV2Routes } from '../../../src/server/memory/memory-v2-routes';
import { writeRepoPreferences, writePreferences } from '../../../src/server/preferences-handler';
import type { Route } from '../../../src/server/types';
import { createTestRouter } from './test-helpers';
import { createMemoryStores, MemoryCaptureService, WORKSPACE_MEMORY_SUBDIR } from '@plusplusoneplusplus/coc-memory';

// ============================================================================
// Constants
// ============================================================================

const WORKSPACE_ID = 'ws-test-v2';

// ============================================================================
// Helpers
// ============================================================================

function setupDataDir(): string {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-v2-routes-test-'));
    return dataDir;
}

function enableMemoryV2(dataDir: string, wsId: string): void {
    writeRepoPreferences(dataDir, wsId, {
        memoryV2: { enabled: true },
    } as any);
}

function enableGlobalMemoryV2(dataDir: string): void {
    writePreferences(dataDir, { global: { memoryV2: { enabled: true } } });
}

function getWorkspaceStoreDir(dataDir: string, wsId: string): string {
    return path.join(dataDir, 'repos', wsId, WORKSPACE_MEMORY_SUBDIR);
}

// ============================================================================
// Tests
// ============================================================================

describe('Memory V2 Routes', () => {
    let dataDir: string;
    let routes: Route[];
    let router: ReturnType<typeof createTestRouter>;

    beforeEach(() => {
        dataDir = setupDataDir();
        routes = [];
        registerMemoryV2Routes(routes, dataDir);
        router = createTestRouter(routes);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Feature gate ──────────────────────────────────────────────────────────

    describe('feature gate', () => {
        it('returns 404 when memory v2 is not enabled', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(res.status).toBe(404);
            expect(res.body).toContain('not enabled');
        });

        it('returns 404 for all methods when not enabled', async () => {
            const routes404 = [
                () => router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, { content: 'test' }),
                () => router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/review`),
                () => router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/episodes`),
                () => router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`),
            ];
            for (const fn of routes404) {
                const res = await fn();
                expect(res.status).toBe(404);
            }
        });
    });

    // ── Scopes endpoint ───────────────────────────────────────────────────────

    describe('GET /api/memory/v2/scopes', () => {
        it('returns global scope disabled by default', async () => {
            const res = await router.get('/api/memory/v2/scopes');
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.scopes).toBeDefined();
            expect(Array.isArray(body.scopes)).toBe(true);
            const global = body.scopes.find((s: any) => s.id === 'global');
            expect(global).toBeDefined();
            expect(global.type).toBe('global');
            expect(global.label).toBe('Global');
            expect(global.enabled).toBe(false);
            expect(global.counts).toBeDefined();
        });

        it('returns global scope enabled after enabling global prefs', async () => {
            enableGlobalMemoryV2(dataDir);
            const res = await router.get('/api/memory/v2/scopes');
            expect(res.status).toBe(200);
            const body = res.json();
            const global = body.scopes.find((s: any) => s.id === 'global');
            expect(global.enabled).toBe(true);
        });

        it('counts reflect facts in enabled global scope', async () => {
            enableGlobalMemoryV2(dataDir);
            await router.post(`/api/workspaces/global/memory/v2/facts`, {
                content: 'A global fact',
            });
            const res = await router.get('/api/memory/v2/scopes');
            const body = res.json();
            const global = body.scopes.find((s: any) => s.id === 'global');
            expect(global.counts.activeFacts).toBe(1);
        });

        it('returns only global scope when no store provided', async () => {
            const res = await router.get('/api/memory/v2/scopes');
            expect(res.status).toBe(200);
            const body = res.json();
            const workspaceScopes = body.scopes.filter((s: any) => s.type === 'workspace');
            expect(workspaceScopes).toHaveLength(0);
        });
    });

    // ── Facts: create ─────────────────────────────────────────────────────────

    describe('POST /facts', () => {
        beforeEach(() => enableMemoryV2(dataDir, WORKSPACE_ID));

        it('creates a fact and returns 201', async () => {
            const res = await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, {
                content: 'The project uses TypeScript strict mode',
                importance: 0.8,
                tags: ['typescript', 'config'],
            });
            expect(res.status).toBe(201);
            const body = res.json();
            expect(body.fact).toBeDefined();
            expect(body.fact.content).toBe('The project uses TypeScript strict mode');
            expect(body.fact.importance).toBe(0.8);
            expect(body.fact.tags).toContain('typescript');
            expect(body.fact.status).toBe('active');
        });

        it('returns 400 when content is missing', async () => {
            const res = await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, {
                importance: 0.5,
            });
            expect(res.status).toBe(400);
        });

        it('returns 422 when content is blocked by safety scanner', async () => {
            const res = await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, {
                content: 'Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            });
            expect(res.status).toBe(422);
            const body = res.json();
            expect(body.blocked).toBe(true);
        });
    });

    // ── Facts: list/search ────────────────────────────────────────────────────

    describe('GET /facts', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                await svc.captureExplicit({
                    content: 'Project uses Vitest for testing',
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    provenance: { createdBy: 'user', version: 1 },
                });
                await svc.captureExplicit({
                    content: 'Database is SQLite with better-sqlite3',
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    provenance: { createdBy: 'user', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('lists all active facts', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.facts).toHaveLength(2);
        });

        it('searches facts by query', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts?q=SQLite`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.facts.length).toBeGreaterThan(0);
            expect(body.facts[0].content).toContain('SQLite');
        });
    });

    // ── Facts: update ─────────────────────────────────────────────────────────

    describe('PATCH /facts/:id', () => {
        let factId: string;

        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                const fact = await svc.captureExplicit({
                    content: 'Original content',
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    provenance: { createdBy: 'user', version: 1 },
                });
                factId = fact!.id;
            } finally {
                handle.close();
            }
        });

        it('updates fact content', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`, {
                content: 'Updated content',
                importance: 0.9,
            });
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.fact.content).toBe('Updated content');
            expect(body.fact.importance).toBe(0.9);
        });

        it('returns 404 for unknown fact', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/unknown-id`, {
                content: 'new',
            });
            expect(res.status).toBe(404);
        });

        it('returns 422 for blocked content in PATCH', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`, {
                content: 'password: SuperSecret123ExtraLongPwd!',
            });
            expect(res.status).toBe(422);
        });

        it('returns 400 for invalid status value', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`, {
                status: 'banana',
            });
            expect(res.status).toBe(400);
        });
    });

    // ── Facts: delete ─────────────────────────────────────────────────────────

    describe('DELETE /facts/:id', () => {
        let factId: string;

        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                const fact = await svc.captureExplicit({
                    content: 'Fact to delete',
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    provenance: { createdBy: 'user', version: 1 },
                });
                factId = fact!.id;
            } finally {
                handle.close();
            }
        });

        it('deletes a fact', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.deleted).toBe(true);
        });

        it('returns 404 when deleting non-existent fact', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/no-such-id`);
            expect(res.status).toBe(404);
        });
    });

    // ── Review queue ──────────────────────────────────────────────────────────

    describe('review queue', () => {
        let reviewFactId: string;

        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                await handle.facts.addFact({
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    content: 'Low confidence extracted fact',
                    importance: 0.4,
                    confidence: 0.3,
                    status: 'review',
                    tags: [],
                    source: 'auto-extracted',
                    provenance: { createdBy: 'ai', version: 1 },
                });
                const all = await handle.facts.listFacts({ statuses: ['review'] });
                reviewFactId = all[0].id;
            } finally {
                handle.close();
            }
        });

        it('lists review queue', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/review`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.facts).toHaveLength(1);
            expect(body.facts[0].status).toBe('review');
        });

        it('approves a review fact → status becomes active', async () => {
            const res = await router.post(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/review/${reviewFactId}/approve`,
                {},
            );
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.fact.status).toBe('active');
        });

        it('rejects a review fact → status becomes rejected', async () => {
            const res = await router.post(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/review/${reviewFactId}/reject`,
                {},
            );
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.fact.status).toBe('rejected');
        });

        it('returns 404 when approving unknown fact', async () => {
            const res = await router.post(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/review/no-such-id/approve`,
                {},
            );
            expect(res.status).toBe(404);
        });
    });

    // ── Episodes ──────────────────────────────────────────────────────────────

    describe('GET /episodes', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                await handle.episodes.addEpisode({
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    processId: 'proc-001',
                    summary: 'Discussed TypeScript strict mode config',
                    eventType: 'chat-turn',
                    provenance: { createdBy: 'ai', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('lists episodes', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/episodes`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.episodes).toHaveLength(1);
            expect(body.episodes[0].processId).toBe('proc-001');
        });
    });

    // ── Export ────────────────────────────────────────────────────────────────

    describe('GET /export', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                await svc.captureExplicit({
                    content: 'Export test fact',
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    provenance: { createdBy: 'user', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('exports facts and episodes as JSON', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.version).toBe(1);
            expect(Array.isArray(body.facts)).toBe(true);
            expect(Array.isArray(body.episodes)).toBe(true);
            expect(body.facts).toHaveLength(1);
            expect(body.facts[0].content).toBe('Export test fact');
            expect(body.scope).toBe('workspace');
        });
    });

    // ── Wipe ──────────────────────────────────────────────────────────────────

    describe('DELETE /wipe', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                await svc.captureExplicit({
                    content: 'Fact to be wiped',
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    provenance: { createdBy: 'user', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('returns 400 without confirm body', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/wipe`);
            expect(res.status).toBe(400);
            expect(res.body).toContain('confirm');
        });

        it('wipes facts when confirm=true', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/wipe`);
            expect(res.status).toBe(400);
        });

        it('wipes all data with confirm: true body', async () => {
            const listBefore = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(listBefore.json().facts).toHaveLength(1);

            const res = await router.delete(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/wipe`,
                { confirm: true }
            );
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.wiped).toBe(true);

            const listAfter = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(listAfter.json().facts).toHaveLength(0);
        });
    });

    // ── Workspace isolation ───────────────────────────────────────────────────
    // Each workspace has its own isolated store; facts never bleed between workspaces.

    describe('workspace isolation', () => {
        const WS_A = 'ws-isolation-a';
        const WS_B = 'ws-isolation-b';

        it('workspaces do not share facts', async () => {
            enableMemoryV2(dataDir, WS_A);
            enableMemoryV2(dataDir, WS_B);

            await router.post(`/api/workspaces/${WS_A}/memory/v2/facts`, {
                content: 'Fact for workspace A',
            });

            const listB = await router.get(`/api/workspaces/${WS_B}/memory/v2/facts`);
            expect(listB.status).toBe(200);
            const facts = listB.json().facts as any[];
            expect(facts.some((f: any) => f.content === 'Fact for workspace A')).toBe(false);
        });

        it('WS_A and WS_B facts remain isolated', async () => {
            enableMemoryV2(dataDir, WS_A);
            enableMemoryV2(dataDir, WS_B);

            await router.post(`/api/workspaces/${WS_A}/memory/v2/facts`, { content: 'Fact A' });
            await router.post(`/api/workspaces/${WS_B}/memory/v2/facts`, { content: 'Fact B' });

            const listA = await router.get(`/api/workspaces/${WS_A}/memory/v2/facts`);
            expect(listA.json().facts).toHaveLength(1);
            expect(listA.json().facts[0].content).toBe('Fact A');

            const listB = await router.get(`/api/workspaces/${WS_B}/memory/v2/facts`);
            expect(listB.json().facts).toHaveLength(1);
            expect(listB.json().facts[0].content).toBe('Fact B');
        });

        it('wiping one workspace does not affect another', async () => {
            enableMemoryV2(dataDir, WS_A);
            enableMemoryV2(dataDir, WS_B);

            await router.post(`/api/workspaces/${WS_A}/memory/v2/facts`, { content: 'WS_A fact' });
            await router.post(`/api/workspaces/${WS_B}/memory/v2/facts`, { content: 'WS_B fact — must survive' });

            const wipeRes = await router.delete(`/api/workspaces/${WS_A}/memory/v2/wipe`, { confirm: true });
            expect(wipeRes.status).toBe(200);
            expect(wipeRes.json().scope).toBe('workspace');

            const listA = await router.get(`/api/workspaces/${WS_A}/memory/v2/facts`);
            expect(listA.json().facts).toHaveLength(0);

            const listB = await router.get(`/api/workspaces/${WS_B}/memory/v2/facts`);
            expect(listB.json().facts).toHaveLength(1);
            expect(listB.json().facts[0].content).toContain('WS_B fact');
        });
    });

    // ── Global scope via wsId="global" ────────────────────────────────────────

    describe('global scope (wsId="global")', () => {
        beforeEach(() => enableGlobalMemoryV2(dataDir));

        it('creates a fact in global scope', async () => {
            const res = await router.post(`/api/workspaces/global/memory/v2/facts`, {
                content: 'A globally shared fact',
            });
            expect(res.status).toBe(201);
            expect(res.json().fact.content).toBe('A globally shared fact');
        });

        it('global scope is separate from workspace scope', async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);

            await router.post(`/api/workspaces/global/memory/v2/facts`, { content: 'Global fact' });
            await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, { content: 'Workspace fact' });

            const globalList = await router.get(`/api/workspaces/global/memory/v2/facts`);
            expect(globalList.json().facts).toHaveLength(1);
            expect(globalList.json().facts[0].content).toBe('Global fact');

            const wsList = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(wsList.json().facts).toHaveLength(1);
            expect(wsList.json().facts[0].content).toBe('Workspace fact');
        });

        it('wipe global scope does not delete workspace facts', async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);

            await router.post(`/api/workspaces/global/memory/v2/facts`, { content: 'Global fact' });
            await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, { content: 'WS fact — must survive' });

            const wipeRes = await router.delete(`/api/workspaces/global/memory/v2/wipe`, { confirm: true });
            expect(wipeRes.status).toBe(200);
            expect(wipeRes.json().scope).toBe('global');

            const globalList = await router.get(`/api/workspaces/global/memory/v2/facts`);
            expect(globalList.json().facts).toHaveLength(0);

            const wsList = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(wsList.json().facts).toHaveLength(1);
            expect(wsList.json().facts[0].content).toContain('WS fact');
        });

        it('returns 404 for global scope when global memory is disabled', async () => {
            writePreferences(dataDir, { global: { memoryV2: { enabled: false } } });
            const res = await router.get(`/api/workspaces/global/memory/v2/facts`);
            expect(res.status).toBe(404);
        });

        it('export for global scope reports scope as global', async () => {
            await router.post(`/api/workspaces/global/memory/v2/facts`, { content: 'Global export fact' });
            const res = await router.get(`/api/workspaces/global/memory/v2/export`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.scope).toBe('global');
            expect(body.facts).toHaveLength(1);
        });
    });

    // ── Wipe scope isolation (global vs workspace) ────────────────────────────

    describe('wipe scope isolation', () => {
        const WS_ISOLATED = 'ws-wipe-isolated';
        const WS_ISOLATED_B = 'ws-wipe-isolated-b';

        it('wiping workspace scope does not delete global facts', async () => {
            enableGlobalMemoryV2(dataDir);
            enableMemoryV2(dataDir, WS_ISOLATED);

            await router.post(`/api/workspaces/global/memory/v2/facts`, { content: 'Global fact that must survive' });
            await router.post(`/api/workspaces/${WS_ISOLATED}/memory/v2/facts`, { content: 'Workspace fact about to be wiped' });

            const wipeRes = await router.delete(`/api/workspaces/${WS_ISOLATED}/memory/v2/wipe`, { confirm: true });
            expect(wipeRes.status).toBe(200);
            expect(wipeRes.json().scope).toBe('workspace');

            const isolatedList = await router.get(`/api/workspaces/${WS_ISOLATED}/memory/v2/facts`);
            expect(isolatedList.json().facts).toHaveLength(0);

            const globalList = await router.get(`/api/workspaces/global/memory/v2/facts`);
            expect(globalList.json().facts).toHaveLength(1);
            expect(globalList.json().facts[0].content).toContain('Global fact that must survive');
        });

        it('wiping global scope does not delete workspace facts', async () => {
            enableGlobalMemoryV2(dataDir);
            enableMemoryV2(dataDir, WS_ISOLATED);

            await router.post(`/api/workspaces/global/memory/v2/facts`, { content: 'Global fact about to be wiped' });
            await router.post(`/api/workspaces/${WS_ISOLATED}/memory/v2/facts`, { content: 'Workspace fact that must survive' });

            const wipeRes = await router.delete(`/api/workspaces/global/memory/v2/wipe`, { confirm: true });
            expect(wipeRes.status).toBe(200);
            expect(wipeRes.json().scope).toBe('global');

            const globalList = await router.get(`/api/workspaces/global/memory/v2/facts`);
            expect(globalList.json().facts).toHaveLength(0);

            const isolatedList = await router.get(`/api/workspaces/${WS_ISOLATED}/memory/v2/facts`);
            expect(isolatedList.json().facts).toHaveLength(1);
            expect(isolatedList.json().facts[0].content).toContain('Workspace fact that must survive');
        });

        it('wiping one workspace does not delete another workspace facts', async () => {
            enableMemoryV2(dataDir, WS_ISOLATED);
            enableMemoryV2(dataDir, WS_ISOLATED_B);

            await router.post(`/api/workspaces/${WS_ISOLATED}/memory/v2/facts`, { content: 'Workspace A fact' });
            await router.post(`/api/workspaces/${WS_ISOLATED_B}/memory/v2/facts`, { content: 'Workspace B fact - must survive' });

            const wipeRes = await router.delete(`/api/workspaces/${WS_ISOLATED}/memory/v2/wipe`, { confirm: true });
            expect(wipeRes.status).toBe(200);

            const listA = await router.get(`/api/workspaces/${WS_ISOLATED}/memory/v2/facts`);
            expect(listA.json().facts).toHaveLength(0);

            const listB = await router.get(`/api/workspaces/${WS_ISOLATED_B}/memory/v2/facts`);
            expect(listB.json().facts).toHaveLength(1);
            expect(listB.json().facts[0].content).toContain('Workspace B fact');
        });
    });

    // ── Export field completeness ─────────────────────────────────────────────

    describe('export field completeness', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getWorkspaceStoreDir(dataDir, WORKSPACE_ID);
            const handle = createMemoryStores(storeDir);
            try {
                await handle.facts.addFact({
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    content: 'The project uses TypeScript strict mode',
                    importance: 0.85,
                    confidence: 0.95,
                    status: 'active',
                    tags: ['typescript', 'config'],
                    source: 'explicit',
                    sourceProcessId: 'proc-export-test',
                });
                await handle.facts.addFact({
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    content: 'Low-confidence inferred fact',
                    importance: 0.3,
                    confidence: 0.4,
                    status: 'review',
                    tags: ['uncertain'],
                    source: 'auto-extracted',
                });
                await handle.episodes.addEpisode({
                    scope: 'workspace',
                    workspaceId: WORKSPACE_ID,
                    processId: 'proc-export-test',
                    summary: 'Discussed TypeScript config',
                    eventType: 'chat-turn',
                    provenance: { createdBy: 'ai', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('export includes all required fact fields', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`);
            expect(res.status).toBe(200);
            const body = res.json();

            expect(body.version).toBe(1);
            expect(body.exportedAt).toBeTruthy();
            expect(body.scope).toBe('workspace');
            expect(body.facts.length).toBeGreaterThanOrEqual(2);

            const activeFact = body.facts.find((f: any) => f.status === 'active');
            expect(activeFact).toBeDefined();
            expect(activeFact.id).toBeTruthy();
            expect(activeFact.content).toBe('The project uses TypeScript strict mode');
            expect(activeFact.status).toBe('active');
            expect(activeFact.tags).toContain('typescript');
            expect(activeFact.tags).toContain('config');
            expect(typeof activeFact.importance).toBe('number');
            expect(typeof activeFact.confidence).toBe('number');
            expect(activeFact.importance).toBe(0.85);
            expect(activeFact.confidence).toBe(0.95);
            expect(activeFact.source).toBe('explicit');
            expect(activeFact.sourceProcessId).toBe('proc-export-test');
            expect(activeFact.createdAt).toBeTruthy();
        });

        it('export includes review-status facts with correct fields', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`);
            const body = res.json();
            const reviewFact = body.facts.find((f: any) => f.status === 'review');
            expect(reviewFact).toBeDefined();
            expect(reviewFact.status).toBe('review');
            expect(reviewFact.tags).toContain('uncertain');
            expect(reviewFact.source).toBe('auto-extracted');
            expect(typeof reviewFact.importance).toBe('number');
            expect(typeof reviewFact.confidence).toBe('number');
        });

        it('export includes episodes with processId, summary, eventType, scope, and provenance', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`);
            const body = res.json();
            expect(body.episodes.length).toBeGreaterThan(0);
            const ep = body.episodes[0];
            expect(ep.id).toBeTruthy();
            expect(ep.processId).toBe('proc-export-test');
            expect(ep.summary).toBe('Discussed TypeScript config');
            expect(ep.eventType).toBe('chat-turn');
            expect(ep.scope).toBe('workspace');
            expect(ep.provenance).toBeDefined();
            expect(ep.provenance.createdBy).toBe('ai');
            expect(ep.createdAt).toBeTruthy();
        });
    });
});
