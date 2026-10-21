import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useReviewFileNavigation } from '../../../../src/server/spa/client/react/features/git/diff/useReviewFileNavigation';

function setup(overrides = {}) {
    const options = {
        identity: 'server/member/commit', selectedPath: 'a', paths: ['a', 'c', 'b'],
        reviewedFiles: new Set<string>(), toggleReviewed: vi.fn(), navigate: vi.fn(), ...overrides,
    };
    const hook = renderHook(props => useReviewFileNavigation(props), { initialProps: options });
    return { ...hook, options };
}
function deferred() {
    let resolve!: () => void, reject!: (reason: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe('review file navigation', () => {
    it('marks before navigating once in displayed order with the first hunk', () => {
        const { result, options } = setup();
        act(() => { result.current('a'); result.current('a'); });
        expect(options.toggleReviewed).toHaveBeenCalledExactlyOnceWith('a');
        expect(options.navigate).toHaveBeenCalledExactlyOnceWith('c', 'first');
        expect(options.toggleReviewed.mock.invocationCallOrder[0]).toBeLessThan(options.navigate.mock.invocationCallOrder[0]);
    });
    it.each([
        { selectedPath: 'a', reviewedFiles: new Set(['a']), path: 'a' },
        { selectedPath: 'b', path: 'b' },
        { selectedPath: 'a', path: 'c' },
        { selectedPath: null, path: 'a' },
    ])('toggles without navigating for unmark, last, noncurrent and overview: %j', ({ path, ...overrides }) => {
        const { result, options } = setup(overrides);
        act(() => result.current(path));
        expect(options.toggleReviewed).toHaveBeenCalledExactlyOnceWith(path);
        expect(options.navigate).not.toHaveBeenCalled();
    });
    it('waits for async success', async () => {
        const pending = deferred();
        const { result, options } = setup({ toggleReviewed: vi.fn(() => pending.promise) });
        act(() => result.current('a'));
        expect(options.navigate).not.toHaveBeenCalled();
        await act(async () => pending.resolve());
        expect(options.navigate).toHaveBeenCalledExactlyOnceWith('c', 'first');
    });
    it('cancels a pending mark advance when the same file is unmarked', async () => {
        const pending = deferred();
        const toggleReviewed = vi.fn().mockReturnValueOnce(pending.promise);
        const { result, options, rerender } = setup({ toggleReviewed });
        act(() => result.current('a'));
        rerender({ ...options, reviewedFiles: new Set(['a']) });
        act(() => result.current('a'));
        await act(async () => pending.resolve());
        expect(toggleReviewed).toHaveBeenCalledTimes(2);
        expect(options.navigate).not.toHaveBeenCalled();
    });
    it.each(['sync', 'async'])('does not navigate on %s failure', async kind => {
        const { result, options } = setup({ toggleReviewed: vi.fn(() => {
            if (kind === 'sync') throw new Error('offline');
            return Promise.reject(new Error('offline'));
        }) });
        await act(async () => result.current('a'));
        expect(options.navigate).not.toHaveBeenCalled();
    });
    it.each(['identity', 'selectedPath', 'removed', 'unmount', 'superseded'])('revokes pending navigation after %s changes', async change => {
        const pending = deferred();
        const { result, options, rerender, unmount } = setup({ toggleReviewed: vi.fn(() => pending.promise) });
        const old = result.current;
        act(() => old('a'));
        if (change === 'unmount') unmount();
        else if (change === 'superseded') act(() => result.current('c'));
        else rerender({ ...options, ...(change === 'identity' ? { identity: 'other-server/member/commit' }
            : change === 'selectedPath' ? { selectedPath: 'b' } : { paths: ['a', 'b'] }) });
        await act(async () => pending.resolve());
        expect(options.navigate).not.toHaveBeenCalled();
        if (change === 'identity' || change === 'selectedPath' || change === 'unmount') {
            act(() => old('a'));
            expect(options.toggleReviewed).toHaveBeenCalledTimes(1);
        }
    });
});
