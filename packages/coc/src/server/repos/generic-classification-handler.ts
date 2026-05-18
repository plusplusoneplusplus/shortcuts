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
} from './classification-store';
import { TaskDefs } from '../tasks/task-types';
import { buildClassificationPrompt } from './pr-classification-handler';

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

                // Check in-flight
                const pending = readPendingGeneric(dataDir, workspaceId, repoId, type, identifier);
                if (pending) {
                    return sendJson(res, {
                        status: 'running',
                        processId: pending.processId,
                    });
                }

                // Resolve repo
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const prompt = buildPromptForType(type, identifier, repoId);
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
                    },
                    config: body.model ? { model: body.model } : {},
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
                    return sendJson(res, {
                        status: 'running',
                        processId: pending.processId,
                    });
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

function buildPromptForType(type: ClassificationType, identifier: string, repoId: string): string {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        const prId = colonIdx !== -1 ? identifier.slice(0, colonIdx) : identifier;
        return buildClassificationPrompt(repoId, prId);
    }
    if (type === 'commit') {
        return [
            `Classify every hunk in commit ${identifier} of this repository.`,
            '',
            'Use the available git CLI tools to read the commit diff. Do NOT ask me for the diff — fetch it yourself.',
            '',
            'For each @@ hunk, produce a classification with: file, hunkIndex (0-based within the file), category (logic|mechanical|test|generated), intensity (high|low), and a one-sentence reason.',
            '',
            'When you have classified every hunk, persist the results by calling the `saveClassification` tool exactly once with the full array. Do NOT print the classifications as JSON in your response — the persistence layer reads them directly from the tool call.',
        ].join('\n');
    }
    // branch-range: identifier = "baseRef..headRef"
    return [
        `Classify every hunk in the branch range ${identifier} of this repository.`,
        '',
        'Use the available git CLI tools to read the diff (git diff). Do NOT ask me for the diff — fetch it yourself.',
        '',
        'For each @@ hunk, produce a classification with: file, hunkIndex (0-based within the file), category (logic|mechanical|test|generated), intensity (high|low), and a one-sentence reason.',
        '',
        'When you have classified every hunk, persist the results by calling the `saveClassification` tool exactly once with the full array. Do NOT print the classifications as JSON in your response — the persistence layer reads them directly from the tool call.',
    ].join('\n');
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

/** Extract extra payload fields for backward compat with ClassificationExecutor. */
function extractPayloadFields(type: ClassificationType, identifier: string): Record<string, string> {
    if (type === 'pr') {
        const colonIdx = identifier.indexOf(':');
        if (colonIdx !== -1) {
            return { prId: identifier.slice(0, colonIdx), headSha: identifier.slice(colonIdx + 1) };
        }
        return { prId: identifier, headSha: 'unknown' };
    }
    if (type === 'commit') {
        return { commitHash: identifier };
    }
    return { branchRange: identifier };
}
