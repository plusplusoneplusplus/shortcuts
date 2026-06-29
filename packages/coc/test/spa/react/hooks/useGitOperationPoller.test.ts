/**
 * renderHook tests for useGitOperationPoller.
 *
 * Covers the lifecycle contract: starts polling, stops on success/failure,
 * routes missing jobs, honors a custom isComplete, clears on unmount and on
 * workspace change, ignores stale in-flight results after a repo switch, and
 * reports thrown poll requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stub the clone client so useCocClient resolves to a controllable getOperation.
const { getOperationMock, stub } = vi.hoisted(() => {
    const getOperationMock = vi.fn();
    return { getOperationMock, stub: { git: { getOperation: getOperationMock } } };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => stub,
    getCocClientFor: () => stub,
    toSpaCocRequestOptions: (opts?: unknown) => opts,
    translateSpaCocClientError: (e: unknown) => { throw e; },
}));

// cloneRegistry reads getApiBase() at module load.
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

// Import after mocks.
import { useGitOperationPoller } from '../../../../src/server/spa/client/react/features/git/hooks/useGitOperationPoller';

const INTERVAL = 3000;

/** Advance fake timers by `ms` and flush the awaited getOperation continuation. */
async function tick(ms: number = INTERVAL): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('useGitOperationPoller', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getOperationMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    // ── Start / poll ──────────────────────────────────────────────

    it('does not poll until start() is called', async () => {
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));
        expect(result.current.isPolling()).toBe(false);
        expect(result.current.activeJobId()).toBe(null);

        await tick();
        expect(getOperationMock).not.toHaveBeenCalled();
    });

    it('polls getOperation with the started workspace and job id', async () => {
        getOperationMock.mockResolvedValue({ status: 'running' });
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', {}); });
        expect(result.current.isPolling()).toBe(true);
        expect(result.current.activeJobId()).toBe('job-1');

        await tick();
        expect(getOperationMock).toHaveBeenCalledWith('ws-A', 'job-1');
    });

    it('keeps polling while the job is running, then resolves on completion', async () => {
        getOperationMock
            .mockResolvedValueOnce({ status: 'running' })
            .mockResolvedValueOnce({ status: 'success' });
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onSuccess }); });

        await tick(); // tick 1 — running
        expect(onSuccess).not.toHaveBeenCalled();
        expect(result.current.isPolling()).toBe(true);

        await tick(); // tick 2 — success
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(result.current.isPolling()).toBe(false);
    });

    // ── Terminal routing ──────────────────────────────────────────

    it('stops polling and calls onSuccess on a successful job', async () => {
        getOperationMock.mockResolvedValue({ status: 'success' });
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onSuccess }); });
        await tick();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(result.current.isPolling()).toBe(false);
        expect(result.current.activeJobId()).toBe(null);

        // No further polling once terminal.
        getOperationMock.mockClear();
        await tick(INTERVAL * 2);
        expect(getOperationMock).not.toHaveBeenCalled();
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('stops polling and calls onFailure with the job error on a failed job', async () => {
        getOperationMock.mockResolvedValue({ status: 'failed', error: 'boom' });
        const onFailure = vi.fn();
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onFailure, onSuccess }); });
        await tick();

        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onFailure).toHaveBeenCalledWith('boom', expect.objectContaining({ status: 'failed' }));
        expect(onSuccess).not.toHaveBeenCalled();
        expect(result.current.isPolling()).toBe(false);
    });

    it('passes undefined error to onFailure when the failed job has no error string', async () => {
        getOperationMock.mockResolvedValue({ status: 'failed' });
        const onFailure = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onFailure }); });
        await tick();

        expect(onFailure).toHaveBeenCalledWith(undefined, expect.objectContaining({ status: 'failed' }));
    });

    it('falls back to onSuccess when a job is missing and no onMissing is given', async () => {
        getOperationMock.mockResolvedValue(null);
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onSuccess }); });
        await tick();

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(result.current.isPolling()).toBe(false);
    });

    it('calls onMissing (not onSuccess) when a job is missing and onMissing is provided', async () => {
        getOperationMock.mockResolvedValue(null);
        const onSuccess = vi.fn();
        const onMissing = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onSuccess, onMissing }); });
        await tick();

        expect(onMissing).toHaveBeenCalledTimes(1);
        expect(onSuccess).not.toHaveBeenCalled();
    });

    // ── Custom isComplete (reorder semantics) ─────────────────────

    it('keeps polling on a missing job when a custom isComplete excludes it', async () => {
        // Reorder treats only explicit success/failed as terminal, so a missing
        // job must NOT end the poll.
        getOperationMock.mockResolvedValue(null);
        const onSuccess = vi.fn();
        const isComplete = (job: { status?: string } | null) =>
            job?.status === 'success' || job?.status === 'failed';
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { isComplete, onSuccess }); });
        await tick();

        expect(onSuccess).not.toHaveBeenCalled();
        expect(result.current.isPolling()).toBe(true);
    });

    // ── Thrown poll request ───────────────────────────────────────

    it('stops polling and reports onError when the poll request throws', async () => {
        getOperationMock.mockRejectedValue(new Error('network down'));
        const onError = vi.fn();
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', { onError, onSuccess }); });
        await tick();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onSuccess).not.toHaveBeenCalled();
        expect(result.current.isPolling()).toBe(false);
    });

    it('stops polling on a thrown request even without an onError callback', async () => {
        getOperationMock.mockRejectedValue(new Error('network down'));
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', {}); });
        await tick();

        expect(result.current.isPolling()).toBe(false);
    });

    // ── Explicit stop / replace ───────────────────────────────────

    it('stop() halts polling and clears the active job', async () => {
        getOperationMock.mockResolvedValue({ status: 'running' });
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', {}); });
        await tick();
        expect(result.current.isPolling()).toBe(true);

        act(() => { result.current.stop(); });
        expect(result.current.isPolling()).toBe(false);
        expect(result.current.activeJobId()).toBe(null);

        getOperationMock.mockClear();
        await tick(INTERVAL * 2);
        expect(getOperationMock).not.toHaveBeenCalled();
    });

    it('a second start() replaces the first poll', async () => {
        getOperationMock.mockResolvedValue({ status: 'running' });
        const onSuccessA = vi.fn();
        const onSuccessB = vi.fn();
        const { result } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-A', { onSuccess: onSuccessA }); });
        act(() => { result.current.start('job-B', { onSuccess: onSuccessB }); });
        expect(result.current.activeJobId()).toBe('job-B');

        getOperationMock.mockResolvedValue({ status: 'success' });
        await tick();

        expect(onSuccessB).toHaveBeenCalledTimes(1);
        expect(onSuccessA).not.toHaveBeenCalled();
        expect(getOperationMock).toHaveBeenCalledWith('ws-A', 'job-B');
        expect(getOperationMock).not.toHaveBeenCalledWith('ws-A', 'job-A');
    });

    // ── Cleanup: unmount + workspace change ───────────────────────

    it('clears the interval on unmount', async () => {
        getOperationMock.mockResolvedValue({ status: 'running' });
        const { result, unmount } = renderHook(() => useGitOperationPoller('ws-A'));

        act(() => { result.current.start('job-1', {}); });
        await tick();

        getOperationMock.mockClear();
        unmount();
        await tick(INTERVAL * 2);
        expect(getOperationMock).not.toHaveBeenCalled();
    });

    it('clears the interval when the mounted workspace changes', async () => {
        getOperationMock.mockResolvedValue({ status: 'running' });
        const { result, rerender } = renderHook(
            ({ ws }) => useGitOperationPoller(ws),
            { initialProps: { ws: 'ws-A' } },
        );

        act(() => { result.current.start('job-1', {}); });
        await tick();

        getOperationMock.mockClear();
        rerender({ ws: 'ws-B' });
        await tick(INTERVAL * 2);

        expect(getOperationMock).not.toHaveBeenCalled();
        expect(result.current.isPolling()).toBe(false);
    });

    it('ignores a stale in-flight result that resolves after a workspace change', async () => {
        // getOperation stays pending so the tick is still awaiting when the repo switches.
        let resolveJob: (job: unknown) => void = () => {};
        getOperationMock.mockImplementation(
            () => new Promise(res => { resolveJob = res; }),
        );
        const onSuccess = vi.fn();
        const { result, rerender } = renderHook(
            ({ ws }) => useGitOperationPoller(ws),
            { initialProps: { ws: 'ws-A' } },
        );

        act(() => { result.current.start('job-1', { onSuccess }); });
        await tick(); // fires the tick; getOperation is now pending
        expect(getOperationMock).toHaveBeenCalledWith('ws-A', 'job-1');

        // Repo switches while the request is in flight.
        rerender({ ws: 'ws-B' });

        // The in-flight request finally resolves to a completed job — must be dropped.
        await act(async () => {
            resolveJob({ status: 'success' });
            await flushMicrotasks();
        });

        expect(onSuccess).not.toHaveBeenCalled();
    });
});
