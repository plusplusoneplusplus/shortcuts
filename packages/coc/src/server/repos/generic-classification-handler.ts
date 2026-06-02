/**
 * Generic Diff Classification Routes
 *
 * A single generic endpoint that dispatches classification to the correct
 * handler based on `ClassificationKey.type`. Replaces the need for
 * type-specific classification routes on the client side.
 *
 * POST /api/repos/:repoId/classify-diff   — trigger classification
 * GET  /api/repos/:repoId/classify-diff    — get cached result / poll status
 *
 * The `type` field in the body (POST) or query (GET) determines how the
 * classification is keyed and dispatched:
 *   - 'pr':           delegates to PR classification (prId:headSha)
 *   - 'commit':       delegates to commit classification (hash)
 *   - 'branch-range': delegates to branch-range classification (baseRef..headRef)
 */

import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { sendJson, send404, send400, send500, readJsonBody } from '../router';
import { RepoTreeService } from './tree-service';
import {
    readClassification,
    readPending,
    writePending,
    clearPending,
} from './classification-store';
import { TaskDefs } from '../tasks/task-types';
import type { ChatProvider } from '../tasks/task-types';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS } from '../tasks/task-types';
import type { ReasoningEffort } from '../tasks/task-types';
import { buildClassificationPrompt } from './pr-classification-handler';
import { renderClassificationPrompt } from './classification-prompt';

// ============================================================================
// Types
// ============================================================================

type ClassificationType = 'pr' | 'commit' | 'branch-range';

interface ClassifyDiffPostBody {
    /** Classification type. */
    type: ClassificationType;
    /** Opaque identifier: `prId:headSha` for PRs, hash for commits, `base..head` for branch-range. */
    identifier: string;
    /** AI model to use (optional). */
    model?: string;
    /** Workspace ID for queue routing. */
    workspaceId?: string;
    /** AI provider to use for this classification run (optional; falls back to server default). */
    provider?: ChatProvider;
    /** Reasoning effort override for models that support it (optional). */
    reasoningEffort?: ReasoningEffort;
}

export interface GenericClassificationRouteOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
}

// ============================================================================
// Route registration
// ============================================================================

export function registerGenericClassificationRoutes(routes: Route[], opts: GenericClassificationRouteOptions): void {
    const { dataDir, store, bridge } = opts;
    const svc = opts.repoTreeService ?? new RepoTreeService(dataDir, undefined, store);

    // -- POST: Trigger classification -----------------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/classify-diff$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);

                let body: ClassifyDiffPostBody;
                try {
                    body = await readJsonBody<ClassifyDiffPostBody>(req);
                } catch {
                    return send400(res, 'Invalid JSON body');
                }

                if (!body.type || !['pr', 'commit', 'branch-range'].includes(body.type)) {
                    return send400(res, 'Missing or invalid field: type (must be pr, commit, or branch-range)');
                }
                if (!body.identifier || typeof body.identifier !== 'string') {
                    return send400(res, 'Missing required field: identifier');
                }

                const workspaceId = body.workspaceId || repoId;
                const { type, identifier } = body;

                // Check cache
                const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier);
                if (cached) {
                    return sendJson(res, {
                        status: 'ready',
                        processId: cached.processId,
                        result: cached.result,
                        createdAt: cached.createdAt,
                    });
                }

                // Check in-flight — self-heal stale pending markers
                const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier);
                if (pending) {
                    if (isTaskAlive(pending.processId, bridge)) {
                        return sendJson(res, {
                            status: 'running',
                            processId: pending.processId,
                        });
                    }
                    // Stale marker: task is gone or terminal — clear it and fall through to re-enqueue
                    clearPendingGeneric(dataDir, workspaceId, repoId, type, identifier);
                }

                // Resolve repo
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const prompt = buildPromptForType(type, identifier, repoId, dataDir);
                const rootPath = repo.localPath ?? process.cwd();
                bridge.getOrCreateBridge(rootPath);
                const resolvedRepoId = bridge.getRepoIdForPath(rootPath);
                const queueManager = bridge.registry.getQueueForRepo(rootPath);

                // Determine the task kind and skills based on type
                const displayName = buildDisplayName(type, identifier);

                const taskId = queueManager.enqueue({
                    type: TaskDefs.prClassification.kind,
                    priority: 'normal',
                    repoId: resolvedRepoId,
                    payload: {
                        kind: TaskDefs.prClassification.kind,
                        prompt,
                        workspaceId,
                        repoId,
                        classificationType: type,
                        classificationIdentifier: identifier,
                        ...extractPayloadFields(type, identifier),
                        workingDirectory: rootPath,
                        skills: ['classify-diff'],
                        ...(body.provider && VALID_CHAT_PROVIDERS.has(body.provider) ? { provider: body.provider } : {}),
                    },
                    config: {
                        ...(body.model ? { model: body.model } : {}),
                        ...(body.reasoningEffort && VALID_REASONING_EFFORTS.has(body.reasoningEffort) ? { reasoningEffort: body.reasoningEffort } : {}),
                    },
                    displayName,
                });

                // Write pending marker
                try {
                    writePendingGeneric(dataDir, workspaceId, repoId, type, identifier, String(taskId));
                } catch {
                    /* best-effort */
                }

                sendJson(res, { status: 'started', taskId }, 202);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET: Batch status (must be registered before the single-item GET) ------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/classify-diff\/batch-status$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const type = url.searchParams.get('type') as ClassificationType | null;
                const rawIdentifiers = url.searchParams.get('identifiers');
                const workspaceIdParam = url.searchParams.get('workspaceId');
                const workspaceId = workspaceIdParam || repoId;

                if (!type || !['pr', 'commit', 'branch-range'].includes(type)) {
                    return send400(res, 'Missing or invalid query parameter: type');
                }
                if (!rawIdentifiers) {
                    return sendJson(res, { statuses: {} });
                }

                const identifiers = rawIdentifiers
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);

                if (identifiers.length > 200) {
                    return send400(res, 'Too many identifiers: max 200 per request');
                }
                if (identifiers.length === 0) {
                    return sendJson(res, { statuses: {} });
                }

                const statuses: Record<string, 'none' | 'ready' | 'running'> = {};
                for (const identifier of identifiers) {
                    const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier);
                    if (cached) {
                        statuses[identifier] = 'ready';
                        continue;
                    }
                    const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier);
                    if (pending && isTaskAlive(pending.processId, bridge)) {
                        statuses[identifier] = 'running';
                    } else {
                        statuses[identifier] = 'none';
                    }
                }

                sendJson(res, { statuses });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET: Poll / get cached result ----------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/classify-diff$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const type = url.searchParams.get('type') as ClassificationType | null;
                const identifier = url.searchParams.get('identifier');
                const workspaceIdParam = url.searchParams.get('workspaceId');
                const workspaceId = workspaceIdParam || repoId;

                if (!type || !['pr', 'commit', 'branch-range'].includes(type)) {
                    return send400(res, 'Missing or invalid query parameter: type');
                }
                if (!identifier) {
                    return send400(res, 'Missing required query parameter: identifier');
                }

                const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier);
                if (cached) {
                    return sendJson(res, {
                        status: 'ready',
                        processId: cached.processId,
                        result: cached.result,
                        createdAt: cached.createdAt,
                    });
                }

                const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier);
                if (pending) {
                    if (isTaskAlive(pending.processId, bridge)) {
                        return sendJson(res, {
                            status: 'running',
                            processId: pending.processId,
                        });
                    }
                    // Stale marker: task is gone or terminal — clear it and report idle
                    clearPendingGeneric(dataDir, workspaceId, repoId, type, identifier);
                }

                sendJson(res, { status: 'none' });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}

// ============================================================================
// Helpers — delegation to classification-store generic paths
// ============================================================================

function readClassificationGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
) {
    // Map generic key to the PR-style key the store expects.
    // For PRs: identifier = "prId:headSha"
    // For generic: we use (repoId, type_identifier_prefix, identifier_suffix) 
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    return readClassification(dataDir, workspaceId, repoId, prId, headSha);
}

function readPendingGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
) {
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    return readPending(dataDir, workspaceId, repoId, prId, headSha);
}

function writePendingGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
    processId: string,
) {
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    writePending(dataDir, workspaceId, repoId, prId, headSha, processId);
}

function clearPendingGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
) {
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    clearPending(dataDir, workspaceId, repoId, prId, headSha);
}

/**
 * Check whether the task associated with a pending marker is still alive in
 * any queue across all repos. Returns `true` (alive) when the task is found
 * with status `queued` or `running`. Returns `false` (stale) when the task is
 * missing or in a terminal state (`completed`, `failed`, `cancelled`).
 *
 * Fail-safe: any exception from the queue lookup returns `true` so we never
 * delete a marker we cannot positively prove is stale.
 */
function isTaskAlive(processId: string, bridge: MultiRepoQueueRouter): boolean {
    try {
        const task = bridge.getTask(processId);
        if (!task) return false;
        return task.status === 'queued' || task.status === 'running';
    } catch {
        return true;
    }
}

/**
 * Map generic classification key to the (prId, headSha) pair the store uses.
 * For non-PR types, we repurpose the fields as a generic two-part key.
 */
function splitIdentifier(type: ClassificationType, identifier: string, _repoId: string): { prId: string; headSha: string } {
    if (type === 'pr') {
        // identifier = "prId:headSha"
        const colonIdx = identifier.indexOf(':');
        if (colonIdx === -1) return { prId: identifier, headSha: 'unknown' };
        return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
    }
    // For commit and branch-range, use type as prId-equivalent and identifier as headSha-equivalent
    return { prId: `_${type}`, headSha: identifier };
}

function buildPromptForType(type: ClassificationType, identifier: string, repoId: string, dataDir?: string): string {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        const prId = colonIdx !== -1 ? identifier.slice(0, colonIdx) : identifier;
        return buildClassificationPrompt(repoId, prId, dataDir);
    }
    return renderClassificationPrompt(type, identifier, repoId, dataDir);
}

function buildDisplayName(type: ClassificationType, identifier: string): string {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        const prId = colonIdx !== -1 ? identifier.slice(0, colonIdx) : identifier;
        const sha = colonIdx !== -1 ? identifier.slice(colonIdx + 1, colonIdx + 8) : '';
        return `Classify PR #${prId}${sha ? ` [${sha}]` : ''}`;
    }
    if (type === 'commit') {
        return `Classify commit ${identifier.slice(0, 7)}`;
    }
    return `Classify branch range ${identifier}`;
}

/**
 * Extract extra payload fields for backward compat with ClassificationExecutor.
 *
 * For non-PR types, `prId` and `headSha` are included using the same two-part
 * key scheme as `splitIdentifier` so that `ClassificationExecutor` can resolve
 * the classification context and inject the `saveClassification` tool.
 * Without these fields the tool guard in the executor is skipped and results
 * are never persisted.
 */
function extractPayloadFields(type: ClassificationType, identifier: string): Record<string, string> {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        if (colonIdx !== -1) {
            return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
        }
        return { prId: identifier, headSha: 'unknown' };
    }
    if (type === 'commit') {
        // prId/_headSha mirror splitIdentifier so the executor resolves the same store key.
        return { commitHash: identifier, prId: '_commit', headSha: identifier };
    }
    // branch-range
    return { branchRange: identifier, prId: '_branch-range', headSha: identifier };
}
