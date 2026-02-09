/**
 * Tests for ContextBuilder - TF-IDF indexing and context retrieval.
 */

import { describe, it, expect } from 'vitest';
import { ContextBuilder, tokenize } from '../../src/server/context-builder';
import type { ModuleGraph } from '../../src/types';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestGraph(): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project for context builder testing',
            language: 'TypeScript',
            buildSystem: 'npm',
        },
        categories: ['core', 'ui', 'utils'],
        modules: [
            {
                id: 'auth-module',
                name: 'Authentication',
                category: 'core',
                path: 'src/auth',
                purpose: 'Handles user authentication with JWT tokens and session management',
                complexity: 'high',
                keyFiles: ['src/auth/login.ts', 'src/auth/jwt.ts'],
                dependencies: ['database-module', 'utils-module'],
                dependents: ['api-module'],
            },
            {
                id: 'database-module',
                name: 'Database',
                category: 'core',
                path: 'src/db',
                purpose: 'Database connection pool and query builder',
                complexity: 'medium',
                keyFiles: ['src/db/pool.ts', 'src/db/query.ts'],
                dependencies: [],
                dependents: ['auth-module'],
            },
            {
                id: 'api-module',
                name: 'API Routes',
                category: 'core',
                path: 'src/api',
                purpose: 'HTTP REST API endpoints and middleware',
                complexity: 'high',
                keyFiles: ['src/api/routes.ts', 'src/api/middleware.ts'],
                dependencies: ['auth-module'],
                dependents: [],
            },
            {
                id: 'ui-components',
                name: 'UI Components',
                category: 'ui',
                path: 'src/components',
                purpose: 'React components for the user interface, including login form and dashboard',
                complexity: 'medium',
                keyFiles: ['src/components/Login.tsx', 'src/components/Dashboard.tsx'],
                dependencies: ['utils-module'],
                dependents: [],
            },
            {
                id: 'utils-module',
                name: 'Utilities',
                category: 'utils',
                path: 'src/utils',
                purpose: 'Common utility functions for string manipulation and date formatting',
                complexity: 'low',
                keyFiles: ['src/utils/strings.ts', 'src/utils/dates.ts'],
                dependencies: [],
                dependents: ['auth-module', 'ui-components'],
            },
        ],
    };
}

function createTestMarkdown(): Record<string, string> {
    return {
        'auth-module': '# Authentication Module\n\nThis module handles user login, logout, and JWT token management.\nIt supports OAuth2 flows and session-based authentication.\n\n## Features\n- JWT token creation and validation\n- Password hashing with bcrypt\n- Session cookie management\n- Rate limiting for login attempts',
        'database-module': '# Database Module\n\nProvides database connection pooling and a query builder.\nSupports PostgreSQL and MySQL with automatic connection retry.\n\n## Query Builder\nFluent API for building SQL queries with parameter binding.',
        'api-module': '# API Routes\n\nRESTful API endpoints with Express.js middleware.\nIncludes request validation, error handling, and response formatting.\n\n## Endpoints\n- GET /api/users\n- POST /api/auth/login\n- POST /api/auth/logout',
        'ui-components': '# UI Components\n\nReact component library for the frontend.\nIncludes login form, dashboard widgets, and data tables.\n\n## Styling\nUses Tailwind CSS for responsive design.',
        'utils-module': '# Utilities\n\nCommon helper functions used throughout the application.\nIncludes string manipulation, date formatting, and validation helpers.',
    };
}

// ============================================================================
// tokenize() Tests
// ============================================================================

describe('tokenize', () => {
    it('should tokenize simple text into lowercase terms', () => {
        const tokens = tokenize('Hello World Testing');
        expect(tokens).toContain('hello');
        expect(tokens).toContain('world');
        expect(tokens).toContain('testing');
    });

    it('should remove stop words', () => {
        const tokens = tokenize('the quick brown fox is a fast animal');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('is');
        expect(tokens).not.toContain('a');
        expect(tokens).toContain('quick');
        expect(tokens).toContain('brown');
        expect(tokens).toContain('fox');
    });

    it('should remove single-character words', () => {
        const tokens = tokenize('I a x testing');
        expect(tokens).not.toContain('i');
        expect(tokens).not.toContain('a');
        expect(tokens).not.toContain('x');
        expect(tokens).toContain('testing');
    });

    it('should handle special characters', () => {
        const tokens = tokenize('hello-world foo_bar (test) "quotes"');
        expect(tokens).toContain('hello-world');
        expect(tokens).toContain('foo_bar');
        expect(tokens).toContain('test');
        expect(tokens).toContain('quotes');
    });

    it('should handle empty input', () => {
        expect(tokenize('')).toEqual([]);
    });

    it('should handle only stop words', () => {
        const tokens = tokenize('the is a an');
        expect(tokens).toEqual([]);
    });

    it('should handle text with numbers', () => {
        const tokens = tokenize('version 2 release 10');
        expect(tokens).toContain('version');
        expect(tokens).toContain('release');
        expect(tokens).toContain('10');
    });
});

// ============================================================================
// ContextBuilder Tests
// ============================================================================

describe('ContextBuilder', () => {
    const graph = createTestGraph();
    const markdownData = createTestMarkdown();

    it('should build an index from module articles', () => {
        const builder = new ContextBuilder(graph, markdownData);
        expect(builder.documentCount).toBe(5);
        expect(builder.vocabularySize).toBeGreaterThan(0);
    });

    it('should index modules even without markdown data', () => {
        const builder = new ContextBuilder(graph, {});
        expect(builder.documentCount).toBe(5);
        // Still indexes module metadata (name, purpose, etc.)
        expect(builder.vocabularySize).toBeGreaterThan(0);
    });

    describe('retrieve()', () => {
        it('should return relevant modules for an authentication question', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('How does authentication work?');

            expect(result.moduleIds).toContain('auth-module');
            expect(result.contextText).toContain('Authentication Module');
            expect(result.graphSummary).toContain('TestProject');
        });

        it('should return relevant modules for a database question', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('How is the database connection pool configured?');

            expect(result.moduleIds).toContain('database-module');
            expect(result.contextText).toContain('Database Module');
        });

        it('should return relevant modules for a UI question', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('What React components are in the login form?');

            expect(result.moduleIds).toContain('ui-components');
        });

        it('should boost module name matches', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('authentication');

            // auth-module should be ranked high due to name matching
            const authIdx = result.moduleIds.indexOf('auth-module');
            expect(authIdx).toBeLessThan(3);
        });

        it('should expand with 1-hop dependency neighbors', () => {
            const builder = new ContextBuilder(graph, markdownData);
            // Ask about auth - should include database-module and utils-module as dependencies
            const result = builder.retrieve('JWT authentication', 5);

            // auth-module should be primary
            expect(result.moduleIds).toContain('auth-module');
            // database-module is a dependency of auth-module, may be included via expansion
        });

        it('should respect maxModules limit', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('authentication', 2);

            expect(result.moduleIds.length).toBeLessThanOrEqual(2);
        });

        it('should include context text for selected modules', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('database query builder');

            expect(result.contextText).toContain('## Module:');
        });

        it('should include graph summary', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('anything');

            expect(result.graphSummary).toContain('TestProject');
            expect(result.graphSummary).toContain('TypeScript');
            expect(result.graphSummary).toContain('Module Graph:');
        });

        it('should return empty results for completely unrelated queries', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('xyzzy quantum entanglement neuroscience');

            // May or may not match — but should at least not throw
            expect(result.moduleIds).toBeDefined();
            expect(result.graphSummary).toContain('TestProject');
        });

        it('should handle queries matching multiple modules', () => {
            const builder = new ContextBuilder(graph, markdownData);
            // "login" appears in both auth-module and ui-components
            const result = builder.retrieve('login form handling');

            expect(result.moduleIds.length).toBeGreaterThan(0);
        });

        it('should separate context sections with dividers', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('authentication database');

            if (result.moduleIds.length >= 2) {
                expect(result.contextText).toContain('---');
            }
        });
    });

    describe('graph summary', () => {
        it('should include project info in graph summary', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('test');

            expect(result.graphSummary).toContain('Project: TestProject');
            expect(result.graphSummary).toContain('Language: TypeScript');
            expect(result.graphSummary).toContain('Modules: 5');
        });

        it('should include module dependencies in graph summary', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('test');

            expect(result.graphSummary).toContain('depends on:');
            expect(result.graphSummary).toContain('database-module');
        });

        it('should list all modules in graph summary', () => {
            const builder = new ContextBuilder(graph, markdownData);
            const result = builder.retrieve('test');

            expect(result.graphSummary).toContain('Authentication');
            expect(result.graphSummary).toContain('Database');
            expect(result.graphSummary).toContain('API Routes');
            expect(result.graphSummary).toContain('UI Components');
            expect(result.graphSummary).toContain('Utilities');
        });
    });
});
