/**
 * Tests for commit popout review-progress behavior.
 *
 * Verifies that commit review in the popout uses session-local progress
 * (no server persistence) that resets when the commitHash changes —
 * mirrors the same session-local guarantee tested for PR review progress,
 * but without the `persistence` option.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrReviewProgress } from '../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress';

/**
 * The commit popout passes the commitHash as `headSha` and omits the
 * `persistence` option so the hook is fully session-local.
 */
function useCommitReviewProgress(commitHash: string) {
    return usePrReviewProgress(commitHash);
}

describe('commit popout review progress (session-local)', () => {
    it('starts with empty visited and reviewed sets', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        expect(result.current.state.reviewedFiles.size).toBe(0);
        expect(result.current.state.visitedFiles.size).toBe(0);
        expect(result.current.state.headSha).toBe('abc1234');
    });

    it('markVisited marks a file visited without marking it reviewed', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        act(() => result.current.markVisited('src/foo.ts'));
        expect(result.current.isVisited('src/foo.ts')).toBe(true);
        expect(result.current.isReviewed('src/foo.ts')).toBe(false);
    });

    it('markReviewed marks a file reviewed and implicitly visited', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        act(() => result.current.markReviewed('src/bar.ts'));
        expect(result.current.isReviewed('src/bar.ts')).toBe(true);
        expect(result.current.isVisited('src/bar.ts')).toBe(true);
    });

    it('toggleReviewed flips the reviewed flag', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        act(() => result.current.toggleReviewed('src/baz.ts'));
        expect(result.current.isReviewed('src/baz.ts')).toBe(true);
        act(() => result.current.toggleReviewed('src/baz.ts'));
        expect(result.current.isReviewed('src/baz.ts')).toBe(false);
        // visited stays true after unmarking
        expect(result.current.isVisited('src/baz.ts')).toBe(true);
    });

    it('resets progress when the commitHash (headSha) changes', () => {
        const { result, rerender } = renderHook(
            ({ hash }: { hash: string }) => useCommitReviewProgress(hash),
            { initialProps: { hash: 'abc1234' } },
        );
        act(() => {
            result.current.markVisited('src/foo.ts');
            result.current.markReviewed('src/bar.ts');
        });
        expect(result.current.state.visitedFiles.size).toBe(2);
        expect(result.current.state.reviewedFiles.size).toBe(1);

        // Navigate to a different commit
        rerender({ hash: 'def5678' });

        expect(result.current.state.visitedFiles.size).toBe(0);
        expect(result.current.state.reviewedFiles.size).toBe(0);
        expect(result.current.state.headSha).toBe('def5678');
    });

    it('is immediately hydrated (no server fetch) in session-local mode', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        // Without persistence option, the hook marks hydrated=true immediately.
        expect(result.current.state.hydrated).toBe(true);
    });

    it('unmarkReviewed keeps visited state', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        act(() => result.current.markReviewed('src/foo.ts'));
        act(() => result.current.unmarkReviewed('src/foo.ts'));
        expect(result.current.isReviewed('src/foo.ts')).toBe(false);
        expect(result.current.isVisited('src/foo.ts')).toBe(true);
    });

    it('setLastSelectedFile does not affect reviewed/visited sets', () => {
        const { result } = renderHook(() => useCommitReviewProgress('abc1234'));
        act(() => result.current.setLastSelectedFile('src/baz.ts'));
        expect(result.current.state.visitedFiles.size).toBe(0);
        expect(result.current.state.reviewedFiles.size).toBe(0);
    });
});
