/**
 * Seeds Response Parser Tests
 *
 * Tests for parsing AI responses into ThemeSeed arrays.
 */

import { describe, it, expect } from 'vitest';
import { parseSeedsResponse } from '../../src/seeds/response-parser';

describe('Seeds Response Parser', () => {
    describe('parseSeedsResponse', () => {
        it('should parse valid JSON response with multiple themes', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'authentication',
                        description: 'User authentication and authorization',
                        hints: ['auth', 'login', 'password'],
                    },
                    {
                        theme: 'api-gateway',
                        description: 'API gateway and routing',
                        hints: ['gateway', 'routing', 'api'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].theme).toBe('authentication');
            expect(seeds[0].description).toBe('User authentication and authorization');
            expect(seeds[0].hints).toEqual(['auth', 'login', 'password']);
        });

        it('should parse response wrapped in markdown code blocks', () => {
            const response = `Here's the JSON:
\`\`\`json
{
  "themes": [
    {
      "theme": "database",
      "description": "Database layer",
      "hints": ["db", "sql"]
    }
  ]
}
\`\`\`
That's the result.`;

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(1);
            expect(seeds[0].theme).toBe('database');
        });

        it('should normalize theme IDs to kebab-case', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'API Gateway',
                        description: 'API gateway',
                        hints: ['api'],
                    },
                    {
                        theme: 'user_authentication',
                        description: 'Auth',
                        hints: ['auth'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].theme).toBe('api-gateway');
            expect(seeds[1].theme).toBe('user-authentication');
        });

        it('should handle hints as comma-separated string', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'auth',
                        description: 'Authentication',
                        hints: 'login,password,token',
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].hints).toEqual(['login', 'password', 'token']);
        });

        it('should default hints to theme name if missing', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'database',
                        description: 'Database layer',
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds[0].hints).toEqual(['database']);
        });

        it('should skip invalid themes and continue parsing', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'valid-theme',
                        description: 'Valid theme',
                        hints: ['hint'],
                    },
                    {
                        // Missing theme field
                        description: 'Invalid theme',
                    },
                    {
                        theme: 'another-valid',
                        description: 'Another valid',
                        hints: ['hint2'],
                    },
                ],
            });

            const seeds = parseSeedsResponse(response);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].theme).toBe('valid-theme');
            expect(seeds[1].theme).toBe('another-valid');
        });

        it('should deduplicate themes by ID', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'auth',
                        description: 'First auth',
                        hints: ['hint1'],
                    },
                    {
                        theme: 'auth',
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

        it('should throw error on missing themes field', () => {
            const response = JSON.stringify({
                something: 'else',
            });
            expect(() => parseSeedsResponse(response)).toThrow("Missing 'themes' field");
        });

        it('should throw error if themes is not an array', () => {
            const response = JSON.stringify({
                themes: 'not an array',
            });
            expect(() => parseSeedsResponse(response)).toThrow("'themes' field must be an array");
        });

        it('should filter empty hints', () => {
            const response = JSON.stringify({
                themes: [
                    {
                        theme: 'auth',
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
