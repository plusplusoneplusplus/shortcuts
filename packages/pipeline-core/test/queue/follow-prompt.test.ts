/**
 * Tests for follow-prompt shared utilities.
 *
 * Validates buildFollowPromptText and isFollowPromptPayload used by both
 * the VS Code extension and the CoC server.
 */
import { describe, it, expect } from 'vitest';
import {
    buildFollowPromptText,
    isFollowPromptPayload,
    FollowPromptPayload,
} from '../../src/queue/follow-prompt';

describe('isFollowPromptPayload', () => {
    it('returns true when promptFilePath is present', () => {
        expect(isFollowPromptPayload({ promptFilePath: '/path/to/prompt.md' })).toBe(true);
    });

    it('returns true when promptContent is present', () => {
        expect(isFollowPromptPayload({ promptContent: 'Do the thing' })).toBe(true);
    });

    it('returns true when both promptFilePath and promptContent are present', () => {
        expect(isFollowPromptPayload({ promptFilePath: '/p', promptContent: 'c' })).toBe(true);
    });

    it('returns false when neither is present', () => {
        expect(isFollowPromptPayload({ planFilePath: '/plan.md' })).toBe(false);
    });

    it('returns false for empty object', () => {
        expect(isFollowPromptPayload({})).toBe(false);
    });
});

describe('buildFollowPromptText', () => {
    it('builds file-path-based prompt with promptFilePath and planFilePath', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
            planFilePath: '/path/to/plan.md',
        });
        expect(result).toBe('Follow the instruction /path/to/prompt.md. /path/to/plan.md');
    });

    it('builds file-path-based prompt with promptFilePath only', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
        });
        expect(result).toBe('Follow the instruction /path/to/prompt.md.');
    });

    it('builds prompt with direct content and planFilePath', () => {
        const result = buildFollowPromptText({
            promptContent: 'Implement the feature',
            planFilePath: '/path/to/plan.md',
        });
        expect(result).toBe('Implement the feature /path/to/plan.md');
    });

    it('builds prompt with direct content only', () => {
        const result = buildFollowPromptText({
            promptContent: 'Implement the feature',
        });
        expect(result).toBe('Implement the feature');
    });

    it('prefers promptContent over promptFilePath', () => {
        const result = buildFollowPromptText({
            promptContent: 'Direct content',
            promptFilePath: '/path/to/prompt.md',
            planFilePath: '/path/to/plan.md',
        });
        expect(result).toBe('Direct content /path/to/plan.md');
    });

    it('appends additional context when provided', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
            planFilePath: '/path/to/plan.md',
            additionalContext: 'Focus on error handling',
        });
        expect(result).toBe(
            'Follow the instruction /path/to/prompt.md. /path/to/plan.md\n\nAdditional context: Focus on error handling'
        );
    });

    it('trims additional context whitespace', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
            additionalContext: '  Focus on tests  ',
        });
        expect(result).toBe(
            'Follow the instruction /path/to/prompt.md.\n\nAdditional context: Focus on tests'
        );
    });

    it('ignores empty additional context', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
            additionalContext: '   ',
        });
        expect(result).toBe('Follow the instruction /path/to/prompt.md.');
    });

    it('ignores undefined additional context', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
            additionalContext: undefined,
        });
        expect(result).toBe('Follow the instruction /path/to/prompt.md.');
    });

    it('handles empty planFilePath gracefully', () => {
        const result = buildFollowPromptText({
            promptFilePath: '/path/to/prompt.md',
            planFilePath: '',
        });
        expect(result).toBe('Follow the instruction /path/to/prompt.md.');
    });

    it('handles Windows-style paths', () => {
        const result = buildFollowPromptText({
            promptFilePath: 'D:\\projects\\shortcuts\\.github\\skills\\impl\\SKILL.md',
            planFilePath: 'D:\\projects\\shortcuts\\plan.md',
        });
        expect(result).toBe(
            'Follow the instruction D:\\projects\\shortcuts\\.github\\skills\\impl\\SKILL.md. D:\\projects\\shortcuts\\plan.md'
        );
    });

    it('handles direct content with additional context', () => {
        const result = buildFollowPromptText({
            promptContent: 'Refactor the auth module.',
            additionalContext: 'NO backward compatibility needed',
        });
        expect(result).toBe(
            'Refactor the auth module.\n\nAdditional context: NO backward compatibility needed'
        );
    });
});
