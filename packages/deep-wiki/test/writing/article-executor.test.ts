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
import type { ModuleGraph, ModuleAnalysis } from '../../src/types';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Test Data
// ============================================================================

function createTestGraph(): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        modules: [
            {
                id: 'auth',
                name: 'Auth Module',
                path: 'src/auth/',
                purpose: 'Authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'medium' as const,
                category: 'core',
            },
        ],
        categories: [{ name: 'core', description: 'Core modules' }],
        architectureNotes: 'Test architecture',
    };
}

function createTestAnalysis(moduleId = 'auth'): ModuleAnalysis {
    return {
        moduleId,
        overview: 'Authentication module overview.',
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
    it('should include moduleId and moduleName', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const item = analysisToPromptItem(analysis, graph);

        expect(item.moduleId).toBe('auth');
        expect(item.moduleName).toBe('Auth Module');
    });

    it('should include full analysis JSON', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const item = analysisToPromptItem(analysis, graph);

        const parsed = JSON.parse(item.analysis);
        expect(parsed.moduleId).toBe('auth');
        expect(parsed.overview).toContain('Authentication');
    });

    it('should include simplified module graph', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const item = analysisToPromptItem(analysis, graph);

        const parsed = JSON.parse(item.moduleGraph);
        expect(parsed).toBeInstanceOf(Array);
        expect(parsed[0].id).toBe('auth');
    });

    it('should use moduleId as name when module not found in graph', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis('unknown-module');
        const item = analysisToPromptItem(analysis, graph);

        expect(item.moduleName).toBe('unknown-module');
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
        expect(result.failedModuleIds).toEqual([]);
        expect(result.duration).toBe(0);
    });

    it('should call AI invoker for each analysis', async () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        // Mock invoker returns markdown for map and JSON for reduce
        const mockInvoker: AIInvoker = vi.fn().mockResolvedValue({
            success: true,
            response: '# Auth Module\n\nContent here.',
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

    it('should group modules by category', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('### core');
    });

    it('should include module links', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const index = articles.find(a => a.type === 'index')!;

        expect(index.content).toContain('./modules/auth.md');
    });

    it('should include architecture notes', () => {
        const graph = createTestGraph();
        const analyses = [createTestAnalysis()];

        const articles = generateStaticIndexPages(graph, analyses);
        const arch = articles.find(a => a.type === 'architecture')!;

        expect(arch.content).toContain('Test architecture');
    });

    it('should handle multiple categories', () => {
        const graph: ModuleGraph = {
            ...createTestGraph(),
            modules: [
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
