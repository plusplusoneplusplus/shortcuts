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
import { resolveAdoAccessTokenValue } from '@plusplusoneplusplus/forge';
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

// ── provider clients ─────────────────────────────────────────

/** Provider operations bound to one repository and one credential. */
export interface PrProviderClient {
    /** Resolves when the repository exists and is visible; throws a {@link PrQueryError} otherwise. */
    probeRepository(): Promise<void>;
}

export type CreatePrProviderClient = (identity: PrRepositoryIdentity) => Promise<PrProviderClient>;

/** Production client factory: resolves this server's credentials for the caller-named repository. */
export function createPrProviderClientFactory(dataDir: string): CreatePrProviderClient {
    return async (identity) => identity.provider === 'github'
        ? createGitHubClient(dataDir, identity)
        : createAdoClient(dataDir, identity);
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
    };
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
    throw new PrQueryError('provider-unavailable',
        `${request.mode === 'query' ? 'Query' : 'Get'} mode is not available on this server yet.`);
}
