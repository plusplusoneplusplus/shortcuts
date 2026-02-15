/**
 * Article Executor Tests
 *
 * Tests for article generation map-reduce orchestration:
 * analysis→PromptItem conversion, text mode mapping, AI reduce,
 * and static fallback generation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    analysisToPromptItem,
    runArticleExecutor,
    generateStaticIndexPages,
} from '../../src/writing/article-executor';
import type { ComponentGraph, ComponentAnalysis } from '../../src/types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Test Data
// ============================================================================

function createTestGraph(): ComponentGraph {
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
                id: 'auth',
                name: 'Auth Component',
                path: 'src/auth/',
                purpose: 'Authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium' as const,
                category: 'core',
            },
        ],
        categories: [{ name: 'core', description: 'Core components' }],
        architectureNotes: 'Test architecture',
    };
}

function createTestAnalysis(componentId = 'auth'): ComponentAnalysis {
    return {
        componentId,
        overview: 'Authentication component overview.',
        keyConcepts: [],
        publicAPI: [],
        internalArchitecture: '',
        dataFlow: '',
        patterns: [],
        errorHandling: '',
        codeExamples: [],
        dependencies: { internal: [], external: [] },
        suggestedDiagram: '',
    };
}

// ============================================================================
// analysisToPromptItem
// ============================================================================

describe('analysisToPromptItem', () => {
    it('should include componentId and componentName', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const item = analysisToPromptItem(analysis, graph);

        expect(item.componentId).toBe('auth');
        expect(item.componentName).toBe('Auth Component');
    });

    it('should include full analysis JSON', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const item = analysisToPromptItem(analysis, graph);

        const parsed = JSON.parse(item.analysis);
        expect(parsed.componentId).toBe('auth');
        expect(parsed.overview).toContain('Authentication');
    });

    it('should include simplified component graph', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const item = analysisToPromptItem(analysis, graph);

        const parsed = JSON.parse(item.componentGraph);
        expect(parsed).toBeInstanceOf(Array);
        expect(parsed[0].id).toBe('auth');
    });

    it('should use componentId as name when component not found in graph', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis('unknown-module');
        const item = analysisToPromptItem(analysis, graph);

        expect(item.componentName).toBe('unknown-module');
    });
});

// ============================================================================
// runArticleExecutor
// ============================================================================

describe('runArticleExecutor', () => {
    it('should return empty results for empty analysis list', async () => {
        const graph = createTestGraph();
        const mockInvoker: AIInvoker = vi.fn();

        const result = await runArticleExecutor({
            aiInvoker: mockInvoker,
            graph,
            analyses: [],
            depth: 'normal',
        });

        expect(result.articles).toEqual([]);
        expect(result.failedComponentIds).toEqual([]);
        expect(result.duration).toBe(0);
    });

    it('should call AI invoker for each analysis', async () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        // Mock invoker returns markdown for map and JSON for reduce
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '# Auth Component\n\nContent here.',
        });

        const result = await runArticleExecutor({
            aiInvoker: mockInvoker,
            graph,
            analyses,
            depth: 'normal',
            concurrency: 1,
        });

        expect(mockInvoker).toHaveBeenCalled();
        expect(result.duration).toBeGreaterThan(0);
    });

    it('should use text mode (no output fields) for map phase', async () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        // The prompt should NOT have "Return JSON with these fields" appended
        const prompts: string[] = [];
        const mockInvoker: AIInvoker = vi.fn().mockImplementation(async (prompt: string) => {
            prompts.push(prompt);
            return { success: true, response: '# Article content' };
        });

        await runArticleExecutor({
            aiInvoker: mockInvoker,
            graph,
            analyses,
            depth: 'normal',
        });

        // At least one call should be the article prompt (without JSON field instruction)
        // The reduce call will have JSON instruction
        const articlePrompts = prompts.filter(p => p.includes('wiki article'));
        for (const p of articlePrompts) {
            expect(p).not.toContain('Return JSON with these fields:');
        }
    });
});

// ============================================================================
// generateStaticIndexPages
// ============================================================================

describe('generateStaticIndexPages', () => {
    it('should generate index and architecture pages', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);

        const types = articles.map(a => a.type);
        expect(types).toContain('index');
        expect(types).toContain('architecture');
    });

    it('should include project name in index', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('TestProject');
    });

    it('should group components by category', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('### core');
    });

    it('should include component links', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('./components/auth.md');
    });

    it('should include architecture notes', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const arch = articles.find(a => a.type === 'architecture')!;

        expect(arch.content).toContain('Test architecture');
    });

    it('should handle multiple categories', () => {
        const graph: ComponentGraph = {
            ...createTestGraph(),
            components: [
                {
                    id: 'auth', name: 'Auth', path: 'src/auth/', purpose: 'Auth',
                    keyFiles: [], dependencies: [], dependents: [],
                    complexity: 'medium', category: 'security',
                },
                {
                    id: 'db', name: 'Database', path: 'src/db/', purpose: 'Data',
                    keyFiles: [], dependencies: [], dependents: [],
                    complexity: 'medium', category: 'infrastructure',
                },
            ],
        };

        const analyses = [
            createTestAnalysis('auth'),
            createTestAnalysis('db'),
        ];

        const articles = generateStaticIndexPages(graph, analyses);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('### security');
        expect(index.content).toContain('### infrastructure');
    });
});
