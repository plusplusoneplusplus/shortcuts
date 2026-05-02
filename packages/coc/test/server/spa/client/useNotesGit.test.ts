/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useNotesGit hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getGitStatus: vi.fn(),
        getGitLog: vi.fn(),
        initializeGit: vi.fn(),
        commitGit: vi.fn(),
        getGitDiff: vi.fn(),
    },
}));

import { notesApi } from '../../../../src/server/spa/client/react/features/notes/notesApi';
import { useNotesGit } from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesGit';

const mockNotesApi = vi.mocked(notesApi);

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
        mockNotesApi.getGitStatus.mockReset();
        mockNotesApi.getGitLog.mockReset();
        mockNotesApi.initializeGit.mockReset();
        mockNotesApi.commitGit.mockReset();
        mockNotesApi.getGitDiff.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches status and log on mount when initialized', async () => {
        const status = makeStatus();
        const logEntries = [makeLogEntry()];
        mockNotesApi.getGitStatus.mockResolvedValueOnce(status);
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: logEntries, limit: 20, offset: 0 });

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
        mockNotesApi.getGitStatus.mockResolvedValueOnce(status);

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.initialized).toBe(false);
        expect(result.current.log).toEqual([]);
    });

    it('does not fetch log when not initialized', async () => {
        const status = makeStatus({ initialized: false });
        mockNotesApi.getGitStatus.mockResolvedValueOnce(status);

        renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(mockNotesApi.getGitStatus).toHaveBeenCalledTimes(1);
        });
        expect(mockNotesApi.getGitLog).not.toHaveBeenCalled();
    });

    it('initialize() calls init endpoint and re-fetches', async () => {
        // Initial load: not initialized
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus({ initialized: false }));

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
        expect(result.current.initialized).toBe(false);

        // Mock the init call and subsequent refresh
        mockNotesApi.initializeGit.mockResolvedValueOnce({ initialized: true });
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [makeLogEntry()], limit: 20, offset: 0 });

        await act(async () => {
            await result.current.initialize();
        });

        expect(result.current.initialized).toBe(true);
        expect(result.current.log).toHaveLength(1);
    });

    it('commit() calls commit endpoint with message and refreshes', async () => {
        const status = makeStatus();
        mockNotesApi.getGitStatus.mockResolvedValueOnce(status);
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // Mock commit + refresh
        mockNotesApi.commitGit.mockResolvedValueOnce({ committed: true });
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [makeLogEntry()], limit: 20, offset: 0 });

        await act(async () => {
            await result.current.commit('test message');
        });

        expect(mockNotesApi.commitGit).toHaveBeenCalledWith('ws-1', 'test message');
    });

    it('commit() without message sends no body', async () => {
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockNotesApi.commitGit.mockResolvedValueOnce({ committed: true });
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        await act(async () => {
            await result.current.commit();
        });

        expect(mockNotesApi.commitGit).toHaveBeenCalledWith('ws-1', undefined);
    });

    it('getDiff() calls the diff endpoint and returns data', async () => {
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        const diffData = { files: [{ path: 'note.md', status: 'M', diff: '@@...' }] };
        mockNotesApi.getGitDiff.mockResolvedValueOnce(diffData);

        let diff: any;
        await act(async () => {
            diff = await result.current.getDiff('abc123');
        });

        expect(diff).toEqual(diffData);
        expect(mockNotesApi.getGitDiff).toHaveBeenCalledWith('ws-1', 'abc123');
    });

    it('refresh() re-fetches status and log', async () => {
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        const callsBefore = mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length;

        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus({ clean: false, totalChanges: 3 }));
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [makeLogEntry()], limit: 20, offset: 0 });

        await act(async () => {
            await result.current.refresh();
        });

        expect(mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length).toBeGreaterThan(callsBefore);
        expect(result.current.log).toHaveLength(1);
    });

    it('handles API errors gracefully', async () => {
        mockNotesApi.getGitStatus.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useNotesGit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Failed to fetch notes git status');
        expect(result.current.initialized).toBe(false);
    });

    it('notes-changed CustomEvent triggers debounced refresh', async () => {
        vi.useFakeTimers();

        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        const { result } = renderHook(() => useNotesGit('ws-1'));

        // Wait for initial load (using real timers briefly)
        await vi.waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callsBefore = mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length;

        // Mock refresh responses
        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [makeLogEntry()], limit: 20, offset: 0 });

        // Dispatch notes-changed event
        act(() => {
            window.dispatchEvent(new CustomEvent('notes-changed', {
                detail: { wsId: 'ws-1', changedPaths: ['note.md'] },
            }));
        });

        // Before debounce: no new calls
        expect(mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length).toBe(callsBefore);

        // Advance past debounce (500ms)
        await act(async () => {
            vi.advanceTimersByTime(600);
        });

        expect(mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length).toBeGreaterThan(callsBefore);

        vi.useRealTimers();
    });

    it('ignores notes-changed events for different workspaceId', async () => {
        vi.useFakeTimers();

        mockNotesApi.getGitStatus.mockResolvedValueOnce(makeStatus());
        mockNotesApi.getGitLog.mockResolvedValueOnce({ entries: [], limit: 20, offset: 0 });

        renderHook(() => useNotesGit('ws-1'));

        await vi.waitFor(() => {
            expect(mockNotesApi.getGitStatus).toHaveBeenCalledTimes(1);
            expect(mockNotesApi.getGitLog).toHaveBeenCalledTimes(1);
        });

        const callsBefore = mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length;

        act(() => {
            window.dispatchEvent(new CustomEvent('notes-changed', {
                detail: { wsId: 'ws-OTHER' },
            }));
        });

        await act(async () => {
            vi.advanceTimersByTime(600);
        });

        expect(mockNotesApi.getGitStatus.mock.calls.length + mockNotesApi.getGitLog.mock.calls.length).toBe(callsBefore);

        vi.useRealTimers();
    });

    it('cancels pending fetches on unmount', async () => {
        mockNotesApi.getGitStatus.mockImplementation(() => new Promise(() => {})); // never resolves

        const { unmount } = renderHook(() => useNotesGit('ws-1'));

        // Unmount while loading — should not error
        unmount();
    });
});
