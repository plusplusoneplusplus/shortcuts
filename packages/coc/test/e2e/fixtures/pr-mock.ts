import type { Page, Route } from '@playwright/test';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';
import type {
    CommentThread,
    PullRequest,
    PullRequestCheck,
    PullRequestCommit,
    Reviewer,
} from '../../../src/server/spa/client/react/features/pull-requests/pr-utils';
import {
    MOCK_PR_CHECKS,
    MOCK_PR_COMMITS,
    MOCK_PR_LIST,
    MOCK_PR_OPEN,
    MOCK_PR_THREADS,
} from './pr-fixtures.js';

interface MockCoworkerCandidate {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    prCount: number;
    isInRoster?: boolean;
}

export interface PrMockOptions {
    pullRequests?: PullRequest[];
    coworkerCandidates?: MockCoworkerCandidate[];
    coworkerCandidateError?: {
        status: number;
        body?: unknown;
    };
    coworkerCandidateDelayMs?: number;
    prDetail?: PullRequest;
    threads?: CommentThread[];
    reviewers?: Reviewer[];
    /** Body for GET /pull-requests/:id/diff (text/plain). Defaults to empty. */
    diff?: string;
    /** Body for GET /pull-requests/:id/commits. Defaults to `MOCK_PR_COMMITS`. */
    commits?: PullRequestCommit[];
    /** Body for GET /pull-requests/:id/checks. Defaults to `MOCK_PR_CHECKS`. */
    checks?: PullRequestCheck[];
    unconfigured?: boolean;
    detectedProvider?: 'github' | 'ado' | null;
    remoteUrl?: string;
}

function buildCoworkerCandidatesFromPullRequests(pullRequests: readonly PullRequest[]): MockCoworkerCandidate[] {
    const byKey = new Map<string, MockCoworkerCandidate>();

    for (const pr of pullRequests) {
        const displayName = pr.author?.displayName?.trim();
        if (!displayName) continue;
        const id = pr.author?.id == null ? '' : String(pr.author.id).trim();
        const key = id ? `id:${id}` : `name:${displayName.toLowerCase()}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.prCount += 1;
            existing.email ??= pr.author?.email;
            existing.avatarUrl ??= pr.author?.avatarUrl;
            continue;
        }
        byKey.set(key, {
            id,
            displayName,
            ...(pr.author?.email ? { email: pr.author.email } : {}),
            ...(pr.author?.avatarUrl ? { avatarUrl: pr.author.avatarUrl } : {}),
            prCount: 1,
        });
    }

    return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function coworkerCandidateMatches(candidate: MockCoworkerCandidate, query: string): boolean {
    const normalizedQuery = query.toLowerCase();
    return candidate.displayName.toLowerCase().includes(normalizedQuery) ||
        (candidate.email?.toLowerCase().includes(normalizedQuery) ?? false) ||
        candidate.id.toLowerCase().includes(normalizedQuery);
}

export async function setupPrRoutes(
    page: Page,
    serverUrl: string,
    repoId: string,
    options: PrMockOptions = {},
): Promise<() => Promise<void>> {
    const {
        pullRequests = MOCK_PR_LIST,
        coworkerCandidates,
        coworkerCandidateError,
        coworkerCandidateDelayMs = 0,
        prDetail = MOCK_PR_OPEN,
        threads = MOCK_PR_THREADS,
        reviewers = [],
        diff = '',
        commits = MOCK_PR_COMMITS,
        checks = MOCK_PR_CHECKS,
        unconfigured = false,
        detectedProvider = null,
        remoteUrl = '',
    } = options;

    const originId = resolveCanonicalOriginId({ workspaceId: repoId, remoteUrl });
    const aggregateOriginId = resolveCanonicalOriginId({ workspaceId: '__all' });
    const bases = [
        `${serverUrl}/api/origins/${encodeURIComponent(originId)}/pull-requests`,
        `${serverUrl}/api/origins/${encodeURIComponent(aggregateOriginId)}/pull-requests`,
    ];

    const threadsPatterns   = bases.map(base => `${base}/**/threads**`);
    const reviewersPatterns = bases.map(base => `${base}/**/reviewers**`);
    const commitsPatterns   = bases.map(base => `${base}/**/commits**`);
    const checksPatterns    = bases.map(base => `${base}/**/checks**`);
    const diffPatterns      = bases.map(base => `${base}/**/diff**`);
    const coworkerCandidatesPatterns = bases.map(base => `${base}/coworker-candidates?*`);
    const baseUrls = bases.map(base => new URL(base));
    const collectionSegments = new Set([
        'recent-opened',
        'coworker-candidates',
        'coworker-roster',
        'review-history',
        'suggestions',
    ]);
    const detailPattern = (url: URL) => {
        return baseUrls.some(baseUrl => {
            if (url.origin !== baseUrl.origin) return false;
            const prefix = `${baseUrl.pathname}/`;
            if (!url.pathname.startsWith(prefix)) return false;
            const rest = decodeURIComponent(url.pathname.slice(prefix.length));
            return rest.length > 0 && !rest.includes('/') && !collectionSegments.has(rest);
        });
    };
    const listPatterns = bases.map(base => `${base}?*`);

    const unconfiguredBody = {
        error: 'unconfigured',
        detected: detectedProvider,
        remoteUrl,
    };
    const candidateSource = coworkerCandidates ?? buildCoworkerCandidatesFromPullRequests(pullRequests);

    const threadsHandler = (route: Route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { threads } });
    };
    for (const pattern of threadsPatterns) await page.route(pattern, threadsHandler);

    const reviewersHandler = (route: Route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { reviewers } });
    };
    for (const pattern of reviewersPatterns) await page.route(pattern, reviewersHandler);

    const commitsHandler = (route: Route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { commits } });
    };
    for (const pattern of commitsPatterns) await page.route(pattern, commitsHandler);

    const checksHandler = (route: Route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: { checks } });
    };
    for (const pattern of checksPatterns) await page.route(pattern, checksHandler);

    const diffHandler = (route: Route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: diff,
        });
    };
    for (const pattern of diffPatterns) await page.route(pattern, diffHandler);

    const coworkerCandidatesHandler = async (route: Route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        if (coworkerCandidateError) {
            return route.fulfill({
                status: coworkerCandidateError.status,
                json: coworkerCandidateError.body ?? { error: 'candidate search failed' },
            });
        }
        if (coworkerCandidateDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, coworkerCandidateDelayMs));
        }
        const url = new URL(route.request().url());
        const query = (url.searchParams.get('query') ?? '').trim();
        if (query.length < 2) {
            return route.fulfill({
                status: 400,
                json: { error: 'query must be at least 2 characters', minimumQueryLength: 2 },
            });
        }
        const topRaw = Number(url.searchParams.get('top') ?? '20');
        const top = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(Math.floor(topRaw), 50) : 20;
        const matching = candidateSource.filter(candidate => coworkerCandidateMatches(candidate, query));
        const candidates = matching.slice(0, top);
        return route.fulfill({
            status: 200,
            json: {
                candidates,
                total: matching.length,
                query,
                minimumQueryLength: 2,
                fetchedAt: Date.now(),
                scannedPullRequests: pullRequests.length,
                truncated: matching.length > candidates.length,
            },
        });
    };
    for (const pattern of coworkerCandidatesPatterns) await page.route(pattern, coworkerCandidatesHandler);

    // single PR detail — must come after sub-resources, before list
    await page.route(detailPattern, (route) => {
        if (unconfigured) {
            return route.fulfill({ status: 401, json: unconfiguredBody });
        }
        return route.fulfill({ status: 200, json: prDetail });
    });

    // list (filter by status query param to simulate server-side filtering;
    //       'open' returns all provided PRs to match initial-load test expectations)
    const listHandler = (route: Route) => {
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
    };
    for (const pattern of listPatterns) await page.route(pattern, listHandler);

    return async () => {
        for (const pattern of threadsPatterns) await page.unroute(pattern);
        for (const pattern of reviewersPatterns) await page.unroute(pattern);
        for (const pattern of commitsPatterns) await page.unroute(pattern);
        for (const pattern of checksPatterns) await page.unroute(pattern);
        for (const pattern of diffPatterns) await page.unroute(pattern);
        for (const pattern of coworkerCandidatesPatterns) await page.unroute(pattern);
        await page.unroute(detailPattern);
        for (const pattern of listPatterns) await page.unroute(pattern);
    };
}
