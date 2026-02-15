/**
 * Merge Response Parser Tests
 *
 * Tests for parsing AI responses into MergeResult.
 * Verifies graph parsing, newThemes extraction, and convergence detection.
 */

import { describe, it, expect } from 'vitest';
import { parseMergeResponse } from '../../../src/discovery/iterative/merge-response-parser';

describe('parseMergeResponse', () => {
    describe('valid merge response', () => {
        it('should parse a valid merge response with graph and newThemes', () => {
            const json = JSON.stringify({
                graph: {
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
                    categories: [{ name: 'core', description: 'Core modules' }],
                    architectureNotes: 'Layered',
                },
                newThemes: [
                    {
                        theme: 'authorization',
                        description: 'Permission checking',
                        hints: ['permission', 'role'],
                    },
                ],
                converged: false,
                coverage: 0.6,
                reason: 'Coverage 0.6, 1 new theme discovered',
            });

            const result = parseMergeResponse(json);
            expect(result.graph.project.name).toBe('test-project');
            expect(result.graph.components).toHaveLength(1);
            expect(result.newThemes).toHaveLength(1);
            expect(result.newThemes[0].theme).toBe('authorization');
            expect(result.converged).toBe(false);
            expect(result.coverage).toBe(0.6);
            expect(result.reason).toContain('Coverage 0.6');
        });

        it('should parse response with converged=true', () => {
            const json = JSON.stringify({
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
                newThemes: [],
                converged: true,
                coverage: 0.85,
                reason: 'Coverage 0.85, no new themes',
            });

            const result = parseMergeResponse(json);
            expect(result.converged).toBe(true);
            expect(result.coverage).toBe(0.85);
            expect(result.newThemes).toHaveLength(0);
        });

        it('should default coverage to 0 if not provided', () => {
            const json = JSON.stringify({
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
                newThemes: [],
                converged: false,
                reason: 'Not converged',
            });

            const result = parseMergeResponse(json);
            expect(result.coverage).toBe(0);
        });

        it('should normalize component IDs in graph', () => {
            const json = JSON.stringify({
                graph: {
                    project: {
                        name: 'test-project',
                        description: 'Test',
                        language: 'TypeScript',
                        buildSystem: 'npm',
                        entryPoints: [],
                    },
                    components: [
                        {
                            id: 'AuthService',
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
                    architectureNotes: '',
                },
                newThemes: [],
                converged: true,
                coverage: 1.0,
                reason: 'Complete',
            });

            const result = parseMergeResponse(json);
            expect(result.graph.components[0].id).toBe('authservice');
        });

        it('should normalize theme IDs in newThemes', () => {
            const json = JSON.stringify({
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
                newThemes: [
                    {
                        theme: 'API Gateway',
                        description: 'Gateway',
                        hints: ['api', 'gateway'],
                    },
                ],
                converged: false,
                coverage: 0.5,
                reason: 'New theme',
            });

            const result = parseMergeResponse(json);
            expect(result.newThemes[0].theme).toBe('api-gateway');
        });
    });

    describe('JSON wrapped in markdown', () => {
        it('should extract JSON from markdown code blocks', () => {
            const response = `Here's the merged result:

\`\`\`json
{
  "graph": {
    "project": {
      "name": "test-project",
      "description": "Test",
      "language": "TypeScript",
      "buildSystem": "npm",
      "entryPoints": []
    },
    "modules": [],
    "categories": [],
    "architectureNotes": ""
  },
  "newThemes": [],
  "converged": true,
  "coverage": 0.9,
  "reason": "Complete"
}
\`\`\`

That's the merge.`;

            const result = parseMergeResponse(response);
            expect(result.converged).toBe(true);
            expect(result.coverage).toBe(0.9);
        });
    });

    describe('error handling', () => {
        it('should throw on empty response', () => {
            expect(() => parseMergeResponse('')).toThrow();
        });

        it('should throw on invalid JSON', () => {
            expect(() => parseMergeResponse('not json')).toThrow();
        });

        it('should throw on missing graph field', () => {
            const json = JSON.stringify({
                newThemes: [],
                converged: true,
                coverage: 1.0,
            });

            expect(() => parseMergeResponse(json)).toThrow('graph');
        });

        it('should throw on invalid graph', () => {
            const json = JSON.stringify({
                graph: { invalid: 'graph' },
                newThemes: [],
                converged: true,
                coverage: 1.0,
            });

            expect(() => parseMergeResponse(json)).toThrow();
        });

        it('should handle missing newThemes (defaults to empty array)', () => {
            const json = JSON.stringify({
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
                converged: true,
                coverage: 1.0,
                reason: 'Complete',
            });

            const result = parseMergeResponse(json);
            expect(result.newThemes).toEqual([]);
        });
    });
});
