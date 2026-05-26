/**
 * Tests for usePrReviewProgress hook (AC-03).
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrReviewProgress } from '../../../../src/server/spa/client/react/features/git/diff/usePrReviewProgress';

describe('usePrReviewProgress', () => {
    it('starts with empty visited and reviewed sets', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        expect(result.current.state.reviewedFiles.size).toBe(0);
        expect(result.current.state.visitedFiles.size).toBe(0);
        expect(result.current.state.headSha).toBe('sha1');
    });

    it('markVisited marks a file visited but never reviewed', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        act(() => result.current.markVisited('a.ts'));
        expect(result.current.isVisited('a.ts')).toBe(true);
        expect(result.current.isReviewed('a.ts')).toBe(false);
    });

    it('markReviewed marks a file reviewed and implicitly visited', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        act(() => result.current.markReviewed('a.ts'));
        expect(result.current.isReviewed('a.ts')).toBe(true);
        expect(result.current.isVisited('a.ts')).toBe(true);
    });

    it('unmarkReviewed clears reviewed state but keeps visited state', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        act(() => result.current.markReviewed('a.ts'));
        act(() => result.current.unmarkReviewed('a.ts'));
        expect(result.current.isReviewed('a.ts')).toBe(false);
        expect(result.current.isVisited('a.ts')).toBe(true);
    });

    it('toggleReviewed flips reviewed state', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        act(() => result.current.toggleReviewed('a.ts'));
        expect(result.current.isReviewed('a.ts')).toBe(true);
        act(() => result.current.toggleReviewed('a.ts'));
        expect(result.current.isReviewed('a.ts')).toBe(false);
        // Visited remains true (regression guard: unmarking must not lose the
        // visited indicator).
        expect(result.current.isVisited('a.ts')).toBe(true);
    });

    it('resets visited and reviewed sets when headSha changes', () => {
        const { result, rerender } = renderHook(
            ({ sha }: { sha: string | undefined }) => usePrReviewProgress(sha),
            { initialProps: { sha: 'sha1' as string | undefined } },
        );
        act(() => {
            result.current.markVisited('a.ts');
            result.current.markReviewed('b.ts');
        });
        expect(result.current.state.reviewedFiles.size).toBe(1);
        expect(result.current.state.visitedFiles.size).toBe(2);

        rerender({ sha: 'sha2' });
        expect(result.current.state.reviewedFiles.size).toBe(0);
        expect(result.current.state.visitedFiles.size).toBe(0);
        expect(result.current.state.headSha).toBe('sha2');
    });

    it('ignores empty file paths', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        act(() => {
            result.current.markVisited('');
            result.current.markReviewed('');
            result.current.toggleReviewed('');
            result.current.unmarkReviewed('');
        });
        expect(result.current.state.reviewedFiles.size).toBe(0);
        expect(result.current.state.visitedFiles.size).toBe(0);
    });

    it('does not duplicate state when re-marking the same file', () => {
        const { result } = renderHook(() => usePrReviewProgress('sha1'));
        act(() => {
            result.current.markVisited('a.ts');
            result.current.markVisited('a.ts');
            result.current.markReviewed('a.ts');
            result.current.markReviewed('a.ts');
        });
        expect(result.current.state.visitedFiles.size).toBe(1);
        expect(result.current.state.reviewedFiles.size).toBe(1);
    });
});
