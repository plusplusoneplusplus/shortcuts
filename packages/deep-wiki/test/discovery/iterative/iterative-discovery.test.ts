/**
 * Iterative Discovery Tests
 *
 * Tests for the main iterative discovery convergence loop.
 * Verifies round iteration, concurrency control, and convergence logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIterativeDiscovery } from '../../../src/discovery/iterative/iterative-discovery';
import type { IterativeDiscoveryOptions, TopicSeed, ComponentGraph } from '../../../src/types';

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

describe('runIterativeDiscovery', () => {
    const baseOptions: IterativeDiscoveryOptions = {
        repoPath: '/test/repo',
        seeds: [
            {
                topic: 'authentication',
                description: 'Auth logic',
                hints: ['auth', 'login'],
            },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return empty graph for empty seeds', async () => {
        const options: IterativeDiscoveryOptions = {
            ...baseOptions,
            seeds: [],
        };

        const result = await runIterativeDiscovery(options);
        expect(result.components).toHaveLength(0);
        expect(result.architectureNotes).toContain('No seeds');
    });

    it('should converge on first round when merge returns converged=true', async () => {
        const mockGraph: ComponentGraph = {
            project: {
                name: 'test-project',
                description: 'Test',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: [],
            },
            components: [
                {
                    id: 'auth-service',
                    name: 'Auth Service',
                    path: 'src/auth/',
                    purpose: 'Auth',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'medium',
                    category: 'core',
                },
            ],
            categories: [{ name: 'core', description: 'Core' }],
            architectureNotes: 'Test architecture',
        };

        vi.mocked(runTopicProbe).mockResolvedValue({
            topic: 'authentication',
            foundComponents: [],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.9,
        });

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: mockGraph,
            newTopics: [],
            converged: true,
            coverage: 0.9,
            reason: 'Coverage 0.9, no new topics',
        });

        const result = await runIterativeDiscovery(baseOptions);
        expect(result.components).toHaveLength(1);
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(mergeProbeResults)).toHaveBeenCalledTimes(1);
    });

    it('should iterate multiple rounds when new topics are discovered', async () => {
        const round1Graph: ComponentGraph = {
            project: {
                name: 'test-project',
                description: 'Test',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: [],
            },
            components: [],
            categories: [],
            architectureNotes: '',
        };

        const round2Graph: ComponentGraph = {
            ...round1Graph,
            components: [
                {
                    id: 'auth-service',
                    name: 'Auth Service',
                    path: 'src/auth/',
                    purpose: 'Auth',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'medium',
                    category: 'core',
                },
            ],
        };

        vi.mocked(runTopicProbe).mockResolvedValue({
            topic: 'authentication',
            foundComponents: [],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.8,
        });

        // Round 1: discovers new topic
        vi.mocked(mergeProbeResults)
            .mockResolvedValueOnce({
                graph: round1Graph,
                newTopics: [
                    {
                        topic: 'authorization',
                        description: 'Permission checking',
                        hints: ['permission'],
                    },
                ],
                converged: false,
                coverage: 0.5,
                reason: 'Coverage 0.5, 1 new topic',
            })
            // Round 2: converges
            .mockResolvedValueOnce({
                graph: round2Graph,
                newTopics: [],
                converged: true,
                coverage: 0.9,
                reason: 'Coverage 0.9, no new topics',
            });

        const result = await runIterativeDiscovery(baseOptions);
        expect(result.components).toHaveLength(1);
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(2); // Initial + new topic
        expect(vi.mocked(mergeProbeResults)).toHaveBeenCalledTimes(2);
    });

    it('should stop at max rounds even if not converged', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue({
            topic: 'authentication',
            foundComponents: [],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.7,
        });

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: {
                project: {
                    name: 'test-project',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
            },
            newTopics: [
                {
                    topic: 'new-topic',
                    description: 'New topic',
                    hints: ['new'],
                },
            ],
            converged: false,
            coverage: 0.4,
            reason: 'Low coverage',
        });

        const options: IterativeDiscoveryOptions = {
            ...baseOptions,
            maxRounds: 3,
        };

        const result = await runIterativeDiscovery(options);
        expect(vi.mocked(mergeProbeResults)).toHaveBeenCalledTimes(3); // Max rounds
    });

    it('should respect concurrency parameter', async () => {
        const options: IterativeDiscoveryOptions = {
            ...baseOptions,
            seeds: [
                { topic: 'auth', description: 'Auth', hints: ['auth'] },
                { topic: 'db', description: 'DB', hints: ['db'] },
                { topic: 'api', description: 'API', hints: ['api'] },
                { topic: 'cache', description: 'Cache', hints: ['cache'] },
                { topic: 'queue', description: 'Queue', hints: ['queue'] },
            ],
            concurrency: 2,
        };

        vi.mocked(runTopicProbe).mockResolvedValue({
            topic: 'test',
            foundComponents: [],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.8,
        });

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: {
                project: {
                    name: 'test-project',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
            },
            newTopics: [],
            converged: true,
            coverage: 1.0,
            reason: 'Complete',
        });

        await runIterativeDiscovery(options);
        // Should have called probe for all 5 seeds
        expect(vi.mocked(runTopicProbe)).toHaveBeenCalledTimes(5);
    });

    it('should handle probe failures gracefully', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue({
            topic: 'authentication',
            foundComponents: [],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0, // Failed probe
        });

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: {
                project: {
                    name: 'test-project',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
            },
            newTopics: [],
            converged: true,
            coverage: 0,
            reason: 'All probes failed',
        });

        const result = await runIterativeDiscovery(baseOptions);
        expect(result).toBeDefined();
        // Should not throw, should return graph even if probes failed
    });

    it('should converge when coverage threshold is met and no new topics', async () => {
        vi.mocked(runTopicProbe).mockResolvedValue({
            topic: 'authentication',
            foundComponents: [],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.9,
        });

        vi.mocked(mergeProbeResults).mockResolvedValue({
            graph: {
                project: {
                    name: 'test-project',
                    description: 'Test',
                    language: 'TypeScript',
                    buildSystem: 'npm',
                    entryPoints: [],
                },
                components: [],
                categories: [],
                architectureNotes: '',
            },
            newTopics: [],
            converged: false, // Not explicitly converged
            coverage: 0.85, // Above threshold
            reason: 'High coverage',
        });

        const options: IterativeDiscoveryOptions = {
            ...baseOptions,
            coverageThreshold: 0.8,
        };

        const result = await runIterativeDiscovery(options);
        expect(result).toBeDefined();
        // Should converge due to coverage threshold
        expect(vi.mocked(mergeProbeResults)).toHaveBeenCalledTimes(1);
    });
});
