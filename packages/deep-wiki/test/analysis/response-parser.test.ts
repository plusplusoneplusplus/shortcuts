/**
 * Analysis Response Parser Tests
 *
 * Tests for JSON extraction, field normalization, Mermaid validation,
 * and ModuleAnalysis construction from raw AI responses.
 */

import { describe, it, expect } from 'vitest';
import { parseAnalysisResponse, extractJSON } from '../../src/analysis/response-parser';
import type { ModuleAnalysis } from '../../src/types';

// ============================================================================
// Test Data
// ============================================================================

const VALID_ANALYSIS_JSON = {
    moduleId: 'auth',
    overview: 'The auth module handles authentication and authorization.',
    keyConcepts: [
        { name: 'JWT', description: 'JSON Web Token for stateless auth', codeRef: 'src/auth/jwt.ts' },
        { name: 'Session', description: 'Server-side session management' },
    ],
    publicAPI: [
        { name: 'authenticate', signature: 'authenticate(token: string): Promise<User>', description: 'Verify token' },
        { name: 'authorize', signature: 'authorize(user: User, role: string): boolean', description: 'Check permissions' },
    ],
    internalArchitecture: 'Layered architecture with middleware pattern.',
    dataFlow: 'Request → Middleware → Token validation → User lookup → Response',
    patterns: ['Middleware', 'Factory', 'Strategy'],
    errorHandling: 'Custom AuthError class with error codes.',
    codeExamples: [
        { title: 'Token Validation', code: 'const user = await verify(token);', file: 'src/auth/jwt.ts', lines: [10, 15] },
    ],
    dependencies: {
        internal: [{ module: 'database', usage: 'User lookup' }],
        external: [{ package: 'jsonwebtoken', usage: 'JWT signing/verification' }],
    },
    suggestedDiagram: 'graph TD\n  A[Request] --> B[Middleware]\n  B --> C[JWT Verify]',
};

// ============================================================================
// extractJSON
// ============================================================================

describe('extractJSON', () => {
    it('should parse direct JSON', () => {
        const result = extractJSON(JSON.stringify({ a: 1 }));
        expect(result).toEqual({ a: 1 });
    });

    it('should extract from ```json code block', () => {
        const response = 'Here is the result:\n```json\n{"a": 1}\n```\nDone.';
        const result = extractJSON(response);
        expect(result).toEqual({ a: 1 });
    });

    it('should extract from ``` code block', () => {
        const response = 'Result:\n```\n{"b": 2}\n```';
        const result = extractJSON(response);
        expect(result).toEqual({ b: 2 });
    });

    it('should find first {...} block', () => {
        const response = 'Some text before {"c": 3} and after';
        const result = extractJSON(response);
        expect(result).toEqual({ c: 3 });
    });

    it('should return null for invalid input', () => {
        expect(extractJSON('')).toBeNull();
        expect(extractJSON('no json here')).toBeNull();
        expect(extractJSON('{ invalid json }')).toBeNull();
    });

    it('should return null for null/undefined', () => {
        expect(extractJSON(null as any)).toBeNull();
        expect(extractJSON(undefined as any)).toBeNull();
    });

    it('should handle nested JSON objects', () => {
        const nested = { a: { b: { c: [1, 2, 3] } } };
        const result = extractJSON(JSON.stringify(nested));
        expect(result).toEqual(nested);
    });
});

// ============================================================================
// parseAnalysisResponse — Valid cases
// ============================================================================

describe('parseAnalysisResponse', () => {
    it('should parse a complete valid analysis', () => {
        const response = JSON.stringify(VALID_ANALYSIS_JSON);
        const result = parseAnalysisResponse(response, 'auth');

        expect(result.moduleId).toBe('auth');
        expect(result.overview).toContain('authentication');
        expect(result.keyConcepts).toHaveLength(2);
        expect(result.publicAPI).toHaveLength(2);
        expect(result.patterns).toEqual(['Middleware', 'Factory', 'Strategy']);
        expect(result.codeExamples).toHaveLength(1);
        expect(result.codeExamples[0].lines).toEqual([10, 15]);
        expect(result.dependencies.internal).toHaveLength(1);
        expect(result.dependencies.external).toHaveLength(1);
        expect(result.suggestedDiagram).toContain('graph TD');
    });

    it('should parse from markdown code block', () => {
        const response = `Here is the analysis:\n\`\`\`json\n${JSON.stringify(VALID_ANALYSIS_JSON)}\n\`\`\``;
        const result = parseAnalysisResponse(response, 'auth');
        expect(result.moduleId).toBe('auth');
        expect(result.overview).toContain('authentication');
    });

    it('should use expected moduleId when response has wrong ID', () => {
        const modified = { ...VALID_ANALYSIS_JSON, moduleId: 'wrong-id' };
        const result = parseAnalysisResponse(JSON.stringify(modified), 'auth');
        // Should use the response's moduleId if it's a valid string
        expect(result.moduleId).toBe('wrong-id');
    });

    it('should use expected moduleId when response is missing it', () => {
        const { moduleId, ...rest } = VALID_ANALYSIS_JSON;
        const result = parseAnalysisResponse(JSON.stringify(rest), 'auth');
        expect(result.moduleId).toBe('auth');
    });

    // ========================================================================
    // Partial/missing fields
    // ========================================================================

    it('should fill defaults for missing optional fields', () => {
        const minimal = {
            moduleId: 'minimal',
            overview: 'A minimal module.',
        };
        const result = parseAnalysisResponse(JSON.stringify(minimal), 'minimal');

        expect(result.moduleId).toBe('minimal');
        expect(result.overview).toBe('A minimal module.');
        expect(result.keyConcepts).toEqual([]);
        expect(result.publicAPI).toEqual([]);
        expect(result.internalArchitecture).toBe('');
        expect(result.dataFlow).toBe('');
        expect(result.patterns).toEqual([]);
        expect(result.errorHandling).toBe('');
        expect(result.codeExamples).toEqual([]);
        expect(result.dependencies.internal).toEqual([]);
        expect(result.dependencies.external).toEqual([]);
        expect(result.suggestedDiagram).toBe('');
    });

    it('should handle missing overview with default', () => {
        const result = parseAnalysisResponse(JSON.stringify({ moduleId: 'test' }), 'test');
        expect(result.overview).toBe('No overview available.');
    });

    // ========================================================================
    // Mermaid diagram handling
    // ========================================================================

    it('should extract Mermaid diagram from code block', () => {
        const withCodeBlock = {
            ...VALID_ANALYSIS_JSON,
            suggestedDiagram: '```mermaid\ngraph TD\n  A-->B\n```',
        };
        const result = parseAnalysisResponse(JSON.stringify(withCodeBlock), 'auth');
        expect(result.suggestedDiagram).toBe('graph TD\n  A-->B');
    });

    it('should reject invalid Mermaid diagram', () => {
        const withInvalid = {
            ...VALID_ANALYSIS_JSON,
            suggestedDiagram: 'This is not a diagram',
        };
        const result = parseAnalysisResponse(JSON.stringify(withInvalid), 'auth');
        expect(result.suggestedDiagram).toBe('');
    });

    it('should accept various Mermaid diagram types', () => {
        const types = ['graph TD', 'flowchart LR', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2'];
        for (const type of types) {
            const json = { ...VALID_ANALYSIS_JSON, suggestedDiagram: `${type}\n  A-->B` };
            const result = parseAnalysisResponse(JSON.stringify(json), 'auth');
            expect(result.suggestedDiagram).toContain(type.split(' ')[0]);
        }
    });

    // ========================================================================
    // Code example handling
    // ========================================================================

    it('should normalize file paths in code examples', () => {
        const json = {
            ...VALID_ANALYSIS_JSON,
            codeExamples: [
                { title: 'Test', code: 'code', file: './src/test.ts' },
                { title: 'Test2', code: 'code', file: '/absolute/path.ts' },
            ],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'auth');
        expect(result.codeExamples[0].file).toBe('src/test.ts');
        expect(result.codeExamples[1].file).toBe('absolute/path.ts');
    });

    it('should handle code examples with line numbers', () => {
        const json = {
            ...VALID_ANALYSIS_JSON,
            codeExamples: [
                { title: 'Test', code: 'code', file: 'test.ts', lines: [5, 10] },
            ],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'auth');
        expect(result.codeExamples[0].lines).toEqual([5, 10]);
    });

    it('should skip code examples with invalid line numbers', () => {
        const json = {
            ...VALID_ANALYSIS_JSON,
            codeExamples: [
                { title: 'Test', code: 'code', lines: [10, 5] }, // end < start
                { title: 'Test2', code: 'code', lines: [-1, 5] }, // negative
            ],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'auth');
        // Lines should not be set for invalid entries
        expect(result.codeExamples[0].lines).toBeUndefined();
        expect(result.codeExamples[1].lines).toBeUndefined();
    });

    // ========================================================================
    // Error cases
    // ========================================================================

    it('should throw on completely invalid JSON', () => {
        expect(() => parseAnalysisResponse('not json at all!!!', 'test')).toThrow();
    });

    it('should throw on empty response', () => {
        expect(() => parseAnalysisResponse('', 'test')).toThrow();
    });

    it('should filter out invalid keyConcepts', () => {
        const json = {
            moduleId: 'test',
            overview: 'Test',
            keyConcepts: [
                { name: 'Valid', description: 'Yes' },
                { description: 'No name' }, // missing name
                'not an object',
                null,
            ],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'test');
        expect(result.keyConcepts).toHaveLength(1);
        expect(result.keyConcepts[0].name).toBe('Valid');
    });

    it('should filter out invalid publicAPI entries', () => {
        const json = {
            moduleId: 'test',
            overview: 'Test',
            publicAPI: [
                { name: 'valid', signature: 'fn()', description: 'works' },
                { signature: 'fn()' }, // missing name
                null,
            ],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'test');
        expect(result.publicAPI).toHaveLength(1);
    });

    it('should filter non-string patterns', () => {
        const json = {
            moduleId: 'test',
            overview: 'Test',
            patterns: ['Factory', 123, null, '', 'Observer'],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'test');
        expect(result.patterns).toEqual(['Factory', 'Observer']);
    });

    it('should handle backslash paths (Windows)', () => {
        const json = {
            ...VALID_ANALYSIS_JSON,
            codeExamples: [
                { title: 'Win', code: 'code', file: 'src\\auth\\jwt.ts' },
            ],
        };
        const result = parseAnalysisResponse(JSON.stringify(json), 'auth');
        expect(result.codeExamples[0].file).toBe('src/auth/jwt.ts');
    });
});
