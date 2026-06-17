/**
 * Tests for pr-classification-handler — unit tests for the PR prompt helper.
 *
 * Route-level behavior lives in generic-classification-handler; classification
 * persistence is handled by the `saveClassification` LLM tool.
 */

import { describe, it, expect } from 'vitest';
import { buildClassificationPrompt } from '../../src/server/repos/pr-classification-handler';
import { TaskDefs } from '../../src/server/tasks/task-types';

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

    it('should point at the classify-diff skill for schema and persistence rules', () => {
        const prompt = buildClassificationPrompt('repo', '42');
        expect(prompt).toContain('Use the `classify-diff` skill');
        expect(prompt).toContain('persistence rules');
        expect(prompt).not.toContain('saveClassification');
        expect(prompt).not.toContain('hunkIndex');
    });

    it('ignores dataDir because classification prompts are no longer admin-overridable', () => {
        const prompt = buildClassificationPrompt('repo', '99', '/data');
        expect(prompt).toContain('Classify every hunk');
        expect(prompt).toContain('pull request #99');
        expect(prompt).not.toContain('CUSTOM:');
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
