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

vi.mock('../../../../src/server/spa/client/react/utils/cron', () => ({
    describeCron: vi.fn((expr: string) => `desc(${expr})`),
}));

import { notesApi } from '../../../../src/server/spa/client/react/features/notes/notesApi';
import { useNotesAutoCommit } from '../../../../src/server/spa/client/react/hooks/useNotesAutoCommit';

const mockGetAutoCommitStatus = notesApi.getAutoCommitStatus as ReturnType<typeof vi.fn>;
const mockEnableAutoCommit = notesApi.enableAutoCommit as ReturnType<typeof vi.fn>;
const mockDisableAutoCommit = notesApi.disableAutoCommit as ReturnType<typeof vi.fn>;
const mockUpdateAutoCommitInterval = notesApi.updateAutoCommitInterval as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────

function makeEnabledStatus(overrides: Record<string, any> = {}) {
    return {
        enabled: true,
        schedule: {
            id: 'sched-1',
            cron: '*/30 * * * *',
            status: 'active',
            nextRun: '2025-01-01T01:00:00Z',
            ...overrides.schedule,
        },
        lastRun: overrides.lastRun ?? { status: 'completed' },
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
        expect(result.current.scheduleId).toBe('sched-1');
        expect(result.current.cron).toBe('*/30 * * * *');
        expect(result.current.cronDescription).toBe('desc(*/30 * * * *)');
        expect(result.current.nextRun).toBe('2025-01-01T01:00:00Z');
        expect(result.current.status).toBe('active');
        expect(result.current.lastRunStatus).toBe('completed');
    });

    it('returns autoCommitEnabled: false when GET returns { enabled: false }', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.autoCommitEnabled).toBe(false);
        expect(result.current.scheduleId).toBeNull();
        expect(result.current.cron).toBeNull();
        expect(result.current.cronDescription).toBeNull();
        expect(result.current.status).toBeNull();
    });

    it('enable() calls POST endpoint with default cron, refetches status', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockEnableAutoCommit.mockResolvedValueOnce({ schedule: {}, scriptPath: '/tmp/script.sh' });
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        await act(async () => {
            await result.current.enable();
        });

        expect(mockEnableAutoCommit).toHaveBeenCalledWith('ws-1', undefined);
        expect(result.current.autoCommitEnabled).toBe(true);
    });

    it('enable() sends custom cron when provided', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockEnableAutoCommit.mockResolvedValueOnce({ schedule: {}, scriptPath: '/tmp/script.sh' });
        mockGetAutoCommitStatus.mockResolvedValueOnce(
            makeEnabledStatus({ schedule: { id: 'sched-2', cron: '*/15 * * * *', status: 'active', nextRun: null } }),
        );

        await act(async () => {
            await result.current.enable('*/15 * * * *');
        });

        expect(mockEnableAutoCommit).toHaveBeenCalledWith('ws-1', '*/15 * * * *');
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
        expect(result.current.scheduleId).toBeNull();
    });

    it('updateInterval() calls PATCH, refetches status', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockUpdateAutoCommitInterval.mockResolvedValueOnce({ schedule: {} });
        mockGetAutoCommitStatus.mockResolvedValueOnce(
            makeEnabledStatus({ schedule: { id: 'sched-1', cron: '*/10 * * * *', status: 'active', nextRun: null } }),
        );

        await act(async () => {
            await result.current.updateInterval('*/10 * * * *');
        });

        expect(mockUpdateAutoCommitInterval).toHaveBeenCalledWith('ws-1', '*/10 * * * *');
        expect(result.current.cron).toBe('*/10 * * * *');
    });

    it('refreshes on schedule-changed window event', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Mock the refetch
        mockGetAutoCommitStatus.mockResolvedValueOnce(makeEnabledStatus());

        act(() => {
            window.dispatchEvent(new Event('schedule-changed'));
        });

        await waitFor(() => {
            expect(result.current.autoCommitEnabled).toBe(true);
        });

        // getAutoCommitStatus called on mount + on event
        expect(mockGetAutoCommitStatus).toHaveBeenCalledTimes(2);
    });

    it('sets enabling: true during enable call, resets after', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        let resolveEnable!: () => void;
        mockEnableAutoCommit.mockReturnValueOnce(
            new Promise<any>((resolve) => { resolveEnable = () => resolve({ schedule: {}, scriptPath: '' }); }),
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
        expect(result.current.scheduleId).toBeNull();
    });

    it('handles enable error gracefully', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce({ enabled: false });

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        mockEnableAutoCommit.mockRejectedValueOnce(new Error('409 Conflict'));

        await act(async () => {
            await result.current.enable();
        });

        // Should not throw, enabling should be reset
        expect(result.current.enabling).toBe(false);
        expect(result.current.autoCommitEnabled).toBe(false);
    });

    it('returns null lastRunStatus for unknown statuses', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(
            makeEnabledStatus({ lastRun: { status: 'running' } }),
        );

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.lastRunStatus).toBeNull();
    });

    it('handles paused status', async () => {
        mockGetAutoCommitStatus.mockResolvedValueOnce(
            makeEnabledStatus({ schedule: { id: 'sched-1', cron: '*/30 * * * *', status: 'paused', nextRun: null } }),
        );

        const { result } = renderHook(() => useNotesAutoCommit('ws-1'));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.status).toBe('paused');
        expect(result.current.nextRun).toBeNull();
    });
});
