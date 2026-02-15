/**
 * Iterative Discovery Cache Integration Tests
 *
 * Tests that the iterative discovery loop properly integrates with
 * the discovery cache: loading cached probes, saving fresh probes,
 * round resumption from metadata, git hash invalidation, and
 * --force behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runIterativeDiscovery } from '../../../src/discovery/iterative/iterative-discovery';
import type { IterativeDiscoveryOptions, TopicSeed, ComponentGraph, TopicProbeResult } from '../../../src/types';
import {
    saveProbeResult,
    getCachedProbeResult,
    getDiscoveryMetadata,
    clearDiscoveryCache,
} from '../../../src/cache';

// Mock probe and merge sessions
vi.mock('../../../src/discovery/iterative/probe-session', () => ({
    runTopicProbe: vi.fn(),
}));

vi.mock('../../../src/discovery/iterative/merge-session', () => ({
    mergeProbeResults: vi.fn(),
}));

// Mock logger to suppress output during tests
vi.mock('../../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printHeader: vi.fn(),
    printKeyValue: vi.fn(),
    gray: (s: string) => s,
    cyan: (s: string) => s,
    bold: (s: string) => s,
}));

import { runTopicProbe } from '../../../src/discovery/iterative/probe-session';
import { mergeProbeResults } from '../../../src/discovery/iterative/merge-session';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let outputDir: string;

const gitHash = 'test_git_hash_123';

function createMockGraph(moduleIds: string[] = []): ComponentGraph {
    return {
        project: {
            name: 'test-project',
            description: 'Test',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: [],
        },
        components: moduleIds.map(id => ({
            id,
            name: id,
            path: `src/${id}/`,
            purpose: `${id} component`,
            keyFiles: [`src/${id}/index.ts`],
            dependencies: [],
            dependents: [],
            complexity: 'medium' as const,
            category: 'core',
        })),
        categories: [{ name: 'core', description: 'Core' }],
        architectureNotes: 'Test',
    };
}

function createProbeResult(topic: string): TopicProbeResult {
    return {
        topic,
        foundComponents: [
            {
                id: `${topic}-service`,
                name: `${topic} Service`,
                path: `src/${topic}/`,
                purpose: `Handles ${topic}`,
                keyFiles: [`src/${topic}/index.ts`],
                evidence: 'Found',
            },
        ],
        discoveredTopics: [],
        dependencies: [],
        confidence: 0.9,
    };
}

const baseSeeds: TopicSeed[] = [
    { topic: 'auth', description: 'Authentication', hints: ['auth'] },
    { topic: 'database', description: 'Database layer', hints: ['db'] },
    { topic: 'api', description: 'API routes', hints: ['api'] },
];

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-iter-cache-test-'));
    outputDir = path.join(tempDir, 'output');
    vi.clearAllMocks();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Probe Cache Hit Tests
// ============================================================================

describe('probe cache integration', () => {
    it('should skip cached probes and only run uncached ones', async () => {
        // Pre-populate cache with 2 of 3 probes
        saveProbeResult('auth', createProbeResult('auth'), outputDir, gitHash);
        saveProbeResult('database', createProbeResult('database'), outputDir, gitHash);

        // Only 'api' should trigger a fresh probe
        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('api'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph(['auth-service', 'database-service', 'api-service']),
            newTopics: [],
            converged: true,
            coverage: 0.95,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: baseSeeds,
            outputDir,
            gitHash,
            maxRounds: 1,
        };

        const result = await runIterativeDiscovery(options);

        // Only 1 fresh probe (api), not 3
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(1);

        // Merge should still receive all 3 probe results
        expect(vi.mocked(mergeProbeResults)).toHaveBeenCalledTimes(1);
        const mergeCallArgs = vi.mocked(mergeProbeResults).mock.calls[0];
        const probeResults = mergeCallArgs[1] as TopicProbeResult[];
        expect(probeResults).toHaveLength(3);

        expect(result.components).toHaveLength(3);
    });

    it('should run all probes when no cache exists', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('auth'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph(['auth-service']),
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: baseSeeds,
            outputDir,
            gitHash,
            maxRounds: 1,
        };

        await runIterativeDiscovery(options);

        // All 3 probes should run
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(3);
    });

    it('should save probe results to cache as they complete', async () => {
        vi.mocked(runTopicProbe).mockImplementation(async (_repoPath, topic) => {
            return createProbeResult(topic.topic);
        });

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph(['auth-service', 'database-service']),
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: [
                { topic: 'auth', description: 'Auth', hints: ['auth'] },
                { topic: 'database', description: 'DB', hints: ['db'] },
            ],
            outputDir,
            gitHash,
            maxRounds: 1,
        };

        await runIterativeDiscovery(options);

        // Verify probes were saved to cache
        const cachedAuth = getCachedProbeResult('auth', outputDir, gitHash);
        const cachedDb = getCachedProbeResult('database', outputDir, gitHash);
        expect(cachedAuth).not.toBeNull();
        expect(cachedAuth!.topic).toBe('auth');
        expect(cachedDb).not.toBeNull();
        expect(cachedDb!.topic).toBe('database');
    });
});

// ============================================================================
// Git Hash Invalidation Tests
// ============================================================================

describe('git hash invalidation', () => {
    it('should ignore cached probes with different git hash', async () => {
        // Cache probes with old hash
        saveProbeResult('auth', createProbeResult('auth'), outputDir, 'old_hash');
        saveProbeResult('database', createProbeResult('database'), outputDir, 'old_hash');

        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('auth'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph([]),
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: baseSeeds,
            outputDir,
            gitHash: 'new_hash', // Different from cached
            maxRounds: 1,
        };

        await runIterativeDiscovery(options);

        // All 3 probes should run (cache invalidated)
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(3);
    });
});

// ============================================================================
// Discovery Metadata (Round Resumption) Tests
// ============================================================================

describe('discovery metadata', () => {
    it('should save metadata after each round', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('auth'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph(['auth-service']),
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: [{ topic: 'auth', description: 'Auth', hints: ['auth'] }],
            outputDir,
            gitHash,
            maxRounds: 3,
        };

        await runIterativeDiscovery(options);

        const metadata = getDiscoveryMetadata(outputDir);
        expect(metadata).not.toBeNull();
        expect(metadata!.mode).toBe('iterative');
        expect(metadata!.currentRound).toBe(1);
        expect(metadata!.converged).toBe(true);
        expect(metadata!.coverage).toBe(0.9);
        expect(metadata!.gitHash).toBe(gitHash);
    });

    it('should update metadata each round during multi-round discovery', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('auth'));

        // Round 1: discover new topic
        vi.mocked(mergeProbeResults)
            .mockResolvedValueOnce({
                graph: createMockGraph([]),
                newTopics: [{ topic: 'db', description: 'DB', hints: ['db'] }],
                converged: false,
                coverage: 0.4,
                reason: 'Low coverage',
            })
            // Round 2: converge
            .mockResolvedValueOnce({
                graph: createMockGraph(['auth-service', 'db-service']),
                newTopics: [],
                converged: true,
                coverage: 0.9,
                reason: 'Converged',
            });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: [{ topic: 'auth', description: 'Auth', hints: ['auth'] }],
            outputDir,
            gitHash,
            maxRounds: 3,
        };

        await runIterativeDiscovery(options);

        const metadata = getDiscoveryMetadata(outputDir);
        expect(metadata).not.toBeNull();
        expect(metadata!.currentRound).toBe(2); // Last round saved
        expect(metadata!.converged).toBe(true);
    });
});

// ============================================================================
// No Cache When outputDir Not Provided
// ============================================================================

describe('no caching when outputDir not provided', () => {
    it('should work normally without cache options', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('auth'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph(['auth-service']),
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: [{ topic: 'auth', description: 'Auth', hints: ['auth'] }],
            // No outputDir, no gitHash
            maxRounds: 1,
        };

        const result = await runIterativeDiscovery(options);
        expect(result.components).toHaveLength(1);
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(1);

        // No metadata should be saved
        expect(getDiscoveryMetadata(outputDir)).toBeNull();
    });
});

// ============================================================================
// --use-cache Mode Tests
// ============================================================================

describe('--use-cache mode', () => {
    it('should load cached probes regardless of git hash', async () => {
        // Cache probes with a different hash
        saveProbeResult('auth', createProbeResult('auth'), outputDir, 'completely_different_hash');
        saveProbeResult('database', createProbeResult('database'), outputDir, 'another_different_hash');

        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('api'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph([]),
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: baseSeeds,
            outputDir,
            gitHash: 'current_hash',
            useCache: true,
            maxRounds: 1,
        };

        await runIterativeDiscovery(options);

        // Only 'api' should trigger a fresh probe (auth + database from cache)
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(1);
    });
});

// ============================================================================
// Partial Cache Recovery Tests
// ============================================================================

describe('partial cache (crash recovery)', () => {
    it('should use cached probes from interrupted run and only re-run missing', async () => {
        // Simulate a previous interrupted run: 2 of 3 probes saved
        saveProbeResult('auth', createProbeResult('auth'), outputDir, gitHash);
        saveProbeResult('database', createProbeResult('database'), outputDir, gitHash);
        // 'api' probe was not saved (process crashed)

        vi.mocked(runTopicProbe).mockResolvedValue(createProbeResult('api'));

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: createMockGraph(['auth-service', 'database-service', 'api-service']),
            newTopics: [],
            converged: true,
            coverage: 0.95,
            reason: 'Converged',
        });

        const options: IterativeDiscoveryOptions = {
            repoPath: '/test/repo',
            seeds: baseSeeds,
            outputDir,
            gitHash,
            maxRounds: 1,
        };

        const result = await runIterativeDiscovery(options);

        // Only 'api' needed a fresh probe
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(1);
        expect(result.components).toHaveLength(3);

        // After completion, the api probe should also be cached
        const cachedApi = getCachedProbeResult('api', outputDir, gitHash);
        expect(cachedApi).not.toBeNull();
    });
});
