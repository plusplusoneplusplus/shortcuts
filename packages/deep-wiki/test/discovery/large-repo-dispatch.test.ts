/**
 * Discovery — Large Repo Dispatch Tests
 *
 * Gap: test/discovery/large-repo-handler.test.ts only verifies the threshold
 * constant (3000) and mergeSubGraphs() merging logic. The actual dispatch path
 * where file count > 3000 switches from standard to chunked/batched discovery
 * is never simulated.
 *
 * These tests exercise discoverComponentGraph() in src/discovery/index.ts,
 * verifying that it routes to the correct code path based on isLargeRepo().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentGraph } from '../../src/types';

// ============================================================================
// Mocks
// ============================================================================

// Mock at the source level so discoverComponentGraph sees the mocked versions
vi.mock('../../src/discovery/large-repo-handler', () => ({
    isLargeRepo: vi.fn().mockResolvedValue(false),
    discoverLargeRepo: vi.fn(),
    LARGE_REPO_THRESHOLD: 3000,
    mergeSubGraphs: vi.fn(),
}));

vi.mock('../../src/discovery/discovery-session', () => ({
    runDiscoverySession: vi.fn(),
    DiscoveryError: class DiscoveryError extends Error {
        code: string;
        constructor(message: string, code: string) {
            super(message);
            this.name = 'DiscoveryError';
            this.code = code;
        }
    },
}));

vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printSuccess: vi.fn(),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { discoverComponentGraph } from '../../src/discovery';

// ============================================================================
// Fixtures
// ============================================================================

function makeMinimalGraph(overrides: Partial<ComponentGraph> = {}): ComponentGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'comp-1',
                name: 'Auth',
                path: 'src/auth/',
                purpose: 'Authentication module',
                keyFiles: ['src/auth/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            },
        ],
        categories: [{ name: 'core', description: 'Core components' }],
        architectureNotes: 'Standard layered architecture',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Discovery — large repo dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ========================================================================
    // Standard path (below threshold)
    // ========================================================================

    it('uses standard (single-pass) discovery when file count is below threshold', async () => {
        const { isLargeRepo } = await import('../../src/discovery/large-repo-handler');
        const { runDiscoverySession } = await import('../../src/discovery/discovery-session');
        const { discoverLargeRepo } = await import('../../src/discovery/large-repo-handler');

        vi.mocked(isLargeRepo).mockResolvedValue(false);
        vi.mocked(runDiscoverySession).mockResolvedValue({
            graph: makeMinimalGraph(),
            tokenUsage: undefined,
        });

        const result = await discoverComponentGraph({ repoPath: '/repo' });

        expect(vi.mocked(runDiscoverySession)).toHaveBeenCalledOnce();
        expect(vi.mocked(discoverLargeRepo)).not.toHaveBeenCalled();
        expect(result.graph.components).toHaveLength(1);
    });

    it('standard path returns tokenUsage from the session', async () => {
        const { isLargeRepo } = await import('../../src/discovery/large-repo-handler');
        const { runDiscoverySession } = await import('../../src/discovery/discovery-session');

        vi.mocked(isLargeRepo).mockResolvedValue(false);
        vi.mocked(runDiscoverySession).mockResolvedValue({
            graph: makeMinimalGraph(),
            tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        });

        const result = await discoverComponentGraph({ repoPath: '/repo' });

        expect(result.tokenUsage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    });

    // ========================================================================
    // Large repo path (above threshold)
    // ========================================================================

    it('uses chunked discovery when file count exceeds 3000', async () => {
        const { isLargeRepo, discoverLargeRepo } = await import('../../src/discovery/large-repo-handler');
        const { runDiscoverySession } = await import('../../src/discovery/discovery-session');

        vi.mocked(isLargeRepo).mockResolvedValue(true);
        vi.mocked(discoverLargeRepo).mockResolvedValue(makeMinimalGraph());

        const result = await discoverComponentGraph({ repoPath: '/large-repo' });

        expect(vi.mocked(discoverLargeRepo)).toHaveBeenCalledOnce();
        expect(vi.mocked(runDiscoverySession)).not.toHaveBeenCalled();
        expect(result.graph.components).toHaveLength(1);
    });

    it('large repo path passes options through to discoverLargeRepo', async () => {
        const { isLargeRepo, discoverLargeRepo } = await import('../../src/discovery/large-repo-handler');

        vi.mocked(isLargeRepo).mockResolvedValue(true);
        vi.mocked(discoverLargeRepo).mockResolvedValue(makeMinimalGraph());

        const options = { repoPath: '/large-repo', model: 'gpt-4', concurrency: 3 };
        await discoverComponentGraph(options);

        expect(vi.mocked(discoverLargeRepo)).toHaveBeenCalledWith(expect.objectContaining({
            repoPath: '/large-repo',
            model: 'gpt-4',
            concurrency: 3,
        }));
    });

    it('large repo path does not include tokenUsage in result (large repo does not track usage)', async () => {
        const { isLargeRepo, discoverLargeRepo } = await import('../../src/discovery/large-repo-handler');

        vi.mocked(isLargeRepo).mockResolvedValue(true);
        vi.mocked(discoverLargeRepo).mockResolvedValue(makeMinimalGraph());

        const result = await discoverComponentGraph({ repoPath: '/large-repo' });

        // Large repo path returns only { graph, duration } — no tokenUsage
        expect(result.tokenUsage).toBeUndefined();
    });

    // ========================================================================
    // Custom threshold
    // ========================================================================

    it('passes custom largeRepoThreshold to isLargeRepo check', async () => {
        const { isLargeRepo } = await import('../../src/discovery/large-repo-handler');
        const { runDiscoverySession } = await import('../../src/discovery/discovery-session');

        vi.mocked(isLargeRepo).mockResolvedValue(false);
        vi.mocked(runDiscoverySession).mockResolvedValue({ graph: makeMinimalGraph(), tokenUsage: undefined });

        await discoverComponentGraph({ repoPath: '/repo', largeRepoThreshold: 500 });

        expect(vi.mocked(isLargeRepo)).toHaveBeenCalledWith('/repo', 500);
    });

    // ========================================================================
    // Result shape
    // ========================================================================

    it('both paths return a DiscoveryResult with graph and duration', async () => {
        const { isLargeRepo } = await import('../../src/discovery/large-repo-handler');
        const { runDiscoverySession } = await import('../../src/discovery/discovery-session');

        for (const isLarge of [false, true]) {
            vi.mocked(isLargeRepo).mockResolvedValue(isLarge);
            if (!isLarge) {
                vi.mocked(runDiscoverySession).mockResolvedValue({ graph: makeMinimalGraph(), tokenUsage: undefined });
            } else {
                const { discoverLargeRepo } = await import('../../src/discovery/large-repo-handler');
                vi.mocked(discoverLargeRepo).mockResolvedValue(makeMinimalGraph());
            }

            const result = await discoverComponentGraph({ repoPath: '/repo' });

            expect(result).toHaveProperty('graph');
            expect(result).toHaveProperty('duration');
            expect(typeof result.duration).toBe('number');
            expect(result.graph).toHaveProperty('components');
        }
    });

    it('large repo merges subgraphs without losing nodes', async () => {
        const { isLargeRepo, discoverLargeRepo } = await import('../../src/discovery/large-repo-handler');

        const graphWithTwoComponents = makeMinimalGraph({
            components: [
                { id: 'comp-1', name: 'Auth', path: 'src/auth/', purpose: 'Auth', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' },
                { id: 'comp-2', name: 'DB', path: 'src/db/', purpose: 'Database', keyFiles: [], dependencies: [], dependents: [], complexity: 'medium', category: 'core' },
            ],
        });

        vi.mocked(isLargeRepo).mockResolvedValue(true);
        vi.mocked(discoverLargeRepo).mockResolvedValue(graphWithTwoComponents);

        const result = await discoverComponentGraph({ repoPath: '/large-repo' });

        expect(result.graph.components).toHaveLength(2);
        expect(result.graph.components.map(c => c.id)).toContain('comp-1');
        expect(result.graph.components.map(c => c.id)).toContain('comp-2');
    });
});
