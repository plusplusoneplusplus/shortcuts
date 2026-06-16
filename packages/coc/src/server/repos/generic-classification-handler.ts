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
import type { CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
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
import {
    resolvePullRequestOriginStorageScope,
    resolvePullRequestStorageId,
    resolvePullRequestStorageScope,
    type PullRequestStorageScope,
    type PullRequestStorageScopeInput,
} from './pr-origin-scope';
import type { RepoInfo } from './types';

const VALID_EFFORT_TIERS = new Set(['very-low', 'low', 'medium', 'high']);

// ============================================================================
// Types
// ============================================================================

export type ClassificationType = 'pr' | 'commit' | 'branch-range';

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
    /** Effort tier to expand after provider resolution (optional). */
    effortTier?: 'very-low' | 'low' | 'medium' | 'high';
    /** Explicit request to route the provider through Auto at enqueue time. */
    autoProviderRouting?: boolean;
}

export interface GenericClassificationRouteOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>;
}

export interface EnqueueGenericClassificationOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>;
    repoId: string;
    workspaceId?: string;
    type: ClassificationType;
    identifier: string;
    priority?: CreateTaskInput['priority'];
    model?: string;
    provider?: ChatProvider;
    reasoningEffort?: ReasoningEffort;
    effortTier?: 'very-low' | 'low' | 'medium' | 'high';
    autoProviderRouting?: boolean;
    storageScope?: PullRequestStorageScopeInput;
}

export type EnqueueGenericClassificationResult =
    | {
        status: 'ready';
        processId?: string;
        result: unknown;
        createdAt: string;
    }
    | {
        status: 'running';
        processId: string;
    }
    | {
        status: 'started';
        taskId: string;
    }
    | {
        status: 'not-found';
        message: string;
    };

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
                if (body.effortTier !== undefined && (typeof body.effortTier !== 'string' || !VALID_EFFORT_TIERS.has(body.effortTier))) {
                    return send400(res, `Invalid effortTier: '${String(body.effortTier)}'`);
                }

                const { type, identifier } = body;
                const result = await enqueueGenericClassification({
                    ...opts,
                    repoId,
                    workspaceId: body.workspaceId || repoId,
                    type,
                    identifier,
                    priority: 'normal',
                    model: body.model,
                    provider: body.provider,
                    reasoningEffort: body.reasoningEffort,
                    effortTier: body.effortTier,
                    autoProviderRouting: body.autoProviderRouting,
                });

                if (result.status === 'not-found') {
                    return send404(res, result.message);
                }
                sendJson(res, result, result.status === 'started' ? 202 : 200);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- GET: Origin-scoped PR batch status ------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/classify-diff\/batch-status$/,
        handler: async (req, res, match) => {
            try {
                const originId = decodeURIComponent(match![1]).trim();
                if (!originId) {
                    return send400(res, 'originId must be a non-empty string');
                }

                const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const type = url.searchParams.get('type') as ClassificationType | null;
                const rawIdentifiers = url.searchParams.get('identifiers');
                const workspaceIdParam = url.searchParams.get('workspaceId')?.trim();
                const repoIdParam = url.searchParams.get('repoId')?.trim();
                const workspaceId = workspaceIdParam || originId;
                const repoId = repoIdParam || workspaceId;

                if (type !== 'pr') {
                    return send400(res, 'Origin-scoped classification batch status only supports type=pr');
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

                const storageScope = await resolvePullRequestOriginStorageScope({ originId, processStore: store });
                const statuses: Record<string, 'none' | 'ready' | 'running'> = {};
                for (const identifier of identifiers) {
                    const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
                    if (cached) {
                        statuses[identifier] = 'ready';
                        continue;
                    }
                    const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
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

                const storageScope = await resolveClassificationStorageScope(svc, store, repoId, workspaceId);
                const statuses: Record<string, 'none' | 'ready' | 'running'> = {};
                for (const identifier of identifiers) {
                    const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
                    if (cached) {
                        statuses[identifier] = 'ready';
                        continue;
                    }
                    const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
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

                const storageScope = await resolveClassificationStorageScope(svc, store, repoId, workspaceId);
                const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
                if (cached) {
                    return sendJson(res, {
                        status: 'ready',
                        processId: cached.processId,
                        result: cached.result,
                        createdAt: cached.createdAt,
                    });
                }

                const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
                if (pending) {
                    if (isTaskAlive(pending.processId, bridge)) {
                        return sendJson(res, {
                            status: 'running',
                            processId: pending.processId,
                        });
                    }
                    // Stale marker: task is gone or terminal — clear it and report idle
                    clearPendingGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
                }

                sendJson(res, { status: 'none' });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}

export async function enqueueGenericClassification(
    options: EnqueueGenericClassificationOptions,
): Promise<EnqueueGenericClassificationResult> {
    const {
        dataDir,
        store,
        bridge,
        repoId,
        type,
        identifier,
    } = options;
    const workspaceId = options.workspaceId || repoId;
    const svc = options.repoTreeService ?? new RepoTreeService(dataDir, undefined, store);
    const repo = await svc.resolveRepo(repoId);
    const storageScope = options.storageScope
        ?? await resolveClassificationStorageScope(svc, store, repoId, workspaceId, repo);

    const cached = readClassificationGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
    if (cached) {
        return {
            status: 'ready',
            processId: cached.processId,
            result: cached.result,
            createdAt: cached.createdAt,
        };
    }

    const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
    if (pending) {
        if (isTaskAlive(pending.processId, bridge)) {
            return {
                status: 'running',
                processId: pending.processId,
            };
        }
        clearPendingGeneric(dataDir, workspaceId, repoId, type, identifier, storageScope);
    }

    if (!repo) {
        return { status: 'not-found', message: `Repo ${repoId} not found` };
    }

    const prompt = buildPromptForType(type, identifier, repoId, dataDir);
    const rootPath = repo.localPath ?? process.cwd();
    bridge.getOrCreateBridge(rootPath);
    const resolvedRepoId = bridge.getRepoIdForPath(rootPath);
    const queueManager = bridge.registry.getQueueForRepo(rootPath);

    const taskSpec: CreateTaskInput = {
        type: TaskDefs.prClassification.kind,
        priority: options.priority ?? 'normal',
        repoId: resolvedRepoId,
        payload: {
            kind: TaskDefs.prClassification.kind,
            prompt,
            workspaceId,
            repoId,
            classificationStorageOriginId: resolvePullRequestStorageId(workspaceId, storageScope),
            classificationType: type,
            classificationIdentifier: identifier,
            ...extractPayloadFields(type, identifier),
            workingDirectory: rootPath,
            skills: ['classify-diff'],
            ...(options.provider && VALID_CHAT_PROVIDERS.has(options.provider) ? { provider: options.provider } : {}),
            ...(options.autoProviderRouting === true ? { context: { autoProviderRouting: { requested: true } } } : {}),
        },
        config: {
            ...(options.model ? { model: options.model } : {}),
            ...(options.reasoningEffort && VALID_REASONING_EFFORTS.has(options.reasoningEffort) ? { reasoningEffort: options.reasoningEffort } : {}),
            ...(options.effortTier ? { effortTier: options.effortTier } : {}),
        },
        displayName: buildDisplayName(type, identifier),
    };
    if (options.prepareTaskForEnqueue) {
        await options.prepareTaskForEnqueue(taskSpec);
    }
    const taskId = queueManager.enqueue(taskSpec);

    try {
        writePendingGeneric(dataDir, workspaceId, repoId, type, identifier, String(taskId), storageScope);
    } catch {
        /* best-effort */
    }

    return { status: 'started', taskId: String(taskId) };
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
    storageScope?: PullRequestStorageScopeInput,
) {
    // Map generic key to the PR-style key the store expects.
    // For PRs: identifier = "prId:headSha"
    // For generic: we use (repoId, type_identifier_prefix, identifier_suffix) 
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    return readClassification(dataDir, workspaceId, repoId, prId, headSha, storageScope);
}

function readPendingGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
    storageScope?: PullRequestStorageScopeInput,
) {
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    return readPending(dataDir, workspaceId, repoId, prId, headSha, storageScope);
}

function writePendingGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
    processId: string,
    storageScope?: PullRequestStorageScopeInput,
) {
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    writePending(dataDir, workspaceId, repoId, prId, headSha, processId, { storageScope });
}

function clearPendingGeneric(
    dataDir: string,
    workspaceId: string,
    repoId: string,
    type: ClassificationType,
    identifier: string,
    storageScope?: PullRequestStorageScopeInput,
) {
    const { prId, headSha } = splitIdentifier(type, identifier, repoId);
    clearPending(dataDir, workspaceId, repoId, prId, headSha, storageScope);
}

async function resolveClassificationStorageScope(
    svc: RepoTreeService,
    store: ProcessStore,
    repoId: string,
    workspaceId: string,
    repo?: RepoInfo,
): Promise<PullRequestStorageScope> {
    const resolvedRepo = repo ?? await svc.resolveRepo(repoId);
    return resolvePullRequestStorageScope({
        workspaceId,
        repoId,
        remoteUrl: resolvedRepo?.remoteUrl,
        rootPath: resolvedRepo?.localPath,
        processStore: store,
    });
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
