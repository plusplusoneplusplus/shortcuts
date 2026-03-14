import { describe, it, expect } from 'vitest';
import { parseGitHubApiResponse } from '../../src/skills/github-api-utils';

describe('parseGitHubApiResponse', () => {
    it('parses a valid JSON object', () => {
        const result = parseGitHubApiResponse('{"name":"repo","size":42}');
        expect(result).toEqual({ name: 'repo', size: 42 });
    });

    it('parses a valid JSON array', () => {
        const result = parseGitHubApiResponse('[{"type":"dir"},{"type":"file"}]');
        expect(result).toEqual([{ type: 'dir' }, { type: 'file' }]);
    });

    it('returns null for empty string', () => {
        expect(parseGitHubApiResponse('')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
        expect(parseGitHubApiResponse('not-json')).toBeNull();
    });

    it('returns null for truncated JSON', () => {
        expect(parseGitHubApiResponse('{"key":')).toBeNull();
    });

    it('parses JSON primitives', () => {
        expect(parseGitHubApiResponse('"hello"')).toBe('hello');
        expect(parseGitHubApiResponse('123')).toBe(123);
        expect(parseGitHubApiResponse('true')).toBe(true);
        expect(parseGitHubApiResponse('null')).toBeNull();
    });
});
