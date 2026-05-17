/**
 * Tests for pr-classification-handler — unit tests for prompt and tag helpers.
 *
 * Route-level behavior (POST/GET) is covered indirectly via the file-based
 * classification-store tests. The legacy `extractClassificationFromResult`
 * has been removed in favour of the `saveClassification` LLM tool.
 */

import { describe, it, expect } from 'vitest';
import { buildClassificationPrompt } from '../../src/server/repos/pr-classification-handler';

// ── buildClassificationPrompt ────────────────────────────────────────────────

describe('buildClassificationPrompt', () => {
    it('should include the PR number in the prompt', () => {
        const prompt = buildClassificationPrompt('my-repo', '42');
        expect(prompt).toContain('pull request #42');
    });

    it('should never include a cache-key comment', () => {
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
