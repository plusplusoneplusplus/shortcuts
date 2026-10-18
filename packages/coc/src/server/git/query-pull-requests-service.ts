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
    createGitHubPullRequestsAdapter,
    getOrResolveAdoUserId,
    resolveAdoAccessTokenValue,
    type ProviderCheckStatus,
    type ProviderPullRequestCheck,
    type Reviewer,
} from '@plusplusoneplusplus/forge';
import {
    PullRequestAsyncStatus,
    PullRequestStatus,
    type GitPullRequest,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
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

export type PrMergeabilityState = 'mergeable' | 'conflicting' | 'blocked' | 'unknown';

export interface PrMergeability {
    state: PrMergeabilityState;
    blockedReason?: string;
}

export type PrReviewVote = Reviewer['vote'];

export interface PrReview {
    reviewer: PrAuthor;
    vote: PrReviewVote;
    isRequired: boolean;
}

/** One PR as read by a provider client for get mode, before subresources. */
export interface PrDetailSource {
    candidate: PrCandidate;
    description: string;
    mergeability?: PrMergeability;
    createdAt?: Date;
    updatedAt?: Date;
    mergedAt?: Date;
    closedAt?: Date;
    /** Reviews already carried by the detail response (ADO); absent → `loadReviews`. */
    reviews?: PrReview[];
    /** False when the provider returned a PR that belongs to a different repository. */
    inRepository: boolean;
}

export interface PrCheck {
    name: string;
    group?: string;
    status: ProviderCheckStatus;
    description?: string;
    detailsUrl?: string;
    startedAt?: string;
    completedAt?: string;
}

export type PrUnavailablePart = 'reviews' | 'checks' | 'mergeability';

/** Get-mode details: the summary fields plus description, mergeability, reviews and checks. */
export interface PrDetail extends PrSummary {
    description: string;
    descriptionTruncated: boolean;
    mergeability: PrMergeability;
    /** `null` when the reviews could not be read; `[]` means there are none. */
    reviews: PrReview[] | null;
    /** `null` when the checks could not be read; `[]` means there are none. */
    checks: PrCheck[] | null;
    checksTruncated?: boolean;
    createdAt?: string;
    updatedAt?: string;
    mergedAt?: string;
    closedAt?: string;
    unavailable?: PrUnavailablePart[];
    /** Sanitized explanation for `unavailable` parts. */
    reason?: string;
}

export type PrGetErrorCode = 'not-found' | 'wrong-repository' | 'provider-error' | 'cancelled';

export type PrGetResult =
    | { id: number; ok: true; pullRequest: PrDetail }
    | { id: number; ok: false; error: { code: PrGetErrorCode; message: string } };

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
    /** One PR by ID. Throws (HTTP 404 → not found) when it cannot be read. */
    getPullRequest(id: number): Promise<PrDetailSource>;
    /** Canonical reviewer votes for a PR whose detail did not carry them. */
    loadReviews(source: PrDetailSource): Promise<PrReview[]>;
    /** Checks on the PR head commit (`candidate.headSha`). Throws when any source fails. */
    loadChecks(source: PrDetailSource): Promise<ProviderPullRequestCheck[]>;
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
              oid
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
    commits?: { nodes?: Array<{ commit?: { oid?: string; statusCheckRollup?: {
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
    return summarizeChecks(contexts.map(mapGitHubRollupContext));
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
        headSha: node.commits?.nodes?.[0]?.commit?.oid,
        // A partial rollup cannot establish complete CI counts. Resolve it from
        // the same head through the paginated adapter in loadCi.
        ...(node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.pageInfo?.hasNextPage
            ? {} : { ci: gitHubRollupCi(node) }),
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
    const adapter = createGitHubPullRequestsAdapter({ token, owner: identity.owner, repo: identity.repo });
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
        async loadCi(candidate) {
            if (!adapter.getChecks || !candidate.headSha) throw new Error('head commit unknown');
            const checks = await adapter.getChecks(identity.repository, candidate.id, candidate.headSha);
            return summarizeChecks(checks.map(check => check.status));
        },
        async getPullRequest(id) {
            const pr = await adapter.getPullRequest(identity.repository, id);
            const candidate: PrCandidate = {
                id,
                title: pr.title,
                url: pr.url,
                author: toPrAuthor(pr.author),
                lifecycle: pr.status === 'merged' ? 'merged' : pr.status === 'closed' ? 'closed' : 'open',
                isDraft: pr.isDraft === true || pr.status === 'draft',
                sourceBranch: pr.sourceBranch,
                targetBranch: pr.targetBranch,
            };
            if (pr.headSha) candidate.headSha = pr.headSha;
            return {
                candidate,
                description: pr.description ?? '',
                ...(pr.mergeability ? { mergeability: pr.mergeability } : {}),
                createdAt: pr.createdAt,
                updatedAt: pr.updatedAt,
                ...(pr.mergedAt ? { mergedAt: pr.mergedAt } : {}),
                ...(pr.closedAt ? { closedAt: pr.closedAt } : {}),
                // `pulls.get` is scoped to owner/repo, so a hit is always in this repository.
                inRepository: true,
            };
        },
        async loadReviews(source) {
            return latestGitHubVotes(await adapter.getReviewers(identity.repository, source.candidate.id));
        },
        async loadChecks(source) {
            if (!adapter.getChecks || !source.candidate.headSha) throw new Error('head commit unknown');
            // Pinning the head SHA makes forge throw (instead of skipping) when a check source fails.
            return adapter.getChecks(identity.repository, source.candidate.id, source.candidate.headSha);
        },
    };
}

function toPrAuthor(identity: { id?: string; login?: string; displayName?: string } | undefined): PrAuthor {
    const author: PrAuthor = {};
    if (identity?.id) author.id = identity.id;
    if (identity?.login) author.login = identity.login;
    if (identity?.displayName) author.displayName = identity.displayName;
    return author;
}

/**
 * GitHub returns every review in order. Keep one entry per user: the latest
 * deciding vote (approve / request changes), or `no-vote` for users who only
 * commented or whose review was dismissed.
 */
function latestGitHubVotes(reviewers: readonly Reviewer[]): PrReview[] {
    const byUser = new Map<string, PrReview>();
    for (const reviewer of reviewers) {
        const key = reviewer.identity.id || reviewer.identity.login || reviewer.identity.displayName;
        const existing = byUser.get(key);
        if (existing && reviewer.vote === 'no-vote') continue;
        if (existing) byUser.delete(key);
        byUser.set(key, { reviewer: toPrAuthor(reviewer.identity), vote: reviewer.vote, isRequired: reviewer.isRequired });
    }
    return [...byUser.values()];
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

function adoVote(vote: number | undefined): PrReviewVote {
    switch (vote) {
        case 10: return 'approved';
        case 5: return 'approved-with-suggestions';
        case -5: return 'waiting-for-author';
        case -10: return 'rejected';
        default: return 'no-vote';
    }
}

/** Same mapping as forge's ADO adapter. */
function adoMergeability(status: PullRequestAsyncStatus | undefined): PrMergeability {
    switch (status) {
        case PullRequestAsyncStatus.Conflicts: return { state: 'conflicting' };
        case PullRequestAsyncStatus.Succeeded: return { state: 'mergeable' };
        case PullRequestAsyncStatus.RejectedByPolicy:
        case PullRequestAsyncStatus.Failure:
            return { state: 'blocked', blockedReason: 'Provider policy or merge preview failure requires attention' };
        default: return { state: 'unknown' };
    }
}

function sameName(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function adoCandidate(pr: GitPullRequest, webRepoUrl: string): PrCandidate {
    const id = pr.pullRequestId as number;
    const candidate: PrCandidate = {
        id,
        title: pr.title ?? '',
        url: `${webRepoUrl}/pullrequest/${id}`,
        author: toPrAuthor({ id: pr.createdBy?.id, login: pr.createdBy?.uniqueName, displayName: pr.createdBy?.displayName }),
        lifecycle: pr.status === PullRequestStatus.Completed ? 'merged'
            : pr.status === PullRequestStatus.Abandoned ? 'closed' : 'open',
        isDraft: pr.isDraft === true,
        sourceBranch: stripRefsHeads(pr.sourceRefName),
        targetBranch: stripRefsHeads(pr.targetRefName),
    };
    const headSha = pr.lastMergeSourceCommit?.commitId;
    if (headSha) candidate.headSha = headSha;
    return candidate;
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
    let probed: { id?: string; projectId?: string } = {};
    const checks = () => adapter ??= createAdoPullRequestsAdapter({ orgUrl, token, project: identity.project, repo: identity.repo });
    return {
        async probeRepository() {
            let repository: { id?: string; project?: { id?: string } } | null;
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
            probed = { id: repository.id, projectId: repository.project?.id };
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
                .map(pr => adoCandidate(pr, webRepoUrl));
            const next = prs.length >= query.pageSize ? String(skip + prs.length) : undefined;
            return { items, ...(next ? { next } : {}) };
        },
        async loadCi(candidate) {
            // A listed head is required for an authoritative, strict status read.
            if (!candidate.headSha) throw new Error('head commit unknown');
            const service = checks();
            if (!service.getChecks) throw new Error('checks unsupported');
            const result = await service.getChecks(identity.repo, candidate.id, candidate.headSha);
            return summarizeChecks(result.map(check => check.status));
        },
        async getPullRequest(id) {
            const git = await connection.getGitApi();
            // Organization-wide lookup; typed-rest-client resolves a 404 as null.
            const pr = await git.getPullRequestById(id, identity.project);
            if (!pr || typeof pr.pullRequestId !== 'number') throw { statusCode: 404 };
            const repository = pr.repository;
            const inRepository = (sameName(repository?.name, identity.repo) || sameName(repository?.id, probed.id))
                && (sameName(repository?.project?.name, identity.project) || sameName(repository?.project?.id, probed.projectId));
            const candidate = adoCandidate(pr, webRepoUrl);
            const closed = pr.closedDate ? new Date(pr.closedDate) : undefined;
            return {
                candidate,
                description: pr.description ?? '',
                mergeability: adoMergeability(pr.mergeStatus),
                ...(pr.creationDate ? { createdAt: new Date(pr.creationDate) } : {}),
                ...(closed && candidate.lifecycle === 'merged' ? { mergedAt: closed } : {}),
                ...(closed && candidate.lifecycle === 'closed' ? { closedAt: closed } : {}),
                reviews: (pr.reviewers ?? []).map(reviewer => ({
                    reviewer: toPrAuthor({ id: reviewer.id, login: reviewer.uniqueName, displayName: reviewer.displayName }),
                    vote: adoVote(reviewer.vote),
                    isRequired: reviewer.isRequired === true,
                })),
                inRepository,
            };
        },
        async loadReviews(source) {
            return source.reviews ?? [];
        },
        async loadChecks(source) {
            const service = checks();
            if (!service.getChecks || !source.candidate.headSha) throw new Error('head commit unknown');
            return service.getChecks(identity.repo, source.candidate.id, source.candidate.headSha);
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
    return runGetMode(request, client, signal);
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

/** Get-mode limits on returned detail. */
export const MAX_DESCRIPTION_CHARS = 20_000;
export const MAX_CHECKS = 100;
export const MAX_CHECK_DESCRIPTION_CHARS = 500;

function isoDate(value: Date | undefined): string | undefined {
    if (!(value instanceof Date)) return undefined;
    const time = value.getTime();
    // ADO maps a missing date to the epoch; treat it as unknown.
    return Number.isFinite(time) && time > 0 ? value.toISOString() : undefined;
}

function toCheck(check: ProviderPullRequestCheck): PrCheck {
    const out: PrCheck = { name: check.name, status: check.status };
    if (check.group) out.group = check.group;
    if (check.description) out.description = check.description.slice(0, MAX_CHECK_DESCRIPTION_CHARS);
    if (check.detailsUrl) out.detailsUrl = check.detailsUrl;
    const startedAt = isoDate(check.startedAt);
    const completedAt = isoDate(check.completedAt);
    if (startedAt) out.startedAt = startedAt;
    if (completedAt) out.completedAt = completedAt;
    return out;
}

/**
 * A provider failure while reading one PR or one of its parts. Credentials,
 * rate limits and cancellation end the whole call; anything else stays local
 * to that ID (or part).
 */
function classifyItemFailure(err: unknown, provider: PrQueryProvider): { status?: number } {
    if (err instanceof PrQueryError) throw err;
    const status = statusOf(err);
    if (isRateLimited(err, status) || status === 401 || status === 403) {
        throw toPrQueryError(err, provider, 'request');
    }
    return { status };
}

/**
 * Get mode. Each unique ID is fetched once with at most
 * {@link MAX_CONCURRENT_REQUESTS} provider requests in flight; results come
 * back in input order with one entry per input position. Repository-level and
 * credential failures, and cancellation, fail the whole call.
 */
async function runGetMode(
    request: Extract<PrQueryRequest, { mode: 'get' }>,
    client: PrProviderClient,
    signal: AbortSignal | undefined,
): Promise<PrQuerySuccess> {
    const { identity } = request;
    const provider = identity.provider;
    const label = providerLabel(provider);
    const unique = [...new Set(request.ids)];
    const results = new Map<number, PrGetResult>();
    let fatal: PrQueryError | undefined;

    // Throws once the call is cancelled or another ID already failed the whole call.
    const checkpoint = () => {
        throwIfAborted(signal);
        if (fatal) throw fatal;
    };

    const fetchOne = async (id: number): Promise<PrGetResult> => {
        checkpoint();
        let source: PrDetailSource;
        try {
            source = await awaitUnlessAborted(client.getPullRequest(id), signal);
        } catch (err) {
            const { status } = classifyItemFailure(err, provider);
            if (status === 404) {
                return { id, ok: false, error: { code: 'not-found', message: `${label} pull request ${id} was not found in this repository.` } };
            }
            return { id, ok: false, error: { code: 'provider-error', message: `${label} pull request ${id} could not be read${status ? ` (HTTP ${status})` : ''}.` } };
        }
        if (!source.inRepository) {
            return { id, ok: false, error: { code: 'wrong-repository', message: `${label} pull request ${id} belongs to a different repository.` } };
        }

        const unavailable: PrUnavailablePart[] = [];
        const reasons: string[] = [];
        const partFailed = (part: PrUnavailablePart, err: unknown) => {
            const { status } = classifyItemFailure(err, provider);
            unavailable.push(part);
            reasons.push(`${part} could not be read${status ? ` (HTTP ${status})` : ''}`);
        };

        let reviews: PrReview[] | null = null;
        if (source.reviews) {
            reviews = source.reviews;
        } else {
            checkpoint();
            try {
                reviews = await awaitUnlessAborted(client.loadReviews(source), signal);
            } catch (err) {
                partFailed('reviews', err);
            }
        }

        let checks: ProviderPullRequestCheck[] | null = null;
        if (source.candidate.headSha) {
            checkpoint();
            try {
                checks = await awaitUnlessAborted(client.loadChecks(source), signal);
            } catch (err) {
                partFailed('checks', err);
            }
        } else {
            unavailable.push('checks');
            reasons.push('checks could not be read (head commit unknown)');
        }

        const { headSha: _headSha, ...summary } = source.candidate;
        const ci: PrCiSummary = checks
            ? summarizeChecks(checks.map(check => check.status))
            : { state: 'unavailable', reason: 'CI status could not be read.' };
        const description = source.description ?? '';
        const detail: PrDetail = {
            ...toSummary(summary, ci),
            description: description.slice(0, MAX_DESCRIPTION_CHARS),
            descriptionTruncated: description.length > MAX_DESCRIPTION_CHARS,
            mergeability: source.mergeability ?? { state: 'unknown' },
            reviews,
            checks: checks ? checks.slice(0, MAX_CHECKS).map(toCheck) : null,
        };
        if (checks && checks.length > MAX_CHECKS) detail.checksTruncated = true;
        const createdAt = isoDate(source.createdAt);
        const updatedAt = isoDate(source.updatedAt);
        const mergedAt = isoDate(source.mergedAt);
        const closedAt = isoDate(source.closedAt);
        if (createdAt) detail.createdAt = createdAt;
        if (updatedAt) detail.updatedAt = updatedAt;
        if (mergedAt) detail.mergedAt = mergedAt;
        if (closedAt) detail.closedAt = closedAt;
        if (unavailable.length > 0) {
            detail.unavailable = unavailable;
            detail.reason = `${reasons.join('; ')}.`;
        }
        return { id, ok: true, pullRequest: detail };
    };

    // Each worker runs its provider requests one at a time, so at most
    // MAX_CONCURRENT_REQUESTS requests are in flight across the batch.
    let next = 0;
    const worker = async () => {
        while (!fatal && next < unique.length) {
            const id = unique[next++];
            try {
                results.set(id, await fetchOne(id));
            } catch (err) {
                fatal ??= err instanceof PrQueryError ? err : toPrQueryError(err, provider, 'request');
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, unique.length) }, worker));
    throwIfAborted(signal);
    if (fatal) throw fatal;

    return {
        success: true,
        mode: 'get',
        provider,
        repository: identity.repository,
        results: request.ids.map(id => results.get(id) as PrGetResult),
    };
}
