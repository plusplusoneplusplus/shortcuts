/**
 * Memory V2 Routes (AC-01 / AC-02 server side)
 *
 * Registers workspace-scoped and global REST endpoints for coc-memory v2:
 *
 *   GET    /api/memory/v2/scopes                              — list all memory scopes
 *   GET    /api/workspaces/:wsId/memory/v2/facts            — list/search facts
 *   POST   /api/workspaces/:wsId/memory/v2/facts            — create explicit fact
 *   PATCH  /api/workspaces/:wsId/memory/v2/facts/:id        — update fact
 *   DELETE /api/workspaces/:wsId/memory/v2/facts/:id        — delete fact
 *   GET    /api/workspaces/:wsId/memory/v2/review           — list review queue
 *   POST   /api/workspaces/:wsId/memory/v2/review/:id/approve — approve review fact
 *   POST   /api/workspaces/:wsId/memory/v2/review/:id/reject  — reject review fact
 *   GET    /api/workspaces/:wsId/memory/v2/episodes         — list episodes
 *   GET    /api/workspaces/:wsId/memory/v2/export           — export all
 *   DELETE /api/workspaces/:wsId/memory/v2/wipe             — wipe scope
 *
 * The special wsId "global" addresses the global memory scope directly (using
 * global preferences rather than per-workspace preferences).
 *
 * All workspace-scoped routes are gated by prefs.memoryV2.enabled. Returns 404 when
 * disabled. The "global" wsId is gated by global preferences.memoryV2.enabled.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import {
    createMemoryStores,
    MemoryCaptureService,
    scanMemoryContent,
    GLOBAL_MEMORY_SUBDIR,
    WORKSPACE_MEMORY_SUBDIR,
    type MemoryScope,
    type CloseableMemoryStoreHandle,
} from '@plusplusoneplusplus/coc-memory';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send404, send500 } from '../router';
import { readRepoPreferences, readGlobalPreferences } from '../preferences-handler';

// ============================================================================
// Constants & types
// ============================================================================

const FEATURE_DISABLED_MSG = 'Memory v2 is not enabled for this workspace';

/** The reserved wsId that addresses the global memory scope. */
export const GLOBAL_SCOPE_WS_ID = 'global';

// ============================================================================
// Helpers
// ============================================================================

interface ScopeInfo {
    scope: MemoryScope;
    storeDir: string;
    workspaceId: string | undefined;
}

/**
 * Read memoryV2 prefs and resolve scope + storeDir.
 *
 * When wsId === GLOBAL_SCOPE_WS_ID, reads global preferences.
 * Otherwise reads per-workspace preferences and always uses the workspace-isolated store.
 *
 * Returns null if the feature is disabled for this scope.
 */
function resolveScope(
    dataDir: string,
    wsId: string,
): ScopeInfo | null {
    if (wsId === GLOBAL_SCOPE_WS_ID) {
        const globalPrefs = readGlobalPreferences(dataDir);
        if (!globalPrefs.memoryV2?.enabled) return null;
        return {
            scope: 'global',
            storeDir: path.join(dataDir, GLOBAL_MEMORY_SUBDIR),
            workspaceId: undefined,
        };
    }

    const prefs = readRepoPreferences(dataDir, wsId);
    if (!prefs.memoryV2?.enabled) return null;

    return {
        scope: 'workspace',
        storeDir: path.join(dataDir, 'repos', wsId, WORKSPACE_MEMORY_SUBDIR),
        workspaceId: wsId,
    };
}

/** Open stores, run fn, close stores in finally. */
async function withStores<T>(
    storeDir: string,
    fn: (handle: CloseableMemoryStoreHandle) => Promise<T>,
): Promise<T> {
    const handle = createMemoryStores(storeDir);
    try {
        return await fn(handle);
    } finally {
        try { handle.close(); } catch { /* already closed */ }
    }
}

/** Get fact/episode counts for a scope; returns zeros when store does not exist or is disabled. */
async function getScopeCounts(
    storeDir: string,
    scope: MemoryScope,
    workspaceId: string | undefined,
    enabled: boolean,
): Promise<{ activeFacts: number; reviewFacts: number; episodes: number }> {
    if (!enabled) return { activeFacts: 0, reviewFacts: 0, episodes: 0 };
    try {
        if (!fs.existsSync(storeDir)) {
            return { activeFacts: 0, reviewFacts: 0, episodes: 0 };
        }
        return await withStores(storeDir, async (handle) => {
            const [active, review, eps] = await Promise.all([
                handle.facts.listFacts({ statuses: ['active'], scope, workspaceId, limit: 1000 })
                    .then(f => f.length),
                handle.facts.listFacts({ statuses: ['review'], scope, workspaceId, limit: 1000 })
                    .then(f => f.length),
                handle.episodes.listEpisodes({ scope, workspaceId, limit: 1000 })
                    .then(e => e.length),
            ]);
            return { activeFacts: active, reviewFacts: review, episodes: eps };
        });
    } catch {
        return { activeFacts: 0, reviewFacts: 0, episodes: 0 };
    }
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all memory v2 routes (global scopes + workspace-scoped).
 * Mutates `routes` in place.
 *
 * @param routes  Route table to add to.
 * @param dataDir CoC data root.
 * @param store   Optional process store; used by the scopes endpoint to include workspace labels.
 */
export function registerMemoryV2Routes(routes: Route[], dataDir: string, store?: ProcessStore): void {

    // ── GET /api/memory/v2/scopes ─────────────────────────────────────────────
    routes.push({
        method: 'GET',
        pattern: '/api/memory/v2/scopes',
        handler: async (_req, res) => {
            try {
                const scopes: Array<{
                    id: string;
                    type: 'global' | 'workspace';
                    label: string;
                    enabled: boolean;
                    workspaceId?: string;
                    counts: { activeFacts: number; reviewFacts: number; episodes: number };
                }> = [];

                // Global scope
                const globalPrefs = readGlobalPreferences(dataDir);
                const globalEnabled = globalPrefs.memoryV2?.enabled === true;
                const globalStoreDir = path.join(dataDir, GLOBAL_MEMORY_SUBDIR);
                const globalCounts = await getScopeCounts(globalStoreDir, 'global', undefined, globalEnabled);
                scopes.push({
                    id: GLOBAL_SCOPE_WS_ID,
                    type: 'global',
                    label: 'Global',
                    enabled: globalEnabled,
                    counts: globalCounts,
                });

                // Workspace scopes (requires store for labels)
                if (store) {
                    const workspaces = await store.getWorkspaces();
                    for (const ws of workspaces) {
                        const prefs = readRepoPreferences(dataDir, ws.id);
                        const wsEnabled = prefs.memoryV2?.enabled === true;
                        const wsStoreDir = path.join(dataDir, 'repos', ws.id, WORKSPACE_MEMORY_SUBDIR);
                        const wsCounts = await getScopeCounts(wsStoreDir, 'workspace', ws.id, wsEnabled);
                        scopes.push({
                            id: `workspace:${ws.id}`,
                            type: 'workspace',
                            label: ws.name,
                            enabled: wsEnabled,
                            workspaceId: ws.id,
                            counts: wsCounts,
                        });
                    }
                }

                sendJson(res, { scopes });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── GET /api/workspaces/:wsId/memory/v2/facts ─────────────────────────────
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/facts$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            const parsedUrl = url.parse(req.url ?? '', true);
            const q = typeof parsedUrl.query.q === 'string' ? parsedUrl.query.q : undefined;
            const rawStatus = parsedUrl.query.status;
            const statuses = Array.isArray(rawStatus)
                ? (rawStatus as string[])
                : typeof rawStatus === 'string' ? [rawStatus] : undefined;
            const limit = typeof parsedUrl.query.limit === 'string'
                ? Math.min(200, parseInt(parsedUrl.query.limit, 10) || 50)
                : 50;

            try {
                const result = await withStores(scopeInfo.storeDir, async (handle) => {
                    if (q?.trim()) {
                        const searchResults = await handle.facts.searchFacts({
                            text: q,
                            limit,
                            statuses: statuses as any,
                            scope: scopeInfo.scope,
                            workspaceId: scopeInfo.workspaceId,
                        });
                        return searchResults.map(r => r.fact);
                    }
                    return handle.facts.listFacts({
                        statuses: statuses as any,
                        scope: scopeInfo.scope,
                        workspaceId: scopeInfo.workspaceId,
                        limit,
                    });
                });
                sendJson(res, { facts: result });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── POST /api/workspaces/:wsId/memory/v2/facts ────────────────────────────
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/facts$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            let body: any;
            try { body = await readJsonBody(req); } catch { send400(res, 'Invalid JSON body'); return; }

            if (typeof body.content !== 'string' || !body.content.trim()) {
                send400(res, 'content is required');
                return;
            }

            try {
                const fact = await withStores(scopeInfo.storeDir, async (handle) => {
                    const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                    return svc.captureExplicit({
                        content: body.content,
                        scope: scopeInfo.scope,
                        workspaceId: scopeInfo.workspaceId,
                        importance: typeof body.importance === 'number' ? body.importance : 0.5,
                        tags: Array.isArray(body.tags) ? body.tags : [],
                        provenance: { createdBy: 'user', version: 1, extractedFrom: 'dashboard' },
                        sourceProcessId: body.sourceProcessId,
                    });
                });

                if (!fact) {
                    sendJson(res, { error: 'Content blocked by safety scanner', blocked: true }, 422);
                    return;
                }
                sendJson(res, { fact }, 201);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── PATCH /api/workspaces/:wsId/memory/v2/facts/:id ───────────────────────
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/facts\/([^/]+)$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const factId = decodeURIComponent(match![2]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            let body: any;
            try { body = await readJsonBody(req); } catch { send400(res, 'Invalid JSON body'); return; }

            // Allowed update fields
            const updates: Record<string, unknown> = {};
            if (typeof body.content === 'string') {
                const scan = scanMemoryContent(body.content);
                if (scan.blocked) {
                    sendJson(res, { error: 'Content blocked by safety scanner', reason: scan.reason }, 422);
                    return;
                }
                updates.content = body.content;
            }
            if (typeof body.importance === 'number') updates.importance = Math.max(0, Math.min(1, body.importance));
            if (Array.isArray(body.tags)) updates.tags = body.tags;
            if (typeof body.status === 'string') {
                const allowed = ['active', 'archived', 'rejected'];
                if (!allowed.includes(body.status)) {
                    send400(res, `status must be one of: ${allowed.join(', ')}`);
                    return;
                }
                updates.status = body.status;
            }

            try {
                const updated = await withStores(scopeInfo.storeDir, (handle) =>
                    handle.facts.updateFact(factId, updates as any)
                );
                if (!updated) { send404(res, `Fact not found: ${factId}`); return; }
                sendJson(res, { fact: updated });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── DELETE /api/workspaces/:wsId/memory/v2/facts/:id ──────────────────────
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/facts\/([^/]+)$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const factId = decodeURIComponent(match![2]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            try {
                const deleted = await withStores(scopeInfo.storeDir, (handle) =>
                    handle.facts.deleteFact(factId)
                );
                if (!deleted) { send404(res, `Fact not found: ${factId}`); return; }
                sendJson(res, { deleted: true });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── GET /api/workspaces/:wsId/memory/v2/review ────────────────────────────
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/review$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            try {
                const facts = await withStores(scopeInfo.storeDir, (handle) =>
                    handle.facts.listFacts({
                        statuses: ['review'],
                        scope: scopeInfo.scope,
                        workspaceId: scopeInfo.workspaceId,
                    })
                );
                sendJson(res, { facts });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── POST /api/workspaces/:wsId/memory/v2/review/:id/approve ──────────────
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/review\/([^/]+)\/approve$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const factId = decodeURIComponent(match![2]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            // Optional: body may contain { content } for edit-and-approve
            let body: any = {};
            try { body = await readJsonBody(req); } catch { /* no body is fine */ }

            try {
                const updated = await withStores(scopeInfo.storeDir, async (handle) => {
                    const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                    if (typeof body.content === 'string') {
                        return svc.editAndApproveReviewFact(factId, body.content);
                    }
                    return svc.approveReviewFact(factId);
                });
                if (!updated) { send404(res, `Review fact not found: ${factId}`); return; }
                sendJson(res, { fact: updated });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── POST /api/workspaces/:wsId/memory/v2/review/:id/reject ───────────────
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/review\/([^/]+)\/reject$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const factId = decodeURIComponent(match![2]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            try {
                const updated = await withStores(scopeInfo.storeDir, async (handle) => {
                    const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                    return svc.rejectReviewFact(factId);
                });
                if (!updated) { send404(res, `Review fact not found: ${factId}`); return; }
                sendJson(res, { fact: updated });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── GET /api/workspaces/:wsId/memory/v2/episodes ─────────────────────────
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/episodes$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            const parsedUrl = url.parse(req.url ?? '', true);
            const limit = typeof parsedUrl.query.limit === 'string'
                ? Math.min(200, parseInt(parsedUrl.query.limit, 10) || 50)
                : 50;

            try {
                const episodes = await withStores(scopeInfo.storeDir, (handle) =>
                    handle.episodes.listEpisodes({
                        scope: scopeInfo.scope,
                        workspaceId: scopeInfo.workspaceId,
                        limit,
                    })
                );
                sendJson(res, { episodes });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── GET /api/workspaces/:wsId/memory/v2/export ───────────────────────────
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/export$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            try {
                const [facts, episodes] = await withStores(scopeInfo.storeDir, async (handle) =>
                    Promise.all([
                        handle.facts.exportFacts(scopeInfo.scope, scopeInfo.workspaceId),
                        handle.episodes.exportEpisodes(scopeInfo.scope, scopeInfo.workspaceId),
                    ])
                );
                sendJson(res, {
                    version: 1,
                    exportedAt: new Date().toISOString(),
                    scope: scopeInfo.scope,
                    workspaceId: scopeInfo.workspaceId,
                    facts,
                    episodes,
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // ── DELETE /api/workspaces/:wsId/memory/v2/wipe ──────────────────────────
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/memory\/v2\/wipe$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const scopeInfo = resolveScope(dataDir, wsId);
            if (!scopeInfo) { send404(res, FEATURE_DISABLED_MSG); return; }

            // Require explicit confirmation in body
            let body: any = {};
            try { body = await readJsonBody(req); } catch { /* no body */ }
            if (body.confirm !== true) {
                send400(res, 'Wipe requires { confirm: true } in the request body');
                return;
            }

            try {
                await withStores(scopeInfo.storeDir, async (handle) => {
                    await handle.facts.wipe(scopeInfo.scope, scopeInfo.workspaceId);
                    await handle.episodes.wipe(scopeInfo.scope, scopeInfo.workspaceId);
                });
                sendJson(res, { wiped: true, scope: scopeInfo.scope });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}
