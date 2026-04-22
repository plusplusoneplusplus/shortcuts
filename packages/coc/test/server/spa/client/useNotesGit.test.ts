/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useNotesGit hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';
import { useNotesGit } from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesGit';

const mockFetchApi = fetchApi as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────

function makeStatus(overrides: Record<string, any> = {}) {
    return {
        initialized: true,
        branch: 'main',
        clean: true,
        staged: [],
        unstaged: [],
        untracked: [],
        totalChanges: 0,
        ...overrides,
    };
}

function makeLogEntry(overrides: Record<string, any> = {}) {
    return {
        hash: 'abc1234567890',
        shortHash: 'abc1234',
        message: 'Initial commit',
        date: '2025-01-01T00:00:00Z',
        filesChanged: 1,
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useNotesGit', () => {
    beforeEach(() => {
        mockFetchApi.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches status and log on mount when initialized', async () => {
        const status = makeStatus();
        const logEntries = [makeLogEntry()];
        mockFetchApi
            .mockResolvedValueOnce(status) // GET .../status
            .mockResolvedValueOnce({ entries: logEntries }); // GET .../log

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.initialized).toBe(true);
        expect(result.current.status).toEqual(status);
        expect(result.current.log).toEqual(logEntries);
        expect(result.current.error).toBeNull();
    });

    it('sets initialized=false when status reports not initialized', async () => {
        const status = makeStatus({ initialized: false });
        mockFetchApi.mockResolvedValueOnce(status);

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.initialized).toBe(false);
        expect(result.current.log).toEqual([]);
    });

    it('does not fetch log when not initialized', async () => {
        const status = makeStatus({ initialized: false });
        mockFetchApi.mockResolvedValueOnce(status);

        renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledTimes(1);
        });
        // Only status was fetched, not log
        expect(mockFetchApi).toHaveBeenCalledWith(
            expect.stringContaining('/notes/git/status')
        );
    });

    it('initialize() calls init endpoint and re-fetches', async () => {
        // Initial load: not initialized
        mockFetchApi.mockResolvedValueOnce(makeStatus({ initialized: false }));

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.initialized).toBe(false);

        // Mock the init call and subsequent refresh
        mockFetchApi
            .mockResolvedValueOnce({ initialized: true }) // POST .../init
            .mockResolvedValueOnce(makeStatus()) // refresh status
            .mockResolvedValueOnce({ entries: [makeLogEntry()] }); // refresh log

        await act(async () => {
            await result.current.initialize();
        });

        expect(result.current.initialized).toBe(true);
        expect(result.current.log).toHaveLength(1);
    });

    it('commit() calls commit endpoint with message and refreshes', async () => {
        const status = makeStatus();
        mockFetchApi
            .mockResolvedValueOnce(status) // mount status
            .mockResolvedValueOnce({ entries: [] }); // mount log

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // Mock commit + refresh
        mockFetchApi
            .mockResolvedValueOnce({ committed: true }) // POST .../commit
            .mockResolvedValueOnce(makeStatus()) // refresh status
            .mockResolvedValueOnce({ entries: [makeLogEntry()] }); // refresh log

        await act(async () => {
            await result.current.commit('test message');
        });

        // Verify commit was called with message
        const commitCall = mockFetchApi.mock.calls.find(
            (c: any[]) => typeof c[0] === 'string' && c[0].includes('/commit')
        );
        expect(commitCall).toBeDefined();
        expect(commitCall![1]).toEqual(
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ message: 'test message' }),
            })
        );
    });

    it('commit() without message sends no body', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeStatus()) // mount
            .mockResolvedValueOnce({ entries: [] }); // mount log

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockFetchApi
            .mockResolvedValueOnce({ committed: true })
            .mockResolvedValueOnce(makeStatus())
            .mockResolvedValueOnce({ entries: [] });

        await act(async () => {
            await result.current.commit();
        });

        const commitCall = mockFetchApi.mock.calls.find(
            (c: any[]) => typeof c[0] === 'string' && c[0].includes('/commit')
        );
        expect(commitCall![1]).toEqual(
            expect.objectContaining({ method: 'POST' })
        );
        expect(commitCall![1].body).toBeUndefined();
    });

    it('getDiff() calls the diff endpoint and returns data', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeStatus())
            .mockResolvedValueOnce({ entries: [] });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        const diffData = { files: [{ path: 'note.md', status: 'M', diff: '@@...' }] };
        mockFetchApi.mockResolvedValueOnce(diffData);

        let diff: any;
        await act(async () => {
            diff = await result.current.getDiff('abc123');
        });

        expect(diff).toEqual(diffData);
        const diffCall = mockFetchApi.mock.calls.find(
            (c: any[]) => typeof c[0] === 'string' && c[0].includes('/diff/')
        );
        expect(diffCall![0]).toContain('/diff/abc123');
    });

    it('refresh() re-fetches status and log', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeStatus())
            .mockResolvedValueOnce({ entries: [] });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        const callsBefore = mockFetchApi.mock.calls.length;

        mockFetchApi
            .mockResolvedValueOnce(makeStatus({ clean: false, totalChanges: 3 }))
            .mockResolvedValueOnce({ entries: [makeLogEntry()] });

        await act(async () => {
            await result.current.refresh();
        });

        expect(mockFetchApi.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(result.current.log).toHaveLength(1);
    });

    it('handles API errors gracefully', async () => {
        mockFetchApi.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Failed to fetch notes git status');
        expect(result.current.initialized).toBe(false);
    });

    it('notes-changed CustomEvent triggers debounced refresh', async () => {
        vi.useFakeTimers();

        mockFetchApi
            .mockResolvedValueOnce(makeStatus())
            .mockResolvedValueOnce({ entries: [] });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        // Wait for initial load (using real timers briefly)
        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callsBefore = mockFetchApi.mock.calls.length;

        // Mock refresh responses
        mockFetchApi
            .mockResolvedValueOnce(makeStatus())
            .mockResolvedValueOnce({ entries: [makeLogEntry()] });

        // Dispatch notes-changed event
        act(() => {
            window.dispatchEvent(new CustomEvent('notes-changed', {
                detail: { wsId: 'ws-1', changedPaths: ['note.md'] },
            }));
        });

        // Before debounce: no new calls
        expect(mockFetchApi.mock.calls.length).toBe(callsBefore);

        // Advance past debounce (500ms)
        await act(async () => {
            vi.advanceTimersByTime(600);
        });

        expect(mockFetchApi.mock.calls.length).toBeGreaterThan(callsBefore);

        vi.useRealTimers();
    });

    it('ignores notes-changed events for different workspaceId', async () => {
        vi.useFakeTimers();

        mockFetchApi
            .mockResolvedValueOnce(makeStatus())
            .mockResolvedValueOnce({ entries: [] });

        renderHook(() => useNotesGit('ws-1'));

        await vi.waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledTimes(2);
        });

        const callsBefore = mockFetchApi.mock.calls.length;

        act(() => {
            window.dispatchEvent(new CustomEvent('notes-changed', {
                detail: { wsId: 'ws-OTHER' },
            }));
        });

        await act(async () => {
            vi.advanceTimersByTime(600);
        });

        expect(mockFetchApi.mock.calls.length).toBe(callsBefore);

        vi.useRealTimers();
    });

    it('cancels pending fetches on unmount', async () => {
        mockFetchApi.mockImplementation(() => new Promise(() => {})); // never resolves

        const { unmount } = renderHook(() => useNotesGit('ws-1'));

        // Unmount while loading — should not error
        unmount();
    });
});
