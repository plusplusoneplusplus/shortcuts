/**
 * PR Review Suggestions — Review History Fetch & Cache (AC-01)
 *
 * Fetches the user's last 50 reviewed PRs from the forge provider,
 * caches the result to disk at `~/.coc/repos/<workspaceId>/pr-review-history.json`.
 * Re-fetch only on explicit manual refresh.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import type { IPullRequestsService, ReviewedPullRequest } from '@plusplusoneplusplus/forge';

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
const DEFAULT_TOP = 50;

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

function getHistoryPath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, REVIEW_HISTORY_FILENAME);
}

/**
 * Read cached review history from disk.
 * Returns null if no cache exists or the file is corrupt.
 */
export function readReviewHistoryCache(dataDir: string, workspaceId: string): ReviewHistoryCache | null {
    const filePath = getHistoryPath(dataDir, workspaceId);
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

/**
 * Write review history cache to disk.
 */
export function writeReviewHistoryCache(
    dataDir: string,
    workspaceId: string,
    cache: ReviewHistoryCache,
): void {
    const filePath = getHistoryPath(dataDir, workspaceId);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8');
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
): Promise<ReviewHistoryCache> {
    if (!prService.getReviewedPullRequests) {
        throw new Error('Provider does not support fetching reviewed pull requests');
    }

    const reviews = await prService.getReviewedPullRequests(repositoryId, top);
    const cache: ReviewHistoryCache = {
        fetchedAt: new Date().toISOString(),
        reviews: reviews.map(serializeReview),
    };

    writeReviewHistoryCache(dataDir, workspaceId, cache);
    return cache;
}
