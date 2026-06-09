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
 * GET  /api/repos/:repoId/pull-requests/:prId/diff       — get unified diff (plain text)
 * GET  /api/repos/:repoId/pull-requests/:prId/diff/files/:path — get per-file diff (JSON)
 * GET  /api/repos/:repoId/pull-requests/:prId/checks     — get CI/check statuses
 * GET  /api/repos/:repoId/pull-requests/recent-opened    — list recently opened PRs
 * POST /api/repos/:repoId/pull-requests/recent-opened    — record a recently opened PR
 * DELETE /api/repos/:repoId/pull-requests/recent-opened/:prNumber — remove stale recent PR
 * GET  /api/repos/:repoId/pull-requests/coworker-roster  — list Team roster coworkers
 * POST /api/repos/:repoId/pull-requests/coworker-roster  — add/update a Team roster coworker
 * DELETE /api/repos/:repoId/pull-requests/coworker-roster/:coworkerKey — remove a Team roster coworker
 * POST /api/repos/:repoId/pull-requests/team-auto-classification — enqueue bounded Team PR classifications
 * GET  /api/repos/:repoId/pull-requests/:prId/review-progress — get reviewer progress (AC-04)
 * PUT  /api/repos/:repoId/pull-requests/:prId/review-progress — save reviewer progress (AC-04)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { sendJson, send404, send400, send500, readJsonBody } from '../router';
import { RepoTreeService } from './tree-service';
import {
    readReviewProgress,
    writeReviewProgress,
    validateReviewProgressInput,
} from './review-progress-store';
import {
    listRecentOpenedPullRequests,
    recordRecentOpenedPullRequest,
    removeRecentOpenedPullRequest,
    validateRecentOpenedPullRequestInput,
} from './recent-opened-pr-store';
import {
    addPullRequestCoworkerToRoster,
    listPullRequestCoworkerRoster,
    removePullRequestCoworkerFromRoster,
    validatePullRequestCoworkerRosterInput,
} from './pr-coworker-roster-store';
import { ProviderFactory } from '../providers/provider-factory';
import type { AdoNoCredentialsSentinel } from '../providers/provider-factory';
import { readProvidersConfig } from '../providers/providers-config';
import { computeSummary, parseFullDiff } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput, IPullRequestsService, ISDKService, ProcessStore, ProviderPullRequest } from '@plusplusoneplusplus/forge';
import { readReviewHistoryCache, fetchAndCacheReviewHistory, readSuggestionsCache, rankAndCacheSuggestions, toPrMetadata } from './pr-suggestions';
import {
    autoClassifyTeamPullRequests,
    type TeamAutoClassifiablePullRequest,
} from './pr-team-auto-classification';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the diff text for a single file from a combined unified diff.
 * Returns the raw diff section (from `diff --git` to the next `diff --git` or EOF).
 */
function extractFileDiffFromCombined(combinedDiff: string, filePath: string): string | null {
    const lines = combinedDiff.split('\n');
    let capturing = false;
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
            if (capturing) break;
            const body = line.slice('diff --git '.length);
            const bIdx = body.lastIndexOf(' b/');
            const path = bIdx !== -1 ? body.slice(bIdx + 3) : '';
            if (path === filePath) {
                capturing = true;
                result.push(line);
            }
        } else if (capturing) {
            result.push(line);
        }
    }

    return result.length > 0 ? result.join('\n') : null;
}

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

function parseWorkspaceId(req: Parameters<Route['handler']>[0], body: unknown, repoId: string): string {
    if (body && typeof body === 'object') {
        const raw = (body as Record<string, unknown>).workspaceId;
        if (typeof raw === 'string' && raw.trim()) {
            return raw.trim();
        }
    }
    const parsed = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    return parsed.searchParams.get('workspaceId')?.trim() || repoId;
}

function parseTeamAutoClassificationPullRequests(raw: unknown): TeamAutoClassifiablePullRequest[] | string {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return 'Body must be an object';
    }
    const pullRequests = (raw as Record<string, unknown>).pullRequests;
    if (!Array.isArray(pullRequests)) {
        return 'pullRequests must be an array';
    }
    if (pullRequests.length > 200) {
        return 'pullRequests must contain at most 200 entries';
    }

    const parsed: TeamAutoClassifiablePullRequest[] = [];
    for (const [index, value] of pullRequests.entries()) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return `pullRequests[${index}] must be an object`;
        }
        const item = value as Record<string, unknown>;
        const author = item.author && typeof item.author === 'object' && !Array.isArray(item.author)
            ? item.author as Record<string, unknown>
            : undefined;
        const number = typeof item.number === 'number' || typeof item.number === 'string'
            ? item.number
            : undefined;
        const status = typeof item.status === 'string' ? item.status : undefined;
        const headSha = typeof item.headSha === 'string' ? item.headSha : undefined;
        const authorId = typeof author?.id === 'number' || typeof author?.id === 'string'
            ? author.id
            : undefined;
        const displayName = typeof author?.displayName === 'string' ? author.displayName : undefined;

        parsed.push({
            ...(number !== undefined ? { number } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(headSha !== undefined ? { headSha } : {}),
            ...(author ? { author: { ...(authorId !== undefined ? { id: authorId } : {}), ...(displayName !== undefined ? { displayName } : {}) } } : {}),
        });
    }
    return parsed;
}

function parsePositiveIntegerPathSegment(raw: string): number | null {
    if (!/^\d+$/.test(raw)) return null;
    const number = Number(raw);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// ============================================================================
// PR list cache (in-memory, 60-min TTL)
// ============================================================================

const PR_LIST_TTL_MS = 60 * 60 * 1000;
const PR_LIST_FETCH_TOP = 100;

interface PrCacheEntry {
    data: any[];
    fetchedAt: number;
    expiresAt: number;
}

const prListCache = new Map<string, PrCacheEntry>();

interface PullRequestDiffStats {
    additions: number;
    deletions: number;
    changedFiles: number;
}

const prDiffStatsCache = new Map<string, PullRequestDiffStats>();

function makePrCacheKey(repoId: string, status: string, scope: string): string {
    return `${repoId}|${status}|${scope}`;
}

class PullRequestRouteError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
        readonly body?: unknown,
    ) {
        super(message);
        this.name = 'PullRequestRouteError';
    }
}

function sendPullRequestRouteError(res: Parameters<Route['handler']>[1], err: unknown): boolean {
    if (!(err instanceof PullRequestRouteError)) {
        return false;
    }
    if (err.statusCode === 404) {
        send404(res, err.message);
        return true;
    }
    sendJson(res, err.body ?? { error: err.message }, err.statusCode);
    return true;
}

async function resolvePullRequestsService(
    dataDir: string,
    svc: RepoTreeService,
    repoId: string,
): Promise<IPullRequestsService> {
    const repo = await svc.resolveRepo(repoId);
    if (!repo) {
        throw new PullRequestRouteError(404, `Repo ${repoId} not found`);
    }

    const cfg = await readProvidersConfig(dataDir);
    const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
    if (!prSvc || isNoAdoCredentials(prSvc)) {
        if (isNoAdoCredentials(prSvc)) {
            throw new PullRequestRouteError(401, 'no-ado-credentials', { error: 'no-ado-credentials' });
        }
        const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
        throw new PullRequestRouteError(401, 'unconfigured', { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl });
    }

    return prSvc;
}

async function refreshPullRequestListCache(
    dataDir: string,
    svc: RepoTreeService,
    repoId: string,
    status: string,
    scope: 'mine' | 'all',
): Promise<PrCacheEntry> {
    const prSvc = await resolvePullRequestsService(dataDir, svc, repoId);
    let prs = await prSvc.listPullRequests(repoId, { status, top: PR_LIST_FETCH_TOP, scope });
    prs = await enrichPullRequestsWithDiffStats(repoId, prs, prSvc);
    const fetchedAt = Date.now();
    const entry = { data: prs, fetchedAt, expiresAt: fetchedAt + PR_LIST_TTL_MS };
    prListCache.set(makePrCacheKey(repoId, status, scope), entry);
    return entry;
}

export interface WarmPullRequestWorkspaceCacheOptions {
    dataDir: string;
    workspaceId: string;
    repoId: string;
    store?: ProcessStore;
    bridge?: MultiRepoQueueRouter;
    service?: RepoTreeService;
    suggestionsEnabled?: boolean;
    autoClassifyTeamEnabled?: boolean;
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>;
}

export async function warmPullRequestWorkspaceCache(options: WarmPullRequestWorkspaceCacheOptions): Promise<void> {
    const svc = options.service ?? new RepoTreeService(options.dataDir);
    await refreshPullRequestListCache(options.dataDir, svc, options.repoId, 'open', 'mine');
    listRecentOpenedPullRequests(options.dataDir, options.workspaceId, options.repoId);
    listPullRequestCoworkerRoster(options.dataDir, options.workspaceId, options.repoId);
    if (options.autoClassifyTeamEnabled === true && options.bridge && options.store) {
        const allOpen = await refreshPullRequestListCache(options.dataDir, svc, options.repoId, 'open', 'all');
        await triggerTeamAutoClassification({
            dataDir: options.dataDir,
            store: options.store,
            bridge: options.bridge,
            repoTreeService: svc,
            prepareTaskForEnqueue: options.prepareTaskForEnqueue,
            workspaceId: options.workspaceId,
            repoId: options.repoId,
            pullRequests: allOpen.data,
        });
    }
    if (options.suggestionsEnabled) {
        readSuggestionsCache(options.dataDir, options.repoId);
    }
}

/** Clear all cached PR list entries. Exported for testing. */
export function clearPrListCache(): void {
    prListCache.clear();
    prDiffStatsCache.clear();
}

function getPullRequestProviderId(pr: any): number | string | undefined {
    return pr?.number ?? pr?.id;
}

function makePrDiffStatsCacheKey(repoId: string, pr: any): string | undefined {
    const headSha = typeof pr?.headSha === 'string' ? pr.headSha.trim() : '';
    if (!headSha) return undefined;

    const prId = getPullRequestProviderId(pr);
    if (prId == null) return undefined;

    return `${repoId}|${String(prId)}|${headSha}`;
}

function buildPullRequestDiffStats(diff: string): PullRequestDiffStats {
    const { files } = parseFullDiff(diff);
    const summary = computeSummary(files);
    return {
        additions: summary.additions,
        deletions: summary.deletions,
        changedFiles: summary.filesChanged,
    };
}

async function getPullRequestDiffStats(
    repoId: string,
    pr: any,
    prSvc: IPullRequestsService,
): Promise<PullRequestDiffStats | undefined> {
    if (typeof prSvc.getDiff !== 'function') return undefined;

    const prId = getPullRequestProviderId(pr);
    if (prId == null) return undefined;

    const cacheKey = makePrDiffStatsCacheKey(repoId, pr);
    const cached = cacheKey ? prDiffStatsCache.get(cacheKey) : undefined;
    if (cached) return cached;

    const diff = await prSvc.getDiff(repoId, prId);
    const stats = buildPullRequestDiffStats(diff);
    if (cacheKey) {
        prDiffStatsCache.set(cacheKey, stats);
    }
    return stats;
}

async function enrichPullRequestsWithDiffStats(
    repoId: string,
    prs: any[],
    prSvc: IPullRequestsService,
): Promise<any[]> {
    if (typeof prSvc.getDiff !== 'function') return prs;

    return Promise.all(prs.map(async pr => {
        try {
            const diffStats = await getPullRequestDiffStats(repoId, pr, prSvc);
            return diffStats ? { ...pr, diffStats } : pr;
        } catch (err) {
            const prId = getPullRequestProviderId(pr);
            console.warn(
                `[pr-list] failed to load diff stats for repo=${repoId} pr=${prId ?? '(unknown)'}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return pr;
        }
    }));
}

// ============================================================================
// PR detail cache (in-memory, 10-min TTL)
// ============================================================================

const PR_DETAIL_TTL_MS = 10 * 60 * 1000;

interface PrDetailCacheEntry {
    data: any;
    expiresAt: number;
}

const prDetailCache = new Map<string, PrDetailCacheEntry>();

function makePrDetailCacheKey(repoId: string, prId: string): string {
    return `${repoId}|${prId}`;
}

async function getCachedPullRequestDetail(
    repoId: string,
    prId: string,
    getPullRequest: (repoId: string, prId: string) => Promise<ProviderPullRequest>,
): Promise<ProviderPullRequest> {
    const cacheKey = makePrDetailCacheKey(repoId, prId);
    const cached = prDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        console.debug(`[pr-detail-cache] hit key=${cacheKey}`);
        return cached.data as ProviderPullRequest;
    }

    if (cached) {
        console.debug(`[pr-detail-cache] expired key=${cacheKey}`);
    } else {
        console.debug(`[pr-detail-cache] miss key=${cacheKey}`);
    }

    const pr = await getPullRequest(repoId, prId);
    prDetailCache.set(cacheKey, { data: pr, expiresAt: Date.now() + PR_DETAIL_TTL_MS });
    console.debug(`[pr-detail-cache] set key=${cacheKey}`);
    return pr;
}

/** Clear all cached PR detail entries (and all sub-endpoint caches). Exported for testing. */
export function clearPrDetailCache(): void {
    prDetailCache.clear();
    prThreadsCache.clear();
    prCommitsCache.clear();
    prReviewersCache.clear();
    prChecksCache.clear();
}

// ============================================================================
// PR diff cache (in-memory, no TTL — invalidated by PR force-refresh only)
// ============================================================================

// Keyed by repoId|prId. No TTL: the combined diff for a PR is stable until
// the reviewer explicitly refreshes (force=true on the detail endpoint).

const prDiffCache = new Map<string, string>();

function makePrDiffCacheKey(repoId: string, prId: string): string {
    return `${repoId}|${prId}`;
}

/** Clear all cached PR diff entries. Exported for testing. */
export function clearPrDiffCache(): void {
    prDiffCache.clear();
}

/** Clear the cached diff for one specific PR (used by force-refresh). */
function clearPrDiffCacheEntry(repoId: string, prId: string): void {
    prDiffCache.delete(makePrDiffCacheKey(repoId, prId));
}

// ============================================================================
// PR sub-endpoint caches (threads/commits/reviewers/checks)
// ============================================================================

const PR_THREADS_TTL_MS  = 10 * 60 * 1000;
const PR_COMMITS_TTL_MS  = 30 * 60 * 1000;
const PR_REVIEWERS_TTL_MS = 30 * 60 * 1000;
const PR_CHECKS_TTL_MS   = 10 * 60 * 1000;

interface PrSubCacheEntry {
    data: any;
    expiresAt: number;
}

const prThreadsCache   = new Map<string, PrSubCacheEntry>();
const prCommitsCache   = new Map<string, PrSubCacheEntry>();
const prReviewersCache = new Map<string, PrSubCacheEntry>();
const prChecksCache    = new Map<string, PrSubCacheEntry>();

/** Cache key for per-PR sub-endpoint caches — same format as detail cache. */
function makePrSubCacheKey(repoId: string, prId: string): string {
    return `${repoId}|${prId}`;
}

/** Clear all cached PR threads entries. Exported for testing. */
export function clearPrThreadsCache(): void {
    prThreadsCache.clear();
}

/** Clear all cached PR commits entries. Exported for testing. */
export function clearPrCommitsCache(): void {
    prCommitsCache.clear();
}

/** Clear all cached PR reviewers entries. Exported for testing. */
export function clearPrReviewersCache(): void {
    prReviewersCache.clear();
}

/** Clear all cached PR checks entries. Exported for testing. */
export function clearPrChecksCache(): void {
    prChecksCache.clear();
}

/** Evict all per-PR sub-endpoint cache entries for one PR (used by force-refresh). */
function clearPrSubCacheEntries(repoId: string, prId: string): void {
    const key = makePrSubCacheKey(repoId, prId);
    prThreadsCache.delete(key);
    prCommitsCache.delete(key);
    prReviewersCache.delete(key);
    prChecksCache.delete(key);
}

type FullContextUnavailableReason =
    | 'pr-detail-unavailable'
    | 'missing-pr-shas'
    | 'missing-local-path'
    | 'git-diff-failed'
    | 'git-fetch-failed';

interface FullContextDiffResult {
    diff: string | null;
    unavailableReason?: FullContextUnavailableReason;
}

const execFileAsync = promisify(execFile);

function isMissingCommitError(err: unknown): boolean {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return message.includes('bad object')
        || message.includes('unknown revision')
        || message.includes('ambiguous argument')
        || message.includes('invalid object')
        || message.includes('needed a single revision')
        || message.includes('not a valid object name');
}

async function runGit(localPath: string, args: string[], timeout = 10_000): Promise<string> {
    const { stdout } = await execFileAsync(
        'git',
        args,
        { cwd: localPath, encoding: 'utf-8', timeout },
    );
    return stdout;
}

async function hasGitCommit(localPath: string, sha: string): Promise<boolean> {
    try {
        await runGit(localPath, ['cat-file', '-e', `${sha}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

function pushUnique(values: string[], value: string | undefined): void {
    const trimmed = value?.trim();
    if (trimmed && !values.includes(trimmed)) {
        values.push(trimmed);
    }
}

function buildFetchCandidates(prId: string, prData: ProviderPullRequest, missingBase: boolean, missingHead: boolean): string[] {
    const candidates: string[] = [];
    if (missingBase) {
        pushUnique(candidates, prData.baseSha);
        pushUnique(candidates, prData.targetBranch);
        pushUnique(candidates, prData.targetBranch ? `refs/heads/${prData.targetBranch}` : undefined);
    }

    if (missingHead) {
        pushUnique(candidates, prData.headSha);
        pushUnique(candidates, prData.sourceBranch);
        pushUnique(candidates, prData.sourceBranch ? `refs/heads/${prData.sourceBranch}` : undefined);
        pushUnique(candidates, `refs/pull/${prId}/head`);
    }

    return candidates;
}

async function fetchMissingPrCommits(
    localPath: string,
    remote: string,
    prId: string,
    prData: ProviderPullRequest,
): Promise<boolean> {
    const baseSha = prData.baseSha;
    const headSha = prData.headSha;
    if (!baseSha || !headSha) return false;

    let missingBase = !(await hasGitCommit(localPath, baseSha));
    let missingHead = !(await hasGitCommit(localPath, headSha));
    if (!missingBase && !missingHead) return true;

    const candidates = buildFetchCandidates(prId, prData, missingBase, missingHead);
    for (const candidate of candidates) {
        try {
            await runGit(localPath, ['fetch', '--no-tags', '--quiet', remote, candidate], 30_000);
        } catch (err) {
            console.warn(`[pr-full-context] failed to fetch ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
        }

        missingBase = !(await hasGitCommit(localPath, baseSha));
        missingHead = !(await hasGitCommit(localPath, headSha));
        if (!missingBase && !missingHead) return true;
    }

    return false;
}

/**
 * Attempt to produce a full-file-context diff by running `git diff -U99999`
 * with the PR's base and head SHAs against the local repo checkout. When the
 * SHAs are missing locally, fetch PR refs/commits into the requested repo
 * without checking out branches or modifying the working tree.
 */
async function getFullContextFileDiff(
    localPath: string,
    remote: string,
    prId: string,
    prData: ProviderPullRequest,
    filePath: string,
): Promise<FullContextDiffResult> {
    const baseSha = prData.baseSha;
    const headSha = prData.headSha;
    if (!baseSha || !headSha) {
        return { diff: null, unavailableReason: 'missing-pr-shas' };
    }

    try {
        const stdout = await runGit(localPath, ['diff', '-U99999', baseSha, headSha, '--', filePath]);
        return { diff: stdout || null, unavailableReason: stdout ? undefined : 'git-diff-failed' };
    } catch (err) {
        if (!isMissingCommitError(err)) {
            console.warn(`[pr-full-context] git diff failed before fetch: ${err instanceof Error ? err.message : String(err)}`);
            return { diff: null, unavailableReason: 'git-diff-failed' };
        }
    }

    const fetched = await fetchMissingPrCommits(localPath, remote, prId, prData);
    if (!fetched) {
        return { diff: null, unavailableReason: 'git-fetch-failed' };
    }

    try {
        const stdout = await runGit(localPath, ['diff', '-U99999', baseSha, headSha, '--', filePath]);
        return { diff: stdout || null, unavailableReason: stdout ? undefined : 'git-diff-failed' };
    } catch (err) {
        console.warn(`[pr-full-context] git diff failed after fetch: ${err instanceof Error ? err.message : String(err)}`);
        return { diff: null, unavailableReason: 'git-diff-failed' };
    }
}

/**
 * Return the combined diff for a PR, fetching it once and caching the result.
 * Both the full-diff and per-file-diff endpoints call this so only one
 * provider round-trip occurs per PR per cache lifetime.
 */
async function getCachedCombinedDiff(
    repoId: string,
    prId: string,
    getDiff: (repoId: string, prId: string) => Promise<string>,
): Promise<string> {
    const key = makePrDiffCacheKey(repoId, prId);
    const hit = prDiffCache.get(key);
    if (hit !== undefined) {
        console.debug(`[pr-diff-cache] hit key=${key}`);
        return hit;
    }
    console.debug(`[pr-diff-cache] miss key=${key}`);
    const diff = await getDiff(repoId, prId);
    prDiffCache.set(key, diff);
    console.debug(`[pr-diff-cache] set key=${key}`);
    return diff;
}

// ============================================================================
// Auto-classification
// ============================================================================

export interface PullRequestAutoClassificationOptions {
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>;
    getEnabled?: () => boolean;
}

interface TriggerTeamAutoClassificationOptions {
    dataDir: string;
    store: ProcessStore;
    bridge: MultiRepoQueueRouter;
    repoTreeService?: RepoTreeService;
    prepareTaskForEnqueue?: (input: CreateTaskInput) => Promise<void>;
    workspaceId: string;
    repoId: string;
    pullRequests: readonly TeamAutoClassifiablePullRequest[];
}

async function triggerTeamAutoClassification(options: TriggerTeamAutoClassificationOptions): Promise<void> {
    try {
        const result = await autoClassifyTeamPullRequests(options);
        if (result.errors.length > 0) {
            const first = result.errors[0];
            console.warn(
                `[pr-auto-classify-team] ${result.errors.length} enqueue error(s) for workspace=${options.workspaceId} repo=${options.repoId}; first=${first.identifier ?? '(unknown)'}: ${first.message}`,
            );
        }
    } catch (err) {
        console.warn(
            `[pr-auto-classify-team] failed for workspace=${options.workspaceId} repo=${options.repoId}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

function isTeamAutoClassificationEnabled(options?: PullRequestAutoClassificationOptions): boolean {
    if (!options) return false;
    try {
        return options.getEnabled?.() === true;
    } catch (err) {
        console.warn(`[pr-auto-classify-team] failed to read config gate: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
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
export function registerPrRoutes(
    routes: Route[],
    dataDir: string,
    service?: RepoTreeService,
    store?: ProcessStore,
    aiService?: ISDKService,
    autoClassification?: PullRequestAutoClassificationOptions,
): void {
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
                const workspaceId = typeof query.workspaceId === 'string' && query.workspaceId.trim()
                    ? query.workspaceId.trim()
                    : repoId;
                const cacheKey = makePrCacheKey(repoId, status, scope);

                let entry: PrCacheEntry;

                // Serve from cache if valid and not forced
                const cached = !force ? prListCache.get(cacheKey) : undefined;
                if (force) prListCache.delete(cacheKey);

                if (cached && cached.expiresAt > Date.now()) {
                    entry = cached;
                } else {
                    entry = await refreshPullRequestListCache(dataDir, svc, repoId, status, scope);
                }

                // Apply in-memory pagination
                let page = entry.data.slice(skip, skip + top);

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

                if (isTeamAutoClassificationEnabled(autoClassification)) {
                    await triggerTeamAutoClassification({
                        dataDir,
                        store: autoClassification!.store,
                        bridge: autoClassification!.bridge,
                        repoTreeService: svc,
                        prepareTaskForEnqueue: autoClassification!.prepareTaskForEnqueue,
                        workspaceId,
                        repoId,
                        pullRequests: page,
                    });
                }

                sendJson(res, { pullRequests: page, total: page.length, fetchedAt: entry.fetchedAt });
            } catch (err) {
                if (sendPullRequestRouteError(res, err)) return;
                if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get review history (cached) ------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/review-history$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cached = readReviewHistoryCache(dataDir, repoId);
                if (cached) {
                    sendJson(res, cached);
                } else {
                    sendJson(res, { reviews: [], fetchedAt: null });
                }
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Refresh review history (fetch from provider & cache) -----------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/review-history\/refresh$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
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

                if (typeof prSvc.getReviewedPullRequests !== 'function') {
                    return sendJson(res, { error: 'Provider does not support review history' }, 501);
                }

                const cached = await fetchAndCacheReviewHistory(dataDir, repoId, prSvc, repoId);
                sendJson(res, cached);
            } catch (err) {
                if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- Get cached suggestions -----------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/suggestions$/,
        handler: async (_req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const cached = readSuggestionsCache(dataDir, repoId);
                if (cached) {
                    sendJson(res, cached);
                } else {
                    sendJson(res, { suggestions: [], rankedAt: null });
                }
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Refresh suggestions (LLM ranking) ------------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/suggestions\/refresh$/,
        handler: async (_req, res, match) => {
            try {
                if (!aiService) {
                    return sendJson(res, { error: 'AI service not available' }, 503);
                }

                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                // Need review history first
                const history = readReviewHistoryCache(dataDir, repoId);
                if (!history || history.reviews.length === 0) {
                    return sendJson(res, { error: 'No review history cached. Refresh review history first.' }, 400);
                }

                // Fetch current open PRs
                const cfg = await readProvidersConfig(dataDir);
                const prSvc = await ProviderFactory.createPullRequestsService(repo.remoteUrl ?? '', cfg);
                if (!prSvc || isNoAdoCredentials(prSvc)) {
                    if (isNoAdoCredentials(prSvc)) {
                        return sendJson(res, { error: 'no-ado-credentials' }, 401);
                    }
                    const detected = ProviderFactory.detectProviderType(repo.remoteUrl ?? '');
                    return sendJson(res, { error: 'unconfigured', detected, remoteUrl: repo.remoteUrl }, 401);
                }

                const openPrs = await prSvc.listPullRequests(repoId, { status: 'open', top: 100, scope: 'all' });
                const prMetadata = openPrs.map(toPrMetadata);

                const cached = await rankAndCacheSuggestions(dataDir, repoId, aiService, history, prMetadata);
                sendJson(res, cached);
            } catch (err) {
                if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    // -- List recently opened PRs ---------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/recent-opened$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const workspaceId = parseWorkspaceId(req, undefined, repoId);
                const entries = listRecentOpenedPullRequests(dataDir, workspaceId, repoId);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Record recently opened PR --------------------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/recent-opened$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                let raw: unknown;
                try {
                    raw = await readJsonBody<unknown>(req);
                } catch {
                    return send400(res, 'Invalid JSON body');
                }

                const validation = validateRecentOpenedPullRequestInput(raw);
                if (!validation.ok) {
                    return send400(res, validation.error);
                }

                const workspaceId = parseWorkspaceId(req, raw, repoId);
                const entries = recordRecentOpenedPullRequest(dataDir, workspaceId, repoId, validation.entry);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Remove stale recently opened PR --------------------------------------

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/recent-opened\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const rawPrNumber = decodeURIComponent(match![2]);
                const prNumber = parsePositiveIntegerPathSegment(rawPrNumber);
                if (prNumber === null) {
                    return send400(res, 'prNumber must be a positive integer');
                }

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const workspaceId = parseWorkspaceId(req, undefined, repoId);
                const entries = removeRecentOpenedPullRequest(dataDir, workspaceId, repoId, prNumber);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- List Team roster coworkers -------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/coworker-roster$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const workspaceId = parseWorkspaceId(req, undefined, repoId);
                const entries = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Add/update Team roster coworker ---------------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/coworker-roster$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                let raw: unknown;
                try {
                    raw = await readJsonBody<unknown>(req);
                } catch {
                    return send400(res, 'Invalid JSON body');
                }

                const validation = validatePullRequestCoworkerRosterInput(raw);
                if (!validation.ok) {
                    return send400(res, validation.error);
                }

                const workspaceId = parseWorkspaceId(req, raw, repoId);
                const entries = addPullRequestCoworkerToRoster(dataDir, workspaceId, repoId, validation.entry);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Remove Team roster coworker ------------------------------------------

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/coworker-roster\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const coworkerKey = decodeURIComponent(match![2]).trim();
                if (!coworkerKey) {
                    return send400(res, 'coworkerKey must be a non-empty string');
                }

                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                const workspaceId = parseWorkspaceId(req, undefined, repoId);
                const entries = removePullRequestCoworkerFromRoster(dataDir, workspaceId, repoId, coworkerKey);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Trigger bounded Team auto-classification ------------------------------

    routes.push({
        method: 'POST',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/team-auto-classification$/,
        handler: async (req, res, match) => {
            try {
                if (!isTeamAutoClassificationEnabled(autoClassification)) {
                    return sendJson(res, { error: 'Pull Requests Team auto-classification is disabled' }, 403);
                }

                const repoId = decodeURIComponent(match![1]);
                const repo = await svc.resolveRepo(repoId);
                if (!repo) return send404(res, `Repo ${repoId} not found`);

                let raw: unknown;
                try {
                    raw = await readJsonBody<unknown>(req);
                } catch {
                    return send400(res, 'Invalid JSON body');
                }

                const validation = parseTeamAutoClassificationPullRequests(raw);
                if (typeof validation === 'string') {
                    return send400(res, validation);
                }

                const workspaceId = parseWorkspaceId(req, raw, repoId);
                const result = await autoClassifyTeamPullRequests({
                    dataDir,
                    store: autoClassification!.store,
                    bridge: autoClassification!.bridge,
                    repoTreeService: svc,
                    prepareTaskForEnqueue: autoClassification!.prepareTaskForEnqueue,
                    workspaceId,
                    repoId,
                    pullRequests: validation,
                });
                return sendJson(res, result);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Get single PR --------------------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);
                const query = url.parse(req.url ?? '', true).query;
                const force = query.force === 'true';
                const cacheKey = makePrDetailCacheKey(repoId, prId);

                // Serve from cache if valid and not forced
                if (force) {
                    prDetailCache.delete(cacheKey);
                    // Also evict the diff cache so the next diff request refetches.
                    clearPrDiffCacheEntry(repoId, prId);
                    // Evict all sub-endpoint caches for this PR.
                    clearPrSubCacheEntries(repoId, prId);
                    console.debug(`[pr-detail-cache] bypass key=${cacheKey}`);
                }

                const cached = !force ? prDetailCache.get(cacheKey) : undefined;
                if (cached && cached.expiresAt > Date.now()) {
                    console.debug(`[pr-detail-cache] hit key=${cacheKey}`);
                    return sendJson(res, cached.data);
                }

                if (!cached) {
                    console.debug(`[pr-detail-cache] miss key=${cacheKey}`);
                }

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

                const pr = await getCachedPullRequestDetail(repoId, prId, prSvc.getPullRequest.bind(prSvc));
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
                const cacheKey = makePrSubCacheKey(repoId, prId);

                const cached = prThreadsCache.get(cacheKey);
                if (cached && cached.expiresAt > Date.now()) {
                    console.debug(`[pr-threads-cache] hit key=${cacheKey}`);
                    return sendJson(res, cached.data);
                }

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
                const result = { threads };
                prThreadsCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_THREADS_TTL_MS });
                console.debug(`[pr-threads-cache] set key=${cacheKey}`);
                sendJson(res, result);
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
                const cacheKey = makePrSubCacheKey(repoId, prId);

                const cached = prReviewersCache.get(cacheKey);
                if (cached && cached.expiresAt > Date.now()) {
                    console.debug(`[pr-reviewers-cache] hit key=${cacheKey}`);
                    return sendJson(res, cached.data);
                }

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
                const result = { reviewers };
                prReviewersCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_REVIEWERS_TTL_MS });
                console.debug(`[pr-reviewers-cache] set key=${cacheKey}`);
                sendJson(res, result);
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
                const cacheKey = makePrSubCacheKey(repoId, prId);

                const cached = prCommitsCache.get(cacheKey);
                if (cached && cached.expiresAt > Date.now()) {
                    console.debug(`[pr-commits-cache] hit key=${cacheKey}`);
                    return sendJson(res, cached.data);
                }

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
                const result = { commits };
                prCommitsCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_COMMITS_TTL_MS });
                console.debug(`[pr-commits-cache] set key=${cacheKey}`);
                sendJson(res, result);
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
                const cacheKey = makePrSubCacheKey(repoId, prId);

                const cached = prChecksCache.get(cacheKey);
                if (cached && cached.expiresAt > Date.now()) {
                    console.debug(`[pr-checks-cache] hit key=${cacheKey}`);
                    return sendJson(res, cached.data);
                }

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
                const result = { checks };
                prChecksCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_CHECKS_TTL_MS });
                console.debug(`[pr-checks-cache] set key=${cacheKey}`);
                sendJson(res, result);
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

    // -- Get per-file diff (extracted from combined) ----------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/diff\/files\/(.+)$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);
                const filePath = decodeURIComponent(match![3]);
                const query = url.parse(req.url ?? '', true).query;
                const fullContext = query.fullContext === 'true';

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
                    return sendJson(res, { diff: '' });
                }

                const combinedDiff = await getCachedCombinedDiff(
                    repoId,
                    prId,
                    prSvc.getDiff.bind(prSvc),
                );
                const fileDiff = extractFileDiffFromCombined(combinedDiff, filePath);

                if (fullContext) {
                    let prData: ProviderPullRequest;
                    try {
                        prData = await getCachedPullRequestDetail(repoId, prId, prSvc.getPullRequest.bind(prSvc));
                    } catch (err) {
                        console.warn(`[pr-full-context] failed to load PR detail: ${err instanceof Error ? err.message : String(err)}`);
                        return sendJson(res, {
                            diff: fileDiff ?? '',
                            fullContextUnavailable: true,
                            fullContextUnavailableReason: 'pr-detail-unavailable',
                        });
                    }

                    let unavailableReason: FullContextUnavailableReason = 'missing-local-path';

                    if (repo.localPath) {
                        const fullCtxDiff = await getFullContextFileDiff(
                            repo.localPath,
                            repo.remoteUrl ?? 'origin',
                            prId,
                            prData,
                            filePath,
                        );
                        unavailableReason = fullCtxDiff.unavailableReason ?? 'git-diff-failed';
                        if (fullCtxDiff.diff) {
                            return sendJson(res, { diff: fullCtxDiff.diff, fullContextUnavailable: false });
                        }
                    }
                    return sendJson(res, { diff: fileDiff ?? '', fullContextUnavailable: true, fullContextUnavailableReason: unavailableReason });
                }

                sendJson(res, { diff: fileDiff ?? '' });
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

                const diff = await getCachedCombinedDiff(
                    repoId,
                    prId,
                    prSvc.getDiff.bind(prSvc),
                );
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

    // -- Get PR review progress (AC-04) ---------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/review-progress$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);
                const parsed = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const headSha = parsed.searchParams.get('headSha');
                const workspaceIdParam = parsed.searchParams.get('workspaceId');
                if (!headSha) {
                    return send400(res, 'Missing required query parameter: headSha');
                }
                const workspaceId = workspaceIdParam || repoId;
                const record = readReviewProgress(dataDir, workspaceId, repoId, prId, headSha);
                return sendJson(res, record);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Put PR review progress (AC-04) ---------------------------------------

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/repos\/([^/]+)\/pull-requests\/([^/]+)\/review-progress$/,
        handler: async (req, res, match) => {
            try {
                const repoId = decodeURIComponent(match![1]);
                const prId = decodeURIComponent(match![2]);

                let raw: unknown;
                try {
                    raw = await readJsonBody<unknown>(req);
                } catch {
                    return send400(res, 'Invalid JSON body');
                }

                const validation = validateReviewProgressInput(raw);
                if (!validation.ok) {
                    return send400(res, validation.error);
                }

                // workspaceId may travel in body OR query (body wins). Defaults to repoId.
                const bodyObj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
                const workspaceIdRaw = typeof bodyObj.workspaceId === 'string' && bodyObj.workspaceId.length > 0
                    ? bodyObj.workspaceId
                    : (() => {
                        const parsed = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                        return parsed.searchParams.get('workspaceId') ?? '';
                    })();
                const workspaceId = workspaceIdRaw || repoId;

                const stored = writeReviewProgress(
                    dataDir,
                    workspaceId,
                    repoId,
                    prId,
                    validation.record,
                );
                return sendJson(res, stored);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });
}
