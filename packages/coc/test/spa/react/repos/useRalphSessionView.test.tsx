/**
 * @vitest-environment jsdom
 *
 * Tests for `useRalphSessionView` — the read-side hook for the per-session
 * Ralph journal. Mocks `getSpaCocClient().workspaces.ralphSession(...)` and
 * verifies:
 *
 *   1. Initial fetch resolves into the `{record, sections}` shape.
 *   2. A 404-ish failure surfaces as `view === null` (empty / not found).
 *   3. The `ralph-session-complete` window CustomEvent triggers a re-fetch.
 *   4. While `phase === 'executing'`, the hook polls (uses a small pollMs).
 *   5. Once the session reaches a terminal phase, polling stops.
 *   6. Switching `sessionId` re-fetches.
 *   7. `sessionId === null` short-circuits without calling the client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const ralphSessionMock = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            ralphSession: ralphSessionMock,
        },
    }),
}));

import { useRalphSessionView } from '../../../../src/server/spa/client/react/features/chat/useRalphSessionView';

function makeRecord(overrides: any = {}) {
    return {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        originalGoal: 'do the thing',
        maxIterations: 10,
        currentIteration: 1,
        phase: 'executing',
        startedAt: new Date().toISOString(),
        iterations: [],
        ...overrides,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
    ralphSessionMock.mockReset();
});

describe('useRalphSessionView', () => {
    it('starts as undefined and resolves to {record, sections}', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ phase: 'complete' }),
            sections: [{ iteration: 1, signal: 'RALPH_COMPLETE', timestamp: '', body: '' }],
        });

        const { result } = renderHook(() => useRalphSessionView('ws-1', 'sess-1'));
        expect(result.current.view).toBeUndefined();

        await waitFor(() => expect(result.current.view).not.toBeUndefined());
        expect(result.current.view?.record.sessionId).toBe('sess-1');
        expect(result.current.view?.sections).toHaveLength(1);
    });

    it('surfaces 404 / fetch errors as view = null', async () => {
        const err: any = new Error('not found');
        err.status = 404;
        ralphSessionMock.mockRejectedValueOnce(err);

        const { result } = renderHook(() => useRalphSessionView('ws-1', 'sess-1'));
        await waitFor(() => expect(result.current.view).toBeNull());
    });

    it('re-fetches on the ralph-session-complete window event', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ phase: 'executing' }),
            sections: [],
        });

        const { result } = renderHook(() => useRalphSessionView('ws-1', 'sess-1', 999_999));
        await waitFor(() => expect(result.current.view).not.toBeUndefined());
        expect(ralphSessionMock).toHaveBeenCalledTimes(1);

        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ phase: 'complete' }),
            sections: [],
        });

        window.dispatchEvent(new CustomEvent('ralph-session-complete', { detail: { repoId: 'ws-1' } }));

        await waitFor(() => expect(ralphSessionMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.view?.record.phase).toBe('complete'));
    });

    it('ignores ralph-session-complete events for other repos', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ phase: 'executing' }),
            sections: [],
        });

        renderHook(() => useRalphSessionView('ws-1', 'sess-1', 999_999));
        await waitFor(() => expect(ralphSessionMock).toHaveBeenCalledTimes(1));

        window.dispatchEvent(
            new CustomEvent('ralph-session-complete', { detail: { repoId: 'other-ws' } }),
        );
        await sleep(50);
        expect(ralphSessionMock).toHaveBeenCalledTimes(1);
    });

    it('polls while the phase is executing', async () => {
        ralphSessionMock.mockResolvedValue({
            record: makeRecord({ phase: 'executing' }),
            sections: [],
        });

        renderHook(() => useRalphSessionView('ws-1', 'sess-1', 30));
        await waitFor(() => expect(ralphSessionMock).toHaveBeenCalledTimes(1));
        // After ~3 polling intervals at least 2 more fetches should have fired.
        await waitFor(() => expect(ralphSessionMock.mock.calls.length).toBeGreaterThanOrEqual(3), {
            timeout: 1500,
        });
    });

    it('stops polling once the session reaches a terminal phase', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ phase: 'complete' }),
            sections: [],
        });

        renderHook(() => useRalphSessionView('ws-1', 'sess-1', 30));
        await waitFor(() => expect(ralphSessionMock).toHaveBeenCalledTimes(1));
        await sleep(150);
        expect(ralphSessionMock).toHaveBeenCalledTimes(1);
    });

    it('re-loads when sessionId changes', async () => {
        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ sessionId: 'sess-1', phase: 'complete' }),
            sections: [],
        });
        const { result, rerender } = renderHook(
            ({ id }: { id: string }) => useRalphSessionView('ws-1', id, 999_999),
            { initialProps: { id: 'sess-1' } },
        );
        await waitFor(() => expect(result.current.view?.record.sessionId).toBe('sess-1'));

        ralphSessionMock.mockResolvedValueOnce({
            record: makeRecord({ sessionId: 'sess-2', phase: 'complete' }),
            sections: [],
        });
        rerender({ id: 'sess-2' });
        await waitFor(() => expect(result.current.view?.record.sessionId).toBe('sess-2'));
        expect(ralphSessionMock).toHaveBeenCalledTimes(2);
    });

    it('returns view = undefined when sessionId is null and skips the fetch', async () => {
        const { result } = renderHook(() => useRalphSessionView('ws-1', null));
        // Allow any pending microtasks / effects to flush.
        await sleep(20);
        expect(result.current.view).toBeUndefined();
        expect(ralphSessionMock).not.toHaveBeenCalled();
    });
});
