import type { Page } from '@playwright/test';
import type {
    CommentThread,
    PullRequest,
    PullRequestCommit,
    Reviewer,
} from '../../../src/server/spa/client/react/features/pull-requests/pr-utils';
import {
    MOCK_PR_COMMITS,
    MOCK_PR_LIST,
    MOCK_PR_OPEN,
    MOCK_PR_THREADS,
} from './pr-fixtures.js';

export interface PrMockOptions {
    pullRequests?: PullRequest[];
    prDetail?: PullRequest;
    threads?: CommentThread[];
    reviewers?: Reviewer[];
    /** Body for GET /pull-requests/:id/diff (text/plain). Defaults to empty. */
    diff?: string;
    /** Body for GET /pull-requests/:id/commits. Defaults to `MOCK_PR_COMMITS`. */
    commits?: PullRequestCommit[];
    unconfigured?: boolean;
    detectedProvider?: 'github' | 'ado' | null;
    remoteUrl?: string;
}

export async function setupPrRoutes(
    page: Page,
    serverUrl: string,
    repoId: string,
    options: PrMockOptions = {},
): Promise<() => Promise<void>> {
    const {
        pullRequests = MOCK_PR_LIST,
        prDetail = MOCK_PR_OPEN,
        threads = MOCK_PR_THREADS,
        reviewers = [],
        diff = '',
        commits = MOCK_PR_COMMITS,
        unconfigured = false,
        detectedProvider = null,
        remoteUrl = '',
    } = options;

    const base = `${serverUrl}/api/repos/${repoId}/pull-requests`;

    const threadsPattern   = `${base}/*/threads`;
    const reviewersPattern = `${base}/*/reviewers`;
    const commitsPattern   = `${base}/*/commits`;
    const diffPattern      = `${base}/*/diff`;
    const detailPattern    = `${base}/*`;
    const listPattern      = `${base}?*`;

    const unconfiguredBody = {
        error: 'unconfigured',
        detected: detectedProvider,
        remoteUrl,
    };

    // threads
    await page.route(threadsPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { threads } });
    });

    // reviewers
    await page.route(reviewersPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { reviewers } });
    });

    // commits — JSON
    await page.route(commitsPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { commits } });
    });

    // diff — plain-text unified diff
    await page.route(diffPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: diff,
        });
    });

    // single PR detail — must come after sub-resources, before list
    await page.route(detailPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: prDetail });
    });

    // list (filter by status query param to simulate server-side filtering;
    //       'open' returns all provided PRs to match initial-load test expectations)
    await page.route(listPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        const url = new URL(route.request().url());
        const statusParam = url.searchParams.get('status');
        const filtered =
            !statusParam || statusParam === 'open' || statusParam === 'all'
                ? pullRequests
                : pullRequests.filter(pr => pr.status === statusParam);
        return route.fulfill({
            status: 200,
            json: { pullRequests: filtered, total: filtered.length },
        });
    });

    return async () => {
        await page.unroute(threadsPattern);
        await page.unroute(reviewersPattern);
        await page.unroute(commitsPattern);
        await page.unroute(diffPattern);
        await page.unroute(detailPattern);
        await page.unroute(listPattern);
    };
}
