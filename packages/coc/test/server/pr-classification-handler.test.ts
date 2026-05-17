/**
 * Tests for pr-classification-handler — unit tests for prompt and tag helpers.
 *
 * Route-level behavior (POST/GET) is covered indirectly via the file-based
 * classification-store tests. The legacy `extractClassificationFromResult`
 * has been removed in favour of the `saveClassification` LLM tool.
 */

import { describe, it, expect } from 'vitest';
import {
    classificationCacheTag,
    buildClassificationPrompt,
} from '../../src/server/repos/pr-classification-handler';

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

    it('should mention the saveClassification tool', () => {
        const prompt = buildClassificationPrompt('repo', '42');
        expect(prompt).toContain('saveClassification');
    });
});
