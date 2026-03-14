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
// Registration
// ============================================================================

/**
 * Register all pull-request API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * @param routes  - Shared route table
 * @param dataDir - CoC data directory (e.g. ~/.coc)
 */
export function registerPrRoutes(routes: Route[], dataDir: string): void {

    // -- List PRs -------------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await new RepoTreeService(dataDir).resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const svc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!svc || isNoAdoCredentials(svc)) {
                    if (isNoAdoCredentials(svc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const query = url.parse(req.url ?? '', true).query;
                const status = typeof query.status === 'string' ? query.status : 'open';
                const top = Math.min(+(query.top ?? 25), 100);
                const skip = +(query.skip ?? 0);

                const prs = await svc.listPullRequests(repoId, { status, top, skip });

                // Apply server-side author and title filters
                let filtered = prs;
                if (typeof query.author === 'string' && query.author) {
                    const authorFilter = query.author.toLowerCase();
                    filtered = filtered.filter(pr =>
                        pr.author?.displayName?.toLowerCase().includes(authorFilter) ||
                        pr.author?.id?.toLowerCase().includes(authorFilter),
                    );
                }
                if (typeof query.search === 'string' && query.search) {
                    const searchFilter = query.search.toLowerCase();
                    filtered = filtered.filter(pr => pr.title.toLowerCase().includes(searchFilter));
                }

                sendJson(res, { pullRequests: filtered, total: filtered.length });
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

                const repo = await new RepoTreeService(dataDir).resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const svc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!svc || isNoAdoCredentials(svc)) {
                    if (isNoAdoCredentials(svc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const pr = await svc.getPullRequest(repoId, prId);
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

                const repo = await new RepoTreeService(dataDir).resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const svc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!svc || isNoAdoCredentials(svc)) {
                    if (isNoAdoCredentials(svc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const threads = await svc.getThreads(repoId, prId);
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

                const repo = await new RepoTreeService(dataDir).resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cfg = await readProvidersConfig(dataDir);
                const svc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!svc || isNoAdoCredentials(svc)) {
                    if (isNoAdoCredentials(svc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const reviewers = await svc.getReviewers(repoId, prId);
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
}
