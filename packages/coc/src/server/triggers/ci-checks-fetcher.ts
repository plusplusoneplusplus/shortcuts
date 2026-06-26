/**
 * Production CI-Checks Fetcher
 *
 * Builds the `CiChecksFetcher` injected into {@link CiFailureEvaluator} for the
 * ci-failure condition monitor. It is a thin adapter over the headless
 * server-side checks path (`fetchOriginPullRequestChecksHeadless` in
 * `repos/pr-routes.ts`) — the SAME path the SPA's
 * `/api/origins/:originId/pull-requests/:prId/checks` route uses — so polling
 * needs no HTTP request context and works for remote clones (origin/workspace
 * scope is resolved through the shared storage-origin path).
 *
 * The adapter maps the provider check shape (`ProviderPullRequestCheck`) onto
 * the evaluator's minimal `CiCheckSnapshot`. The status vocabularies are
 * identical (forge `CheckStatus` ⇔ `CiCheckStatus`), so no value remapping is
 * needed — only field projection.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { fetchOriginPullRequestChecksHeadless } from '../repos/pr-routes';
import type { CiChecksFetcher, CiCheckSnapshot, CiPrChecksSnapshot } from './ci-failure-evaluator';

export interface CreateCiChecksFetcherOptions {
    /** Root data directory (e.g. `~/.coc/`). */
    dataDir: string;
    /** Process store, used for remote-clone-aware origin scope resolution. */
    store?: ProcessStore;
}

/**
 * Create a {@link CiChecksFetcher} bound to a data directory + process store.
 * The returned fetcher resolves the PR checks snapshot for a given
 * workspace/origin/PR by reusing the existing server-side checks path.
 */
export function createCiChecksFetcher(options: CreateCiChecksFetcherOptions): CiChecksFetcher {
    return async ({ workspaceId, originId, prId }): Promise<CiPrChecksSnapshot> => {
        const snapshot = await fetchOriginPullRequestChecksHeadless({
            dataDir: options.dataDir,
            workspaceId,
            originId,
            prId,
            store: options.store,
        });

        const checks: CiCheckSnapshot[] = snapshot.checks.map((check) => ({
            id: check.id,
            name: check.name,
            status: check.status,
            ...(check.detailsUrl ? { detailsUrl: check.detailsUrl } : {}),
        }));

        return {
            prStatus: snapshot.prStatus,
            prNumber: snapshot.prNumber,
            checks,
        };
    };
}
