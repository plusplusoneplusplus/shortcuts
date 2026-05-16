/**
 * PR Classification Routes
 *
 * Registers endpoints for on-demand AI classification of PR diff hunks.
 * Classification runs as a CoC chat conversation with the classify-diff skill.
 *
 * POST /api/repos/:repoId/pull-requests/:prId/classify        — trigger classification
 * GET  /api/repos/:repoId/pull-requests/:prId/classification   — get cached result
 *
 * The classification result is stored in the process store as a conversation.
 * Cache key: `classify-diff:<repoId>:<prId>:<headSha>`.
 */

import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { sendJson, send404, send400, send500, readJsonBody } from '../router';
import { RepoTreeService } from './tree-service';
import type { DiffClassificationResult, HunkClassification } from '../spa/client/react/features/pull-requests/classification-types';

/** Display name prefix used for classification tasks — doubles as a search token. */
const CLASSIFY_DISPLAY_PREFIX = 'Classify PR #';

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

interface ClassificationCacheEntry {
    result: DiffClassificationResult;
    headSha: string;
    createdAt: string;
    processId: string;
}

export interface PrClassificationRouteOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
}

// ============================================================================
// Cache key helpers
// ============================================================================

/** Build the process store tag used to find a cached classification. */
export function classificationCacheTag(repoId: string, prId: string, headSha: string): string {
    return `classify-diff:${repoId}:${prId}:${headSha}`;
}

// ============================================================================
// Result extraction
// ============================================================================

/**
 * Parse the classification JSON from the last assistant turn of a completed process.
 * Expects a JSON block (possibly inside a ```json fence) matching `DiffClassificationResult`.
 */
export function extractClassificationFromResult(resultText: string | undefined): DiffClassificationResult | undefined {
    if (!resultText) return undefined;

    // Try to find a JSON code block first
    const fenceMatch = resultText.match(/```json\s*([\s\S]*?)```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : resultText.trim();

    try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && Array.isArray(parsed.classifications)) {
            // Validate each entry has required fields
            const valid = parsed.classifications.every((c: any) =>
                typeof c.file === 'string' &&
                typeof c.hunkIndex === 'number' &&
                typeof c.category === 'string' &&
                typeof c.intensity === 'string' &&
                typeof c.reason === 'string',
            );
            if (valid) {
                return { classifications: parsed.classifications as HunkClassification[] };
            }
        }
    } catch {
        // Not valid JSON — try to find a JSON object in the text
        const objectMatch = resultText.match(/\{[\s\S]*"classifications"\s*:\s*\[[\s\S]*\]\s*\}/);
        if (objectMatch) {
            try {
                const parsed = JSON.parse(objectMatch[0]);
                if (Array.isArray(parsed.classifications)) {
                    return { classifications: parsed.classifications as HunkClassification[] };
                }
            } catch { /* give up */ }
        }
    }
    return undefined;
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
                const cacheTag = classificationCacheTag(repoId, prId, headSha);

                // Check cache — look for an existing process with this tag
                const cached = await findCachedClassification(store, cacheTag);
                if (cached) {
                    return sendJson(res, {
                        status: cached.status === 'completed' ? 'ready' : 'running',
                        processId: cached.processId,
                        ...(cached.result ? { result: cached.result } : {}),
                    });
                }

                // Resolve repo to get workspace root for queue routing
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const workspaceId = body.workspaceId || repoId;

                // Build the classification prompt
                const prompt = buildClassificationPrompt(repoId, prId);

                // Enqueue a chat task with the classify-diff skill
                const rootPath = repo.localPath ?? process.cwd();
                bridge.getOrCreateBridge(rootPath);
                const resolvedRepoId = bridge.getRepoIdForPath(rootPath);
                const queueManager = bridge.registry.getQueueForRepo(rootPath);

                const taskId = queueManager.enqueue({
                    type: 'chat',
                    priority: 'normal',
                    repoId: resolvedRepoId,
                    payload: {
                        kind: 'chat',
                        mode: 'autopilot',
                        prompt,
                        workspaceId,
                        skills: ['classify-diff'],
                        context: {
                            classifyDiff: {
                                repoId,
                                prId,
                                headSha,
                                cacheTag,
                            },
                        },
                    },
                    config: body.model ? { model: body.model } : {},
                    displayName: `${CLASSIFY_DISPLAY_PREFIX}${prId} [${headSha.slice(0, 7)}]`,
                });

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

                // headSha is passed as query parameter
                const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const headSha = url.searchParams.get('headSha');

                if (!headSha) {
                    return send400(res, 'Missing required query parameter: headSha');
                }

                const cacheTag = classificationCacheTag(repoId, prId, headSha);
                const cached = await findCachedClassification(store, cacheTag);

                if (!cached) {
                    return sendJson(res, { status: 'none' });
                }

                sendJson(res, {
                    status: cached.status === 'completed' ? 'ready' : 'running',
                    processId: cached.processId,
                    ...(cached.result ? { result: cached.result } : {}),
                    ...(cached.createdAt ? { createdAt: cached.createdAt } : {}),
                });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}

// ============================================================================
// Helpers
// ============================================================================

function buildClassificationPrompt(repoId: string, prId: string): string {
    return [
        `Classify every hunk in pull request #${prId} of this repository.`,
        '',
        'Use the available git and gh CLI tools to read the PR diff. Do NOT ask me for the diff — fetch it yourself.',
        '',
        'For each @@ hunk, produce a classification with: file, hunkIndex (0-based within the file), category (logic|mechanical|test|generated), intensity (high|low), and a one-sentence reason.',
        '',
        'Output the result as a single JSON object matching this schema:',
        '```json',
        '{ "classifications": [ { "file": "...", "hunkIndex": 0, "category": "logic", "intensity": "high", "reason": "..." } ] }',
        '```',
    ].join('\n');
}

interface CachedResult {
    processId: string;
    status: string;
    result?: DiffClassificationResult;
    createdAt?: string;
}

/**
 * Search the process store for a process whose prompt contains the cache tag.
 * Uses a display-name convention: "Classify PR #<prId> [<shortSha>]".
 * Returns the most recent match.
 */
async function findCachedClassification(store: ProcessStore, cacheTag: string): Promise<CachedResult | undefined> {
    try {
        // Extract the headSha short prefix from the cache tag for display-name matching
        const parts = cacheTag.split(':');
        const prId = parts[2];
        const headSha = parts[3];
        const expectedDisplayName = `${CLASSIFY_DISPLAY_PREFIX}${prId} [${headSha.slice(0, 7)}]`;

        // Get recent processes (limit search to avoid scanning the entire store)
        const processes = await store.getAllProcesses({ limit: 50, exclude: ['conversation'] });
        for (const proc of processes) {
            // Match by prompt content containing the cache tag, or by display name convention
            const promptMatch = proc.fullPrompt?.includes(`#${prId}`) ?? false;
            const nameMatch = (proc as any).displayName === expectedDisplayName ||
                proc.promptPreview?.includes(`Classify PR #${prId}`);

            if (promptMatch || nameMatch) {
                let result: DiffClassificationResult | undefined;
                if (proc.status === 'completed' && proc.result) {
                    result = extractClassificationFromResult(proc.result);
                }
                return {
                    processId: proc.id,
                    status: proc.status,
                    result,
                    createdAt: proc.startTime instanceof Date ? proc.startTime.toISOString() : String(proc.startTime),
                };
            }
        }
    } catch {
        // Process store query failed — fall through
    }
    return undefined;
}
