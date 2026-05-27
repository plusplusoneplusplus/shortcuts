/**
 * Tests for pr-classification-handler — unit tests for prompt and tag helpers,
 * plus enqueue payload shape verification.
 *
 * Route-level behavior (POST/GET) is covered indirectly via the file-based
 * classification-store tests. The legacy `extractClassificationFromResult`
 * has been removed in favour of the `saveClassification` LLM tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildClassificationPrompt } from '../../src/server/repos/pr-classification-handler';
import { TaskDefs } from '../../src/server/tasks/task-types';

// Mock the prompt override module so we can test override-aware rendering
vi.mock('../../src/server/admin/ralph-prompt-overrides', () => ({
    getPromptOverride: vi.fn(),
}));

import { getPromptOverride } from '../../src/server/admin/ralph-prompt-overrides';

const mockedGetOverride = vi.mocked(getPromptOverride);

// ── buildClassificationPrompt ────────────────────────────────────────────────

describe('buildClassificationPrompt', () => {
    beforeEach(() => mockedGetOverride.mockReset());
    afterEach(() => vi.restoreAllMocks());

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

    it('uses admin override when dataDir is provided and override exists', () => {
        mockedGetOverride.mockReturnValue(
            'CUSTOM: ${target} | ${diffInstructions} | ${classificationSchema} | ${saveInstruction}'
        );
        const prompt = buildClassificationPrompt('repo', '99', '/data');
        expect(prompt).toContain('CUSTOM:');
        expect(prompt).toContain('pull request #99');
        expect(prompt).not.toContain('${target}');
    });

    it('falls back to default template when override is not set', () => {
        mockedGetOverride.mockReturnValue(undefined);
        const prompt = buildClassificationPrompt('repo', '42', '/data');
        expect(prompt).toContain('Classify every hunk');
        expect(prompt).toContain('pull request #42');
    });

    it('does not contain unexpanded template variables', () => {
        const prompt = buildClassificationPrompt('repo', '42');
        expect(prompt).not.toContain('${target}');
        expect(prompt).not.toContain('${diffInstructions}');
        expect(prompt).not.toContain('${classificationSchema}');
        expect(prompt).not.toContain('${saveInstruction}');
    });
});

// ── TaskDefs.prClassification ────────────────────────────────────────────────

describe('TaskDefs.prClassification', () => {
    it('has kind "pr-classification"', () => {
        expect(TaskDefs.prClassification.kind).toBe('pr-classification');
    });

    it('is not exclusive (uses shared queue lane)', () => {
        expect(TaskDefs.prClassification.exclusive).toBe(false);
    });

    it('is not visible in the enqueue filter UI', () => {
        expect(TaskDefs.prClassification.visible).toBe(false);
    });
});
