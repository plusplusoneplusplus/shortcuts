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
 * GET  /api/repos/:repoId/pull-requests/:prId/diff       — get unified diff
 * GET  /api/repos/:repoId/pull-requests/:prId/commits    — get commits
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
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

/** Detect whether an error is an authentication/authorization failure. */
function isAuthError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden');
}

/** Detect the no-ado-credentials sentinel from the provider factory. */
function isNoAdoCredentials(svc: unknown): svc is AdoNoCredentialsSentinel {
    return typeof svc === 'object' && svc !== null && (svc as AdoNoCredentialsSentinel).error === 'no-ado-credentials';
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
                    const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                    if (!prSvc || isNoAdoCredentials(prSvc)) {
                        if (isNoAdoCredentials(prSvc)) {
                            return sendJson(res, { error: 'no-ado-credentials' }, 401);
                        }
                        const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                        return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                    }

                    prs = await prSvc.listPullRequests(repoId, { status, top: PR_LIST_FETCH_TOP, scope });
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
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
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
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const pr = await prSvc.getPullRequest(repoId, prId);
                sendJson(res, pr);
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
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
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const threads = await prSvc.getThreads(repoId, prId);
                sendJson(res, { threads });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
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
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const reviewers = await prSvc.getReviewers(repoId, prId);
                sendJson(res, { reviewers });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
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
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                if (typeof prSvc.getCommits !== 'function') {
                    return sendJson(res, { commits: [] });
                }

                const commits = await prSvc.getCommits(repoId, prId);
                sendJson(res, { commits });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
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
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                if (typeof prSvc.getChecks !== 'function') {
                    return sendJson(res, { checks: [] });
                }

                const checks = await prSvc.getChecks(repoId, prId);
                sendJson(res, { checks });
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
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
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                if (typeof prSvc.getDiff !== 'function') {
                    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('');
                    return;
                }

                const diff = await prSvc.getDiff(repoId, prId);
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(diff);
            } catch (err) {
                if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
                    send404(res, err.message);
                } else if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });
}
