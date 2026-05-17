/**
 * PR Classification Routes
 *
 * Registers endpoints for on-demand AI classification of PR diff hunks.
 * Classification runs as a CoC chat conversation with the classify-diff skill.
 *
 * POST /api/repos/:repoId/pull-requests/:prId/classify        — trigger classification
 * GET  /api/repos/:repoId/pull-requests/:prId/classification   — get cached result
 *
 * Results are persisted to a file-based store keyed by (workspaceId, repoId,
 * prId, headSha). The AI writes results via the `saveClassification` LLM
 * tool injected by `ClassificationExecutor` — there is no JSON extraction
 * from assistant text or process-store scanning.
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

// ============================================================================
// Types
// ============================================================================

interface ClassifyRequestBody {
    /** SHA of the PR head commit. Used as cache key component. */
    headSha: string;
    /** AI model to use for classification (optional, defaults to per-repo preference). */
    model?: string;
    /** Workspace ID for queue routing. */
    workspaceId?: string;
}

export interface PrClassificationRouteOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
}

// ============================================================================
// Route registration
// ============================================================================

export function registerPrClassificationRoutes(routes: Route[], opts: PrClassificationRouteOptions): void {
    const { dataDir, store, bridge } = opts;
    const svc = opts.repoTreeService ?? new RepoTreeService(dataDir, undefined, store);

    // -- Trigger classification -----------------------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/classify$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                let body: ClassifyRequestBody;
                try {
                    body = await readJsonBody<ClassifyRequestBody>(req);
                } catch {
                    return send400(res, 'Invalid JSON body');
                }

                if (!body.headSha || typeof body.headSha !== 'string') {
                    return send400(res, 'Missing required field: headSha');
                }

                const headSha = body.headSha.trim();
                const workspaceId = body.workspaceId || repoId;

                // Cached result wins.
                const cached = readClassification(dataDir, workspaceId, repoId, prId, headSha);
                if (cached) {
                    return sendJson(res, {
                        status: 'ready',
                        processId: cached.processId,
                        result: cached.result,
                        createdAt: cached.createdAt,
                    });
                }

                // In-flight task already running for this exact (repo, pr, headSha)?
                const pending = readPending(dataDir, workspaceId, repoId, prId, headSha);
                if (pending) {
                    return sendJson(res, {
                        status: 'running',
                        processId: pending.processId,
                    });
                }

                // Resolve repo to get workspace root for queue routing.
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const prompt = buildClassificationPrompt(repoId, prId);

                // Enqueue a pr-classification task with the classify-diff skill.
                const rootPath = repo.localPath ?? process.cwd();
                bridge.getOrCreateBridge(rootPath);
                const resolvedRepoId = bridge.getRepoIdForPath(rootPath);
                const queueManager = bridge.registry.getQueueForRepo(rootPath);

                const taskId = queueManager.enqueue({
                    type: TaskDefs.prClassification.kind,
                    priority: 'normal',
                    repoId: resolvedRepoId,
                    payload: {
                        kind: TaskDefs.prClassification.kind,
                        prompt,
                        workspaceId,
                        repoId,
                        prId,
                        headSha,
                        workingDirectory: rootPath,
                        skills: ['classify-diff'],
                    },
                    config: body.model ? { model: body.model } : {},
                    displayName: `Classify PR #${prId} [${headSha.slice(0, 7)}]`,
                });

                // Write the pending marker so concurrent requests / polls
                // see a `running` status until the AI calls saveClassification.
                try {
                    writePending(dataDir, workspaceId, repoId, prId, headSha, String(taskId));
                } catch {
                    /* best-effort */
                }

                sendJson(res, { status: 'started', taskId }, 202);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Get cached classification result -------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/classification$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const headSha = url.searchParams.get('headSha');
                const workspaceIdParam = url.searchParams.get('workspaceId');
                const workspaceId = workspaceIdParam || repoId;

                if (!headSha) {
                    return send400(res, 'Missing required query parameter: headSha');
                }

                const cached = readClassification(dataDir, workspaceId, repoId, prId, headSha);
                if (cached) {
                    return sendJson(res, {
                        status: 'ready',
                        processId: cached.processId,
                        result: cached.result,
                        createdAt: cached.createdAt,
                    });
                }

                const pending = readPending(dataDir, workspaceId, repoId, prId, headSha);
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
// Helpers
// ============================================================================

export function buildClassificationPrompt(repoId: string, prId: string): string {
    return [
        `Classify every hunk in pull request #${prId} of this repository.`,
        '',
        'Use the available git and gh CLI tools to read the PR diff. Do NOT ask me for the diff — fetch it yourself.',
        '',
        'For each @@ hunk, produce a classification with: file, hunkIndex (0-based within the file), category (logic|mechanical|test|generated), intensity (high|low), and a one-sentence reason.',
        '',
        'When you have classified every hunk, persist the results by calling the `saveClassification` tool exactly once with the full array. Do NOT print the classifications as JSON in your response — the persistence layer reads them directly from the tool call.',
    ].join('\n');
}
