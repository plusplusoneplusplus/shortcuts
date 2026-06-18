/**
 * Tests for pr-suggestions — review history fetch & cache (AC-01)
 * and LLM-based ranking (AC-02).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    readReviewHistoryCache,
    writeReviewHistoryCache,
    fetchAndCacheReviewHistory,
    readSuggestionsCache,
    writeSuggestionsCache,
    buildRankingPrompt,
    parseSuggestionsResponse,
    rankAndCacheSuggestions,
    toPrMetadata,
} from '../../src/server/repos/pr-suggestions';
import type { ReviewHistoryCache, SuggestionsCache, PrMetadataForRanking, SerializedReviewedPullRequest } from '../../src/server/repos/pr-suggestions';
import type { IPullRequestsService, ReviewedPullRequest, CopilotSDKService } from '@plusplusoneplusplus/forge';

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

const originScope = {
    storageOriginId: 'gh_org_repo',
    legacyScopes: [{ workspaceId: 'ws-abc', repoId: 'repo-abc' }],
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

    it('migrates legacy workspace cache into origin storage on read', () => {
        const legacyDir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'pr-review-history.json'), JSON.stringify(mockCache), 'utf-8');

        const result = readReviewHistoryCache(tmpDir, 'ws-abc', 'repo-abc', originScope);

        expect(result?.reviews).toHaveLength(1);
        const originFile = path.join(tmpDir, 'repos', 'gh_org_repo', 'pr-review-history.json');
        expect(fs.existsSync(originFile)).toBe(true);
        expect(JSON.parse(fs.readFileSync(originFile, 'utf-8')).reviews).toHaveLength(1);
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

    it('writes origin-scoped cache when a storage scope is supplied', () => {
        writeReviewHistoryCache(tmpDir, 'ws-abc', mockCache, originScope);

        expect(fs.existsSync(path.join(tmpDir, 'repos', 'ws-abc', 'pr-review-history.json'))).toBe(false);
        const filePath = path.join(tmpDir, 'repos', 'gh_org_repo', 'pr-review-history.json');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(filePath, 'utf-8')).reviews).toHaveLength(1);
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

// ══════════════════════════════════════════════════════════════
// AC-02: LLM-Based Ranking Tests
// ══════════════════════════════════════════════════════════════

const mockSerializedReview: SerializedReviewedPullRequest = {
    number: 42,
    title: 'Add feature X',
    author: { id: 'user1', displayName: 'Alice', email: 'alice@test.com' },
    filesChanged: ['src/index.ts', 'src/utils.ts'],
    labels: ['enhancement'],
    reviewedAt: '2024-06-01T10:00:00.000Z',
    targetBranch: 'main',
    url: 'https://github.com/org/repo/pull/42',
};

const mockOpenPr: PrMetadataForRanking = {
    number: 100,
    title: 'Fix bug in parser',
    description: 'Fixes a critical parsing error',
    author: { id: 'user1', displayName: 'Alice' },
    filesChanged: ['src/parser.ts', 'src/utils.ts'],
    reviewers: [{ id: 'user2', displayName: 'Bob' }],
    labels: ['bug'],
};

const mockSuggestionsCache: SuggestionsCache = {
    rankedAt: '2024-06-01T14:00:00.000Z',
    suggestions: [
        { prNumber: 100, score: 95 },
        { prNumber: 101, score: 80 },
    ],
};

describe('readSuggestionsCache', () => {
    it('returns null when no cache file exists', () => {
        const result = readSuggestionsCache(tmpDir, 'ws-abc');
        expect(result).toBeNull();
    });

    it('returns null for corrupt JSON', () => {
        const dir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pr-suggestions-cache.json'), 'not-json', 'utf-8');
        expect(readSuggestionsCache(tmpDir, 'ws-abc')).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
        const dir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pr-suggestions-cache.json'), '{"foo": "bar"}', 'utf-8');
        expect(readSuggestionsCache(tmpDir, 'ws-abc')).toBeNull();
    });

    it('reads valid cache from disk', () => {
        const dir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pr-suggestions-cache.json'), JSON.stringify(mockSuggestionsCache), 'utf-8');
        const result = readSuggestionsCache(tmpDir, 'ws-abc');
        expect(result).not.toBeNull();
        expect(result!.suggestions).toHaveLength(2);
        expect(result!.suggestions[0].prNumber).toBe(100);
        expect(result!.suggestions[0].score).toBe(95);
        expect(result!.rankedAt).toBe('2024-06-01T14:00:00.000Z');
    });

    it('migrates legacy workspace suggestions into origin storage on read', () => {
        const legacyDir = path.join(tmpDir, 'repos', 'ws-abc');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'pr-suggestions-cache.json'), JSON.stringify(mockSuggestionsCache), 'utf-8');

        const result = readSuggestionsCache(tmpDir, 'ws-abc', 'repo-abc', originScope);

        expect(result?.suggestions).toHaveLength(2);
        const originFile = path.join(tmpDir, 'repos', 'gh_org_repo', 'pr-suggestions-cache.json');
        expect(fs.existsSync(originFile)).toBe(true);
        expect(JSON.parse(fs.readFileSync(originFile, 'utf-8')).suggestions).toHaveLength(2);
    });
});

describe('writeSuggestionsCache', () => {
    it('creates directories and writes cache', () => {
        writeSuggestionsCache(tmpDir, 'ws-def', mockSuggestionsCache);
        const filePath = path.join(tmpDir, 'repos', 'ws-def', 'pr-suggestions-cache.json');
        expect(fs.existsSync(filePath)).toBe(true);
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(raw.suggestions).toHaveLength(2);
        expect(raw.rankedAt).toBe('2024-06-01T14:00:00.000Z');
    });

    it('writes origin-scoped suggestions when a storage scope is supplied', () => {
        writeSuggestionsCache(tmpDir, 'ws-abc', mockSuggestionsCache, originScope);

        expect(fs.existsSync(path.join(tmpDir, 'repos', 'ws-abc', 'pr-suggestions-cache.json'))).toBe(false);
        const filePath = path.join(tmpDir, 'repos', 'gh_org_repo', 'pr-suggestions-cache.json');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(filePath, 'utf-8')).suggestions).toHaveLength(2);
    });

    it('overwrites existing cache', () => {
        writeSuggestionsCache(tmpDir, 'ws-def', mockSuggestionsCache);
        const updated: SuggestionsCache = {
            rankedAt: '2024-07-01T14:00:00.000Z',
            suggestions: [],
        };
        writeSuggestionsCache(tmpDir, 'ws-def', updated);
        const result = readSuggestionsCache(tmpDir, 'ws-def');
        expect(result!.suggestions).toHaveLength(0);
        expect(result!.rankedAt).toBe('2024-07-01T14:00:00.000Z');
    });
});

describe('buildRankingPrompt', () => {
    it('includes review history summary in prompt', () => {
        const prompt = buildRankingPrompt([mockSerializedReview], [mockOpenPr]);
        expect(prompt).toContain('Review History');
        expect(prompt).toContain('Alice');
        expect(prompt).toContain('src');
    });

    it('includes open PR metadata in prompt', () => {
        const prompt = buildRankingPrompt([mockSerializedReview], [mockOpenPr]);
        expect(prompt).toContain('PR #100');
        expect(prompt).toContain('Fix bug in parser');
        expect(prompt).toContain('Bob');
        expect(prompt).toContain('bug');
    });

    it('handles empty review history', () => {
        const prompt = buildRankingPrompt([], [mockOpenPr]);
        expect(prompt).toContain('No review history available');
    });

    it('handles empty open PRs', () => {
        const prompt = buildRankingPrompt([mockSerializedReview], []);
        expect(prompt).toContain('No open PRs');
    });

    it('truncates long file lists', () => {
        const manyFiles = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
        const pr: PrMetadataForRanking = { ...mockOpenPr, filesChanged: manyFiles };
        const prompt = buildRankingPrompt([], [pr]);
        expect(prompt).toContain('+5 more');
    });

    it('truncates long descriptions', () => {
        const longDesc = 'A'.repeat(300);
        const pr: PrMetadataForRanking = { ...mockOpenPr, description: longDesc };
        const prompt = buildRankingPrompt([], [pr]);
        expect(prompt).toContain('...');
        expect(prompt).not.toContain('A'.repeat(300));
    });
});

describe('parseSuggestionsResponse', () => {
    it('parses valid JSON array', () => {
        const raw = '[{"prNumber": 42, "score": 95}, {"prNumber": 17, "score": 80}]';
        const result = parseSuggestionsResponse(raw);
        expect(result).toEqual([
            { prNumber: 42, score: 95 },
            { prNumber: 17, score: 80 },
        ]);
    });

    it('extracts JSON from markdown code block', () => {
        const raw = '```json\n[{"prNumber": 42, "score": 95}]\n```';
        const result = parseSuggestionsResponse(raw);
        expect(result).toHaveLength(1);
        expect(result[0].prNumber).toBe(42);
    });

    it('extracts JSON with surrounding text', () => {
        const raw = 'Here are the results:\n[{"prNumber": 42, "score": 95}]\nDone.';
        const result = parseSuggestionsResponse(raw);
        expect(result).toHaveLength(1);
    });

    it('clamps scores to 0-100 range', () => {
        const raw = '[{"prNumber": 1, "score": 150}, {"prNumber": 2, "score": -10}]';
        const result = parseSuggestionsResponse(raw);
        expect(result[0].score).toBe(100);
        expect(result[1].score).toBe(0);
    });

    it('sorts by score descending', () => {
        const raw = '[{"prNumber": 1, "score": 50}, {"prNumber": 2, "score": 90}, {"prNumber": 3, "score": 70}]';
        const result = parseSuggestionsResponse(raw);
        expect(result[0].prNumber).toBe(2);
        expect(result[1].prNumber).toBe(3);
        expect(result[2].prNumber).toBe(1);
    });

    it('limits to 5 suggestions', () => {
        const items = Array.from({ length: 10 }, (_, i) => ({ prNumber: i + 1, score: 90 - i }));
        const raw = JSON.stringify(items);
        const result = parseSuggestionsResponse(raw);
        expect(result).toHaveLength(5);
    });

    it('skips invalid items', () => {
        const raw = '[{"prNumber": 42, "score": 95}, {"prNumber": "bad", "score": 80}, {"score": 70}]';
        const result = parseSuggestionsResponse(raw);
        expect(result).toHaveLength(1);
        expect(result[0].prNumber).toBe(42);
    });

    it('throws when no JSON array found', () => {
        expect(() => parseSuggestionsResponse('no json here')).toThrow('No JSON array found');
    });
});

describe('toPrMetadata', () => {
    it('converts a PullRequest to PrMetadataForRanking', () => {
        const pr = {
            id: 1,
            number: 100,
            title: 'Test PR',
            description: 'A test pull request',
            author: { id: 'user1', displayName: 'Alice' },
            sourceBranch: 'feature/test',
            targetBranch: 'main',
            status: 'open' as const,
            isDraft: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            url: 'https://github.com/org/repo/pull/100',
            repositoryId: 'repo-id',
            reviewers: [{ identity: { id: 'user2', displayName: 'Bob' }, vote: 0, isRequired: false }],
            labels: ['enhancement'],
        };

        const metadata = toPrMetadata(pr as any);
        expect(metadata.number).toBe(100);
        expect(metadata.title).toBe('Test PR');
        expect(metadata.description).toBe('A test pull request');
        expect(metadata.author.displayName).toBe('Alice');
        expect(metadata.reviewers).toHaveLength(1);
        expect(metadata.reviewers[0].displayName).toBe('Bob');
        expect(metadata.labels).toEqual(['enhancement']);
        expect(metadata.filesChanged).toEqual([]);
    });
});

describe('rankAndCacheSuggestions', () => {
    it('calls transform and caches result', async () => {
        const mockAiService = {
            transform: vi.fn().mockResolvedValue({
                success: true,
                text: JSON.stringify([
                    { prNumber: 100, score: 95 },
                    { prNumber: 101, score: 80 },
                ]),
            }),
        } as unknown as CopilotSDKService;

        const history: ReviewHistoryCache = {
            fetchedAt: '2024-06-01T12:00:00.000Z',
            reviews: [mockSerializedReview],
        };

        const result = await rankAndCacheSuggestions(
            tmpDir, 'ws-rank', mockAiService, history, [mockOpenPr],
        );

        expect(result.suggestions).toHaveLength(2);
        expect(result.suggestions[0].prNumber).toBe(100);
        expect(result.rankedAt).toBeDefined();

        // Verify it was written to disk
        const cached = readSuggestionsCache(tmpDir, 'ws-rank');
        expect(cached).not.toBeNull();
        expect(cached!.suggestions).toHaveLength(2);
    });

    it('parses the transform response text', async () => {
        const mockAiService = {
            transform: vi.fn().mockResolvedValue({
                success: true,
                text: '[{"prNumber": 42, "score": 95}]',
            }),
        } as unknown as CopilotSDKService;

        const history: ReviewHistoryCache = {
            fetchedAt: '2024-06-01T12:00:00.000Z',
            reviews: [mockSerializedReview],
        };

        const result = await rankAndCacheSuggestions(
            tmpDir, 'ws-parse', mockAiService, history, [mockOpenPr],
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].prNumber).toBe(42);
    });

    it('handles empty open PRs without calling LLM', async () => {
        const mockAiService = {
            transform: vi.fn(),
        } as unknown as CopilotSDKService;

        const history: ReviewHistoryCache = {
            fetchedAt: '2024-06-01T12:00:00.000Z',
            reviews: [mockSerializedReview],
        };

        const result = await rankAndCacheSuggestions(
            tmpDir, 'ws-empty', mockAiService, history, [],
        );

        expect(result.suggestions).toHaveLength(0);
        expect(mockAiService.transform).not.toHaveBeenCalled();

        // Verify cache was still written
        const cached = readSuggestionsCache(tmpDir, 'ws-empty');
        expect(cached).not.toBeNull();
        expect(cached!.suggestions).toHaveLength(0);
    });

    it('uses gpt-4.1 model with 30s timeout', async () => {
        const mockAiService = {
            transform: vi.fn().mockResolvedValue({ success: true, text: '[]' }),
        } as unknown as CopilotSDKService;

        const history: ReviewHistoryCache = {
            fetchedAt: '2024-06-01T12:00:00.000Z',
            reviews: [mockSerializedReview],
        };

        await rankAndCacheSuggestions(
            tmpDir, 'ws-model', mockAiService, history, [mockOpenPr],
        );

        expect(mockAiService.transform).toHaveBeenCalledWith(
            expect.any(String),
            { model: 'gpt-4.1', timeoutMs: 30_000 },
        );
    });
});
