import type { Page } from '@playwright/test';
import type {
    CommentThread,
    PullRequest,
    Reviewer,
} from '../../../src/server/spa/client/react/repos/pull-requests/pr-utils';
import {
    MOCK_PR_LIST,
    MOCK_PR_OPEN,
    MOCK_PR_THREADS,
} from './pr-fixtures.js';

export interface PrMockOptions {
    pullRequests?: PullRequest[];
    prDetail?: PullRequest;
    threads?: CommentThread[];
    reviewers?: Reviewer[];
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
        unconfigured = false,
        detectedProvider = null,
        remoteUrl = '',
    } = options;

    const base = `${serverUrl}/api/repos/${repoId}/pull-requests`;

    const threadsPattern  = `${base}/*/threads`;
    const reviewersPattern = `${base}/*/reviewers`;
    const detailPattern   = `${base}/*`;
    const listPattern     = base;

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

    // single PR detail — must come after sub-resources, before list
    await page.route(detailPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: prDetail });
    });

    // list
    await page.route(listPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({
            status: 200,
            json: { pullRequests, total: pullRequests.length },
        });
    });

    return async () => {
        await page.unroute(threadsPattern);
        await page.unroute(reviewersPattern);
        await page.unroute(detailPattern);
        await page.unroute(listPattern);
    };
}
