/**
 * Work Item Plan REST API Routes
 *
 * Plan versioning and AI-assisted refinement for work items.
 *
 * Routes:
 *   GET  /api/workspaces/:id/work-items/:wid/plan             — Get current plan
 *   PUT  /api/workspaces/:id/work-items/:wid/plan             — Update plan (auto-versions)
 *   GET  /api/workspaces/:id/work-items/:wid/plan/versions    — List plan versions
 *   GET  /api/workspaces/:id/work-items/:wid/plan/versions/:v — Get specific version
 *   POST /api/workspaces/:id/work-items/:wid/plan/refine      — AI-assisted refinement
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { Route } from '../types';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, notFound, badRequest, forbidden } from '../errors';
import type {
    WorkItem,
    WorkItemStore,
    WorkItemContentVersionSource,
    WorkItemPlanVersion,
    WorkItemPlanVersionDiffChunk,
    WorkItemChange,
} from '../work-items/types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { clearWorkItemResponseCacheForWorkspace } from '../work-items/work-item-response-cache';

export interface WorkItemPlanRouteContext {
    routes: Route[];
    workItemStore: WorkItemStore;
    getWsServer?: () => ProcessWebSocketServer;
    /** Returns true when the durable Work Items/Goals workflow flag is enabled. */
    getWorkflowEnabled?: () => boolean;
    /** Optional AI invoker for plan refinement. If not provided, refinement is unavailable. */
    refineWithAI?: (currentPlan: string, description: string, title: string, instructions?: string) => Promise<string>;
}

const WORKFLOW_VERSION_TYPES = new Set(['work-item', 'goal']);

function isLocalOnlyWorkItemOrGoal(item: WorkItem): boolean {
    const effectiveType = item.type ?? 'work-item';
    if (!WORKFLOW_VERSION_TYPES.has(effectiveType)) return false;
    if (item.tracker && item.tracker.kind !== 'local-only') return false;
    return !item.githubMirror && !item.azureBoardsMirror;
}

function parseVersionSource(value: unknown, fallback: WorkItemContentVersionSource): WorkItemContentVersionSource {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function compareLines(baseContent: string, targetContent: string): WorkItemPlanVersionDiffChunk[] {
    const base = baseContent.split('\n');
    const target = targetContent.split('\n');
    const table = Array.from({ length: base.length + 1 }, () => Array<number>(target.length + 1).fill(0));
    for (let i = base.length - 1; i >= 0; i--) {
        for (let j = target.length - 1; j >= 0; j--) {
            table[i][j] = base[i] === target[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    const entries: Array<{ type: WorkItemPlanVersionDiffChunk['type']; line: string }> = [];
    let i = 0;
    let j = 0;
    while (i < base.length && j < target.length) {
        if (base[i] === target[j]) {
            entries.push({ type: 'equal', line: base[i++] });
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            entries.push({ type: 'removed', line: base[i++] });
        } else {
            entries.push({ type: 'added', line: target[j++] });
        }
    }
    while (i < base.length) entries.push({ type: 'removed', line: base[i++] });
    while (j < target.length) entries.push({ type: 'added', line: target[j++] });

    const chunks: WorkItemPlanVersionDiffChunk[] = [];
    for (const entry of entries) {
        const last = chunks[chunks.length - 1];
        if (last?.type === entry.type) {
            last.lines.push(entry.line);
        } else {
            chunks.push({ type: entry.type, lines: [entry.line] });
        }
    }
    return chunks;
}

function parsePositiveVersion(value: string | null, field: string): number {
    const version = value ? Number(value) : NaN;
    if (!Number.isInteger(version) || version <= 0) {
        throw badRequest(`${field} must be a positive integer version`);
    }
    return version;
}

export function registerWorkItemPlanRoutes(ctx: WorkItemPlanRouteContext): void {
    const { routes, workItemStore, getWsServer, refineWithAI } = ctx;
    const isWorkflowEnabled = () => ctx.getWorkflowEnabled?.() ?? false;

    // Regex for plan routes: /api/workspaces/:repoId/work-items/:workItemId/plan
    const planBase = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan$/;
    const planVersions = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/versions$/;
    const planVersionCompare = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/versions\/compare$/;
    const planVersionById = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/versions\/(\d+)$/;
    const planVersionRestore = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/versions\/(\d+)\/restore$/;
    const planRefine = /^\/api\/workspaces\/([^/]+)\/work-items\/([^/]+)\/plan\/refine$/;

    // GET /api/workspaces/:id/work-items/:wid/plan — Get current plan
    routes.push({
        method: 'GET',
        pattern: planBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (!item.plan) {
                sendJSON(res, 200, { plan: null, versions: 0 });
                return;
            }

            const versions = await workItemStore.getPlanVersions(workItemId);
            sendJSON(res, 200, {
                plan: item.plan,
                versions: versions.length,
            });
        },
    });

    // PUT /api/workspaces/:id/work-items/:wid/plan — Update plan (auto-version)
    routes.push({
        method: 'PUT',
        pattern: planBase,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, badRequest('Invalid JSON body'));
            }

            if (typeof body.content !== 'string' || !body.content.trim()) {
                return handleAPIError(res, badRequest('Missing required field: content'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            const now = new Date().toISOString();
            const newVersion = (item.plan?.version ?? 0) + 1;

            const planVersion: WorkItemPlanVersion = {
                version: newVersion,
                content: body.content,
                createdAt: now,
                resolvedBy: body.resolvedBy || 'user',
                source: parseVersionSource(body.source, body.resolvedBy === 'ai' ? 'ai' : 'user'),
                authorType: parseVersionSource(body.authorType, body.resolvedBy === 'ai' ? 'ai' : 'user'),
                reason: typeof body.reason === 'string' ? body.reason : undefined,
                summary: body.summary,
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                currentContentVersion: newVersion,
                plan: {
                    version: newVersion,
                    currentVersion: newVersion,
                    content: body.content,
                    updatedAt: now,
                    resolvedBy: body.resolvedBy || 'user',
                    source: planVersion.source,
                    reason: planVersion.reason,
                },
            });
            if (updated) {
                clearWorkItemResponseCacheForWorkspace(repoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            }

            // Open a new Change entry linked to this plan version (fire-and-forget)
            const change: WorkItemChange = {
                id: crypto.randomUUID(),
                planVersion: newVersion,
                commits: [],
                startedAt: now,
                status: 'open',
            };
            workItemStore.addChange(workItemId, change).catch(() => { /* non-fatal */ });

            sendJSON(res, 200, { plan: planVersion, version: newVersion });
        },
    });

    // GET /api/workspaces/:id/work-items/:wid/plan/versions — List plan versions
    routes.push({
        method: 'GET',
        pattern: planVersions,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            const versions = await workItemStore.getPlanVersions(workItemId);
            sendJSON(res, 200, versions);
        },
    });

    // GET /api/workspaces/:id/work-items/:wid/plan/versions/compare?base=1&target=2 — Compare two immutable versions
    routes.push({
        method: 'GET',
        pattern: planVersionCompare,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            if (!isWorkflowEnabled()) {
                return handleAPIError(res, forbidden('workItems.workflow feature flag is not enabled'));
            }

            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            if (!isLocalOnlyWorkItemOrGoal(item)) {
                return handleAPIError(res, badRequest('Version compare is only available for local-only work-item and goal items'));
            }

            let baseVersion: number;
            let targetVersion: number;
            try {
                const parsed = new URL(req.url || '/', 'http://localhost');
                baseVersion = parsePositiveVersion(parsed.searchParams.get('base'), 'base');
                targetVersion = parsePositiveVersion(parsed.searchParams.get('target'), 'target');
            } catch (err) {
                return handleAPIError(res, err);
            }

            const base = await workItemStore.getPlanVersion(workItemId, baseVersion);
            if (!base) {
                return handleAPIError(res, notFound(`Plan version ${baseVersion}`));
            }
            const target = await workItemStore.getPlanVersion(workItemId, targetVersion);
            if (!target) {
                return handleAPIError(res, notFound(`Plan version ${targetVersion}`));
            }

            sendJSON(res, 200, {
                base,
                target,
                diff: compareLines(base.content, target.content),
            });
        },
    });

    // GET /api/workspaces/:id/work-items/:wid/plan/versions/:v — Get specific version
    routes.push({
        method: 'GET',
        pattern: planVersionById,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);
            const version = parseInt(match![3], 10);

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            const planVersion = await workItemStore.getPlanVersion(workItemId, version);
            if (!planVersion) {
                return handleAPIError(res, notFound(`Plan version ${version}`));
            }

            sendJSON(res, 200, planVersion);
        },
    });

    // POST /api/workspaces/:id/work-items/:wid/plan/versions/:v/restore — Restore by creating a new current version
    routes.push({
        method: 'POST',
        pattern: planVersionRestore,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            if (!isWorkflowEnabled()) {
                return handleAPIError(res, forbidden('workItems.workflow feature flag is not enabled'));
            }

            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);
            const restoreVersion = parseInt(match![3], 10);

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }
            if (!isLocalOnlyWorkItemOrGoal(item)) {
                return handleAPIError(res, badRequest('Version restore is only available for local-only work-item and goal items'));
            }

            const restored = await workItemStore.getPlanVersion(workItemId, restoreVersion);
            if (!restored) {
                return handleAPIError(res, notFound(`Plan version ${restoreVersion}`));
            }

            const versions = await workItemStore.getPlanVersions(workItemId);
            const latestVersion = Math.max(item.plan?.version ?? 0, ...versions.map(version => version.version));
            const now = new Date().toISOString();
            const newVersion = latestVersion + 1;
            const reason = typeof body.reason === 'string' && body.reason.trim()
                ? body.reason.trim()
                : `Restored version ${restoreVersion}`;
            const summary = typeof body.summary === 'string' && body.summary.trim()
                ? body.summary.trim()
                : reason;
            const planVersion: WorkItemPlanVersion = {
                version: newVersion,
                content: restored.content,
                createdAt: now,
                resolvedBy: 'user',
                source: 'user',
                authorType: 'user',
                reason,
                restoredFromVersion: restoreVersion,
                summary,
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                currentContentVersion: newVersion,
                plan: {
                    version: newVersion,
                    currentVersion: newVersion,
                    content: restored.content,
                    updatedAt: now,
                    resolvedBy: 'user',
                    source: 'user',
                    reason,
                    restoredFromVersion: restoreVersion,
                },
            });
            if (!updated) {
                return handleAPIError(res, notFound('Work item'));
            }

            const change: WorkItemChange = {
                id: crypto.randomUUID(),
                planVersion: newVersion,
                commits: [],
                startedAt: now,
                status: 'open',
            };
            workItemStore.addChange(workItemId, change).catch(() => { /* non-fatal */ });

            clearWorkItemResponseCacheForWorkspace(repoId);
            getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            sendJSON(res, 200, { plan: planVersion, version: newVersion, restoredFromVersion: restoreVersion });
        },
    });

    // POST /api/workspaces/:id/work-items/:wid/plan/refine — AI-assisted refinement
    routes.push({
        method: 'POST',
        pattern: planRefine,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            const repoId = decodeURIComponent(match![1]);
            const workItemId = decodeURIComponent(match![2]);

            if (!refineWithAI) {
                return handleAPIError(res, badRequest('AI refinement is not available'));
            }

            const item = await workItemStore.getWorkItem(workItemId, repoId);
            if (!item) {
                return handleAPIError(res, notFound('Work item'));
            }

            if (!item.plan?.content) {
                return handleAPIError(res, badRequest('Work item has no plan to refine'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                body = {};
            }

            const refinedContent = await refineWithAI(
                item.plan.content,
                item.description,
                item.title,
                body.instructions || undefined,
            );

            const now = new Date().toISOString();
            const newVersion = item.plan.version + 1;

            const planVersion: WorkItemPlanVersion = {
                version: newVersion,
                content: refinedContent,
                createdAt: now,
                resolvedBy: 'ai',
                source: 'ai',
                authorType: 'ai',
                reason: body.instructions || 'AI-refined plan',
                summary: body.summary || (body.instructions ? `AI resolved: ${String(body.instructions).slice(0, 80)}` : 'AI-refined plan'),
            };

            await workItemStore.savePlanVersion(workItemId, planVersion);
            const updated = await workItemStore.updateWorkItem(workItemId, {
                currentContentVersion: newVersion,
                plan: {
                    version: newVersion,
                    currentVersion: newVersion,
                    content: refinedContent,
                    updatedAt: now,
                    resolvedBy: 'ai',
                    source: 'ai',
                    reason: planVersion.reason,
                },
            });
            if (updated) {
                clearWorkItemResponseCacheForWorkspace(repoId);
                getWsServer?.()?.broadcastProcessEvent({ type: 'work-item-updated', workspaceId: repoId, item: updated });
            }

            // Open a new Change for the refined plan version (fire-and-forget)
            const refineChange: WorkItemChange = {
                id: crypto.randomUUID(),
                planVersion: newVersion,
                commits: [],
                startedAt: now,
                status: 'open',
            };
            workItemStore.addChange(workItemId, refineChange).catch(() => { /* non-fatal */ });

            sendJSON(res, 200, {
                plan: planVersion,
                version: newVersion,
                previousVersion: item.plan.version,
            });
        },
    });
}
