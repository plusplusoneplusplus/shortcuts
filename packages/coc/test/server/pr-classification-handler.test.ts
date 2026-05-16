/**
 * Tests for pr-classification-handler — unit tests for the classification route handler.
 */

import { describe, it, expect } from 'vitest';
import {
    extractClassificationFromResult,
    classificationCacheTag,
    buildClassificationPrompt,
} from '../../src/server/repos/pr-classification-handler';
import type { DiffClassificationResult } from '../../src/server/spa/client/react/features/pull-requests/classification-types';

// ── extractClassificationFromResult ──────────────────────────────────────────

describe('extractClassificationFromResult', () => {
    const validResult: DiffClassificationResult = {
        classifications: [
            { file: 'src/main.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'New feature logic' },
            { file: 'src/utils.ts', hunkIndex: 1, category: 'mechanical', intensity: 'low', reason: 'Import reorder' },
        ],
    };

    it('should parse a plain JSON string', () => {
        const input = JSON.stringify(validResult);
        const result = extractClassificationFromResult(input);
        expect(result).toEqual(validResult);
    });

    it('should parse JSON inside a code fence', () => {
        const input = 'Here is the classification:\n```json\n' + JSON.stringify(validResult) + '\n```\nDone.';
        const result = extractClassificationFromResult(input);
        expect(result).toEqual(validResult);
    });

    it('should parse JSON embedded in text without fence', () => {
        const input = 'The result is: ' + JSON.stringify(validResult) + ' — that is all.';
        const result = extractClassificationFromResult(input);
        expect(result).toEqual(validResult);
    });

    it('should return undefined for empty input', () => {
        expect(extractClassificationFromResult(undefined)).toBeUndefined();
        expect(extractClassificationFromResult('')).toBeUndefined();
    });

    it('should return undefined for invalid JSON', () => {
        expect(extractClassificationFromResult('not json at all')).toBeUndefined();
    });

    it('should return undefined when classifications array has invalid entries', () => {
        const invalid = { classifications: [{ file: 'a.ts' }] }; // missing fields
        expect(extractClassificationFromResult(JSON.stringify(invalid))).toBeUndefined();
    });

    it('should return undefined when JSON has no classifications key', () => {
        expect(extractClassificationFromResult('{"hunks": []}')).toBeUndefined();
    });

    it('should handle pretty-printed JSON in code fence', () => {
        const pretty = JSON.stringify(validResult, null, 2);
        const input = '```json\n' + pretty + '\n```';
        const result = extractClassificationFromResult(input);
        expect(result).toEqual(validResult);
    });
});

// ── classificationCacheTag ───────────────────────────────────────────────────

describe('classificationCacheTag', () => {
    it('should produce a deterministic tag from repo, pr, and sha', () => {
        const tag = classificationCacheTag('repo-abc', '42', 'deadbeef');
        expect(tag).toBe('classify-diff:repo-abc:42:deadbeef');
    });

    it('should produce different tags for different SHAs', () => {
        const tag1 = classificationCacheTag('repo', '1', 'sha1');
        const tag2 = classificationCacheTag('repo', '1', 'sha2');
        expect(tag1).not.toBe(tag2);
    });

    it('should produce different tags for different PRs', () => {
        const tag1 = classificationCacheTag('repo', '1', 'sha');
        const tag2 = classificationCacheTag('repo', '2', 'sha');
        expect(tag1).not.toBe(tag2);
    });
});

// ── buildClassificationPrompt ────────────────────────────────────────────────

describe('buildClassificationPrompt', () => {
    it('should include the PR number in the prompt', () => {
        const prompt = buildClassificationPrompt('my-repo', '42');
        expect(prompt).toContain('pull request #42');
    });

    it('should embed the cache tag when provided', () => {
        const tag = 'classify-diff:repo:42:abc123def';
        const prompt = buildClassificationPrompt('repo', '42', tag);
        expect(prompt).toContain(`<!-- cache-key: ${tag} -->`);
    });

    it('should NOT include cache-key comment when cacheTag is omitted', () => {
        const prompt = buildClassificationPrompt('repo', '42');
        expect(prompt).not.toContain('cache-key');
    });

    it('should include instructions to use git tools', () => {
        const prompt = buildClassificationPrompt('repo', '42');
        expect(prompt).toContain('git');
        expect(prompt).toContain('gh');
    });

    it('should include JSON schema guidance', () => {
        const prompt = buildClassificationPrompt('repo', '42');
        expect(prompt).toContain('"classifications"');
        expect(prompt).toContain('"category"');
        expect(prompt).toContain('"intensity"');
    });
});
