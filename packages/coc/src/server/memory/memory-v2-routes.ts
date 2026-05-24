/**
 * Memory V2 Routes (AC-06 server side)
 *
 * Registers workspace-scoped REST endpoints for the redesigned coc-memory v2:
 *
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
 * All routes are gated by prefs.memoryV2.enabled. Returns 404 when disabled.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

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
import type { Route } from '../types';
import { sendJson, readJsonBody, send400, send404, send500 } from '../router';
import { readRepoPreferences } from '../preferences-handler';

// ============================================================================
// Constants & types
// ============================================================================

const FEATURE_DISABLED_MSG = 'Memory v2 is not enabled for this workspace';

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
 * Returns null if the feature is disabled for this workspace.
 */
function resolveScope(
    dataDir: string,
    wsId: string,
): ScopeInfo | null {
    const prefs = readRepoPreferences(dataDir, wsId);
    if (!prefs.memoryV2?.enabled) return null;

    const isolated = prefs.memoryV2.isolated === true;
    if (isolated) {
        return {
            scope: 'workspace',
            storeDir: path.join(dataDir, 'repos', wsId, WORKSPACE_MEMORY_SUBDIR),
            workspaceId: wsId,
        };
    }
    return {
        scope: 'global',
        storeDir: path.join(dataDir, GLOBAL_MEMORY_SUBDIR),
        workspaceId: undefined,
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

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all memory v2 workspace-scoped routes.
 * Mutates `routes` in place.
 */
export function registerMemoryV2Routes(routes: Route[], dataDir: string): void {

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
