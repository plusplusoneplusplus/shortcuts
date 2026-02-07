/**
 * Writing Prompt Tests
 *
 * Tests for article writing prompt generation, depth variants,
 * cross-linking, and module graph simplification.
 */

import { describe, it, expect } from 'vitest';
import {
    buildModuleArticlePrompt,
    buildModuleArticlePromptTemplate,
    buildSimplifiedGraph,
    getArticleStyleGuide,
} from '../../src/writing/prompts';
import type { ModuleAnalysis, ModuleGraph } from '../../src/types';

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
                dependencies: ['database'],
                dependents: ['api'],
                complexity: 'high' as const,
                category: 'security',
            },
            {
                id: 'database',
                name: 'Database Module',
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
            { name: 'security', description: 'Security modules' },
            { name: 'infrastructure', description: 'Infrastructure' },
        ],
        architectureNotes: 'Layered architecture',
    };
}

function createTestAnalysis(): ModuleAnalysis {
    return {
        moduleId: 'auth',
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
            name: 'Auth Module',
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
// buildModuleArticlePrompt
// ============================================================================

describe('buildModuleArticlePrompt', () => {
    it('should include analysis JSON', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildModuleArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('"moduleId": "auth"');
        expect(prompt).toContain('"overview"');
    });

    it('should include simplified module graph', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildModuleArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('"id": "auth"');
        expect(prompt).toContain('"id": "database"');
    });

    it('should include cross-link instructions', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildModuleArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('./modules/module-id.md');
        expect(prompt).toContain('Cross-Linking Rules');
    });

    it('should include Mermaid instructions', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildModuleArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('mermaid');
        expect(prompt).toContain('suggestedDiagram');
    });

    it('should use module name in heading instruction', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildModuleArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('# Auth Module');
    });

    it('should instruct markdown-only output', () => {
        const graph = createTestGraph();
        const analysis = createTestAnalysis();
        const prompt = buildModuleArticlePrompt(analysis, graph, 'normal');

        expect(prompt).toContain('Return ONLY the markdown content');
    });
});

// ============================================================================
// buildModuleArticlePromptTemplate
// ============================================================================

describe('buildModuleArticlePromptTemplate', () => {
    it('should contain template variables', () => {
        const template = buildModuleArticlePromptTemplate('normal');
        expect(template).toContain('{{moduleName}}');
        expect(template).toContain('{{analysis}}');
        expect(template).toContain('{{moduleGraph}}');
    });

    it('should vary by depth', () => {
        const shallow = buildModuleArticlePromptTemplate('shallow');
        const deep = buildModuleArticlePromptTemplate('deep');

        expect(shallow).toContain('concise');
        expect(deep).toContain('thorough');
    });
});
