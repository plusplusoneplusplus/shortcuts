/**
 * Read-only pull-request queries behind the `query_pull_request` LLM tool.
 *
 * The caller always names the repository (`owner/repo` on GitHub,
 * `organization/project/repository` on Azure DevOps); nothing is resolved from
 * the chat's workspace. Requests run on this server with its own credentials
 * (the same sources as `pr-status-fetcher.ts`): the GitHub token from
 * `providers.json` and the host Azure DevOps token. The ADO organization always
 * comes from the caller, never from the configured default org.
 *
 * Nothing is persisted. Cursors are opaque, self-contained and validated on use.
 * Every failure surfaces as a {@link PrQueryError} with a sanitized message —
 * tokens, headers and raw provider bodies never leave this module.
 *
 * Provider data (titles, descriptions, review/check text) is untrusted display
 * data: callers must never treat it as instructions.
 */

import { createHash } from 'crypto';
import { Octokit } from '@octokit/rest';
import * as azdev from 'azure-devops-node-api';
import {
    createAdoPullRequestsAdapter,
    getOrResolveAdoUserId,
    resolveAdoAccessTokenValue,
    type ProviderCheckStatus,
} from '@plusplusoneplusplus/forge';
import { PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { readProvidersConfig } from '../providers/providers-config';

export type PrQueryProvider = 'github' | 'ado';
export type PrQueryStatus = 'open' | 'merged' | 'closed' | 'all';
export type PrQueryCi = 'passing' | 'failing' | 'pending' | 'none';

export type PrQueryErrorCode =
    | 'invalid-input'
    | 'invalid-cursor'
    | 'unsupported-filter'
    | 'credentials-missing'
    | 'auth-failed'
    | 'repository-not-found'
    | 'provider-unavailable'
    | 'cancelled';

/** Whole-call failure. `message` is a sanitized summary safe to show the model. */
export class PrQueryError extends Error {
    constructor(readonly code: PrQueryErrorCode, message: string) {
        super(message);
        this.name = 'PrQueryError';
    }
}

export type PrRepositoryIdentity =
    | { provider: 'github'; repository: string; owner: string; repo: string }
    | { provider: 'ado'; repository: string; organization: string; project: string; repo: string };

export interface PrQueryFilters {
    status: PrQueryStatus;
    /** GitHub login, ADO identity GUID, or `"me"`. */
    author?: string;
    ci?: PrQueryCi;
}

/** Where the next page starts: a provider page cursor plus an offset into it. */
export interface PrQueryCursorPosition {
    after?: string;
    offset: number;
}

export type PrQueryRequest =
    | {
        mode: 'query';
        identity: PrRepositoryIdentity;
        filters: PrQueryFilters;
        limit: number;
        position?: PrQueryCursorPosition;
    }
    | { mode: 'get'; identity: PrRepositoryIdentity; ids: number[] };

export const DEFAULT_QUERY_LIMIT = 20;
export const MAX_QUERY_LIMIT = 100;
export const MAX_GET_IDS = 20;

const PROVIDERS: readonly PrQueryProvider[] = ['github', 'ado'];
const STATUSES: readonly PrQueryStatus[] = ['open', 'merged', 'closed', 'all'];
const CI_STATES: readonly PrQueryCi[] = ['passing', 'failing', 'pending', 'none'];
const KNOWN_KEYS = new Set(['provider', 'repository', 'ids', 'status', 'author', 'ci', 'limit', 'cursor']);
const QUERY_ONLY_KEYS = ['status', 'author', 'ci', 'limit', 'cursor'] as const;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const GITHUB_NAME = /^[A-Za-z0-9._-]+$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_VERSION = 1;

// ── request parsing ──────────────────────────────────────────

function invalid(message: string): PrQueryError {
    return new PrQueryError('invalid-input', message);
}

/**
 * Validates raw tool arguments into a request. Runs before any provider I/O,
 * so every `invalid-input` / `invalid-cursor` / `unsupported-filter` that the
 * arguments alone can reveal is reported here.
 */
export function parsePrQueryRequest(args: unknown): PrQueryRequest {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw invalid('Arguments must be an object with `provider` and `repository`.');
    }
    const input = args as Record<string, unknown>;
    const unknownKeys = Object.keys(input).filter(key => !KNOWN_KEYS.has(key) && input[key] !== undefined);
    if (unknownKeys.length > 0) {
        throw invalid(`Unknown argument(s): ${unknownKeys.join(', ')}.`);
    }
    const identity = parseIdentity(input.provider, input.repository);

    if (input.ids !== undefined) {
        const mixed = QUERY_ONLY_KEYS.filter(key => input[key] !== undefined);
        if (mixed.length > 0) {
            throw invalid(`\`ids\` cannot be combined with ${mixed.map(key => `\`${key}\``).join(', ')}.`);
        }
        return { mode: 'get', identity, ids: parseIds(input.ids) };
    }

    const filters = parseFilters(identity, input);
    const limit = parseLimit(input.limit);
    const position = input.cursor === undefined
        ? undefined
        : decodePrQueryCursor(input.cursor, identity, filters);
    return { mode: 'query', identity, filters, limit, ...(position ? { position } : {}) };
}

function parseIdentity(provider: unknown, repository: unknown): PrRepositoryIdentity {
    if (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) {
        throw invalid('`provider` must be "github" or "ado".');
    }
    if (typeof repository !== 'string') {
        throw invalid('`repository` is required.');
    }
    const segments = repository.split('/').map(segment => segment.trim());
    if (segments.some(segment => segment.length === 0)) {
        throw invalid('`repository` segments must be non-empty.');
    }
    if (provider === 'github') {
        if (segments.length !== 2) throw invalid('GitHub `repository` must be "owner/repo".');
        if (!segments.every(segment => GITHUB_NAME.test(segment))) {
            throw invalid('GitHub `repository` segments may only contain letters, digits, ".", "-" and "_".');
        }
        const [owner, repo] = segments;
        return { provider, repository: segments.join('/'), owner, repo };
    }
    if (segments.length !== 3) throw invalid('Azure DevOps `repository` must be "organization/project/repository".');
    const [organization, project, repo] = segments;
    return { provider: 'ado', repository: segments.join('/'), organization, project, repo };
}

function parseIds(raw: unknown): number[] {
    const ids = Array.isArray(raw) ? raw : [raw];
    if (ids.length === 0) throw invalid('`ids` must contain at least one ID.');
    if (ids.length > MAX_GET_IDS) throw invalid(`At most ${MAX_GET_IDS} IDs per call.`);
    for (const id of ids) {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
            throw invalid('Every ID must be a positive integer.');
        }
    }
    return ids as number[];
}

function parseFilters(identity: PrRepositoryIdentity, input: Record<string, unknown>): PrQueryFilters {
    const status = input.status ?? 'open';
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
        throw invalid('`status` must be one of open, merged, closed, all.');
    }
    const filters: PrQueryFilters = { status: status as PrQueryStatus };
    if (input.ci !== undefined) {
        if (typeof input.ci !== 'string' || !(CI_STATES as readonly string[]).includes(input.ci)) {
            throw invalid('`ci` must be one of passing, failing, pending, none.');
        }
        filters.ci = input.ci as PrQueryCi;
    }
    if (input.author !== undefined) {
        if (typeof input.author !== 'string' || input.author.trim().length === 0) {
            throw invalid('`author` must be a non-empty string.');
        }
        const author = input.author.trim();
        if (author.toLowerCase() === 'me') {
            filters.author = 'me';
        } else if (identity.provider === 'github') {
            if (!GITHUB_LOGIN.test(author)) throw invalid('GitHub `author` must be a login.');
            filters.author = author;
        } else {
            if (!GUID.test(author)) {
                throw new PrQueryError('unsupported-filter',
                    'Azure DevOps `author` must be an identity GUID or "me"; display names and emails are not matched.');
            }
            filters.author = author.toLowerCase();
        }
    }
    return filters;
}

function parseLimit(raw: unknown): number {
    if (raw === undefined) return DEFAULT_QUERY_LIMIT;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > MAX_QUERY_LIMIT) {
        throw invalid(`\`limit\` must be an integer from 1 to ${MAX_QUERY_LIMIT}.`);
    }
    return raw;
}

// ── cursors ──────────────────────────────────────────────────

interface CursorPayload {
    v: number;
    provider: PrQueryProvider;
    repository: string;
    filtersHash: string;
    position: PrQueryCursorPosition;
}

function hashFilters(filters: PrQueryFilters): string {
    return createHash('sha256')
        .update(JSON.stringify([filters.status, filters.author ?? null, filters.ci ?? null]))
        .digest('hex')
        .slice(0, 16);
}

/** Encodes a self-contained cursor bound to the provider, repository and filter set. */
export function encodePrQueryCursor(
    identity: PrRepositoryIdentity,
    filters: PrQueryFilters,
    position: PrQueryCursorPosition,
): string {
    const payload: CursorPayload = {
        v: CURSOR_VERSION,
        provider: identity.provider,
        repository: identity.repository,
        filtersHash: hashFilters(filters),
        position,
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Decodes a cursor and checks it belongs to this provider, repository and filter set. */
export function decodePrQueryCursor(
    raw: unknown,
    identity: PrRepositoryIdentity,
    filters: PrQueryFilters,
): PrQueryCursorPosition {
    const fail = (message: string) => new PrQueryError('invalid-cursor', message);
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
        throw fail('`cursor` is malformed; pass a `nextCursor` from an earlier result.');
    }
    let payload: Partial<CursorPayload>;
    try {
        payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
        throw fail('`cursor` is malformed; pass a `nextCursor` from an earlier result.');
    }
    const position = payload?.position;
    if (!payload || payload.v !== CURSOR_VERSION || !position || typeof position !== 'object'
        || typeof position.offset !== 'number' || !Number.isSafeInteger(position.offset) || position.offset < 0
        || (position.after !== undefined && typeof position.after !== 'string')) {
        throw fail('`cursor` is malformed; pass a `nextCursor` from an earlier result.');
    }
    if (payload.provider !== identity.provider || payload.repository !== identity.repository
        || payload.filtersHash !== hashFilters(filters)) {
        throw fail('`cursor` belongs to a different provider, repository or filter set; repeat the original query arguments.');
    }
    return { ...(position.after !== undefined ? { after: position.after } : {}), offset: position.offset };
}

// ── provider errors ──────────────────────────────────────────

function providerLabel(provider: PrQueryProvider): string {
    return provider === 'github' ? 'GitHub' : 'Azure DevOps';
}

function statusOf(err: unknown): number | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    const status = e.status ?? e.statusCode ?? e.response?.status;
    return typeof status === 'number' ? status : undefined;
}

function isRateLimited(err: unknown, status: number | undefined): boolean {
    if (status === 429) return true;
    if (status !== 403 || !err || typeof err !== 'object') return false;
    const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
    if (headers && String(headers['x-ratelimit-remaining']) === '0') return true;
    const message = (err as { message?: unknown }).message;
    return typeof message === 'string' && /rate limit/i.test(message);
}

/**
 * Maps a provider failure to a whole-call {@link PrQueryError}. Only the HTTP
 * status is kept; provider messages and bodies are dropped.
 */
export function toPrQueryError(
    err: unknown,
    provider: PrQueryProvider,
    context: 'repository' | 'request',
): PrQueryError {
    if (err instanceof PrQueryError) return err;
    const label = providerLabel(provider);
    const status = statusOf(err);
    if (isRateLimited(err, status)) {
        return new PrQueryError('provider-unavailable', `${label} rate limit reached; try again later.`);
    }
    if (status === 401 || status === 403) {
        return new PrQueryError('auth-failed', `${label} rejected this server's credentials (HTTP ${status}).`);
    }
    if (status === 404 && context === 'repository') {
        return new PrQueryError('repository-not-found', `${label} repository was not found or is not visible to this server's credentials.`);
    }
    return new PrQueryError('provider-unavailable', status
        ? `${label} request failed (HTTP ${status}).`
        : `${label} could not be reached.`);
}

// ── summaries and CI ─────────────────────────────────────────

export type PrLifecycle = 'open' | 'merged' | 'closed';
export type PrCiState = PrQueryCi | 'unavailable';

export interface PrCiCounts {
    success: number;
    failure: number;
    pending: number;
    other: number;
}

export interface PrCiSummary {
    state: PrCiState;
    counts?: PrCiCounts;
    /** Sanitized explanation when `state` is `unavailable`. */
    reason?: string;
}

export interface PrAuthor {
    id?: string;
    login?: string;
    displayName?: string;
}

/** Query-mode summary: exactly these fields, nothing else. */
export interface PrSummary {
    id: number;
    title: string;
    url: string;
    author: PrAuthor;
    lifecycle: PrLifecycle;
    isDraft: boolean;
    sourceBranch: string;
    targetBranch: string;
    ci: PrCiSummary;
}

/** A listed PR before CI is known. `ci` is set when the listing already carried it. */
export type PrCandidate = Omit<PrSummary, 'ci'> & {
    ci?: PrCiSummary;
    /** Head commit, used to pin CI lookups to the listed revision. Never returned. */
    headSha?: string;
};

/**
 * Aggregates check statuses (latest run per check) into one CI state:
 * any failure/cancelled → failing; else any pending/running → pending;
 * else any success/warning → passing; else (none, or only skipped) → none.
 */
export function summarizeChecks(statuses: readonly ProviderCheckStatus[]): PrCiSummary {
    const counts: PrCiCounts = { success: 0, failure: 0, pending: 0, other: 0 };
    let failing = false;
    let pending = false;
    let passing = false;
    for (const status of statuses) {
        switch (status) {
            case 'failure':
            case 'cancelled':
                counts.failure++;
                failing = true;
                break;
            case 'pending':
            case 'running':
                counts.pending++;
                pending = true;
                break;
            case 'success':
            case 'warning':
                counts.success++;
                passing = true;
                break;
            case 'skipped':
                counts.success++;
                break;
            default:
                counts.other++;
        }
    }
    const state: PrQueryCi = failing ? 'failing' : pending ? 'pending' : passing ? 'passing' : 'none';
    return { state, counts };
}

// ── provider clients ─────────────────────────────────────────

export interface PrListQuery {
    status: PrQueryStatus;
    /** Provider author value: GitHub login or ADO identity GUID (already resolved from "me"). */
    author?: string;
    /** Provider page token from an earlier page; absent for the first page. */
    after?: string;
    pageSize: number;
}

export interface PrCandidatePage {
    items: PrCandidate[];
    /** Token for the following page; absent when this is the last page. */
    next?: string;
}

/** Provider operations bound to one repository and one credential. */
export interface PrProviderClient {
    /** Resolves when the repository exists and is visible; throws a {@link PrQueryError} otherwise. */
    probeRepository(): Promise<void>;
    /** The signed-in account as an author filter value (GitHub login, ADO identity GUID). */
    resolveCurrentUser(): Promise<string>;
    /** One page of PRs matching the server-side filters, newest first. Throws on any provider failure. */
    listPullRequests(query: PrListQuery): Promise<PrCandidatePage>;
    /** CI for a listed PR whose listing did not carry it. Throws when the lookup fails. */
    loadCi?(candidate: PrCandidate): Promise<PrCiSummary>;
}

export type CreatePrProviderClient = (identity: PrRepositoryIdentity) => Promise<PrProviderClient>;

/** Production client factory: resolves this server's credentials for the caller-named repository. */
export function createPrProviderClientFactory(dataDir: string): CreatePrProviderClient {
    return async (identity) => identity.provider === 'github'
        ? createGitHubClient(dataDir, identity)
        : createAdoClient(dataDir, identity);
}

const GITHUB_STATUS_QUALIFIERS: Record<PrQueryStatus, string[]> = {
    open: ['is:open'],
    merged: ['is:merged'],
    closed: ['is:closed', 'is:unmerged'],
    all: [],
};

const GITHUB_SEARCH_QUERY = `
query QueryPullRequests($q: String!, $first: Int!, $after: String) {
  search(type: ISSUE, query: $q, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url isDraft state merged headRefName baseRefName
        author { login ... on Node { id } ... on User { name } }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  pageInfo { hasNextPage }
                  nodes {
                    __typename
                    ... on CheckRun { status conclusion }
                    ... on StatusContext { state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

interface GitHubRollupContext {
    __typename?: string;
    status?: string | null;
    conclusion?: string | null;
    state?: string | null;
}

interface GitHubSearchNode {
    number?: number;
    title?: string;
    url?: string;
    isDraft?: boolean;
    state?: string;
    merged?: boolean;
    headRefName?: string;
    baseRefName?: string;
    author?: { login?: string; id?: string; name?: string | null } | null;
    commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: {
        state?: string;
        contexts?: { pageInfo?: { hasNextPage?: boolean }; nodes?: Array<GitHubRollupContext | null> };
    } | null } } | null> };
}

interface GitHubSearchResponse {
    search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<GitHubSearchNode | null> };
}

/** Mirrors forge's REST check-run mapping for GraphQL rollup contexts. */
function mapGitHubRollupContext(context: GitHubRollupContext): ProviderCheckStatus {
    if (context.__typename === 'StatusContext') {
        switch (context.state) {
            case 'SUCCESS': return 'success';
            case 'FAILURE':
            case 'ERROR': return 'failure';
            case 'PENDING':
            case 'EXPECTED': return 'pending';
            default: return 'unknown';
        }
    }
    if (context.status !== 'COMPLETED') {
        return context.status === 'IN_PROGRESS' ? 'running' : 'pending';
    }
    switch (context.conclusion) {
        case 'SUCCESS':
        case 'NEUTRAL': return 'success';
        case 'FAILURE':
        case 'TIMED_OUT':
        case 'STARTUP_FAILURE': return 'failure';
        case 'CANCELLED': return 'cancelled';
        case 'SKIPPED':
        case 'STALE': return 'skipped';
        case 'ACTION_REQUIRED': return 'warning';
        default: return 'unknown';
    }
}

function gitHubRollupCi(node: GitHubSearchNode): PrCiSummary {
    const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    if (!rollup) return summarizeChecks([]);
    const contexts = (rollup.contexts?.nodes ?? []).filter((c): c is GitHubRollupContext => !!c);
    const summary = summarizeChecks(contexts.map(mapGitHubRollupContext));
    if (rollup.contexts?.pageInfo?.hasNextPage) {
        // Counts cover the first 100 contexts only; the overall state comes from GitHub's rollup.
        const state: PrQueryCi | undefined = rollup.state === 'SUCCESS' ? 'passing'
            : rollup.state === 'FAILURE' || rollup.state === 'ERROR' ? 'failing'
                : rollup.state === 'PENDING' || rollup.state === 'EXPECTED' ? 'pending'
                    : undefined;
        if (state) summary.state = state;
    }
    return summary;
}

function mapGitHubSearchNode(node: GitHubSearchNode): PrCandidate {
    const lifecycle: PrLifecycle = node.state === 'MERGED' || node.merged ? 'merged'
        : node.state === 'CLOSED' ? 'closed' : 'open';
    const author: PrAuthor = {};
    if (node.author?.id) author.id = node.author.id;
    if (node.author?.login) author.login = node.author.login;
    if (node.author?.name) author.displayName = node.author.name;
    return {
        id: node.number as number,
        title: node.title ?? '',
        url: node.url ?? '',
        author,
        lifecycle,
        isDraft: node.isDraft === true,
        sourceBranch: node.headRefName ?? '',
        targetBranch: node.baseRefName ?? '',
        ci: gitHubRollupCi(node),
    };
}

/** Maps a GitHub GraphQL/search failure; GraphQL errors arrive with HTTP 200. */
function toGitHubSearchError(err: unknown): PrQueryError {
    const errors = (err as { errors?: Array<{ type?: unknown }> } | null)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        const types = errors.map(e => String(e?.type ?? ''));
        if (types.includes('RATE_LIMITED')) return new PrQueryError('provider-unavailable', 'GitHub rate limit reached; try again later.');
        if (types.includes('FORBIDDEN')) return new PrQueryError('auth-failed', "GitHub rejected this server's credentials for the search.");
        if (types.some(type => type === 'UNPROCESSABLE' || type === 'INVALID' || type === 'INVALID_ARGUMENTS')) {
            return new PrQueryError('unsupported-filter', 'GitHub rejected the search filters.');
        }
        return new PrQueryError('provider-unavailable', 'GitHub search failed.');
    }
    if (statusOf(err) === 422) return new PrQueryError('unsupported-filter', 'GitHub rejected the search filters (HTTP 422).');
    return toPrQueryError(err, 'github', 'request');
}

async function createGitHubClient(
    dataDir: string,
    identity: Extract<PrRepositoryIdentity, { provider: 'github' }>,
): Promise<PrProviderClient> {
    let token: string | undefined;
    try {
        token = (await readProvidersConfig(dataDir)).providers.github?.token;
    } catch {
        token = undefined;
    }
    if (!token) {
        throw new PrQueryError('credentials-missing', 'GitHub is not signed in on this server (no token in providers.json).');
    }
    const octokit = new Octokit({ auth: token });
    return {
        async probeRepository() {
            try {
                await octokit.repos.get({ owner: identity.owner, repo: identity.repo });
            } catch (err) {
                throw toPrQueryError(err, 'github', 'repository');
            }
        },
        async resolveCurrentUser() {
            const { data } = await octokit.users.getAuthenticated();
            if (!data?.login) throw new Error('no login');
            return data.login;
        },
        async listPullRequests(query) {
            const q = [
                'is:pr',
                `repo:${identity.owner}/${identity.repo}`,
                ...GITHUB_STATUS_QUALIFIERS[query.status],
                ...(query.author ? [`author:${query.author}`] : []),
                'sort:updated-desc',
            ].join(' ');
            let response: GitHubSearchResponse;
            try {
                response = await octokit.graphql<GitHubSearchResponse>(GITHUB_SEARCH_QUERY, {
                    q,
                    first: query.pageSize,
                    after: query.after ?? null,
                });
            } catch (err) {
                throw toGitHubSearchError(err);
            }
            const items = response.search.nodes
                .filter((node): node is GitHubSearchNode => typeof node?.number === 'number')
                .map(mapGitHubSearchNode);
            const next = response.search.pageInfo.hasNextPage && response.search.pageInfo.endCursor
                ? response.search.pageInfo.endCursor
                : undefined;
            return { items, ...(next ? { next } : {}) };
        },
    };
}

const ADO_STATUS: Record<PrQueryStatus, PullRequestStatus> = {
    open: PullRequestStatus.Active,
    merged: PullRequestStatus.Completed,
    closed: PullRequestStatus.Abandoned,
    all: PullRequestStatus.All,
};

function stripRefsHeads(ref: string | undefined): string {
    return (ref ?? '').replace(/^refs\/heads\//, '');
}

async function createAdoClient(
    dataDir: string,
    identity: Extract<PrRepositoryIdentity, { provider: 'ado' }>,
): Promise<PrProviderClient> {
    let token: string;
    try {
        token = await resolveAdoAccessTokenValue({ dataDir });
    } catch {
        throw new PrQueryError('credentials-missing', 'Azure DevOps is not signed in on this server (no Azure CLI account).');
    }
    if (!token) {
        throw new PrQueryError('credentials-missing', 'Azure DevOps is not signed in on this server (no Azure CLI account).');
    }
    const orgUrl = `https://dev.azure.com/${encodeURIComponent(identity.organization)}`;
    const connection = new azdev.WebApi(orgUrl, azdev.getBearerHandler(token));
    const webRepoUrl = `${orgUrl}/${encodeURIComponent(identity.project)}/_git/${encodeURIComponent(identity.repo)}`;
    let adapter: ReturnType<typeof createAdoPullRequestsAdapter> | undefined;
    return {
        async probeRepository() {
            let repository: unknown;
            try {
                const git = await connection.getGitApi();
                repository = await git.getRepository(identity.repo, identity.project);
            } catch (err) {
                throw toPrQueryError(err, 'ado', 'repository');
            }
            // typed-rest-client resolves a 404 as a null result.
            if (!repository) {
                throw toPrQueryError({ statusCode: 404 }, 'ado', 'repository');
            }
        },
        async resolveCurrentUser() {
            const id = await getOrResolveAdoUserId(orgUrl, token);
            if (!id) throw new Error('no identity');
            return id;
        },
        async listPullRequests(query) {
            if (query.after !== undefined && !/^\d+$/.test(query.after)) {
                throw new PrQueryError('invalid-cursor', '`cursor` is malformed; pass a `nextCursor` from an earlier result.');
            }
            const skip = query.after === undefined ? 0 : Number(query.after);
            let prs: Awaited<ReturnType<Awaited<ReturnType<typeof connection.getGitApi>>['getPullRequests']>> | null;
            try {
                const git = await connection.getGitApi();
                prs = await git.getPullRequests(
                    identity.repo,
                    { status: ADO_STATUS[query.status], ...(query.author ? { creatorId: query.author } : {}) },
                    identity.project,
                    undefined,
                    skip,
                    query.pageSize,
                );
            } catch (err) {
                throw toPrQueryError(err, 'ado', 'request');
            }
            if (!prs) throw toPrQueryError({ statusCode: 404 }, 'ado', 'request');
            const items: PrCandidate[] = prs
                .filter(pr => typeof pr.pullRequestId === 'number')
                .map(pr => {
                    const author: PrAuthor = {};
                    if (pr.createdBy?.id) author.id = pr.createdBy.id;
                    if (pr.createdBy?.uniqueName) author.login = pr.createdBy.uniqueName;
                    if (pr.createdBy?.displayName) author.displayName = pr.createdBy.displayName;
                    const id = pr.pullRequestId as number;
                    const candidate: PrCandidate = {
                        id,
                        title: pr.title ?? '',
                        url: `${webRepoUrl}/pullrequest/${id}`,
                        author,
                        lifecycle: pr.status === PullRequestStatus.Completed ? 'merged'
                            : pr.status === PullRequestStatus.Abandoned ? 'closed' : 'open',
                        isDraft: pr.isDraft === true,
                        sourceBranch: stripRefsHeads(pr.sourceRefName),
                        targetBranch: stripRefsHeads(pr.targetRefName),
                    };
                    const headSha = pr.lastMergeSourceCommit?.commitId;
                    if (headSha) candidate.headSha = headSha;
                    return candidate;
                });
            const next = prs.length >= query.pageSize ? String(skip + prs.length) : undefined;
            return { items, ...(next ? { next } : {}) };
        },
        async loadCi(candidate) {
            adapter ??= createAdoPullRequestsAdapter({ orgUrl, token, project: identity.project, repo: identity.repo });
            // Pinning to the listed head makes forge read only current-iteration
            // statuses and throw (instead of skipping) when a status source fails.
            if (!adapter.getChecks) throw new Error('checks unsupported');
            const checks = await adapter.getChecks(identity.repo, candidate.id, candidate.headSha);
            return summarizeChecks(checks.map(check => check.status));
        },
    };
}

// ── orchestration ────────────────────────────────────────────

export interface PrQuerySuccess {
    success: true;
    mode: 'query' | 'get';
    provider: PrQueryProvider;
    repository: string;
    [key: string]: unknown;
}

export interface RunPrQueryDeps {
    createClient: CreatePrProviderClient;
    signal?: AbortSignal;
}

/** Provider page size. Fixed so cursor offsets stay meaningful between calls. */
export const QUERY_PAGE_SIZE = 100;
/** Scan budget per query call when filters must be applied client-side. */
export const MAX_SCAN_PAGES = 5;
export const MAX_SCAN_CANDIDATES = 500;
/** Maximum provider requests in flight per invocation. */
export const MAX_CONCURRENT_REQUESTS = 4;

function cancelledError(): PrQueryError {
    return new PrQueryError('cancelled', 'The request was cancelled.');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw cancelledError();
}

/**
 * Awaits a provider call but settles as `cancelled` as soon as the signal
 * aborts; the late result is discarded.
 */
export function awaitUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
        promise.catch(() => undefined);
        return Promise.reject(cancelledError());
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(cancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener('abort', onAbort);
                if (signal.aborted) reject(cancelledError()); else resolve(value);
            },
            err => {
                signal.removeEventListener('abort', onAbort);
                reject(signal.aborted ? cancelledError() : err);
            },
        );
    });
}

/** Runs a parsed request: credentials, repository probe, then the requested mode. */
export async function runPrQuery(request: PrQueryRequest, deps: RunPrQueryDeps): Promise<PrQuerySuccess> {
    const { signal } = deps;
    throwIfAborted(signal);
    const client = await awaitUnlessAborted(deps.createClient(request.identity), signal);
    throwIfAborted(signal);
    await awaitUnlessAborted(client.probeRepository(), signal);
    throwIfAborted(signal);
    if (request.mode === 'query') {
        return runQueryMode(request, client, signal);
    }
    throw new PrQueryError('provider-unavailable', 'Get mode is not available on this server yet.');
}

async function resolveAuthor(
    filters: PrQueryFilters,
    provider: PrQueryProvider,
    client: PrProviderClient,
    signal: AbortSignal | undefined,
): Promise<string | undefined> {
    if (filters.author !== 'me') return filters.author;
    let resolved: string;
    try {
        resolved = await awaitUnlessAborted(client.resolveCurrentUser(), signal);
    } catch (err) {
        if (err instanceof PrQueryError && err.code === 'cancelled') throw err;
        throw new PrQueryError('auth-failed', `${providerLabel(provider)} could not resolve "me" to the signed-in account.`);
    }
    throwIfAborted(signal);
    return resolved;
}

async function resolveCi(
    candidate: PrCandidate,
    provider: PrQueryProvider,
    client: PrProviderClient,
    signal: AbortSignal | undefined,
): Promise<PrCiSummary> {
    if (candidate.ci) return candidate.ci;
    if (!client.loadCi) return { state: 'unavailable', reason: 'CI status is not available from this provider listing.' };
    try {
        return await awaitUnlessAborted(client.loadCi(candidate), signal);
    } catch (err) {
        const mapped = toPrQueryError(err, provider, 'request');
        const status = statusOf(err);
        // Cancellation, credentials and rate limits fail the whole call; anything else is per-PR.
        if (mapped.code === 'cancelled' || mapped.code === 'auth-failed' || isRateLimited(err, status)) throw mapped;
        return { state: 'unavailable', reason: `CI status could not be read${status ? ` (HTTP ${status})` : ''}.` };
    }
}

function toSummary(candidate: PrCandidate, ci: PrCiSummary): PrSummary {
    return {
        id: candidate.id,
        title: candidate.title,
        url: candidate.url,
        author: candidate.author,
        lifecycle: candidate.lifecycle,
        isDraft: candidate.isDraft,
        sourceBranch: candidate.sourceBranch,
        targetBranch: candidate.targetBranch,
        ci,
    };
}

/**
 * Query mode. Lifecycle and author are filtered by the provider; CI is
 * filtered here while scanning provider pages in order. `limit` counts only
 * items matching every filter. When the scan budget runs out first, the
 * matches found so far come back with `scan.truncated` and a cursor that
 * resumes after the last scanned candidate.
 */
async function runQueryMode(
    request: Extract<PrQueryRequest, { mode: 'query' }>,
    client: PrProviderClient,
    signal: AbortSignal | undefined,
): Promise<PrQuerySuccess> {
    const { identity, filters, limit } = request;
    const provider = identity.provider;
    const resolvedAuthor = await resolveAuthor(filters, provider, client, signal);

    const items: PrSummary[] = [];
    let ciUnavailableExcluded = 0;
    let scanned = 0;
    let pages = 0;
    let truncated = false;
    let after = request.position?.after;
    let offset = request.position?.offset ?? 0;
    let nextPosition: PrQueryCursorPosition | undefined;

    scan: for (;;) {
        if (pages >= MAX_SCAN_PAGES || scanned >= MAX_SCAN_CANDIDATES) {
            truncated = true;
            nextPosition = { ...(after !== undefined ? { after } : {}), offset };
            break;
        }
        let page: PrCandidatePage;
        try {
            page = await awaitUnlessAborted(client.listPullRequests({
                status: filters.status,
                ...(resolvedAuthor ? { author: resolvedAuthor } : {}),
                ...(after !== undefined ? { after } : {}),
                pageSize: QUERY_PAGE_SIZE,
            }), signal);
        } catch (err) {
            throw toPrQueryError(err, provider, 'request');
        }
        throwIfAborted(signal);
        pages++;

        let index = offset;
        while (index < page.items.length) {
            if (scanned >= MAX_SCAN_CANDIDATES) {
                truncated = true;
                nextPosition = { ...(after !== undefined ? { after } : {}), offset: index };
                break scan;
            }
            // Without a CI filter every candidate is returned, so only look up as many as still fit.
            const width = Math.min(
                MAX_CONCURRENT_REQUESTS,
                filters.ci ? MAX_CONCURRENT_REQUESTS : limit - items.length,
                MAX_SCAN_CANDIDATES - scanned,
            );
            const chunk = page.items.slice(index, index + width);
            const cis = await Promise.all(chunk.map(candidate => resolveCi(candidate, provider, client, signal)));
            throwIfAborted(signal);
            for (let i = 0; i < chunk.length; i++) {
                index++;
                scanned++;
                const ci = cis[i];
                if (filters.ci) {
                    if (ci.state === 'unavailable') {
                        ciUnavailableExcluded++;
                        continue;
                    }
                    if (ci.state !== filters.ci) continue;
                }
                items.push(toSummary(chunk[i], ci));
                if (items.length === limit) {
                    if (index < page.items.length) {
                        nextPosition = { ...(after !== undefined ? { after } : {}), offset: index };
                    } else if (page.next !== undefined) {
                        nextPosition = { after: page.next, offset: 0 };
                    }
                    break scan;
                }
            }
        }

        offset = 0;
        if (page.next === undefined) break;
        after = page.next;
    }

    return {
        success: true,
        mode: 'query',
        provider,
        repository: identity.repository,
        filters: {
            status: filters.status,
            ...(filters.author ? { author: filters.author } : {}),
            ...(filters.author === 'me' && resolvedAuthor ? { resolvedAuthor } : {}),
            ...(filters.ci ? { ci: filters.ci } : {}),
        },
        items,
        ...(nextPosition ? { nextCursor: encodePrQueryCursor(identity, filters, nextPosition) } : {}),
        scan: { truncated, candidatesScanned: scanned },
        ciUnavailableExcluded,
    };
}
