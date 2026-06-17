/**
 * PR Review Suggestions — Review History & LLM-Based Ranking (AC-01 + AC-02)
 *
 * AC-01: Fetches the user's last 50 reviewed PRs from the forge provider,
 * caches the result to disk at `~/.coc/repos/<originId>/pr-review-history.json`.
 * Re-fetch only on explicit manual refresh.
 *
 * AC-02: Sends cached review history + current open PR metadata to an LLM,
 * which returns a ranked top-5 list of suggested PRs. The ranking is cached
 * to disk at `~/.coc/repos/<originId>/pr-suggestions-cache.json` and
 * persists across server restarts. Re-ranked only on manual refresh.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import type { IPullRequestsService, ReviewedPullRequest, ISDKService, ProviderPullRequest } from '@plusplusoneplusplus/forge';
import {
    isPullRequestOriginScoped,
    resolvePullRequestLegacyScopes,
    resolvePullRequestStorageId,
    type PullRequestStorageScopeInput,
} from './pr-origin-scope';

// ── Types ────────────────────────────────────────────────────

export interface ReviewHistoryCache {
    /** ISO timestamp of when the history was fetched. */
    fetchedAt: string;
    /** The cached review history entries. */
    reviews: SerializedReviewedPullRequest[];
}

/** JSON-safe version of ReviewedPullRequest (dates as ISO strings). */
export interface SerializedReviewedPullRequest {
    number: number;
    title: string;
    author: { id: string; displayName: string; email?: string; avatarUrl?: string };
    filesChanged: string[];
    labels: string[];
    reviewedAt: string;
    targetBranch: string;
    url: string;
}

// ── Constants ────────────────────────────────────────────────

const REVIEW_HISTORY_FILENAME = 'pr-review-history.json';
const SUGGESTIONS_CACHE_FILENAME = 'pr-suggestions-cache.json';
const DEFAULT_TOP = 50;
const SUGGESTION_COUNT = 5;

// ── Serialization ────────────────────────────────────────────

function serializeReview(r: ReviewedPullRequest): SerializedReviewedPullRequest {
    return {
        number: r.number,
        title: r.title,
        author: {
            id: r.author.id,
            displayName: r.author.displayName,
            email: r.author.email,
            avatarUrl: r.author.avatarUrl,
        },
        filesChanged: r.filesChanged,
        labels: r.labels,
        reviewedAt: r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : String(r.reviewedAt),
        targetBranch: r.targetBranch,
        url: r.url,
    };
}

// ── File I/O ─────────────────────────────────────────────────

function getHistoryPath(dataDir: string, workspaceId: string, scope?: PullRequestStorageScopeInput): string {
    return getRepoDataPath(dataDir, resolvePullRequestStorageId(workspaceId, scope), REVIEW_HISTORY_FILENAME);
}

/**
 * Read cached review history from disk.
 * Returns null if no cache exists or the file is corrupt.
 */
function readReviewHistoryCacheFile(filePath: string): ReviewHistoryCache | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.reviews) && typeof parsed.fetchedAt === 'string') {
            return parsed as ReviewHistoryCache;
        }
        return null;
    } catch {
        return null;
    }
}

function writeJsonCacheFile<T>(filePath: string, cache: T): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

function migrateReviewHistoryCache(
    dataDir: string,
    workspaceId: string,
    repoId: string | undefined,
    scope?: PullRequestStorageScopeInput,
): void {
    if (!repoId || !isPullRequestOriginScoped(workspaceId, scope)) return;

    const targetPath = getHistoryPath(dataDir, workspaceId, scope);
    const target = readReviewHistoryCacheFile(targetPath);
    let newest = target;
    let shouldWrite = false;
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = getHistoryPath(dataDir, legacy.workspaceId);
        if (legacyPath === targetPath) continue;
        const candidate = readReviewHistoryCacheFile(legacyPath);
        if (!candidate) continue;
        if (!newest || candidate.fetchedAt > newest.fetchedAt) {
            newest = candidate;
            shouldWrite = true;
        }
    }

    if (newest && (!target || shouldWrite)) {
        writeJsonCacheFile(targetPath, newest);
    }
}

export function readReviewHistoryCache(
    dataDir: string,
    workspaceId: string,
    repoId?: string,
    scope?: PullRequestStorageScopeInput,
): ReviewHistoryCache | null {
    migrateReviewHistoryCache(dataDir, workspaceId, repoId, scope);
    return readReviewHistoryCacheFile(getHistoryPath(dataDir, workspaceId, scope));
}

/**
 * Write review history cache to disk.
 */
export function writeReviewHistoryCache(
    dataDir: string,
    workspaceId: string,
    cache: ReviewHistoryCache,
    scope?: PullRequestStorageScopeInput,
): void {
    writeJsonCacheFile(getHistoryPath(dataDir, workspaceId, scope), cache);
}

// ── Fetch & Cache ────────────────────────────────────────────

/**
 * Fetch review history from the forge provider and cache it to disk.
 * Returns the cached data. Throws if the provider doesn't support review history.
 */
export async function fetchAndCacheReviewHistory(
    dataDir: string,
    workspaceId: string,
    prService: IPullRequestsService,
    repositoryId: string,
    top: number = DEFAULT_TOP,
    scope?: PullRequestStorageScopeInput,
): Promise<ReviewHistoryCache> {
    if (!prService.getReviewedPullRequests) {
        throw new Error('Provider does not support fetching reviewed pull requests');
    }

    const reviews = await prService.getReviewedPullRequests(repositoryId, top);
    const cache: ReviewHistoryCache = {
        fetchedAt: new Date().toISOString(),
        reviews: reviews.map(serializeReview),
    };

    writeReviewHistoryCache(dataDir, workspaceId, cache, scope);
    return cache;
}

// ══════════════════════════════════════════════════════════════
// AC-02: LLM-Based Ranking
// ══════════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────────

export interface PrSuggestion {
    /** PR number from the forge provider. */
    prNumber: number;
    /** LLM-assigned relevance score (0–100). */
    score: number;
}

export interface SuggestionsCache {
    /** ISO timestamp of when the ranking was generated. */
    rankedAt: string;
    /** Ordered list of top-5 suggestions (highest score first). */
    suggestions: PrSuggestion[];
}

/** Minimal PR metadata sent to the LLM for ranking. */
export interface PrMetadataForRanking {
    number: number;
    title: string;
    description: string;
    author: { id: string; displayName: string };
    filesChanged: string[];
    reviewers: { id: string; displayName: string }[];
    labels: string[];
}

// ── File I/O ─────────────────────────────────────────────────

function getSuggestionsPath(dataDir: string, workspaceId: string, scope?: PullRequestStorageScopeInput): string {
    return getRepoDataPath(dataDir, resolvePullRequestStorageId(workspaceId, scope), SUGGESTIONS_CACHE_FILENAME);
}

/**
 * Read cached PR suggestions from disk.
 * Returns null if no cache exists or the file is corrupt.
 */
function readSuggestionsCacheFile(filePath: string): SuggestionsCache | null {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.suggestions) && typeof parsed.rankedAt === 'string') {
            return parsed as SuggestionsCache;
        }
        return null;
    } catch {
        return null;
    }
}

function migrateSuggestionsCache(
    dataDir: string,
    workspaceId: string,
    repoId: string | undefined,
    scope?: PullRequestStorageScopeInput,
): void {
    if (!repoId || !isPullRequestOriginScoped(workspaceId, scope)) return;

    const targetPath = getSuggestionsPath(dataDir, workspaceId, scope);
    const target = readSuggestionsCacheFile(targetPath);
    let newest = target;
    let shouldWrite = false;
    for (const legacy of resolvePullRequestLegacyScopes(workspaceId, repoId, scope)) {
        const legacyPath = getSuggestionsPath(dataDir, legacy.workspaceId);
        if (legacyPath === targetPath) continue;
        const candidate = readSuggestionsCacheFile(legacyPath);
        if (!candidate) continue;
        if (!newest || candidate.rankedAt > newest.rankedAt) {
            newest = candidate;
            shouldWrite = true;
        }
    }

    if (newest && (!target || shouldWrite)) {
        writeJsonCacheFile(targetPath, newest);
    }
}

export function readSuggestionsCache(
    dataDir: string,
    workspaceId: string,
    repoId?: string,
    scope?: PullRequestStorageScopeInput,
): SuggestionsCache | null {
    migrateSuggestionsCache(dataDir, workspaceId, repoId, scope);
    return readSuggestionsCacheFile(getSuggestionsPath(dataDir, workspaceId, scope));
}

/**
 * Write PR suggestions cache to disk.
 */
export function writeSuggestionsCache(
    dataDir: string,
    workspaceId: string,
    cache: SuggestionsCache,
    scope?: PullRequestStorageScopeInput,
): void {
    writeJsonCacheFile(getSuggestionsPath(dataDir, workspaceId, scope), cache);
}

// ── Prompt Building ──────────────────────────────────────────

/**
 * Convert review history into a compact summary for the LLM prompt.
 */
function summarizeReviewHistory(reviews: SerializedReviewedPullRequest[]): string {
    if (reviews.length === 0) return 'No review history available.';

    const authorCounts = new Map<string, number>();
    const directoryCounts = new Map<string, number>();

    for (const review of reviews) {
        const authorName = review.author.displayName;
        authorCounts.set(authorName, (authorCounts.get(authorName) ?? 0) + 1);

        for (const filePath of review.filesChanged) {
            const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.';
            directoryCounts.set(dir, (directoryCounts.get(dir) ?? 0) + 1);
        }
    }

    const topAuthors = [...authorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => `  - ${name} (${count} reviews)`)
        .join('\n');

    const topDirs = [...directoryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([dir, count]) => `  - ${dir} (${count} files)`)
        .join('\n');

    return [
        `Total reviewed PRs: ${reviews.length}`,
        '',
        'Top authors reviewed for:',
        topAuthors,
        '',
        'Frequently reviewed directories:',
        topDirs,
    ].join('\n');
}

/**
 * Format open PR metadata for the LLM prompt.
 */
function formatOpenPrs(prs: PrMetadataForRanking[]): string {
    if (prs.length === 0) return 'No open PRs.';

    return prs.map(pr => [
        `PR #${pr.number}: ${pr.title}`,
        `  Author: ${pr.author.displayName}`,
        `  Files: ${pr.filesChanged.slice(0, 20).join(', ')}${pr.filesChanged.length > 20 ? ` (+${pr.filesChanged.length - 20} more)` : ''}`,
        `  Reviewers: ${pr.reviewers.map(r => r.displayName).join(', ') || 'none'}`,
        `  Labels: ${pr.labels.join(', ') || 'none'}`,
        pr.description ? `  Description: ${pr.description.substring(0, 200)}${pr.description.length > 200 ? '...' : ''}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');
}

/**
 * Build the full LLM prompt for ranking PRs.
 * Exported for testing.
 */
export function buildRankingPrompt(
    history: SerializedReviewedPullRequest[],
    openPrs: PrMetadataForRanking[],
): string {
    const historySummary = summarizeReviewHistory(history);
    const prsList = formatOpenPrs(openPrs);

    return [
        'You are a code review recommendation engine. Based on a developer\'s past review history, rank which of the currently open pull requests they are most likely to want to review.',
        '',
        '## Review History',
        historySummary,
        '',
        '## Open Pull Requests',
        prsList,
        '',
        `## Task`,
        `Select the top ${SUGGESTION_COUNT} pull requests this developer would most likely review, based on:`,
        '- Authors they frequently review for',
        '- File paths and directories they frequently touch',
        '- Labels and areas that match their review patterns',
        '',
        `Return ONLY a JSON array of exactly ${SUGGESTION_COUNT} objects (or fewer if there are fewer open PRs), each with:`,
        '- "prNumber": the PR number',
        '- "score": a relevance score from 0 to 100 (highest = most relevant)',
        '',
        'Ordered by score descending. Return ONLY the JSON array, no explanation.',
        '',
        'Example: [{"prNumber": 42, "score": 95}, {"prNumber": 17, "score": 80}]',
    ].join('\n');
}

// ── LLM Response Parsing ─────────────────────────────────────

/**
 * Parse the LLM response into a list of PR suggestions.
 * Exported for testing.
 */
export function parseSuggestionsResponse(raw: string): PrSuggestion[] {
    // Extract JSON array from the response (may be wrapped in markdown code blocks)
    const jsonMatch = raw.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
        throw new Error('No JSON array found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
        throw new Error('LLM response is not a JSON array');
    }

    const suggestions: PrSuggestion[] = [];
    for (const item of parsed) {
        if (typeof item.prNumber === 'number' && typeof item.score === 'number') {
            suggestions.push({
                prNumber: item.prNumber,
                score: Math.max(0, Math.min(100, item.score)),
            });
        }
    }

    return suggestions
        .sort((a, b) => b.score - a.score)
        .slice(0, SUGGESTION_COUNT);
}

// ── Convert PullRequest → PrMetadataForRanking ───────────────

/**
 * Convert a forge PullRequest to the minimal metadata shape needed for ranking.
 */
export function toPrMetadata(pr: ProviderPullRequest): PrMetadataForRanking {
    return {
        number: pr.number,
        title: pr.title,
        description: pr.description ?? '',
        author: { id: pr.author.id, displayName: pr.author.displayName },
        filesChanged: [],  // Files are not included in list response; populated separately if available
        reviewers: (pr.reviewers ?? []).map(r => ({ id: r.identity.id, displayName: r.identity.displayName })),
        labels: pr.labels ?? [],
    };
}

// ── Rank & Cache ─────────────────────────────────────────────

/**
 * Use the LLM to rank open PRs based on review history, then cache the result.
 * Called only on user-triggered refresh.
 */
export async function rankAndCacheSuggestions(
    dataDir: string,
    workspaceId: string,
    aiService: ISDKService,
    reviewHistory: ReviewHistoryCache,
    openPrs: PrMetadataForRanking[],
    scope?: PullRequestStorageScopeInput,
): Promise<SuggestionsCache> {
    if (openPrs.length === 0) {
        const cache: SuggestionsCache = {
            rankedAt: new Date().toISOString(),
            suggestions: [],
        };
        writeSuggestionsCache(dataDir, workspaceId, cache, scope);
        return cache;
    }

    const prompt = buildRankingPrompt(reviewHistory.reviews, openPrs);
    const result = await aiService.transform(prompt, { model: 'gpt-4.1', timeoutMs: 30_000 });
    if (!result.success) {
        throw new Error(result.error || 'AI PR suggestion ranking failed');
    }
    const suggestions = parseSuggestionsResponse(result.text);

    const cache: SuggestionsCache = {
        rankedAt: new Date().toISOString(),
        suggestions,
    };

    writeSuggestionsCache(dataDir, workspaceId, cache, scope);
    return cache;
}
