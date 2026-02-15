/**
 * Discovery Prompt Builder Tests
 *
 * Tests for the pure-Node discovery prompt-building and response parsing functions.
 */

import { describe, it, expect } from 'vitest';
import {
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
} from '../../src/tasks/discovery-prompt-builder';
import type { DiscoveryPromptInput } from '../../src/tasks/discovery-prompt-builder';

// ============================================================================
// buildDiscoveryPrompt
// ============================================================================

describe('buildDiscoveryPrompt', () => {
    it('should include feature description', () => {
        const input: DiscoveryPromptInput = {
            featureDescription: 'User authentication module',
            workspaceRoot: '/workspace',
        };
        const prompt = buildDiscoveryPrompt(input);
        expect(prompt).toContain('User authentication module');
    });

    it('should include workspace root', () => {
        const input: DiscoveryPromptInput = {
            featureDescription: 'test',
            workspaceRoot: '/my/project',
        };
        const prompt = buildDiscoveryPrompt(input);
        expect(prompt).toContain('/my/project');
    });

    it('should include keywords when provided', () => {
        const input: DiscoveryPromptInput = {
            featureDescription: 'test',
            keywords: ['auth', 'jwt', 'token'],
            workspaceRoot: '/ws',
        };
        const prompt = buildDiscoveryPrompt(input);
        expect(prompt).toContain('auth');
        expect(prompt).toContain('jwt');
        expect(prompt).toContain('token');
    });

    it('should include git history scope when enabled', () => {
        const input: DiscoveryPromptInput = {
            featureDescription: 'test',
            scope: { includeGitHistory: true, maxCommits: 100 },
            workspaceRoot: '/ws',
        };
        const prompt = buildDiscoveryPrompt(input);
        expect(prompt).toContain('git commits');
        expect(prompt).toContain('100');
    });

    it('should use default scope when not provided', () => {
        const input: DiscoveryPromptInput = {
            featureDescription: 'test',
            workspaceRoot: '/ws',
        };
        const prompt = buildDiscoveryPrompt(input);
        expect(prompt).toContain('source code files');
        expect(prompt).toContain('documentation files');
    });
});

// ============================================================================
// parseDiscoveryResponse
// ============================================================================

describe('parseDiscoveryResponse', () => {
    it('should return empty array for empty response', () => {
        expect(parseDiscoveryResponse('')).toEqual([]);
    });

    it('should return empty array for undefined-like input', () => {
        expect(parseDiscoveryResponse(undefined as any)).toEqual([]);
    });

    it('should parse valid JSON array', () => {
        const response = JSON.stringify([
            {
                name: 'auth.ts',
                path: 'src/auth.ts',
                type: 'file',
                category: 'source',
                relevance: 90,
                reason: 'Main auth module',
            },
        ]);
        const items = parseDiscoveryResponse(response);
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('auth.ts');
        expect(items[0].type).toBe('file');
        expect(items[0].relevance).toBe(90);
    });

    it('should strip markdown code fences', () => {
        const json = JSON.stringify([
            { name: 'test.ts', type: 'file', category: 'test', relevance: 80, reason: 'Test file' },
        ]);
        const response = '```json\n' + json + '\n```';
        const items = parseDiscoveryResponse(response);
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('test.ts');
    });

    it('should filter out invalid items', () => {
        const response = JSON.stringify([
            { name: 'valid.ts', type: 'file', relevance: 50, reason: 'ok' },
            { name: 'missing-type' }, // no type field
            null,
            { name: 'bad-type', type: 'unknown' }, // invalid type
        ]);
        const items = parseDiscoveryResponse(response);
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('valid.ts');
    });

    it('should handle commit type items', () => {
        const response = JSON.stringify([
            {
                name: 'Add auth module',
                type: 'commit',
                category: 'commit',
                relevance: 75,
                reason: 'Related commit',
                hash: 'abc1234',
            },
        ]);
        const items = parseDiscoveryResponse(response);
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('commit');
        expect(items[0].hash).toBe('abc1234');
    });

    it('should default missing fields', () => {
        const response = JSON.stringify([
            { name: 'file.ts', type: 'file' },
        ]);
        const items = parseDiscoveryResponse(response);
        expect(items[0].category).toBe('source');
        expect(items[0].relevance).toBe(50);
        expect(items[0].reason).toBe('');
    });

    it('should return empty array for non-JSON response', () => {
        expect(parseDiscoveryResponse('This is not JSON')).toEqual([]);
    });

    it('should return empty array for JSON object (not array)', () => {
        expect(parseDiscoveryResponse('{"key": "value"}')).toEqual([]);
    });
});
