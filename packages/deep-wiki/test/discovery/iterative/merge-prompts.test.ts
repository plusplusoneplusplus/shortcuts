/**
 * Merge Prompts Tests
 *
 * Tests for merge prompt template generation.
 * Verifies probe results inclusion, existing graph handling, and convergence criteria.
 */

import { describe, it, expect } from 'vitest';
import { buildMergePrompt } from '../../../src/discovery/iterative/merge-prompts';
import type { TopicProbeResult, ModuleGraph } from '../../../src/types';

describe('buildMergePrompt', () => {
    const probeResults: TopicProbeResult[] = [
        {
            topic: 'authentication',
            foundModules: [
                {
                    id: 'auth-service',
                    name: 'Auth Service',
                    path: 'src/auth/',
                    purpose: 'Auth',
                    keyFiles: ['src/auth/index.ts'],
                    evidence: 'Evidence',
                },
            ],
            discoveredTopics: [],
            dependencies: [],
            confidence: 0.9,
        },
    ];

    const existingGraph: ModuleGraph = {
        project: {
            name: 'test-project',
            description: 'Test',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: [],
        },
        modules: [],
        categories: [],
        architectureNotes: '',
    };

    it('should include the repo path', () => {
        const prompt = buildMergePrompt('/path/to/repo', probeResults, null);
        expect(prompt).toContain('/path/to/repo');
    });

    it('should include probe results', () => {
        const prompt = buildMergePrompt('/repo', probeResults, null);
        expect(prompt).toContain('authentication');
        expect(prompt).toContain('auth-service');
    });

    it('should include existing graph when provided', () => {
        const prompt = buildMergePrompt('/repo', probeResults, existingGraph);
        expect(prompt).toContain('test-project');
        expect(prompt).toContain('Existing Graph');
        expect(prompt).toContain('Merge new findings into this existing graph');
    });

    it('should indicate first round when no existing graph', () => {
        const prompt = buildMergePrompt('/repo', probeResults, null);
        expect(prompt).toContain('First Round');
        expect(prompt).toContain('Build the initial graph');
    });

    it('should mention convergence criteria', () => {
        const prompt = buildMergePrompt('/repo', probeResults, null);
        expect(prompt).toContain('converged');
        expect(prompt).toContain('coverage');
        expect(prompt).toContain('0.8');
    });

    it('should include instructions for merging', () => {
        const prompt = buildMergePrompt('/repo', probeResults, null);
        expect(prompt).toContain('Merge all probe results');
        expect(prompt).toContain('Resolve overlapping');
        expect(prompt).toContain('coverage gaps');
    });

    it('should include the JSON schema', () => {
        const prompt = buildMergePrompt('/repo', probeResults, null);
        expect(prompt).toContain('"graph"');
        expect(prompt).toContain('"newTopics"');
        expect(prompt).toContain('"converged"');
        expect(prompt).toContain('"coverage"');
    });

    it('should handle multiple probe results', () => {
        const multipleResults: TopicProbeResult[] = [
            ...probeResults,
            {
                topic: 'database',
                foundModules: [],
                discoveredTopics: [],
                dependencies: [],
                confidence: 0.7,
            },
        ];

        const prompt = buildMergePrompt('/repo', multipleResults, null);
        expect(prompt).toContain('authentication');
        expect(prompt).toContain('database');
    });

    it('should instruct raw JSON output (no markdown)', () => {
        const prompt = buildMergePrompt('/repo', probeResults, null);
        expect(prompt).toContain('raw JSON only');
        expect(prompt).toContain('Do NOT wrap it in markdown code blocks');
    });
});
