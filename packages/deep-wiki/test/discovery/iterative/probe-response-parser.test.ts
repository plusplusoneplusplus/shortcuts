/**
 * Probe Response Parser Tests
 *
 * Tests for parsing AI responses into TopicProbeResult.
 * Verifies JSON extraction, validation, normalization, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { parseProbeResponse } from '../../../src/discovery/iterative/probe-response-parser';

describe('parseProbeResponse', () => {
    describe('valid JSON response', () => {
        it('should parse a valid probe response with modules', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [
                    {
                        id: 'auth-service',
                        name: 'Auth Service',
                        path: 'src/auth/',
                        purpose: 'Handles user authentication',
                        keyFiles: ['src/auth/index.ts', 'src/auth/login.ts'],
                        evidence: 'Contains login and token validation logic',
                    },
                ],
                discoveredTopics: [],
                dependencies: [],
                confidence: 0.9,
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.topic).toBe('authentication');
            expect(result.foundComponents).toHaveLength(1);
            expect(result.foundComponents[0].id).toBe('auth-service');
            expect(result.foundComponents[0].name).toBe('Auth Service');
            expect(result.confidence).toBe(0.9);
        });

        it('should parse response with discovered topics', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [],
                discoveredTopics: [
                    {
                        topic: 'authorization',
                        description: 'Permission checking',
                        hints: ['permission', 'role'],
                        source: 'src/auth/permissions.ts',
                    },
                ],
                dependencies: [],
                confidence: 0.7,
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.discoveredTopics).toHaveLength(1);
            expect(result.discoveredTopics[0].topic).toBe('authorization');
        });

        it('should parse response with line ranges', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [
                    {
                        id: 'auth-service',
                        name: 'Auth Service',
                        path: 'src/auth.ts',
                        purpose: 'Monolithic auth file',
                        keyFiles: ['src/auth.ts'],
                        evidence: 'Large file with auth logic',
                        lineRanges: [[10, 50], [100, 150]],
                    },
                ],
                discoveredTopics: [],
                dependencies: [],
                confidence: 0.8,
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.foundComponents[0].lineRanges).toEqual([[10, 50], [100, 150]]);
        });

        it('should default confidence to 0.5 if not provided', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [],
                discoveredTopics: [],
                dependencies: [],
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.confidence).toBe(0.5);
        });

        it('should normalize component IDs', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [
                    {
                        id: 'AuthService',
                        name: 'Auth Service',
                        path: 'src/auth/',
                        purpose: 'Auth',
                        keyFiles: [],
                        evidence: 'Evidence',
                    },
                ],
                discoveredTopics: [],
                dependencies: [],
                confidence: 0.8,
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.foundComponents[0].id).toBe('authservice');
        });

        it('should handle empty foundComponents', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [],
                discoveredTopics: [],
                dependencies: [],
                confidence: 0.3,
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.foundComponents).toHaveLength(0);
            expect(result.confidence).toBe(0.3);
        });
    });

    describe('JSON wrapped in markdown', () => {
        it('should extract JSON from markdown code blocks', () => {
            const response = `Here's the result:

\`\`\`json
{
  "topic": "authentication",
  "foundComponents": [{
    "id": "auth-service",
    "name": "Auth Service",
    "path": "src/auth/",
    "purpose": "Auth",
    "keyFiles": [],
    "evidence": "Evidence"
  }],
  "discoveredTopics": [],
  "dependencies": [],
  "confidence": 0.8
}
\`\`\`

That's the analysis.`;

            const result = parseProbeResponse(response, 'authentication');
            expect(result.topic).toBe('authentication');
            expect(result.foundComponents).toHaveLength(1);
        });
    });

    describe('error handling', () => {
        it('should throw on empty response', () => {
            expect(() => parseProbeResponse('', 'authentication')).toThrow();
        });

        it('should throw on invalid JSON', () => {
            expect(() => parseProbeResponse('not json', 'authentication')).toThrow();
        });

        it('should throw on missing topic field', () => {
            const json = JSON.stringify({
                foundComponents: [],
                discoveredTopics: [],
                dependencies: [],
            });

            expect(() => parseProbeResponse(json, 'authentication')).toThrow('topic');
        });

        it('should throw on missing foundComponents field', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                discoveredTopics: [],
                dependencies: [],
            });

            expect(() => parseProbeResponse(json, 'authentication')).toThrow('foundComponents');
        });

        it('should skip invalid modules', () => {
            const json = JSON.stringify({
                topic: 'authentication',
                foundComponents: [
                    { id: 'valid-component', name: 'Valid', path: 'src/', purpose: 'Purpose', keyFiles: [], evidence: 'Evidence' },
                    { invalid: 'module' }, // Missing required fields
                    { id: 'another-valid', name: 'Another', path: 'src/', purpose: 'Purpose', keyFiles: [], evidence: 'Evidence' },
                ],
                discoveredTopics: [],
                dependencies: [],
                confidence: 0.8,
            });

            const result = parseProbeResponse(json, 'authentication');
            expect(result.foundComponents).toHaveLength(2);
        });
    });
});
