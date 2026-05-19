/**
 * Pull Request Routes
 *
 * Registers /api/repos/:repoId/pull-requests/* endpoints.
 * Uses ProviderFactory to resolve the correct adapter per repo.
 *
 * GET  /api/repos/:repoId/pull-requests              — list PRs
 * GET  /api/repos/:repoId/pull-requests/:prId        — get single PR
 * GET  /api/repos/:repoId/pull-requests/:prId/threads    — get comment threads
 * GET  /api/repos/:repoId/pull-requests/:prId/reviewers  — get reviewers
 * GET  /api/repos/:repoId/pull-requests/:prId/commits    — get commits
 * GET  /api/repos/:repoId/pull-requests/:prId/diff       — get unified diff (plain text)
 * GET  /api/repos/:repoId/pull-requests/:prId/diff/files/:path — get per-file diff (JSON)
 * GET  /api/repos/:repoId/pull-requests/:prId/checks     — get CI/check statuses
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import type { Route } from '../types';
import { sendJson, send404, send500 } from '../router';
import { RepoTreeService } from './tree-service';
import { ProviderFactory } from '../providers/provider-factory';
import type { AdoNoCredentialsSentinel } from '../providers/provider-factory';
import { readProvidersConfig } from '../providers/providers-config';
import { AdoAuthError } from '@plusplusoneplusplus/forge';
import type { IPullRequestsService, ProcessStore } from '@plusplusoneplusplus/forge';
import type { ProvidersFileConfig } from '../providers/providers-config';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the diff text for a single file from a combined unified diff.
 * Returns the raw diff section (from `diff --git` to the next `diff --git` or EOF).
 */
function extractFileDiffFromCombined(combinedDiff: string, filePath: string): string | null {
    const lines = combinedDiff.split('\n');
    let capturing = false;
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
            if (capturing) break;
            const body = line.slice('diff --git '.length);
            const bIdx = body.lastIndexOf(' b/');
            const path = bIdx !== -1 ? body.slice(bIdx + 3) : '';
            if (path === filePath) {
                capturing = true;
                result.push(line);
            }
        } else if (capturing) {
            result.push(line);
        }
    }

    return result.length > 0 ? result.join('\n') : null;
}

/** Detect whether an error is an authentication/authorization failure. */
function isAuthError(err: unknown): boolean {
    if (err instanceof AdoAuthError) return true;
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
        return true;
    }
    return isAuthError((err as { cause?: unknown }).cause);
}

/** Detect the no-ado-credentials sentinel from the provider factory. */
function isNoAdoCredentials(svc: unknown): svc is AdoNoCredentialsSentinel {
    return typeof svc === 'object' && svc !== null && (svc as AdoNoCredentialsSentinel).error === 'no-ado-credentials';
}

const ADO_AUTH_EXPIRED_MESSAGE = 'ADO token expired. Run `az login` to re-authenticate.';

type PrOperationResult<T> =
    | { kind: 'ok'; value: T }
    | { kind: 'unconfigured'; detected: ReturnType<typeof ProviderFactory.detectProviderType>; remoteUrl: string | undefined }
    | { kind: 'no-ado-credentials' }
    | { kind: 'ado-auth-expired' };

async function runPrOperation<T>(
    remoteUrl: string | undefined,
    cfg: ProvidersFileConfig,
    dataDir: string,
    operation: (prSvc: IPullRequestsService) => Promise<T>,
    cacheKeys: string[] = [],
): Promise<PrOperationResult<T>> {
    const initialSvc = await ProviderFactory.createPullRequestsService(remoteUrl ?? '', cfg);
    if (!initialSvc || isNoAdoCredentials(initialSvc)) {
        return serviceUnavailableResult(initialSvc, remoteUrl);
    }

    try {
        return { kind: 'ok', value: await operation(initialSvc) };
    } catch (err) {
        if (!isAuthError(err)) {
            throw err;
        }
    }

    for (const cacheKey of cacheKeys) {
        prListCache.delete(cacheKey);
    }

    const refreshedSvc = await ProviderFactory.createPullRequestsService(remoteUrl ?? '', cfg, {
        forceRefresh: true,
        dataDir,
    });
    if (!refreshedSvc || isNoAdoCredentials(refreshedSvc)) {
        return serviceUnavailableResult(refreshedSvc, remoteUrl);
    }

    try {
        return { kind: 'ok', value: await operation(refreshedSvc) };
    } catch (err) {
        if (isAuthError(err)) {
            return { kind: 'ado-auth-expired' };
        }
        throw err;
    }
}

function serviceUnavailableResult<T>(
    svc: IPullRequestsService | AdoNoCredentialsSentinel | null,
    remoteUrl: string | undefined,
): PrOperationResult<T> {
    if (isNoAdoCredentials(svc)) {
        return { kind: 'no-ado-credentials' };
    }
    return {
        kind: 'unconfigured',
        detected: ProviderFactory.detectProviderType(remoteUrl ?? ''),
        remoteUrl,
    };
}

function sendPrOperationFailure(res: Parameters<typeof sendJson>[0], result: Exclude<PrOperationResult<unknown>, { kind: 'ok' }>): void {
    if (result.kind === 'no-ado-credentials') {
        sendJson(res, { error: 'no-ado-credentials' }, 401);
        return;
    }
    if (result.kind === 'ado-auth-expired') {
        sendJson(res, { error: 'ado-auth-expired', message: ADO_AUTH_EXPIRED_MESSAGE }, 401);
        return;
    }
    sendJson(res, { error: 'unconfigured', detected: result.detected, remoteUrl: result.remoteUrl }, 401);
}

// ============================================================================
// PR list cache (in-memory, 60-min TTL)
// ============================================================================

const PR_LIST_TTL_MS = 60 * 60 * 1000;
const PR_LIST_FETCH_TOP = 100;

interface PrCacheEntry {
    data: any[];
    expiresAt: number;
}

const prListCache = new Map<string, PrCacheEntry>();

function makePrCacheKey(repoId: string, status: string, scope: string): string {
    return `${repoId}|${status}|${scope}`;
}

/** Clear all cached PR list entries. Exported for testing. */
export function clearPrListCache(): void {
    prListCache.clear();
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Register all pull-request API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes  - Shared route table
 * @param dataDir - CoC data directory (e.g. ~/.coc)
 * @param service - Shared RepoTreeService instance (singleton)
 */
export function registerPrRoutes(routes: Route[], dataDir: string, service?: RepoTreeService, store?: ProcessStore): void {
    const svc = service ?? new RepoTreeService(dataDir, undefined, store);

    // -- List PRs -------------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const query = url.parse(req.url ?? '', true).query;
                const status = typeof query.status === 'string' ? query.status : 'open';
                const scope = typeof query.scope === 'string' && (query.scope === 'mine' || query.scope === 'all') ? query.scope : 'mine';
                const top = Math.min(+(query.top ?? 25), 100);
                const skip = +(query.skip ?? 0);
                const force = query.force === 'true';
                const cacheKey = makePrCacheKey(repoId, status, scope);

                let prs: any[];

                // Serve from cache if valid and not forced
                const cached = !force ? prListCache.get(cacheKey) : undefined;
                if (force) prListCache.delete(cacheKey);

                if (cached && cached.expiresAt > Date.now()) {
                    prs = cached.data;
                } else {
                    const repo = await svc.resolveRepo(repoId);
                    if (!repo) return send404(res, `Repo ${repoId} not found`);

                    const cfg = await readProvidersConfig(dataDir);
                    const result = await runPrOperation(
                        repo.remoteUrl,
                        cfg,
                        dataDir,
                        prSvc => prSvc.listPullRequests(repoId, { status, top: PR_LIST_FETCH_TOP, scope }),
                        [cacheKey],
                    );
                    if (result.kind !== 'ok') {
                        return sendPrOperationFailure(res, result);
                    }
                    prs = result.value;
                    prListCache.set(cacheKey, { data: prs, expiresAt: Date.now() + PR_LIST_TTL_MS });
                }

                // Apply in-memory pagination
                let page = prs.slice(skip, skip + top);

                // Apply server-side author and title filters
                if (typeof query.author === 'string' && query.author) {
                    const authorFilter = query.author.toLowerCase();
                    page = page.filter((pr: any) =>
                        pr.author?.displayName?.toLowerCase().includes(authorFilter) ||
                        pr.author?.id?.toLowerCase().includes(authorFilter),
                    );
                }
                if (typeof query.search === 'string' && query.search) {
                    const searchFilter = query.search.toLowerCase();
                    page = page.filter((pr: any) => pr.title.toLowerCase().includes(searchFilter));
                }

                sendJson(res, { pullRequests: page, total: page.length });
            } catch (err) {
                if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get single PR --------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, prSvc => prSvc.getPullRequest(repoId, prId));
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const pr = result.value;
                sendJson(res, pr);
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get comment threads --------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/threads$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, prSvc => prSvc.getThreads(repoId, prId));
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const threads = result.value;
                sendJson(res, { threads });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get reviewers --------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/reviewers$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, prSvc => prSvc.getReviewers(repoId, prId));
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const reviewers = result.value;
                sendJson(res, { reviewers });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get commits ----------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/commits$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, async prSvc => {
                    if (typeof prSvc.getCommits !== 'function') {
                        return [];
                    }
                    return prSvc.getCommits(repoId, prId);
                });
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const commits = result.value;
                sendJson(res, { commits });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get checks / CI statuses --------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/checks$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, async prSvc => {
                    if (typeof prSvc.getChecks !== 'function') {
                        return [];
                    }
                    return prSvc.getChecks(repoId, prId);
                });
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const checks = result.value;
                sendJson(res, { checks });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get per-file diff (extracted from combined) ----------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/diff\/files\/(.+)$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);
                const filePath = decodeURIComponent(match![3]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, async prSvc => {
                    if (typeof prSvc.getDiff !== 'function') {
                        return '';
                    }
                    return prSvc.getDiff(repoId, prId);
                });
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const combinedDiff = result.value;
                const fileDiff = extractFileDiffFromCombined(combinedDiff, filePath);
                sendJson(res, { diff: fileDiff ?? '' });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get unified diff -----------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/diff$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const result = await runPrOperation(repo.remoteUrl, cfg, dataDir, async prSvc => {
                    if (typeof prSvc.getDiff !== 'function') {
                        return '';
                    }
                    return prSvc.getDiff(repoId, prId);
                });
                if (result.kind !== 'ok') {
                    return sendPrOperationFailure(res, result);
                }
                const diff = result.value;
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(diff);
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendPrOperationFailure(res, { kind: 'ado-auth-expired' });
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });
}
