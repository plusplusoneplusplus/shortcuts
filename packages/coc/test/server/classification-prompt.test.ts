/**
 * Tests for classification-prompt — template rendering, variable substitution,
 * and admin override integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    DIFF_CLASSIFICATION_DEFAULT_TEMPLATE,
    DIFF_CLASSIFICATION_PROMPT_ID,
    DIFF_CLASSIFICATION_TEMPLATE_VARS,
    renderClassificationPrompt,
} from '../../src/server/repos/classification-prompt';

// Mock the prompt override module
vi.mock('../../src/server/admin/ralph-prompt-overrides', () => ({
    getPromptOverride: vi.fn(),
}));

import { getPromptOverride } from '../../src/server/admin/ralph-prompt-overrides';

const mockedGetOverride = vi.mocked(getPromptOverride);

describe('classification-prompt', () => {
    beforeEach(() => {
        mockedGetOverride.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Constants ────────────────────────────────────────────────────────

    describe('constants', () => {
        it('prompt ID is diff-classification-user', () => {
            expect(DIFF_CLASSIFICATION_PROMPT_ID).toBe('diff-classification-user');
        });

        it('template vars include all four required variables', () => {
            expect(DIFF_CLASSIFICATION_TEMPLATE_VARS).toEqual([
                '${target}',
                '${diffInstructions}',
                '${classificationSchema}',
                '${saveInstruction}',
            ]);
        });

        it('default template contains all required variables', () => {
            for (const v of DIFF_CLASSIFICATION_TEMPLATE_VARS) {
                expect(DIFF_CLASSIFICATION_DEFAULT_TEMPLATE).toContain(v);
            }
        });
    });

    // ── renderClassificationPrompt — default template ───────────────────

    describe('renderClassificationPrompt (default template)', () => {
        it('renders PR prompt with pr number', () => {
            const result = renderClassificationPrompt('pr', '42', 'my-repo');
            expect(result).toContain('pull request #42');
            expect(result).toContain('git');
            expect(result).toContain('gh');
            expect(result).toContain('saveClassification');
            expect(result).toContain('hunkIndex');
        });

        it('renders commit prompt with hash', () => {
            const result = renderClassificationPrompt('commit', 'abc1234', 'my-repo');
            expect(result).toContain('commit abc1234');
            expect(result).toContain('commit diff');
            expect(result).toContain('saveClassification');
        });

        it('renders branch-range prompt with range', () => {
            const result = renderClassificationPrompt('branch-range', 'main..feature', 'my-repo');
            expect(result).toContain('branch range main..feature');
            expect(result).toContain('git diff');
            expect(result).toContain('saveClassification');
        });

        it('does not contain unexpanded template variables', () => {
            for (const type of ['pr', 'commit', 'branch-range'] as const) {
                const result = renderClassificationPrompt(type, 'test-id', 'repo');
                for (const v of DIFF_CLASSIFICATION_TEMPLATE_VARS) {
                    expect(result).not.toContain(v);
                }
            }
        });

        it('does not call getPromptOverride when dataDir is not provided', () => {
            renderClassificationPrompt('pr', '1', 'repo');
            expect(mockedGetOverride).not.toHaveBeenCalled();
        });
    });

    // ── renderClassificationPrompt — with override ──────────────────────

    describe('renderClassificationPrompt (override)', () => {
        it('uses the override template when one exists', () => {
            mockedGetOverride.mockReturnValue(
                'Custom: ${target} | ${diffInstructions} | ${classificationSchema} | ${saveInstruction}'
            );

            const result = renderClassificationPrompt('pr', '99', 'repo', '/data');
            expect(mockedGetOverride).toHaveBeenCalledWith('diff-classification-user', '/data');
            expect(result).toContain('Custom:');
            expect(result).toContain('pull request #99');
            expect(result).not.toContain('${target}');
        });

        it('falls back to default when override is undefined', () => {
            mockedGetOverride.mockReturnValue(undefined);
            const result = renderClassificationPrompt('commit', 'abc', 'repo', '/data');
            expect(result).toContain('commit abc');
            // Should match the default template output
            expect(result).toContain('Classify every hunk');
        });
    });
});
