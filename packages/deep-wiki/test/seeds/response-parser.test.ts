/**
 * Seeds Response Parser Tests
 *
 * Tests for parsing AI responses into TopicSeed arrays.
 */

import { describe, it, expect } from 'vitest';
import { parseSeedsResponse } from '../../src/seeds/response-parser';

describe('Seeds Response Parser', () => {
    describe('parseSeedsResponse', () => {
        it('should parse valid JSON response with multiple topics', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'authentication',
                        description: 'User authentication and authorization',
                        hints: ['auth', 'login', 'password'],
                    },
                    {
                        topic: 'api-gateway',
                        description: 'API gateway and routing',
                        hints: ['gateway', 'routing', 'api'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].topic).toBe('authentication');
            expect(seeds[0].description).toBe('User authentication and authorization');
            expect(seeds[0].hints).toEqual(['auth', 'login', 'password']);
        });

        it('should parse response wrapped in markdown code blocks', () => {
            const response = `Here's the JSON:
\`\`\`json
{
  "topics": [
    {
      "topic": "database",
      "description": "Database layer",
      "hints": ["db", "sql"]
    }
  ]
}
\`\`\`
That's the result.`;

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(1);
            expect(seeds[0].topic).toBe('database');
        });

        it('should normalize topic IDs to kebab-case', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'API Gateway',
                        description: 'API gateway',
                        hints: ['api'],
                    },
                    {
                        topic: 'user_authentication',
                        description: 'Auth',
                        hints: ['auth'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].topic).toBe('api-gateway');
            expect(seeds[1].topic).toBe('user-authentication');
        });

        it('should handle hints as comma-separated string', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'auth',
                        description: 'Authentication',
                        hints: 'login,password,token',
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].hints).toEqual(['login', 'password', 'token']);
        });

        it('should default hints to topic name if missing', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'database',
                        description: 'Database layer',
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].hints).toEqual(['database']);
        });

        it('should skip invalid topics and continue parsing', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'valid-topic',
                        description: 'Valid topic',
                        hints: ['hint'],
                    },
                    {
                        // Missing topic field
                        description: 'Invalid topic',
                    },
                    {
                        topic: 'another-valid',
                        description: 'Another valid',
                        hints: ['hint2'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].topic).toBe('valid-topic');
            expect(seeds[1].topic).toBe('another-valid');
        });

        it('should deduplicate topics by ID', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'auth',
                        description: 'First auth',
                        hints: ['hint1'],
                    },
                    {
                        topic: 'auth',
                        description: 'Second auth',
                        hints: ['hint2'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(1);
            expect(seeds[0].description).toBe('First auth');
        });

        it('should throw error on empty response', () => {
            expect(() => parseSeedsResponse('')).toThrow();
        });

        it('should throw error on non-JSON response', () => {
            expect(() => parseSeedsResponse('This is not JSON')).toThrow();
        });

        it('should throw error on missing topics field', () => {
            const response = JSON.stringify({
                something: 'else',
            });
            expect(() => parseSeedsResponse(response)).toThrow("Missing 'topics' field");
        });

        it('should throw error if topics is not an array', () => {
            const response = JSON.stringify({
                topics: 'not an array',
            });
            expect(() => parseSeedsResponse(response)).toThrow("'topics' field must be an array");
        });

        it('should filter empty hints', () => {
            const response = JSON.stringify({
                topics: [
                    {
                        topic: 'auth',
                        description: 'Auth',
                        hints: ['valid', '', '  ', 'another'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].hints).toEqual(['valid', 'another']);
        });
    });
});
