/**
 * Pull Request Routes
 *
 * Registers /api/origins/:originId/pull-requests/* endpoints.
 * Uses ProviderFactory to resolve the correct adapter per repo.
 *
 * GET  /api/origins/:originId/pull-requests          — list PRs through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId    — get single PR through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId/threads    — get comment threads through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId/reviewers  — get reviewers through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId/commits    — get commits through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId/diff       — get unified diff through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId/diff/files/:path — get per-file diff through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/:prId/checks     — get CI/check statuses through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/recent-opened    — list recently opened PRs
 * POST /api/origins/:originId/pull-requests/recent-opened    — record a recently opened PR
 * DELETE /api/origins/:originId/pull-requests/recent-opened/:prNumber — remove stale recent PR
 * GET  /api/origins/:originId/pull-requests/coworker-candidates — search Team roster coworker candidates through an explicit workspace
 * GET  /api/origins/:originId/pull-requests/coworker-roster  — list Team roster coworkers
 * POST /api/origins/:originId/pull-requests/coworker-roster  — add/update a Team roster coworker
 * DELETE /api/origins/:originId/pull-requests/coworker-roster/:coworkerKey — remove a Team roster coworker
 * GET  /api/origins/:originId/pull-requests/:prId/review-progress — get reviewer progress
 * PUT  /api/origins/:originId/pull-requests/:prId/review-progress — save reviewer progress
 * GET  /api/origins/:originId/pull-requests/review-history — get cached review history
 * POST /api/origins/:originId/pull-requests/review-history/refresh — fetch/cache review history through a selected workspace
 * GET  /api/origins/:originId/pull-requests/suggestions — get cached suggestions
 * POST /api/origins/:originId/pull-requests/suggestions/refresh — rank/cache suggestions through a selected workspace
 * POST /api/origins/:originId/pull-requests/team-auto-classification — enqueue bounded Team PR classifications through a selected workspace
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
import { authorMatchesPrTeamRosterEntry, filterPullRequestsByPrTeamRoster, getPrTeamIdentityKey } from '../shared/pr-team-matching';
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
import {
    resolvePullRequestOriginStorageScope,
    resolvePullRequestStorageScope,
    type PullRequestStorageScope,
} from './pr-origin-scope';
import type { RepoInfo } from './types';

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

function parseOptionalScopeValue(
    req: Parameters<Route['handler']>[0],
    body: unknown,
    key: 'workspaceId' | 'repoId',
): string | undefined {
    if (body && typeof body === 'object') {
        const raw = (body as Record<string, unknown>)[key];
        if (typeof raw === 'string' && raw.trim()) {
            return raw.trim();
        }
    }
    const parsed = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    return parsed.searchParams.get(key)?.trim() || undefined;
}

function parseOriginId(raw: string): string | null {
    const originId = decodeURIComponent(raw).trim();
    return originId || null;
}

interface OriginPrStateScope {
    workspaceId: string;
    repoId: string;
    storageScope: PullRequestStorageScope;
}

interface OriginPrRepoScope extends OriginPrStateScope {
    repo: RepoInfo;
}

type OriginPrRepoScopeResult =
    | { ok: true; value: OriginPrRepoScope }
    | { ok: false; status: 400 | 404; message: string };

async function resolveOriginPrStateScope(
    req: Parameters<Route['handler']>[0],
    body: unknown,
    originId: string,
    processStore?: ProcessStore,
): Promise<OriginPrStateScope> {
    const workspaceId = parseOptionalScopeValue(req, body, 'workspaceId') ?? originId;
    const repoId = parseOptionalScopeValue(req, body, 'repoId') ?? workspaceId;
    return {
        workspaceId,
        repoId,
        storageScope: await resolvePullRequestOriginStorageScope({ originId, processStore }),
    };
}

async function resolveOriginPrRepoScope(
    req: Parameters<Route['handler']>[0],
    body: unknown,
    originId: string,
    svc: RepoTreeService,
    processStore?: ProcessStore,
): Promise<OriginPrRepoScopeResult> {
    const workspaceId = parseOptionalScopeValue(req, body, 'workspaceId');
    if (!workspaceId) {
        return {
            ok: false,
            status: 400,
            message: 'workspaceId is required for provider-backed origin pull request actions',
        };
    }

    const repoId = parseOptionalScopeValue(req, body, 'repoId') ?? workspaceId;
    const repo = await svc.resolveRepo(repoId);
    if (!repo) {
        return {
            ok: false,
            status: 404,
            message: `Repo ${repoId} not found`,
        };
    }

    const storageScope = await resolvePrStorageScopeForRoute(svc, processStore, repoId, workspaceId, repo);
    if (storageScope.storageOriginId !== originId) {
        return {
            ok: false,
            status: 400,
            message: `Workspace ${workspaceId} resolves to origin ${storageScope.storageOriginId}, not ${originId}`,
        };
    }

    return {
        ok: true,
        value: {
            workspaceId,
            repoId,
            repo,
            storageScope,
        },
    };
}

function sendOriginPrRepoScopeError(
    res: Parameters<Route['handler']>[1],
    result: Extract<OriginPrRepoScopeResult, { ok: false }>,
): void {
    if (result.status === 404) {
        send404(res, result.message);
        return;
    }
    send400(res, result.message);
}

async function resolvePrStorageScopeForRoute(
    svc: RepoTreeService,
    store: ProcessStore | undefined,
    repoId: string,
    workspaceId: string,
    repo?: RepoInfo,
): Promise<PullRequestStorageScope> {
    const resolvedRepo = repo ?? await svc.resolveRepo(repoId);
    return resolvePullRequestStorageScope({
        workspaceId,
        repoId,
        remoteUrl: resolvedRepo?.remoteUrl,
        rootPath: resolvedRepo?.localPath,
        processStore: store,
    });
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
const PR_TEAM_PER_MEMBER_TOP = 25;
const PR_TEAM_CACHE_TTL_MS = 5 * 60 * 1000;
const PR_COWORKER_CANDIDATE_TTL_MS = 2 * 60 * 1000;
const PR_COWORKER_CANDIDATE_MIN_QUERY_LENGTH = 2;
const PR_COWORKER_CANDIDATE_FETCH_PAGE_SIZE = 100;
const PR_COWORKER_CANDIDATE_MAX_RESULTS = 50;
const PR_COWORKER_CANDIDATE_MAX_PROVIDER_PAGES = 20;

interface PrCacheEntry {
    data: any[];
    fetchedAt: number;
    expiresAt: number;
}

const prListCache = new Map<string, PrCacheEntry>();

interface PullRequestCoworkerCandidate {
    id: string;
    displayName: string;
    login?: string;
    email?: string;
    avatarUrl?: string;
    prCount: number;
    isInRoster?: boolean;
}

interface PrCoworkerCandidateCacheEntry {
    candidates: PullRequestCoworkerCandidate[];
    fetchedAt: number;
    expiresAt: number;
    scannedPullRequests: number;
    truncated: boolean;
}

const prCoworkerCandidateCache = new Map<string, PrCoworkerCandidateCacheEntry>();

interface PullRequestDiffStats {
    additions: number;
    deletions: number;
    changedFiles: number;
}

// Diff stats are derived from provider diffs and cached in memory by
// originId|prId|headSha only. They are never persisted because diffs can contain
// sensitive source content and can be refetched/recomputed.
const prDiffStatsCache = new Map<string, PullRequestDiffStats>();

function makePrCacheKey(cacheScopeId: string, status: string, scope: string): string {
    return `${cacheScopeId}|${status}|${scope}`;
}

function makePrCoworkerCandidateCacheKey(
    repoId: string,
    workspaceId: string,
    normalizedQuery: string,
    status: string,
    scope: string,
): string {
    return `${repoId}|${workspaceId}|${status}|${scope}|${normalizedQuery}`;
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
    cacheScopeId: string,
    status: string,
    scope: 'mine' | 'all',
): Promise<PrCacheEntry> {
    const prSvc = await resolvePullRequestsService(dataDir, svc, repoId);
    let prs = await prSvc.listPullRequests(repoId, { status, top: PR_LIST_FETCH_TOP, scope });
    prs = await enrichPullRequestsWithDiffStats(cacheScopeId, repoId, prs, prSvc);
    const fetchedAt = Date.now();
    const entry = { data: prs, fetchedAt, expiresAt: fetchedAt + PR_LIST_TTL_MS };
    prListCache.set(makePrCacheKey(cacheScopeId, status, scope), entry);
    return entry;
}

// Team scope cache (per-workspace/repo, shorter TTL since it combines per-member fetches)
const teamScopeCache = new Map<string, PrCacheEntry>();

function makeTeamScopeCacheKey(repoId: string, workspaceId: string, status: string): string {
    return `team|${repoId}|${workspaceId}|${status}`;
}

/**
 * Fetch PRs for all team roster members by making per-member queries, then
 * merge with any matching PRs from the all-scope cache. Deduplicates by PR
 * number to produce a complete list of team member PRs.
 */
async function fetchTeamScopePullRequests(
    dataDir: string,
    svc: RepoTreeService,
    repoId: string,
    workspaceId: string,
    status: string,
    roster: readonly { id: string; displayName: string }[],
    allScopePrs: readonly any[],
): Promise<any[]> {
    if (roster.length === 0) return [];

    // Check team-scope cache
    const cacheKey = makeTeamScopeCacheKey(repoId, workspaceId, status);
    const cached = teamScopeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    // Start with team members found in the all-scope cache
    const rosterFiltered = filterPullRequestsByPrTeamRoster(allScopePrs, roster);
    const seenNumbers = new Set<number | string>(
        rosterFiltered.map((pr: any) => getPullRequestProviderId(pr)).filter((id): id is number | string => id != null),
    );

    // Fetch per-member PRs for members that might have PRs outside top 100
    let prSvc: IPullRequestsService;
    try {
        prSvc = await resolvePullRequestsService(dataDir, svc, repoId);
    } catch {
        // If we can't resolve the service, return what we have from the cache
        return rosterFiltered;
    }

    const perMemberResults: any[] = [];
    for (const member of roster) {
        // Prefer login (works with GitHub Search API), fall back to id (works with ADO creatorId)
        const authorId = (member as any).login || member.id || undefined;
        if (!authorId) continue;

        try {
            const memberPrs = await prSvc.listPullRequests(repoId, {
                status,
                top: PR_TEAM_PER_MEMBER_TOP,
                authorId,
            });
            for (const pr of memberPrs) {
                const prId = getPullRequestProviderId(pr);
                if (prId && !seenNumbers.has(prId)) {
                    seenNumbers.add(prId);
                    perMemberResults.push(pr);
                }
            }
        } catch {
            // Best-effort: skip members whose per-author query fails
        }
    }

    // Merge: cached matches first (usually more enriched with diff stats),
    // then supplementary per-member results sorted by updatedAt descending
    const merged = [
        ...rosterFiltered,
        ...perMemberResults.sort((a, b) => {
            const aDate = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
            const bDate = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
            return bDate - aDate;
        }),
    ];

    // Cache the merged team results with a shorter TTL
    const fetchedAt = Date.now();
    teamScopeCache.set(cacheKey, { data: merged, fetchedAt, expiresAt: fetchedAt + PR_TEAM_CACHE_TTL_MS });
    return merged;
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
    const repo = await svc.resolveRepo(options.repoId);
    const prStorageScope = await resolvePrStorageScopeForRoute(svc, options.store, options.repoId, options.workspaceId, repo);
    await refreshPullRequestListCache(options.dataDir, svc, options.repoId, prStorageScope.storageOriginId, 'open', 'mine');
    listRecentOpenedPullRequests(options.dataDir, options.workspaceId, options.repoId, prStorageScope);
    listPullRequestCoworkerRoster(options.dataDir, options.workspaceId, options.repoId, prStorageScope);
    if (options.autoClassifyTeamEnabled === true && options.bridge && options.store) {
        const allOpen = await refreshPullRequestListCache(options.dataDir, svc, options.repoId, prStorageScope.storageOriginId, 'open', 'all');
        await triggerTeamAutoClassification({
            dataDir: options.dataDir,
            store: options.store,
            bridge: options.bridge,
            repoTreeService: svc,
            prepareTaskForEnqueue: options.prepareTaskForEnqueue,
            workspaceId: options.workspaceId,
            repoId: options.repoId,
            pullRequests: allOpen.data,
            storageScope: prStorageScope,
        });
    }
    if (options.suggestionsEnabled) {
        readSuggestionsCache(options.dataDir, options.workspaceId, options.repoId, prStorageScope);
    }
}

/** Clear all cached PR list entries. Exported for testing. */
export function clearPrListCache(): void {
    prListCache.clear();
    prDiffStatsCache.clear();
    prCoworkerCandidateCache.clear();
    teamScopeCache.clear();
}

function normalizeCandidateSearchQuery(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

function parseCandidateTop(raw: unknown): number {
    const value = typeof raw === 'string' && raw.trim() ? Number(raw) : PR_COWORKER_CANDIDATE_MAX_RESULTS;
    if (!Number.isFinite(value) || value <= 0) return PR_COWORKER_CANDIDATE_MAX_RESULTS;
    return Math.min(Math.floor(value), PR_COWORKER_CANDIDATE_MAX_RESULTS);
}

function normalizeAuthorIdentity(author: any): { id: string; displayName: string; login?: string; email?: string; avatarUrl?: string } | undefined {
    if (!author || typeof author !== 'object') return undefined;
    const id = author.id === undefined || author.id === null ? '' : String(author.id).trim();
    const displayName = typeof author.displayName === 'string' ? author.displayName.trim() : '';
    if (!displayName) return undefined;

    const login = typeof author.login === 'string' && author.login.trim() ? author.login.trim() : undefined;
    const email = typeof author.email === 'string' && author.email.trim() ? author.email.trim() : undefined;
    const avatarUrl = typeof author.avatarUrl === 'string' && author.avatarUrl.trim() ? author.avatarUrl.trim() : undefined;
    return {
        id,
        displayName,
        ...(login ? { login } : {}),
        ...(email ? { email } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
    };
}

function authorIdentityMatchesQuery(
    author: { id: string; displayName: string; email?: string },
    normalizedQuery: string,
): boolean {
    return (
        author.displayName.toLowerCase().includes(normalizedQuery) ||
        author.id.toLowerCase().includes(normalizedQuery) ||
        (author.email?.toLowerCase().includes(normalizedQuery) ?? false)
    );
}

function buildPrPageSignature(prs: ProviderPullRequest[]): string {
    if (prs.length === 0) return 'empty';
    const first = getPullRequestProviderId(prs[0]);
    const last = getPullRequestProviderId(prs[prs.length - 1]);
    return `${prs.length}:${first ?? '(missing)'}:${last ?? '(missing)'}`;
}

async function searchPullRequestCoworkerCandidateCache(
    repoId: string,
    workspaceId: string,
    normalizedQuery: string,
    status: string,
    scope: 'mine' | 'all',
    prSvc: IPullRequestsService,
): Promise<PrCoworkerCandidateCacheEntry> {
    const cacheKey = makePrCoworkerCandidateCacheKey(repoId, workspaceId, normalizedQuery, status, scope);
    const cached = prCoworkerCandidateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached;
    }

    const byKey = new Map<string, PullRequestCoworkerCandidate>();
    const pageSignatures = new Set<string>();
    let scannedPullRequests = 0;
    let truncated = false;

    for (let page = 0; page < PR_COWORKER_CANDIDATE_MAX_PROVIDER_PAGES; page++) {
        const skip = page * PR_COWORKER_CANDIDATE_FETCH_PAGE_SIZE;
        const prs = await prSvc.listPullRequests(repoId, {
            status,
            top: PR_COWORKER_CANDIDATE_FETCH_PAGE_SIZE,
            skip,
            scope,
        });
        scannedPullRequests += prs.length;

        const signature = buildPrPageSignature(prs);
        if (pageSignatures.has(signature)) break;
        pageSignatures.add(signature);

        for (const pr of prs) {
            const author = normalizeAuthorIdentity(pr.author);
            if (!author || !authorIdentityMatchesQuery(author, normalizedQuery)) continue;

            const key = getPrTeamIdentityKey(author);
            const existing = byKey.get(key);
            if (existing) {
                existing.prCount += 1;
                if (!existing.login && author.login) existing.login = author.login;
                if (!existing.email && author.email) existing.email = author.email;
                if (!existing.avatarUrl && author.avatarUrl) existing.avatarUrl = author.avatarUrl;
            } else {
                byKey.set(key, { ...author, prCount: 1 });
            }
        }

        if (byKey.size >= PR_COWORKER_CANDIDATE_MAX_RESULTS) {
            truncated = true;
            break;
        }
        if (prs.length < PR_COWORKER_CANDIDATE_FETCH_PAGE_SIZE) {
            break;
        }
        if (page === PR_COWORKER_CANDIDATE_MAX_PROVIDER_PAGES - 1) {
            truncated = true;
        }
    }

    const fetchedAt = Date.now();
    const candidates = Array.from(byKey.values())
        .sort((a, b) => b.prCount - a.prCount || a.displayName.localeCompare(b.displayName))
        .slice(0, PR_COWORKER_CANDIDATE_MAX_RESULTS);
    const entry: PrCoworkerCandidateCacheEntry = {
        candidates,
        fetchedAt,
        expiresAt: fetchedAt + PR_COWORKER_CANDIDATE_TTL_MS,
        scannedPullRequests,
        truncated,
    };
    prCoworkerCandidateCache.set(cacheKey, entry);
    return entry;
}

function getPullRequestProviderId(pr: any): number | string | undefined {
    return pr?.number ?? pr?.id;
}

function normalizePullRequestHeadSha(pr: any): string | undefined {
    const headSha = typeof pr?.headSha === 'string' ? pr.headSha.trim() : '';
    return headSha || undefined;
}

function makePrDiffStatsCacheKey(cacheScopeId: string, pr: any): string | undefined {
    const headSha = normalizePullRequestHeadSha(pr);
    if (!headSha) return undefined;

    const prId = getPullRequestProviderId(pr);
    if (prId == null) return undefined;

    return `${cacheScopeId}|${String(prId)}|${headSha}`;
}

function clearPrDiffStatsCacheEntries(cacheScopeId: string, prId: string): void {
    const prefix = `${cacheScopeId}|${prId}|`;
    for (const key of Array.from(prDiffStatsCache.keys())) {
        if (key.startsWith(prefix)) {
            prDiffStatsCache.delete(key);
        }
    }
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
    cacheScopeId: string,
    repoId: string,
    pr: any,
    prSvc: IPullRequestsService,
): Promise<PullRequestDiffStats | undefined> {
    if (typeof prSvc.getDiff !== 'function') return undefined;

    const prId = getPullRequestProviderId(pr);
    if (prId == null) return undefined;

    const cacheKey = makePrDiffStatsCacheKey(cacheScopeId, pr);
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
    cacheScopeId: string,
    repoId: string,
    prs: any[],
    prSvc: IPullRequestsService,
): Promise<any[]> {
    if (typeof prSvc.getDiff !== 'function') return prs;

    return Promise.all(prs.map(async pr => {
        try {
            const diffStats = await getPullRequestDiffStats(cacheScopeId, repoId, pr, prSvc);
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

function makePrDetailCacheKey(cacheScopeId: string, prId: string): string {
    return `${cacheScopeId}|${prId}`;
}

async function getCachedPullRequestDetail(
    cacheScopeId: string,
    repoId: string,
    prId: string,
    getPullRequest: (repoId: string, prId: string) => Promise<ProviderPullRequest>,
): Promise<ProviderPullRequest> {
    const cacheKey = makePrDetailCacheKey(cacheScopeId, prId);
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
// PR diff cache (in-memory, no TTL)
// ============================================================================

// Provider combined diffs are fetched once per origin/PR/headSha and shared by
// the full diff and per-file diff endpoints. When the current PR head SHA cannot be
// resolved, the cache safely falls back to originId|prId and force-refresh
// invalidation still removes that fallback. Diff contents are never persisted.
const prDiffCache = new Map<string, string>();

function makePrDiffCacheKey(cacheScopeId: string, prId: string, headSha?: string): string {
    const baseKey = `${cacheScopeId}|${prId}`;
    const normalizedHeadSha = headSha?.trim();
    return normalizedHeadSha ? `${baseKey}|${normalizedHeadSha}` : baseKey;
}

/** Clear all cached PR diff entries. Exported for testing. */
export function clearPrDiffCache(): void {
    prDiffCache.clear();
}

/** Clear the cached diff for one specific PR (used by force-refresh). */
function clearPrDiffCacheEntry(cacheScopeId: string, prId: string): void {
    const fallbackKey = makePrDiffCacheKey(cacheScopeId, prId);
    prDiffCache.delete(fallbackKey);
    const headShaKeyPrefix = `${fallbackKey}|`;
    for (const key of Array.from(prDiffCache.keys())) {
        if (key.startsWith(headShaKeyPrefix)) {
            prDiffCache.delete(key);
        }
    }
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
function makePrSubCacheKey(cacheScopeId: string, prId: string): string {
    return `${cacheScopeId}|${prId}`;
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
function clearPrSubCacheEntries(cacheScopeId: string, prId: string): void {
    const key = makePrSubCacheKey(cacheScopeId, prId);
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
    cacheScopeId: string,
    repoId: string,
    prId: string,
    headSha: string | undefined,
    getDiff: (repoId: string, prId: string) => Promise<string>,
): Promise<string> {
    const key = makePrDiffCacheKey(cacheScopeId, prId, headSha);
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

async function resolvePullRequestDetailForDiffCache(
    cacheScopeId: string,
    repoId: string,
    prId: string,
    getPullRequest: (repoId: string, prId: string) => Promise<ProviderPullRequest>,
): Promise<ProviderPullRequest | undefined> {
    try {
        const pr = await getPullRequest(repoId, prId);
        prDetailCache.set(makePrDetailCacheKey(cacheScopeId, prId), {
            data: pr,
            expiresAt: Date.now() + PR_DETAIL_TTL_MS,
        });
        return pr;
    } catch (err) {
        console.warn(`[pr-diff-cache] failed to resolve PR head SHA for repo=${repoId} pr=${prId}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
    }
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
    storageScope?: PullRequestStorageScope;
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

    async function sendPullRequestList(
        req: Parameters<Route['handler']>[0],
        res: Parameters<Route['handler']>[1],
        options: {
            workspaceId: string;
            repoId: string;
            storageScope: PullRequestStorageScope;
        },
    ): Promise<void> {
        const query = url.parse(req.url ?? '', true).query;
        const status = typeof query.status === 'string' ? query.status : 'open';
        const requestedScope = typeof query.scope === 'string' ? query.scope : 'mine';
        const isTeamScope = requestedScope === 'team';
        const providerScope: 'mine' | 'all' = isTeamScope
            ? 'all'
            : (requestedScope === 'mine' || requestedScope === 'all') ? requestedScope : 'mine';
        const top = Math.min(+(query.top ?? 25), 100);
        const skip = +(query.skip ?? 0);
        const force = query.force === 'true';
        const cacheScopeId = options.storageScope.storageOriginId;
        const cacheKey = makePrCacheKey(cacheScopeId, status, providerScope);

        let entry: PrCacheEntry;

        const cached = !force ? prListCache.get(cacheKey) : undefined;
        if (force) prListCache.delete(cacheKey);

        if (cached && cached.expiresAt > Date.now()) {
            entry = cached;
        } else {
            entry = await refreshPullRequestListCache(dataDir, svc, options.repoId, cacheScopeId, status, providerScope);
        }

        let pool = entry.data;
        if (isTeamScope) {
            const roster = listPullRequestCoworkerRoster(dataDir, options.workspaceId, options.repoId, options.storageScope);
            pool = await fetchTeamScopePullRequests(dataDir, svc, options.repoId, options.workspaceId, status, roster, entry.data);
        }

        let page = pool.slice(skip, skip + top);

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
                workspaceId: options.workspaceId,
                repoId: options.repoId,
                pullRequests: page,
                storageScope: options.storageScope,
            });
        }

        sendJson(res, { pullRequests: page, total: isTeamScope ? pool.length : page.length, fetchedAt: entry.fetchedAt });
    }

    async function sendPullRequestDetail(
        req: Parameters<Route['handler']>[0],
        res: Parameters<Route['handler']>[1],
        options: {
            repoId: string;
            prId: string;
            cacheScopeId: string;
        },
    ): Promise<void> {
        const query = url.parse(req.url ?? '', true).query;
        const force = query.force === 'true';
        const cacheKey = makePrDetailCacheKey(options.cacheScopeId, options.prId);

        if (force) {
            prDetailCache.delete(cacheKey);
            clearPrDiffCacheEntry(options.cacheScopeId, options.prId);
            clearPrDiffStatsCacheEntries(options.cacheScopeId, options.prId);
            clearPrSubCacheEntries(options.cacheScopeId, options.prId);
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

        const prSvc = await resolvePullRequestsService(dataDir, svc, options.repoId);
        const pr = await getCachedPullRequestDetail(
            options.cacheScopeId,
            options.repoId,
            options.prId,
            prSvc.getPullRequest.bind(prSvc),
        );
        sendJson(res, pr);
    }

    async function createPullRequestsServiceForRepo(repo: RepoInfo): Promise<IPullRequestsService> {
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

    function sendProviderBackedPrRouteError(res: Parameters<Route['handler']>[1], err: unknown): void {
        if (sendPullRequestRouteError(res, err)) return;
        if (err instanceof Error && (err.message.includes('not found') || err.message.includes('404'))) {
            send404(res, err.message);
        } else if (isAuthError(err)) {
            sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
        } else {
            send500(res, err instanceof Error ? err.message : String(err));
        }
    }

    async function sendPullRequestThreads(
        res: Parameters<Route['handler']>[1],
        options: { repoId: string; prId: string; repo: RepoInfo; cacheScopeId: string },
    ): Promise<void> {
        const cacheKey = makePrSubCacheKey(options.cacheScopeId, options.prId);
        const cached = prThreadsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            console.debug(`[pr-threads-cache] hit key=${cacheKey}`);
            return sendJson(res, cached.data);
        }

        const prSvc = await createPullRequestsServiceForRepo(options.repo);
        const threads = await prSvc.getThreads(options.repoId, options.prId);
        const result = { threads };
        prThreadsCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_THREADS_TTL_MS });
        console.debug(`[pr-threads-cache] set key=${cacheKey}`);
        sendJson(res, result);
    }

    async function sendPullRequestReviewers(
        res: Parameters<Route['handler']>[1],
        options: { repoId: string; prId: string; repo: RepoInfo; cacheScopeId: string },
    ): Promise<void> {
        const cacheKey = makePrSubCacheKey(options.cacheScopeId, options.prId);
        const cached = prReviewersCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            console.debug(`[pr-reviewers-cache] hit key=${cacheKey}`);
            return sendJson(res, cached.data);
        }

        const prSvc = await createPullRequestsServiceForRepo(options.repo);
        const reviewers = await prSvc.getReviewers(options.repoId, options.prId);
        const result = { reviewers };
        prReviewersCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_REVIEWERS_TTL_MS });
        console.debug(`[pr-reviewers-cache] set key=${cacheKey}`);
        sendJson(res, result);
    }

    async function sendPullRequestCommits(
        res: Parameters<Route['handler']>[1],
        options: { repoId: string; prId: string; repo: RepoInfo; cacheScopeId: string },
    ): Promise<void> {
        const cacheKey = makePrSubCacheKey(options.cacheScopeId, options.prId);
        const cached = prCommitsCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            console.debug(`[pr-commits-cache] hit key=${cacheKey}`);
            return sendJson(res, cached.data);
        }

        const prSvc = await createPullRequestsServiceForRepo(options.repo);
        if (typeof prSvc.getCommits !== 'function') {
            return sendJson(res, { commits: [] });
        }

        const commits = await prSvc.getCommits(options.repoId, options.prId);
        const result = { commits };
        prCommitsCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_COMMITS_TTL_MS });
        console.debug(`[pr-commits-cache] set key=${cacheKey}`);
        sendJson(res, result);
    }

    async function sendPullRequestChecks(
        res: Parameters<Route['handler']>[1],
        options: { repoId: string; prId: string; repo: RepoInfo; cacheScopeId: string; force?: boolean },
    ): Promise<void> {
        const cacheKey = makePrSubCacheKey(options.cacheScopeId, options.prId);
        if (options.force) {
            // Smart-poll / manual refresh asks for fresh check statuses, bypassing
            // the 10-min cache (AC-05 force-refresh).
            prChecksCache.delete(cacheKey);
            console.debug(`[pr-checks-cache] bypass key=${cacheKey}`);
        }
        const cached = !options.force ? prChecksCache.get(cacheKey) : undefined;
        if (cached && cached.expiresAt > Date.now()) {
            console.debug(`[pr-checks-cache] hit key=${cacheKey}`);
            return sendJson(res, cached.data);
        }

        const prSvc = await createPullRequestsServiceForRepo(options.repo);
        if (typeof prSvc.getChecks !== 'function') {
            return sendJson(res, { checks: [] });
        }

        const checks = await prSvc.getChecks(options.repoId, options.prId);
        const result = { checks };
        prChecksCache.set(cacheKey, { data: result, expiresAt: Date.now() + PR_CHECKS_TTL_MS });
        console.debug(`[pr-checks-cache] set key=${cacheKey}`);
        sendJson(res, result);
    }

    async function sendPullRequestFileDiff(
        req: Parameters<Route['handler']>[0],
        res: Parameters<Route['handler']>[1],
        options: { repoId: string; prId: string; filePath: string; repo: RepoInfo; cacheScopeId: string },
    ): Promise<void> {
        const query = url.parse(req.url ?? '', true).query;
        const fullContext = query.fullContext === 'true';

        const prSvc = await createPullRequestsServiceForRepo(options.repo);
        if (typeof prSvc.getDiff !== 'function') {
            return sendJson(res, { diff: '' });
        }

        const prData = await resolvePullRequestDetailForDiffCache(
            options.cacheScopeId,
            options.repoId,
            options.prId,
            prSvc.getPullRequest.bind(prSvc),
        );
        const combinedDiff = await getCachedCombinedDiff(
            options.cacheScopeId,
            options.repoId,
            options.prId,
            normalizePullRequestHeadSha(prData),
            prSvc.getDiff.bind(prSvc),
        );
        const fileDiff = extractFileDiffFromCombined(combinedDiff, options.filePath);

        if (fullContext) {
            if (!prData) {
                return sendJson(res, {
                    diff: fileDiff ?? '',
                    fullContextUnavailable: true,
                    fullContextUnavailableReason: 'pr-detail-unavailable',
                });
            }

            let unavailableReason: FullContextUnavailableReason = 'missing-local-path';

            if (options.repo.localPath) {
                const fullCtxDiff = await getFullContextFileDiff(
                    options.repo.localPath,
                    options.repo.remoteUrl ?? 'origin',
                    options.prId,
                    prData,
                    options.filePath,
                );
                unavailableReason = fullCtxDiff.unavailableReason ?? 'git-diff-failed';
                if (fullCtxDiff.diff) {
                    return sendJson(res, { diff: fullCtxDiff.diff, fullContextUnavailable: false });
                }
            }
            return sendJson(res, { diff: fileDiff ?? '', fullContextUnavailable: true, fullContextUnavailableReason: unavailableReason });
        }

        sendJson(res, { diff: fileDiff ?? '' });
    }

    async function sendPullRequestUnifiedDiff(
        res: Parameters<Route['handler']>[1],
        options: { repoId: string; prId: string; repo: RepoInfo; cacheScopeId: string },
    ): Promise<void> {
        const prSvc = await createPullRequestsServiceForRepo(options.repo);
        if (typeof prSvc.getDiff !== 'function') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('');
            return;
        }

        const prData = await resolvePullRequestDetailForDiffCache(
            options.cacheScopeId,
            options.repoId,
            options.prId,
            prSvc.getPullRequest.bind(prSvc),
        );
        const diff = await getCachedCombinedDiff(
            options.cacheScopeId,
            options.repoId,
            options.prId,
            normalizePullRequestHeadSha(prData),
            prSvc.getDiff.bind(prSvc),
        );
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(diff);
    }

    // -- Origin-scoped recent PRs ---------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/recent-opened$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const entries = listRecentOpenedPullRequests(dataDir, workspaceId, repoId, storageScope);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/recent-opened$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');

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

                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, raw, originId, store);
                const entries = recordRecentOpenedPullRequest(dataDir, workspaceId, repoId, validation.entry, undefined, storageScope);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/recent-opened\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const rawPrNumber = decodeURIComponent(match![2]);
                const prNumber = parsePositiveIntegerPathSegment(rawPrNumber);
                if (prNumber === null) {
                    return send400(res, 'prNumber must be a positive integer');
                }

                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const entries = removeRecentOpenedPullRequest(dataDir, workspaceId, repoId, prNumber, storageScope);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Origin-scoped Team roster candidates ---------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/coworker-candidates$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');

                const query = url.parse(req.url ?? '', true).query;
                const rawSearch = normalizeCandidateSearchQuery(query.query);
                if (rawSearch.length < PR_COWORKER_CANDIDATE_MIN_QUERY_LENGTH) {
                    return sendJson(res, {
                        error: `query must be at least ${PR_COWORKER_CANDIDATE_MIN_QUERY_LENGTH} characters`,
                        minimumQueryLength: PR_COWORKER_CANDIDATE_MIN_QUERY_LENGTH,
                    }, 400);
                }

                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { workspaceId, repoId, repo, storageScope } = scopeResult.value;
                const status = typeof query.status === 'string' && query.status.trim() ? query.status.trim() : 'open';
                const scope = typeof query.scope === 'string' && (query.scope === 'mine' || query.scope === 'all') ? query.scope : 'all';
                const top = parseCandidateTop(query.top);
                const includeRoster = query.includeRoster === 'true';
                const normalizedQuery = rawSearch.toLowerCase();
                const prSvc = await createPullRequestsServiceForRepo(repo);
                const cached = await searchPullRequestCoworkerCandidateCache(
                    repoId,
                    workspaceId,
                    normalizedQuery,
                    status,
                    scope,
                    prSvc,
                );
                const roster = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId, storageScope);
                const candidates = cached.candidates
                    .map(candidate => ({
                        ...candidate,
                        isInRoster: roster.some(entry => authorMatchesPrTeamRosterEntry(candidate, entry)),
                    }))
                    .filter(candidate => includeRoster || !candidate.isInRoster)
                    .slice(0, top);

                return sendJson(res, {
                    candidates,
                    total: candidates.length,
                    query: rawSearch,
                    minimumQueryLength: PR_COWORKER_CANDIDATE_MIN_QUERY_LENGTH,
                    fetchedAt: cached.fetchedAt,
                    scannedPullRequests: cached.scannedPullRequests,
                    truncated: cached.truncated,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    // -- Origin-scoped Team roster --------------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/coworker-roster$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const entries = listPullRequestCoworkerRoster(dataDir, workspaceId, repoId, storageScope);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/coworker-roster$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');

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

                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, raw, originId, store);
                const entries = addPullRequestCoworkerToRoster(dataDir, workspaceId, repoId, validation.entry, undefined, storageScope);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/coworker-roster\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const coworkerKey = decodeURIComponent(match![2]).trim();
                if (!coworkerKey) {
                    return send400(res, 'coworkerKey must be a non-empty string');
                }

                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const entries = removePullRequestCoworkerFromRoster(dataDir, workspaceId, repoId, coworkerKey, storageScope);
                return sendJson(res, { entries });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Origin-scoped review progress ----------------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/review-progress$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const parsed = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
                const headSha = parsed.searchParams.get('headSha');
                if (!headSha) {
                    return send400(res, 'Missing required query parameter: headSha');
                }

                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const record = readReviewProgress(dataDir, workspaceId, repoId, prId, headSha, storageScope);
                return sendJson(res, record);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/review-progress$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
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

                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, raw, originId, store);
                const stored = writeReviewProgress(
                    dataDir,
                    workspaceId,
                    repoId,
                    prId,
                    validation.record,
                    undefined,
                    storageScope,
                );
                return sendJson(res, stored);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Origin-scoped review history and suggestions --------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/review-history$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const cached = readReviewHistoryCache(dataDir, workspaceId, repoId, storageScope);
                return sendJson(res, cached ?? { reviews: [], fetchedAt: null });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/review-history\/refresh$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { workspaceId, repoId, repo, storageScope } = scopeResult.value;

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

                const cached = await fetchAndCacheReviewHistory(dataDir, workspaceId, prSvc, repoId, undefined, storageScope);
                return sendJson(res, cached);
            } catch (err) {
                if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/suggestions$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const { workspaceId, repoId, storageScope } = await resolveOriginPrStateScope(req, undefined, originId, store);
                const cached = readSuggestionsCache(dataDir, workspaceId, repoId, storageScope);
                return sendJson(res, cached ?? { suggestions: [], rankedAt: null });
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/suggestions\/refresh$/,
        handler: async (req, res, match) => {
            try {
                if (!aiService) {
                    return sendJson(res, { error: 'AI service not available' }, 503);
                }

                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { workspaceId, repoId, repo, storageScope } = scopeResult.value;

                const history = readReviewHistoryCache(dataDir, workspaceId, repoId, storageScope);
                if (!history || history.reviews.length === 0) {
                    return sendJson(res, { error: 'No review history cached. Refresh review history first.' }, 400);
                }

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

                const cached = await rankAndCacheSuggestions(dataDir, workspaceId, aiService, history, prMetadata, storageScope);
                return sendJson(res, cached);
            } catch (err) {
                if (isAuthError(err)) {
                    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 401);
                } else {
                    send500(res, err instanceof Error ? err.message : String(err));
                }
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/team-auto-classification$/,
        handler: async (req, res, match) => {
            try {
                if (!isTeamAutoClassificationEnabled(autoClassification)) {
                    return sendJson(res, { error: 'Pull Requests Team auto-classification is disabled' }, 403);
                }

                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');

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

                const scopeResult = await resolveOriginPrRepoScope(req, raw, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { workspaceId, repoId, storageScope } = scopeResult.value;
                const result = await autoClassifyTeamPullRequests({
                    dataDir,
                    store: autoClassification!.store,
                    bridge: autoClassification!.bridge,
                    repoTreeService: svc,
                    prepareTaskForEnqueue: autoClassification!.prepareTaskForEnqueue,
                    workspaceId,
                    repoId,
                    pullRequests: validation,
                    storageScope,
                });
                return sendJson(res, result);
            } catch (err) {
                send500(res, err instanceof Error ? err.message : String(err));
            }
        },
    });

    // -- Origin-scoped provider PR subresources -------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/threads$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, repo, storageScope } = scopeResult.value;
                await sendPullRequestThreads(res, {
                    repoId,
                    prId,
                    repo,
                    cacheScopeId: storageScope.storageOriginId,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/reviewers$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, repo, storageScope } = scopeResult.value;
                await sendPullRequestReviewers(res, {
                    repoId,
                    prId,
                    repo,
                    cacheScopeId: storageScope.storageOriginId,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/commits$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, repo, storageScope } = scopeResult.value;
                await sendPullRequestCommits(res, {
                    repoId,
                    prId,
                    repo,
                    cacheScopeId: storageScope.storageOriginId,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/checks$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, repo, storageScope } = scopeResult.value;
                const force = url.parse(req.url ?? '', true).query.force === 'true';
                await sendPullRequestChecks(res, {
                    repoId,
                    prId,
                    repo,
                    cacheScopeId: storageScope.storageOriginId,
                    force,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/diff\/files\/(.+)$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const filePath = decodeURIComponent(match![3]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, repo, storageScope } = scopeResult.value;
                await sendPullRequestFileDiff(req, res, {
                    repoId,
                    prId,
                    filePath,
                    repo,
                    cacheScopeId: storageScope.storageOriginId,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)\/diff$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');
                const prId = decodeURIComponent(match![2]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, repo, storageScope } = scopeResult.value;
                await sendPullRequestUnifiedDiff(res, {
                    repoId,
                    prId,
                    repo,
                    cacheScopeId: storageScope.storageOriginId,
                });
            } catch (err) {
                sendProviderBackedPrRouteError(res, err);
            }
        },
    });

    // -- Origin-scoped provider PR list/detail ---------------------------------

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');

                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { workspaceId, repoId, storageScope } = scopeResult.value;

                await sendPullRequestList(req, res, { workspaceId, repoId, storageScope });
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

    routes.push({
        method: 'GET',
        pattern: /^\/api\/origins\/([^/]+)\/pull-requests\/([^/]+)$/,
        handler: async (req, res, match) => {
            try {
                const originId = parseOriginId(match![1]);
                if (!originId) return send400(res, 'originId must be a non-empty string');

                const prId = decodeURIComponent(match![2]);
                const scopeResult = await resolveOriginPrRepoScope(req, undefined, originId, svc, store);
                if (!scopeResult.ok) return sendOriginPrRepoScopeError(res, scopeResult);
                const { repoId, storageScope } = scopeResult.value;

                await sendPullRequestDetail(req, res, {
                    repoId,
                    prId,
                    cacheScopeId: storageScope.storageOriginId,
                });
            } catch (err) {
                if (sendPullRequestRouteError(res, err)) return;
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
