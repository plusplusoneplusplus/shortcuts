/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useNotesAutoCommit hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getAutoCommitStatus: vi.fn(),
        enableAutoCommit: vi.fn(),
        disableAutoCommit: vi.fn(),
        updateAutoCommitInterval: vi.fn(),
    },
}));

import { notesApi } from '../../../../src/server/spa/client/react/features/notes/notesApi';
import { useNotesAutoCommit } from '../../../../src/server/spa/client/react/features/notes/hooks/useNotesAutoCommit';

const mockGetAutoCommitStatus = notesApi.getAutoCommitStatus as ReturnType<typeof vi.fn>;
const mockEnableAutoCommit = notesApi.enableAutoCommit as ReturnType<typeof vi.fn>;
const mockDisableAutoCommit = notesApi.disableAutoCommit as ReturnType<typeof vi.fn>;
const mockUpdateAutoCommitInterval = notesApi.updateAutoCommitInterval as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────

function makeEnabledStatus(overrides: Record<string, any> = {}) {
    return {
        enabled: true,
        intervalMs: 1_800_000,
        lastCommittedAt: '2025-01-01T01:00:00Z',
        lastError: null,
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useNotesAutoCommit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches auto-commit status on mount and populates return values', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.autoCommitEnabled).toBe(true);
        expect(result.current.intervalMs).toBe(1_800_000);
        expect(result.current.lastCommittedAt).toBe('2025-01-01T01:00:00Z');
        expect(result.current.lastError).toBeNull();
    });

    it('returns autoCommitEnabled: false when GET returns { enabled: false }', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.autoCommitEnabled).toBe(false);
        expect(result.current.intervalMs).toBeNull();
        expect(result.current.lastCommittedAt).toBeNull();
        expect(result.current.lastError).toBeNull();
    });

    it('enable() calls POST endpoint with default intervalMs, refetches status', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockEnableAutoCommit.mockResolvedValueOnce({ enabled: true, intervalMs: 1_800_000 });
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        await act(async () => {
            await result.current.enable();
        });

        expect(mockEnableAutoCommit).toHaveBeenCalledWith('ws-1', undefined);
        expect(result.current.autoCommitEnabled).toBe(true);
    });

    it('enable() sends custom intervalMs when provided', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockEnableAutoCommit.mockResolvedValueOnce({ enabled: true, intervalMs: 900_000 });
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus({ intervalMs: 900_000 }));

        await act(async () => {
            await result.current.enable(900_000);
        });

        expect(mockEnableAutoCommit).toHaveBeenCalledWith('ws-1', 900_000);
    });

    it('disable() calls DELETE endpoint, resets state', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.autoCommitEnabled).toBe(true);

        mockDisableAutoCommit.mockResolvedValueOnce({ deleted: true });
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        await act(async () => {
            await result.current.disable();
        });

        expect(mockDisableAutoCommit).toHaveBeenCalledWith('ws-1');
        expect(result.current.autoCommitEnabled).toBe(false);
        expect(result.current.intervalMs).toBeNull();
    });

    it('updateInterval() calls POST with new intervalMs, refetches status', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockUpdateAutoCommitInterval.mockResolvedValueOnce({ enabled: true, intervalMs: 600_000 });
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus({ intervalMs: 600_000 }));

        await act(async () => {
            await result.current.updateInterval(600_000);
        });

        expect(mockUpdateAutoCommitInterval).toHaveBeenCalledWith('ws-1', 600_000);
        expect(result.current.intervalMs).toBe(600_000);
    });

    it('sets enabling: true during enable call, resets after', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        let resolveEnable!: () => void;
        mockEnableAutoCommit.mockReturnValueOnce(
            new Promise<any>((resolve) => { resolveEnable = () => resolve({ enabled: true, intervalMs: 1_800_000 }); }),
        );

        expect(result.current.enabling).toBe(false);

        let enablePromise: Promise<void>;
        act(() => {
            enablePromise = result.current.enable();
        });

        await waitFor(() => {
            expect(result.current.enabling).toBe(true);
        });

        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        await act(async () => {
            resolveEnable();
            await enablePromise!;
        });

        expect(result.current.enabling).toBe(false);
    });

    it('handles API errors gracefully (sets loading: false, does not throw)', async () => {
        mockGetAutoCommitStatus.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.autoCommitEnabled).toBe(false);
        expect(result.current.intervalMs).toBeNull();
    });

    it('handles enable error gracefully', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockEnableAutoCommit.mockRejectedValueOnce(new Error('500 Internal'));

        await act(async () => {
            await result.current.enable();
        });

        // Should not throw, enabling should be reset
        expect(result.current.enabling).toBe(false);
        expect(result.current.autoCommitEnabled).toBe(false);
    });

    it('exposes lastCommittedAt from status response', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(
            makeEnabledStatus({ lastCommittedAt: '2025-06-01T12:00:00Z' }),
        );

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.lastCommittedAt).toBe('2025-06-01T12:00:00Z');
    });

    it('exposes lastError from status response', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(
            makeEnabledStatus({ lastError: 'nothing to commit' }),
        );

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.lastError).toBe('nothing to commit');
    });
});
