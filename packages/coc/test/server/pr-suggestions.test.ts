/**
 * Tests for pr-suggestions — review history fetch & cache (AC-01).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    readReviewHistoryCache,
    writeReviewHistoryCache,
    fetchAndCacheReviewHistory,
} from '../../src/server/repos/pr-suggestions';
import type { ReviewHistoryCache } from '../../src/server/repos/pr-suggestions';
import type { IPullRequestsService, ReviewedPullRequest } from '@plusplusoneplusplus/forge';

// ── Fixtures ─────────────────────────────────────────────────

const mockReview: ReviewedPullRequest = {
    number: 42,
    title: 'Add feature X',
    author: { id: 'user1', displayName: 'Alice', email: 'alice@test.com' },
    filesChanged: ['src/index.ts', 'src/utils.ts'],
    labels: ['enhancement'],
    reviewedAt: new Date('2024-06-01T10:00:00Z'),
    targetBranch: 'main',
    url: 'https://github.com/org/repo/pull/42',
};

const mockCache: ReviewHistoryCache = {
    fetchedAt: '2024-06-01T12:00:00.000Z',
    reviews: [
        {
            number: 42,
            title: 'Add feature X',
            author: { id: 'user1', displayName: 'Alice', email: 'alice@test.com' },
            filesChanged: ['src/index.ts', 'src/utils.ts'],
            labels: ['enhancement'],
            reviewedAt: '2024-06-01T10:00:00.000Z',
            targetBranch: 'main',
            url: 'https://github.com/org/repo/pull/42',
        },
    ],
};

// ── Setup / Teardown ─────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-suggestions-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────

describe('readReviewHistoryCache', () => {
    it('returns null when no cache file exists', () => {
        const result = readReviewHistoryCache(tmpDir, 'ws-abc');
        expect(result).toBeNull();
    });

    it('returns null for corrupt JSON', () => {
        const dir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pr-review-history.json'), 'not-json', 'utf-8');
        const result = readReviewHistoryCache(tmpDir, 'ws-abc');
        expect(result).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
        const dir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pr-review-history.json'), '{"foo": "bar"}', 'utf-8');
        const result = readReviewHistoryCache(tmpDir, 'ws-abc');
        expect(result).toBeNull();
    });

    it('reads valid cache from disk', () => {
        const dir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pr-review-history.json'), JSON.stringify(mockCache), 'utf-8');
        const result = readReviewHistoryCache(tmpDir, 'ws-abc');
        expect(result).not.toBeNull();
        expect(result!.reviews).toHaveLength(1);
        expect(result!.reviews[0].number).toBe(42);
        expect(result!.fetchedAt).toBe('2024-06-01T12:00:00.000Z');
    });
});

describe('writeReviewHistoryCache', () => {
    it('creates directories and writes cache', () => {
        writeReviewHistoryCache(tmpDir, 'ws-def', mockCache);
        const filePath = path.join(tmpDir, 'repos', 'ws-def', 'pr-review-history.json');
        expect(fs.existsSync(filePath)).toBe(true);
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(raw.reviews).toHaveLength(1);
        expect(raw.fetchedAt).toBe('2024-06-01T12:00:00.000Z');
    });

    it('overwrites existing cache', () => {
        writeReviewHistoryCache(tmpDir, 'ws-def', mockCache);
        const updated: ReviewHistoryCache = {
            fetchedAt: '2024-07-01T12:00:00.000Z',
            reviews: [],
        };
        writeReviewHistoryCache(tmpDir, 'ws-def', updated);
        const result = readReviewHistoryCache(tmpDir, 'ws-def');
        expect(result!.reviews).toHaveLength(0);
        expect(result!.fetchedAt).toBe('2024-07-01T12:00:00.000Z');
    });
});

describe('fetchAndCacheReviewHistory', () => {
    it('fetches from provider and caches to disk', async () => {
        const mockService: Partial<IPullRequestsService> = {
            listPullRequests: vi.fn(),
            getPullRequest: vi.fn(),
            createPullRequest: vi.fn(),
            updatePullRequest: vi.fn(),
            getThreads: vi.fn(),
            createThread: vi.fn(),
            getReviewers: vi.fn(),
            addReviewers: vi.fn(),
            getReviewedPullRequests: vi.fn().mockResolvedValue([mockReview]),
        };

        const result = await fetchAndCacheReviewHistory(
            tmpDir, 'ws-test', mockService as IPullRequestsService, 'repo-id',
        );

        expect(result.reviews).toHaveLength(1);
        expect(result.reviews[0].number).toBe(42);
        expect(result.reviews[0].author.displayName).toBe('Alice');
        expect(result.reviews[0].filesChanged).toEqual(['src/index.ts', 'src/utils.ts']);
        expect(result.fetchedAt).toBeDefined();

        // Verify it was written to disk
        const cached = readReviewHistoryCache(tmpDir, 'ws-test');
        expect(cached).not.toBeNull();
        expect(cached!.reviews).toHaveLength(1);
    });

    it('throws when provider does not support getReviewedPullRequests', async () => {
        const mockService: Partial<IPullRequestsService> = {
            listPullRequests: vi.fn(),
            getPullRequest: vi.fn(),
            createPullRequest: vi.fn(),
            updatePullRequest: vi.fn(),
            getThreads: vi.fn(),
            createThread: vi.fn(),
            getReviewers: vi.fn(),
            addReviewers: vi.fn(),
        };

        await expect(
            fetchAndCacheReviewHistory(tmpDir, 'ws-test', mockService as IPullRequestsService, 'repo-id'),
        ).rejects.toThrow('Provider does not support fetching reviewed pull requests');
    });

    it('passes top parameter to provider', async () => {
        const getReviewedPullRequests = vi.fn().mockResolvedValue([]);
        const mockService: Partial<IPullRequestsService> = {
            listPullRequests: vi.fn(),
            getPullRequest: vi.fn(),
            createPullRequest: vi.fn(),
            updatePullRequest: vi.fn(),
            getThreads: vi.fn(),
            createThread: vi.fn(),
            getReviewers: vi.fn(),
            addReviewers: vi.fn(),
            getReviewedPullRequests,
        };

        await fetchAndCacheReviewHistory(
            tmpDir, 'ws-test', mockService as IPullRequestsService, 'repo-id', 25,
        );

        expect(getReviewedPullRequests).toHaveBeenCalledWith('repo-id', 25);
    });

    it('serializes Date objects to ISO strings', async () => {
        const review: ReviewedPullRequest = {
            ...mockReview,
            reviewedAt: new Date('2025-03-15T08:30:00Z'),
        };
        const mockService: Partial<IPullRequestsService> = {
            listPullRequests: vi.fn(),
            getPullRequest: vi.fn(),
            createPullRequest: vi.fn(),
            updatePullRequest: vi.fn(),
            getThreads: vi.fn(),
            createThread: vi.fn(),
            getReviewers: vi.fn(),
            addReviewers: vi.fn(),
            getReviewedPullRequests: vi.fn().mockResolvedValue([review]),
        };

        const result = await fetchAndCacheReviewHistory(
            tmpDir, 'ws-test', mockService as IPullRequestsService, 'repo-id',
        );

        expect(result.reviews[0].reviewedAt).toBe('2025-03-15T08:30:00.000Z');
    });
});
