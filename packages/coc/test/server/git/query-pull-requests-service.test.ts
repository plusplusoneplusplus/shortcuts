import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ghAdapterMocks = vi.hoisted(() => ({
    getPullRequest: vi.fn(),
    getReviewers: vi.fn(),
    getChecks: vi.fn(),
}));

const octokitMocks = vi.hoisted(() => ({
    graphql: vi.fn(),
    getAuthenticated: vi.fn(),
    reposGet: vi.fn(async () => ({ data: {} })),
}));

const adoMocks = vi.hoisted(() => ({
    getRepository: vi.fn(async () => ({ id: 'repo-guid' })),
    getPullRequests: vi.fn(),
    getPullRequestById: vi.fn(),
    getChecks: vi.fn(),
    resolveUserId: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
    Octokit: vi.fn(function () {
        return {
            graphql: octokitMocks.graphql,
            users: { getAuthenticated: octokitMocks.getAuthenticated },
            repos: { get: octokitMocks.reposGet },
        };
    }),
}));

vi.mock('azure-devops-node-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('azure-devops-node-api')>();
    return {
        ...actual,
        WebApi: vi.fn(function () {
            return { getGitApi: async () => ({
                getRepository: adoMocks.getRepository,
                getPullRequests: adoMocks.getPullRequests,
                getPullRequestById: adoMocks.getPullRequestById,
            }) };
        }),
        getBearerHandler: vi.fn(() => ({})),
    };
});

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        resolveAdoAccessTokenValue: vi.fn(async () => 'ado-token'),
        getOrResolveAdoUserId: adoMocks.resolveUserId,
        createAdoPullRequestsAdapter: vi.fn(() => ({ getChecks: adoMocks.getChecks })),
        createGitHubPullRequestsAdapter: vi.fn(() => ghAdapterMocks),
    };
});

import {
    createPrProviderClientFactory,
    MAX_CHECKS,
    MAX_DESCRIPTION_CHARS,
    MAX_SCAN_CANDIDATES,
    parsePrQueryRequest,
    QUERY_PAGE_SIZE,
    runPrQuery,
    summarizeChecks,
    type PrCandidate,
    type PrCandidatePage,
    type PrDetailSource,
    type PrListQuery,
    type PrProviderClient,
} from '../../../src/server/git/query-pull-requests-service';

const GUID = '0f0e0d0c-0b0a-0908-0706-050403020100';

function candidate(id: number, extra: Partial<PrCandidate> = {}): PrCandidate {
    return {
        id,
        title: `PR ${id}`,
        url: `https://example.test/pr/${id}`,
        author: { login: 'octocat' },
        lifecycle: 'open',
        isDraft: false,
        sourceBranch: `feature/${id}`,
        targetBranch: 'main',
        ...extra,
    };
}

/** A stub provider whose listing is `total` PRs split into fixed-size pages. */
function pagedClient(pages: PrCandidate[][], overrides: Partial<PrProviderClient> = {}) {
    const listPullRequests = vi.fn(async (query: PrListQuery): Promise<PrCandidatePage> => {
        const index = query.after === undefined ? 0 : Number(query.after);
        const items = pages[index] ?? [];
        return { items, ...(index + 1 < pages.length ? { next: String(index + 1) } : {}) };
    });
    const client: PrProviderClient = {
        probeRepository: vi.fn(async () => undefined),
        resolveCurrentUser: vi.fn(async () => 'octocat'),
        listPullRequests,
        getPullRequest: vi.fn(async () => { throw new Error('unused'); }),
        loadReviews: vi.fn(async () => []),
        loadChecks: vi.fn(async () => []),
        ...overrides,
    };
    return { client, listPullRequests };
}

function ci(state: 'passing' | 'failing' | 'pending' | 'none') {
    return { state, counts: { success: 0, failure: 0, pending: 0, other: 0 } };
}

async function query(args: Record<string, unknown>, client: PrProviderClient, signal?: AbortSignal): Promise<any> {
    return runPrQuery(parsePrQueryRequest({ provider: 'github', repository: 'o/r', ...args }), {
        createClient: async () => client,
        signal,
    });
}

describe('summarizeChecks', () => {
    it.each([
        [[], 'none'],
        [['skipped', 'skipped'], 'none'],
        [['unknown'], 'none'],
        [['success', 'warning', 'skipped'], 'passing'],
        [['success', 'pending'], 'pending'],
        [['success', 'running'], 'pending'],
        [['pending', 'failure'], 'failing'],
        [['success', 'cancelled'], 'failing'],
    ] as const)('%j → %s', (statuses, state) => {
        expect(summarizeChecks(statuses).state).toBe(state);
    });

    it('buckets counts', () => {
        expect(summarizeChecks(['success', 'warning', 'skipped', 'failure', 'cancelled', 'pending', 'running', 'unknown']).counts)
            .toEqual({ success: 3, failure: 2, pending: 2, other: 1 });
    });
});

describe('runPrQuery query mode (stub client)', () => {
    it('defaults to open PRs and 20 items, with a cursor that resumes inside the page', async () => {
        const page = Array.from({ length: 30 }, (_, i) => candidate(i + 1, { ci: ci('passing') }));
        const { client, listPullRequests } = pagedClient([page]);
        const result = await query({}, client);
        expect(listPullRequests).toHaveBeenCalledWith({ status: 'open', pageSize: QUERY_PAGE_SIZE });
        expect(result).toMatchObject({ success: true, mode: 'query', provider: 'github', repository: 'o/r', filters: { status: 'open' } });
        expect(result.items.map((item: any) => item.id)).toEqual(page.slice(0, 20).map(p => p.id));
        expect(result.nextCursor).toEqual(expect.any(String));

        const second = await query({ cursor: result.nextCursor }, client);
        expect(second.items.map((item: any) => item.id)).toEqual(page.slice(20).map(p => p.id));
        expect(second.nextCursor).toBeUndefined();
        expect(second.scan).toEqual({ truncated: false, candidatesScanned: 10 });
    });

    it('continues across provider pages without overlap and drops the cursor at the end', async () => {
        const pages = [[1, 2, 3].map(id => candidate(id, { ci: ci('none') })), [4, 5].map(id => candidate(id, { ci: ci('none') }))];
        const { client } = pagedClient(pages);
        const first = await query({ status: 'merged', limit: 3 }, client);
        expect(first.items.map((item: any) => item.id)).toEqual([1, 2, 3]);
        const second = await query({ status: 'merged', limit: 3, cursor: first.nextCursor }, client);
        expect(second.items.map((item: any) => item.id)).toEqual([4, 5]);
        expect(second.nextCursor).toBeUndefined();
        await expect(query({ status: 'open', limit: 3, cursor: first.nextCursor }, client)).rejects.toMatchObject({ code: 'invalid-cursor' });
    });

    it('returns exactly the summary fields and never internal or detail keys', async () => {
        const { client } = pagedClient([[candidate(1, { ci: ci('passing'), headSha: 'abc' })]]);
        const result = await query({}, client);
        expect(Object.keys(result.items[0]).sort()).toEqual(
            ['author', 'ci', 'id', 'isDraft', 'lifecycle', 'sourceBranch', 'targetBranch', 'title', 'url'],
        );
        for (const key of ['description', 'reviews', 'checks', 'headSha', 'raw']) {
            expect(result.items[0]).not.toHaveProperty(key);
        }
    });

    it('fills a CI-filtered page across provider pages and counts unavailable CI exclusions', async () => {
        const states: Record<number, 'passing' | 'failing' | 'unavailable'> = { 1: 'passing', 2: 'failing', 3: 'unavailable', 4: 'passing', 5: 'failing', 6: 'failing' };
        const pages = [[1, 2, 3].map(id => candidate(id)), [4, 5, 6].map(id => candidate(id))];
        const loadCi = vi.fn(async (c: PrCandidate) => {
            if (states[c.id] === 'unavailable') throw Object.assign(new Error('boom secret'), { status: 500 });
            return ci(states[c.id] as 'passing' | 'failing');
        });
        const { client } = pagedClient(pages, { loadCi });
        const result = await query({ ci: 'failing', limit: 2 }, client);
        expect(result.items.map((item: any) => item.id)).toEqual([2, 5]);
        expect(result.ciUnavailableExcluded).toBe(1);
        expect(result.filters).toEqual({ status: 'open', ci: 'failing' });
        const next = await query({ ci: 'failing', limit: 2, cursor: result.nextCursor }, client);
        expect(next.items.map((item: any) => item.id)).toEqual([6]);
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('reports unavailable CI explicitly when no CI filter is set', async () => {
        const loadCi = vi.fn(async () => { throw Object.assign(new Error('x'), { statusCode: 500 }); });
        const { client } = pagedClient([[candidate(1)]], { loadCi });
        const result = await query({}, client);
        expect(result.items[0].ci).toEqual({ state: 'unavailable', reason: 'CI status could not be read (HTTP 500).' });
    });

    it('fails the whole call when a CI lookup is rate limited', async () => {
        const loadCi = vi.fn(async () => { throw { status: 429 }; });
        const { client } = pagedClient([[candidate(1)]], { loadCi });
        await expect(query({ ci: 'failing' }, client)).rejects.toMatchObject({ code: 'provider-unavailable' });
    });

    it('stops at the scan budget with truncated + a resumable cursor, never silently short', async () => {
        const pages = Array.from({ length: 7 }, (_, p) =>
            Array.from({ length: QUERY_PAGE_SIZE }, (_, i) => candidate(p * QUERY_PAGE_SIZE + i + 1, { ci: ci('passing') })));
        pages[6][0] = candidate(601, { ci: ci('failing') });
        const { client, listPullRequests } = pagedClient(pages);
        const result = await query({ ci: 'failing' }, client);
        expect(result.items).toEqual([]);
        expect(result.scan).toEqual({ truncated: true, candidatesScanned: MAX_SCAN_CANDIDATES });
        expect(listPullRequests).toHaveBeenCalledTimes(5);
        const resumed = await query({ ci: 'failing', cursor: result.nextCursor }, client);
        expect(resumed.items.map((item: any) => item.id)).toEqual([601]);
        expect(resumed.scan.truncated).toBe(false);
    });

    it('keeps at most 4 CI lookups in flight', async () => {
        let inFlight = 0;
        let peak = 0;
        const loadCi = vi.fn(async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight--;
            return ci('passing');
        });
        const { client } = pagedClient([Array.from({ length: 12 }, (_, i) => candidate(i + 1))], { loadCi });
        const result = await query({ ci: 'passing' }, client);
        expect(result.items).toHaveLength(12);
        expect(peak).toBe(4);
    });

    it('fails the whole call when a later listing page fails (no partial page passed off as complete)', async () => {
        const listPullRequests = vi.fn(async (q: PrListQuery): Promise<PrCandidatePage> => {
            if (q.after) throw { status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } };
            return { items: [candidate(1, { ci: ci('passing') })], next: 'p2' };
        });
        const { client } = pagedClient([], { listPullRequests });
        await expect(query({ ci: 'failing' }, client)).rejects.toMatchObject({ code: 'provider-unavailable' });
    });

    it('resolves "me" and reports the resolved author', async () => {
        const { client, listPullRequests } = pagedClient([[]], { resolveCurrentUser: vi.fn(async () => 'mona') });
        const result = await query({ author: 'Me' }, client);
        expect(listPullRequests).toHaveBeenCalledWith(expect.objectContaining({ author: 'mona' }));
        expect(result.filters).toEqual({ status: 'open', author: 'me', resolvedAuthor: 'mona' });
    });

    it('fails with auth-failed when "me" cannot be resolved, without listing', async () => {
        const { client, listPullRequests } = pagedClient([[]], { resolveCurrentUser: vi.fn(async () => { throw new Error('nope'); }) });
        await expect(query({ author: 'me' }, client)).rejects.toMatchObject({ code: 'auth-failed' });
        expect(listPullRequests).not.toHaveBeenCalled();
    });

    it('returns cancelled and stops looking up CI after an abort mid-scan', async () => {
        const controller = new AbortController();
        const loadCi = vi.fn(async () => {
            controller.abort();
            return ci('passing');
        });
        const { client } = pagedClient([Array.from({ length: 12 }, (_, i) => candidate(i + 1))], { loadCi });
        await expect(query({ ci: 'passing' }, client, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
        expect(loadCi.mock.calls.length).toBeLessThanOrEqual(4);
    });
});

function detailSource(id: number, extra: Partial<PrDetailSource> = {}): PrDetailSource {
    return {
        candidate: candidate(id, { headSha: `sha${id}` }),
        description: `Body ${id}`,
        mergeability: { state: 'mergeable' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        inRepository: true,
        ...extra,
    };
}

function notFound() {
    return Object.assign(new Error('Not Found secret'), { status: 404 });
}

function getClient(sources: Record<number, PrDetailSource | (() => Promise<PrDetailSource>)>, overrides: Partial<PrProviderClient> = {}) {
    const { client } = pagedClient([], {
        getPullRequest: vi.fn(async (id: number) => {
            const source = sources[id];
            if (!source) throw notFound();
            return typeof source === 'function' ? source() : source;
        }),
        loadReviews: vi.fn(async () => [{ reviewer: { id: 'u1', login: 'mona' }, vote: 'approved' as const, isRequired: false }]),
        loadChecks: vi.fn(async () => [
            { id: 'c1', name: 'build', status: 'success' as const, source: 'check' as const, raw: { secret: 1 } },
            { id: 'c2', name: 'test', status: 'running' as const, source: 'check' as const },
        ]),
        ...overrides,
    });
    return client;
}

async function get(ids: unknown, client: PrProviderClient, signal?: AbortSignal, provider = 'github', repository = 'o/r'): Promise<any> {
    return runPrQuery(parsePrQueryRequest({ provider, repository, ids }), { createClient: async () => client, signal });
}

describe('runPrQuery get mode (stub client)', () => {
    it('returns full details for a single ID in the same results shape', async () => {
        const client = getClient({ 42: detailSource(42) });
        const result = await get(42, client);
        expect(result).toMatchObject({ success: true, mode: 'get', provider: 'github', repository: 'o/r' });
        expect(result.results).toHaveLength(1);
        const [entry] = result.results;
        expect(entry).toMatchObject({ id: 42, ok: true });
        expect(entry.pullRequest).toEqual({
            id: 42, title: 'PR 42', url: 'https://example.test/pr/42', author: { login: 'octocat' },
            lifecycle: 'open', isDraft: false, sourceBranch: 'feature/42', targetBranch: 'main',
            ci: { state: 'pending', counts: { success: 1, failure: 0, pending: 1, other: 0 } },
            description: 'Body 42', descriptionTruncated: false,
            mergeability: { state: 'mergeable' },
            reviews: [{ reviewer: { id: 'u1', login: 'mona' }, vote: 'approved', isRequired: false }],
            checks: [{ name: 'build', status: 'success' }, { name: 'test', status: 'running' }],
            createdAt: '2026-01-01T00:00:00.000Z',
        });
        expect(JSON.stringify(result)).not.toContain('secret');
        expect(entry.pullRequest).not.toHaveProperty('headSha');
        expect(client.probeRepository).toHaveBeenCalledTimes(1);
    });

    it('keeps input order with mixed outcomes and fetches duplicates once', async () => {
        const client = getClient({
            42: detailSource(42),
            7: async () => { throw Object.assign(new Error('boom secret'), { status: 502 }); },
        });
        const result = await get([42, 999, 7, 42], client);
        expect(result.success).toBe(true);
        expect(result.results.map((r: any) => [r.id, r.ok, r.error?.code])).toEqual([
            [42, true, undefined], [999, false, 'not-found'], [7, false, 'provider-error'], [42, true, undefined],
        ]);
        expect(result.results[3]).toEqual(result.results[0]);
        expect(client.getPullRequest).toHaveBeenCalledTimes(3);
        expect(result.results[2].error.message).toContain('HTTP 502');
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('keeps at most 4 provider requests in flight', async () => {
        let inFlight = 0;
        let peak = 0;
        const track = <T>(value: T) => async () => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 1));
            inFlight--;
            return value;
        };
        const ids = Array.from({ length: 12 }, (_, i) => i + 1);
        const client = getClient(Object.fromEntries(ids.map(id => [id, track(detailSource(id))])), {
            loadReviews: vi.fn(track([])),
            loadChecks: vi.fn(track([])),
        });
        const result = await get(ids, client);
        expect(result.results).toHaveLength(12);
        expect(peak).toBeLessThanOrEqual(4);
        expect(peak).toBeGreaterThan(1);
    });

    it.each([401, 403])('fails the whole call with auth-failed on HTTP %i for a later ID', async (status) => {
        const client = getClient({ 1: detailSource(1), 2: async () => { throw Object.assign(new Error('x'), { status }); } });
        await expect(get([1, 2], client)).rejects.toMatchObject({ code: 'auth-failed' });
    });

    it('fails the whole call when a subresource is rejected for credentials', async () => {
        const client = getClient({ 1: detailSource(1) }, {
            loadChecks: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 401 }); }),
        });
        await expect(get(1, client)).rejects.toMatchObject({ code: 'auth-failed' });
    });

    it('reports wrong-repository instead of another repository\'s PR', async () => {
        const client = getClient({ 5: detailSource(5, { inRepository: false }) });
        const result = await get(5, client, undefined, 'ado', 'org/proj/repo');
        expect(result.results[0]).toEqual({ id: 5, ok: false, error: { code: 'wrong-repository', message: expect.any(String) } });
        expect(JSON.stringify(result)).not.toContain('PR 5');
        expect(client.loadChecks).not.toHaveBeenCalled();
    });

    it('marks failed subresources null + unavailable with ci unavailable, never an empty array', async () => {
        const client = getClient({ 1: detailSource(1) }, {
            loadReviews: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 500 }); }),
            loadChecks: vi.fn(async () => { throw new Error('network'); }),
        });
        const { pullRequest } = (await get(1, client)).results[0];
        expect(pullRequest.reviews).toBeNull();
        expect(pullRequest.checks).toBeNull();
        expect(pullRequest.unavailable).toEqual(['reviews', 'checks']);
        expect(pullRequest.reason).toEqual(expect.stringContaining('HTTP 500'));
        expect(pullRequest.ci).toEqual({ state: 'unavailable', reason: expect.any(String) });
    });

    it('reports checks unavailable when the head commit is unknown, and unknown mergeability', async () => {
        const source = detailSource(1, { candidate: candidate(1), mergeability: undefined });
        const client = getClient({ 1: source });
        const { pullRequest } = (await get(1, client)).results[0];
        expect(client.loadChecks).not.toHaveBeenCalled();
        expect(pullRequest.checks).toBeNull();
        expect(pullRequest.unavailable).toEqual(['checks']);
        expect(pullRequest.ci.state).toBe('unavailable');
        expect(pullRequest.mergeability).toEqual({ state: 'unknown' });
    });

    it('uses reviews carried by the detail response and keeps an empty list as "none"', async () => {
        const client = getClient({ 1: detailSource(1, { reviews: [] }) }, { loadChecks: vi.fn(async () => []) });
        const { pullRequest } = (await get(1, client)).results[0];
        expect(client.loadReviews).not.toHaveBeenCalled();
        expect(pullRequest.reviews).toEqual([]);
        expect(pullRequest.checks).toEqual([]);
        expect(pullRequest.ci.state).toBe('none');
        expect(pullRequest).not.toHaveProperty('unavailable');
    });

    it('truncates long descriptions and check lists with flags', async () => {
        const long = 'x'.repeat(MAX_DESCRIPTION_CHARS + 5);
        const many = Array.from({ length: MAX_CHECKS + 3 }, (_, i) => ({
            id: `c${i}`, name: `c${i}`, status: 'failure' as const, source: 'check' as const, description: 'd'.repeat(600),
        }));
        const client = getClient({ 1: detailSource(1, { description: long }) }, { loadChecks: vi.fn(async () => many) });
        const { pullRequest } = (await get(1, client)).results[0];
        expect(pullRequest.description).toHaveLength(MAX_DESCRIPTION_CHARS);
        expect(pullRequest.descriptionTruncated).toBe(true);
        expect(pullRequest.checks).toHaveLength(MAX_CHECKS);
        expect(pullRequest.checksTruncated).toBe(true);
        expect(pullRequest.checks[0].description).toHaveLength(500);
        expect(pullRequest.ci.counts.failure).toBe(MAX_CHECKS + 3);
    });

    it('returns cancelled on a mid-batch abort and makes no further provider calls', async () => {
        const controller = new AbortController();
        let release!: () => void;
        const hold = new Promise<void>(resolve => { release = resolve; });
        const ids = Array.from({ length: 10 }, (_, i) => i + 1);
        const client = getClient(Object.fromEntries(ids.map(id => [id, async () => {
            if (id === 1) controller.abort();
            await hold;
            return detailSource(id);
        }])));
        const pending = get(ids, client, controller.signal);
        await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
        const calls = (client.getPullRequest as any).mock.calls.length;
        release();
        await new Promise(resolve => setTimeout(resolve, 5));
        expect((client.getPullRequest as any).mock.calls.length).toBe(calls);
        expect(calls).toBeLessThanOrEqual(4);
        expect(client.loadReviews).not.toHaveBeenCalled();
    });
});

describe('GitHub client', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-pr-gh-'));
        fs.writeFileSync(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: { github: { token: 'ghp_test' } } }));
        octokitMocks.graphql.mockReset();
        octokitMocks.getAuthenticated.mockReset();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const client = () => createPrProviderClientFactory(dataDir)(parsePrQueryRequest({ provider: 'github', repository: 'o/r' }).identity);

    function node(number: number, extra: Record<string, unknown> = {}) {
        return {
            number, title: `T${number}`, url: `https://github.com/o/r/pull/${number}`, isDraft: false, state: 'OPEN', merged: false,
            headRefName: 'feature', baseRefName: 'main', author: { login: 'octocat', id: 'U_1', name: 'Octo Cat' },
            commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
            ...extra,
        };
    }

    it.each([
        ['open', 'is:pr repo:o/r is:open sort:updated-desc'],
        ['merged', 'is:pr repo:o/r is:merged sort:updated-desc'],
        ['closed', 'is:pr repo:o/r is:closed is:unmerged sort:updated-desc'],
        ['all', 'is:pr repo:o/r sort:updated-desc'],
    ] as const)('builds the %s search query', async (status, q) => {
        octokitMocks.graphql.mockResolvedValue({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } });
        await (await client()).listPullRequests({ status, pageSize: 100 });
        expect(octokitMocks.graphql).toHaveBeenCalledWith(expect.any(String), { q, first: 100, after: null });
    });

    it('adds the author qualifier and passes the page token', async () => {
        octokitMocks.graphql.mockResolvedValue({ search: { pageInfo: { hasNextPage: true, endCursor: 'C2' }, nodes: [] } });
        const page = await (await client()).listPullRequests({ status: 'open', author: 'mona', after: 'C1', pageSize: 100 });
        expect(octokitMocks.graphql.mock.calls[0][1]).toEqual({ q: 'is:pr repo:o/r is:open author:mona sort:updated-desc', first: 100, after: 'C1' });
        expect(page.next).toBe('C2');
    });

    it('maps lifecycle, draft, branches, author and rollup CI', async () => {
        octokitMocks.graphql.mockResolvedValue({
            search: {
                pageInfo: { hasNextPage: false, endCursor: 'x' },
                nodes: [
                    node(1, { isDraft: true, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { pageInfo: { hasNextPage: false }, nodes: [
                        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
                        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
                        { __typename: 'StatusContext', state: 'PENDING' },
                        { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
                    ] } } } }] } }),
                    node(2, { state: 'MERGED', merged: true }),
                    node(3, { state: 'CLOSED' }),
                    {},
                ],
            },
        });
        const page = await (await client()).listPullRequests({ status: 'all', pageSize: 100 });
        expect(page.next).toBeUndefined();
        expect(page.items).toHaveLength(3);
        expect(page.items[0]).toEqual({
            id: 1, title: 'T1', url: 'https://github.com/o/r/pull/1', author: { id: 'U_1', login: 'octocat', displayName: 'Octo Cat' },
            lifecycle: 'open', isDraft: true, sourceBranch: 'feature', targetBranch: 'main',
            ci: { state: 'failing', counts: { success: 1, failure: 1, pending: 2, other: 0 } },
        });
        expect(page.items.map(i => i.lifecycle)).toEqual(['open', 'merged', 'closed']);
        expect(page.items[1].ci).toEqual({ state: 'none', counts: { success: 0, failure: 0, pending: 0, other: 0 } });
    });

    it('defers truncated rollups to a complete head-pinned CI read', async () => {
        octokitMocks.graphql.mockResolvedValue({ search: { pageInfo: { hasNextPage: false }, nodes: [
            node(1, { commits: { nodes: [{ commit: { oid: 'listed-head', statusCheckRollup: { state: 'FAILURE', contexts: { pageInfo: { hasNextPage: true }, nodes: [
                { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
            ] } } } }] } }),
        ] } });
        const page = await (await client()).listPullRequests({ status: 'open', pageSize: 100 });
        expect(page.items[0].ci).toBeUndefined();
        expect(page.items[0].headSha).toBe('listed-head');
    });

    it.each([
        ['GraphQL UNPROCESSABLE', { errors: [{ type: 'UNPROCESSABLE', message: 'bad author secret' }] }, 'unsupported-filter'],
        ['GraphQL RATE_LIMITED', { errors: [{ type: 'RATE_LIMITED' }] }, 'provider-unavailable'],
        ['GraphQL FORBIDDEN', { errors: [{ type: 'FORBIDDEN' }] }, 'auth-failed'],
        ['HTTP 422', { status: 422 }, 'unsupported-filter'],
        ['HTTP 401', { status: 401 }, 'auth-failed'],
        ['HTTP 502', { status: 502 }, 'provider-unavailable'],
    ])('maps a %s search failure to %s without echoing provider text', async (_label, failure, code) => {
        octokitMocks.graphql.mockRejectedValue(failure);
        const err = await (await client()).listPullRequests({ status: 'open', pageSize: 100 }).catch(e => e);
        expect(err).toMatchObject({ code });
        expect(err.message).not.toContain('secret');
    });

    it('resolves "me" to the authenticated login', async () => {
        octokitMocks.getAuthenticated.mockResolvedValue({ data: { login: 'mona' } });
        expect(await (await client()).resolveCurrentUser()).toBe('mona');
    });

    it('rejects GitHub repository names that could inject search qualifiers', () => {
        expect(() => parsePrQueryRequest({ provider: 'github', repository: 'o/r is:closed' })).toThrow(expect.objectContaining({ code: 'invalid-input' }));
    });
});

describe('Azure DevOps client', () => {
    beforeEach(() => {
        adoMocks.getPullRequests.mockReset();
        adoMocks.getChecks.mockReset();
        adoMocks.resolveUserId.mockReset();
    });

    const identity = () => parsePrQueryRequest({ provider: 'ado', repository: 'My Org/Proj/Repo' }).identity;
    const client = () => createPrProviderClientFactory('/unused')(identity());

    function adoPr(id: number, status: number, extra: Record<string, unknown> = {}) {
        return {
            pullRequestId: id, title: `T${id}`, status, isDraft: false,
            sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/main',
            createdBy: { id: GUID, uniqueName: 'jane@example.com', displayName: 'Jane' },
            lastMergeSourceCommit: { commitId: `sha${id}` },
            ...extra,
        };
    }

    it.each([
        ['open', 1],
        ['merged', 3],
        ['closed', 2],
        ['all', 4],
    ] as const)('maps status %s to search criteria %i and pages with skip', async (status, adoStatus) => {
        adoMocks.getPullRequests.mockResolvedValue([]);
        await (await client()).listPullRequests({ status, author: GUID, after: '200', pageSize: 100 });
        expect(adoMocks.getPullRequests).toHaveBeenCalledWith('Repo', { status: adoStatus, creatorId: GUID }, 'Proj', undefined, 200, 100);
    });

    it('maps lifecycle, draft, branches and URL, and leaves CI to loadCi', async () => {
        adoMocks.getPullRequests.mockResolvedValue([adoPr(1, 1, { isDraft: true }), adoPr(2, 3), adoPr(3, 2)]);
        const page = await (await client()).listPullRequests({ status: 'all', pageSize: 3 });
        expect(page.next).toBe('3');
        expect(page.items[0]).toEqual({
            id: 1, title: 'T1', url: 'https://dev.azure.com/My%20Org/Proj/_git/Repo/pullrequest/1',
            author: { id: GUID, login: 'jane@example.com', displayName: 'Jane' },
            lifecycle: 'open', isDraft: true, sourceBranch: 'feature/x', targetBranch: 'main', headSha: 'sha1',
        });
        expect(page.items.map(i => i.lifecycle)).toEqual(['open', 'merged', 'closed']);
    });

    it('ends paging on a short page and rejects a forged page token', async () => {
        adoMocks.getPullRequests.mockResolvedValue([adoPr(1, 1)]);
        const c = await client();
        expect((await c.listPullRequests({ status: 'open', pageSize: 100 })).next).toBeUndefined();
        await expect(c.listPullRequests({ status: 'open', after: 'abc', pageSize: 100 })).rejects.toMatchObject({ code: 'invalid-cursor' });
    });

    it('loads CI pinned to the listed head commit', async () => {
        adoMocks.getPullRequests.mockResolvedValue([adoPr(7, 1)]);
        adoMocks.getChecks.mockResolvedValue([{ status: 'success' }, { status: 'running' }]);
        const c = await client();
        const [listed] = (await c.listPullRequests({ status: 'open', pageSize: 100 })).items;
        const result = await c.loadCi!(listed);
        expect(adoMocks.getChecks).toHaveBeenCalledWith('Repo', 7, 'sha7');
        expect(result.state).toBe('pending');
    });

    it('resolves "me" via the org identity and fails when it cannot', async () => {
        adoMocks.resolveUserId.mockResolvedValueOnce(GUID).mockResolvedValueOnce(null);
        const c = await client();
        expect(await c.resolveCurrentUser()).toBe(GUID);
        expect(adoMocks.resolveUserId).toHaveBeenCalledWith('https://dev.azure.com/My%20Org', 'ado-token');
        await expect(c.resolveCurrentUser()).rejects.toThrow();
    });

    it('end to end: "me" failure is auth-failed and success filters by creator', async () => {
        adoMocks.getPullRequests.mockResolvedValue([adoPr(1, 1)]);
        adoMocks.getChecks.mockResolvedValue([]);
        adoMocks.resolveUserId.mockResolvedValueOnce(null);
        const run = (args: Record<string, unknown>) => runPrQuery(
            parsePrQueryRequest({ provider: 'ado', repository: 'My Org/Proj/Repo', ...args }),
            { createClient: createPrProviderClientFactory('/unused') },
        );
        await expect(run({ author: 'me' })).rejects.toMatchObject({ code: 'auth-failed' });
        adoMocks.resolveUserId.mockResolvedValueOnce(GUID);
        const result: any = await run({ author: 'me' });
        expect(result.filters).toEqual({ status: 'open', author: 'me', resolvedAuthor: GUID });
        expect(adoMocks.getPullRequests.mock.calls.at(-1)?.[1]).toEqual({ status: 1, creatorId: GUID });
        expect(result.items[0].ci).toEqual({ state: 'none', counts: { success: 0, failure: 0, pending: 0, other: 0 } });
        expect(result.items[0]).not.toHaveProperty('headSha');
    });
});

describe('GitHub client get mode', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-pr-gh-get-'));
        fs.writeFileSync(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: { github: { token: 'ghp_test' } } }));
        ghAdapterMocks.getPullRequest.mockReset();
        ghAdapterMocks.getReviewers.mockReset();
        ghAdapterMocks.getChecks.mockReset();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const run = (ids: unknown) => runPrQuery(
        parsePrQueryRequest({ provider: 'github', repository: 'o/r', ids }),
        { createClient: createPrProviderClientFactory(dataDir) },
    ) as Promise<any>;

    const user = (id: string) => ({ id, login: id, displayName: id.toUpperCase() });

    it('maps forge details, keeps the latest deciding vote per user and pins checks to the head', async () => {
        ghAdapterMocks.getPullRequest.mockResolvedValue({
            id: 9001, number: 3, title: 'T3', description: 'Body', author: user('octocat'),
            sourceBranch: 'feature', targetBranch: 'main', status: 'draft', isDraft: true,
            createdAt: new Date('2026-02-01T00:00:00Z'), updatedAt: new Date('2026-02-02T00:00:00Z'),
            url: 'https://github.com/o/r/pull/3', repositoryId: 'o/r', reviewers: [], labels: [],
            headSha: 'abc', mergeability: { state: 'blocked', blockedReason: 'Waiting' }, raw: { token: 'secret' },
        });
        ghAdapterMocks.getReviewers.mockResolvedValue([
            { identity: user('mona'), vote: 'approved', isRequired: false },
            { identity: user('mona'), vote: 'no-vote', isRequired: false },
            { identity: user('hubot'), vote: 'approved', isRequired: false },
            { identity: user('hubot'), vote: 'rejected', isRequired: false },
            { identity: user('lurker'), vote: 'no-vote', isRequired: false },
        ]);
        ghAdapterMocks.getChecks.mockResolvedValue([{ id: '1', name: 'ci', status: 'failure', source: 'check', raw: {} }]);
        const result = await run(3);
        const { pullRequest } = result.results[0];
        expect(ghAdapterMocks.getPullRequest).toHaveBeenCalledWith('o/r', 3);
        expect(ghAdapterMocks.getChecks).toHaveBeenCalledWith('o/r', 3, 'abc');
        expect(pullRequest).toMatchObject({
            id: 3, lifecycle: 'open', isDraft: true, description: 'Body',
            mergeability: { state: 'blocked', blockedReason: 'Waiting' },
            ci: { state: 'failing' },
            createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z',
        });
        expect(pullRequest.reviews).toEqual([
            { reviewer: { id: 'mona', login: 'mona', displayName: 'MONA' }, vote: 'approved', isRequired: false },
            { reviewer: { id: 'hubot', login: 'hubot', displayName: 'HUBOT' }, vote: 'rejected', isRequired: false },
            { reviewer: { id: 'lurker', login: 'lurker', displayName: 'LURKER' }, vote: 'no-vote', isRequired: false },
        ]);
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('maps a pulls.get 404 (for example an issue number) to not-found', async () => {
        ghAdapterMocks.getPullRequest.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
        const result = await run([1]);
        expect(result.results[0]).toMatchObject({ id: 1, ok: false, error: { code: 'not-found' } });
    });
});

describe('Azure DevOps client get mode', () => {
    beforeEach(() => {
        adoMocks.getRepository.mockReset();
        adoMocks.getRepository.mockResolvedValue({ id: 'repo-guid', project: { id: 'proj-guid' } } as any);
        adoMocks.getPullRequestById.mockReset();
        adoMocks.getChecks.mockReset();
    });

    const run = (ids: unknown) => runPrQuery(
        parsePrQueryRequest({ provider: 'ado', repository: 'My Org/Proj/Repo', ids }),
        { createClient: createPrProviderClientFactory('/unused') },
    ) as Promise<any>;

    function adoDetail(id: number, extra: Record<string, unknown> = {}) {
        return {
            pullRequestId: id, title: `T${id}`, description: 'Body', status: 3, isDraft: false,
            sourceRefName: 'refs/heads/feature/x', targetRefName: 'refs/heads/main',
            createdBy: { id: GUID, uniqueName: 'jane@example.com', displayName: 'Jane' },
            creationDate: '2026-03-01T00:00:00Z', closedDate: '2026-03-02T00:00:00Z',
            lastMergeSourceCommit: { commitId: `sha${id}` },
            mergeStatus: 2,
            repository: { id: 'repo-guid', name: 'repo', project: { id: 'proj-guid', name: 'proj' } },
            reviewers: [
                { id: 'r1', displayName: 'Rev', uniqueName: 'rev@example.com', vote: 10, isRequired: true },
                { id: 'r2', displayName: 'Waiter', vote: -5 },
            ],
            ...extra,
        };
    }

    it('maps details with reviewer votes from the PR itself and checks pinned to the head', async () => {
        adoMocks.getPullRequestById.mockResolvedValue(adoDetail(42));
        adoMocks.getChecks.mockResolvedValue([{ id: 'c', name: 'build', status: 'success', source: 'status' }]);
        const result = await run(42);
        expect(adoMocks.getPullRequestById).toHaveBeenCalledWith(42, 'Proj');
        expect(adoMocks.getChecks).toHaveBeenCalledWith('Repo', 42, 'sha42');
        expect(result.results[0].pullRequest).toMatchObject({
            id: 42, url: 'https://dev.azure.com/My%20Org/Proj/_git/Repo/pullrequest/42', lifecycle: 'merged',
            mergeability: { state: 'conflicting' }, ci: { state: 'passing' },
            createdAt: '2026-03-01T00:00:00.000Z', mergedAt: '2026-03-02T00:00:00.000Z',
            reviews: [
                { reviewer: { id: 'r1', login: 'rev@example.com', displayName: 'Rev' }, vote: 'approved', isRequired: true },
                { reviewer: { id: 'r2', displayName: 'Waiter' }, vote: 'waiting-for-author', isRequired: false },
            ],
        });
        expect(result.results[0].pullRequest).not.toHaveProperty('closedAt');
    });

    it.each([
        ['another repository', { repository: { id: 'other', name: 'Other', project: { id: 'proj-guid', name: 'Proj' } } }],
        ['another project', { repository: { id: 'x', name: 'Repo', project: { id: 'p2', name: 'Elsewhere' } } }],
        ['no repository', { repository: undefined }],
    ])('guards against a PR from %s in the same organization', async (_label, extra) => {
        adoMocks.getPullRequestById.mockResolvedValue(adoDetail(5, extra));
        const result = await run(5);
        expect(result.results[0]).toMatchObject({ id: 5, ok: false, error: { code: 'wrong-repository' } });
        expect(adoMocks.getChecks).not.toHaveBeenCalled();
    });

    it('matches the repository by probed ID when the name differs in case or was renamed', async () => {
        adoMocks.getPullRequestById.mockResolvedValue(adoDetail(5, { repository: { id: 'REPO-GUID', name: 'renamed', project: { id: 'proj-guid' } } }));
        adoMocks.getChecks.mockResolvedValue([]);
        expect((await run(5)).results[0].ok).toBe(true);
    });

    it('maps a null lookup to not-found', async () => {
        adoMocks.getPullRequestById.mockResolvedValue(null);
        expect((await run(5)).results[0]).toMatchObject({ ok: false, error: { code: 'not-found' } });
    });
});
