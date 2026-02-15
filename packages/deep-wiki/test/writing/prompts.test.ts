/**
 * Writing Prompt Tests
 *
 * Tests for article writing prompt generation, depth variants,
 * cross-linking, and component graph simplification.
 */

import { describe, it, expect } from 'vitest';
import {
    buildComponentArticlePrompt,
    buildComponentArticlePromptTemplate,
    buildSimplifiedGraph,
    getArticleStyleGuide,
} from '../../src/writing/prompts';
import type { ComponentAnalysis, ComponentGraph } from '../../src/types';

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
                dependencies: ['database'],
                dependents: ['api'],
                complexity: 'high' as const,
                category: 'security',
            },
            {
                id: 'database',
                name: 'Database Component',
                path: 'src/db/',
                purpose: 'Data access',
                keyFiles: ['src/db/index.ts'],
                dependencies: [],
                dependents: ['auth'],
                complexity: 'medium' as const,
                category: 'infrastructure',
            },
        ],
        categories: [
            { name: 'security', description: 'Security components' },
            { name: 'infrastructure', description: 'Infrastructure' },
        ],
        architectureNotes: 'Layered architecture',
    };
}

function createTestAnalysis(): ComponentAnalysis {
    return {
        componentId: 'auth',
        overview: 'Handles user authentication.',
        keyConcepts: [{ name: 'JWT', description: 'Token auth' }],
        publicAPI: [{ name: 'login', signature: 'login(): void', description: 'Logs in' }],
        internalArchitecture: 'Middleware pattern',
        dataFlow: 'Request → Auth → Response',
        patterns: ['Middleware'],
        errorHandling: 'Custom errors',
        codeExamples: [],
        dependencies: { internal: [], external: [] },
        suggestedDiagram: 'graph TD\n  A-->B',
    };
}

// ============================================================================
// buildSimplifiedGraph
// ============================================================================

describe('buildSimplifiedGraph', () => {
    it('should produce JSON with only id, name, path, category', () => {
        const graph = createTestGraph();
        const simplified = buildSimplifiedGraph(graph);
        const parsed = JSON.parse(simplified);

        expect(parsed).toHaveLength(2);
        expect(parsed[0]).toEqual({
            id: 'auth',
            name: 'Auth Component',
            path: 'src/auth/',
            category: 'security',
        });
        expect(parsed[1].id).toBe('database');
    });

    it('should not include keyFiles, dependencies, etc.', () => {
        const graph = createTestGraph();
        const simplified = buildSimplifiedGraph(graph);

        expect(simplified).not.toContain('keyFiles');
        expect(simplified).not.toContain('dependencies');
        expect(simplified).not.toContain('dependents');
        expect(simplified).not.toContain('complexity');
    });
});

// ============================================================================
// getArticleStyleGuide
// ============================================================================

describe('getArticleStyleGuide', () => {
    it('should return different styles for each depth', () => {
        const shallow = getArticleStyleGuide('shallow');
        const normal = getArticleStyleGuide('normal');
        const deep = getArticleStyleGuide('deep');

        expect(shallow).not.toBe(normal);
        expect(normal).not.toBe(deep);
    });

    it('shallow should mention concise/brief', () => {
        expect(getArticleStyleGuide('shallow')).toContain('concise');
    });

    it('normal should mention comprehensive', () => {
        expect(getArticleStyleGuide('normal')).toContain('comprehensive');
    });

    it('deep should mention thorough/detailed', () => {
        expect(getArticleStyleGuide('deep')).toContain('thorough');
    });
});

// ============================================================================
// buildComponentArticlePrompt
// ============================================================================

describe('buildComponentArticlePrompt', () => {
    it('should include analysis JSON', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('"componentId": "auth"');
        expect(prompt).toContain('"overview"');
    });

    it('should include simplified component graph', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('"id": "auth"');
        expect(prompt).toContain('"id": "database"');
    });

    it('should include cross-link instructions', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('./components/component-id.md');
        expect(prompt).toContain('Cross-Linking Rules');
    });

    it('should include Mermaid instructions', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('mermaid');
        expect(prompt).toContain('suggestedDiagram');
    });

    it('should use component name in heading instruction', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('# Auth Component');
    });

    it('should instruct markdown-only output', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('Return ONLY the markdown content');
    });
});

// ============================================================================
// buildComponentArticlePromptTemplate
// ============================================================================

describe('buildComponentArticlePromptTemplate', () => {
    it('should contain template variables', () => {
        const template = buildComponentArticlePromptTemplate('normal');
        expect(template).toContain('{{componentName}}');
        expect(template).toContain('{{analysis}}');
        expect(template).toContain('{{componentGraph}}');
    });

    it('should vary by depth', () => {
        const shallow = buildComponentArticlePromptTemplate('shallow');
        const deep = buildComponentArticlePromptTemplate('deep');

        expect(shallow).toContain('concise');
        expect(deep).toContain('thorough');
    });
});
