/**
 * @vitest-environment node
 *
 * Tests for isGoalFile utility.
 */
import { describe, it, expect } from 'vitest';
import { isGoalFile } from '../../../../src/server/spa/client/react/shared/goal-file-utils';

describe('isGoalFile', () => {
    it('matches exact "goal.md"', () => {
        expect(isGoalFile('goal.md')).toBe(true);
    });

    it('matches suffix ".goal.md"', () => {
        expect(isGoalFile('auth-refactor.goal.md')).toBe(true);
    });

    it('matches nested path with goal.md', () => {
        expect(isGoalFile('Plans/coc/goal.md')).toBe(true);
    });

    it('matches nested path with suffix .goal.md', () => {
        expect(isGoalFile('Plans/coc/my-feature.goal.md')).toBe(true);
    });

    it('matches Windows backslash paths', () => {
        expect(isGoalFile('Plans\\coc\\goal.md')).toBe(true);
        expect(isGoalFile('Plans\\coc\\auth.goal.md')).toBe(true);
    });

    it('rejects regular markdown files', () => {
        expect(isGoalFile('readme.md')).toBe(false);
        expect(isGoalFile('plan.md')).toBe(false);
        expect(isGoalFile('notes.md')).toBe(false);
    });

    it('rejects files containing "goal" but not matching pattern', () => {
        expect(isGoalFile('goal-tracking.md')).toBe(false);
        expect(isGoalFile('my-goal-plan.md')).toBe(false);
    });

    it('rejects non-md files', () => {
        expect(isGoalFile('goal.txt')).toBe(false);
        expect(isGoalFile('goal.yaml')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isGoalFile('')).toBe(false);
    });

    it('handles deeply nested paths', () => {
        expect(isGoalFile('a/b/c/d/e/sprint-1.goal.md')).toBe(true);
    });
});
