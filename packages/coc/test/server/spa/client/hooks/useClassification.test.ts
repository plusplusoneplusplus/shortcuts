/**
 * @vitest-environment jsdom
 *
 * Tests for useClassification — per-PR state isolation and stale-key guarding.
 *
 * Covers AC-01:
 * - Key-change cancellation: switching classification key resets state to idle
 *   and stops any in-flight polling interval.
 * - Stale-key response guarding: async responses (GET / POST / poll) that
 *   resolve after the key has changed are silently dropped.
 * - Initial-fetch happy path: ready and running server states.
 * - No key (undefined): hook stays idle with no API calls.
 *
 * Covers AI-selection threading:
 * - aiSelection.provider/model/reasoningEffort threaded into classify() POST body.
 * - Hook uses the latest aiSelection value on each classify() call (ref pattern).
 * - No internal preferences persistence — that is handled by useModalJobAiSelection.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Hoist mock factory before any imports ─────────────────────────────────

const mocks = vi.hoisted(() => ({
    requestSpaApi: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock(
    '../../../../../src/server/spa/client/react/api/cocClient',
    () => ({ requestSpaApi: mocks.requestSpaApi }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { ClassificationKey } from '../../../../../src/server/spa/client/react/features/git/diff/diffSource';
import type { ResolvedModalJobAiSelection } from '../../../../../src/server/spa/client/react/shared/ModalJobAiControls';

function makeKey(prId: string, sha: string): ClassificationKey {
    return { type: 'pr', repoId: 'repo-1', identifier: `${prId}:${sha}` };
}

function makeAiSelection(overrides?: Partial<ResolvedModalJobAiSelection>): ResolvedModalJobAiSelection {
    return { provider: 'copilot', ...overrides };
}

const RESULT_A = {
    classifications: [{ file: 'a.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'r' }],
};
const RESULT_B = {
    classifications: [{ file: 'b.ts', hunkIndex: 0, category: 'test', intensity: 'low', reason: 'r' }],
};

async function importHook() {
    const { useClassification } = await import(
        '../../../../../src/server/spa/client/react/features/git/diff/useClassification'
    );
    return useClassification;
}

afterEach(() => {
    mocks.requestSpaApi.mockReset();
    vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useClassification', () => {

    // ── No key ─────────────────────────────────────────────────────────────

    it('stays idle when classificationKey is undefined', async () => {
        const useClassification = await importHook();

        const { result } = renderHook(() => useClassification(undefined, makeAiSelection()));

        expect(result.current.state.status).toBe('idle');
        expect(mocks.requestSpaApi).not.toHaveBeenCalled();
    });

    // ── Initial fetch: ready ────────────────────────────────────────────────

    it('transitions to ready when server returns ready on initial GET', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'ready', result: RESULT_A });

        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), makeAiSelection()));

        await waitFor(() => expect(result.current.state.status).toBe('ready'));
        expect(result.current.state.result).toEqual(RESULT_A);
    });

    // ── Initial fetch: running → loading ──────────────────────────────────

    it('transitions to loading when server returns running on initial GET', async () => {
        const useClassification = await importHook();
        // Initial GET: running; polling never resolves in this test
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'running' });
        mocks.requestSpaApi.mockResolvedValue({ status: 'running' });

        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), makeAiSelection()));

        await waitFor(() => expect(result.current.state.status).toBe('loading'));
    });

    // ── Key-change resets state ────────────────────────────────────────────

    it('resets state to idle when classificationKey changes', async () => {
        const useClassification = await importHook();
        // First key: returns ready immediately
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'ready', result: RESULT_A });
        // Second key: never resolves (keep it pending so the test is deterministic)
        mocks.requestSpaApi.mockReturnValueOnce(new Promise(() => {}));

        const keyA = makeKey('1', 'sha1');
        const keyB = makeKey('2', 'sha2');
        const ai = makeAiSelection();

        const { result, rerender } = renderHook(
            ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
            { initialProps: { ck: keyA } },
        );

        // Wait for PR-A to reach ready
        await waitFor(() => expect(result.current.state.status).toBe('ready'));

        // Switch to PR-B
        act(() => { rerender({ ck: keyB }); });

        // State must immediately reset to idle on key change
        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.result).toBeUndefined();
    });

    // ── Stale-key guard: initial GET response dropped ─────────────────────

    it('drops a stale initial-GET response when key has already changed', async () => {
        const useClassification = await importHook();

        let resolveA!: (v: unknown) => void;
        const promiseA = new Promise(r => { resolveA = r; });

        // Key-A's initial GET: held
        mocks.requestSpaApi.mockReturnValueOnce(promiseA);
        // Key-B's initial GET: returns none immediately
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' });

        const keyA = makeKey('1', 'sha1');
        const keyB = makeKey('2', 'sha2');
        const ai = makeAiSelection();

        const { result, rerender } = renderHook(
            ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
            { initialProps: { ck: keyA } },
        );

        // Switch to PR-B before key-A resolves
        act(() => { rerender({ ck: keyB }); });

        // Resolve key-A's GET with a 'ready' result — should be dropped
        await act(async () => {
            resolveA({ status: 'ready', result: RESULT_A });
            // flush all microtasks
            await Promise.resolve();
            await Promise.resolve();
        });

        // State should remain idle for key-B (RESULT_A must NOT appear)
        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.result).toBeUndefined();
    });

    // ── Stale-key guard: classify POST response dropped ───────────────────

    it('drops a stale classify-POST response when key has changed before it resolves', async () => {
        const useClassification = await importHook();

        // Initial GET for key-A: none (idle)
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' });

        let resolvePost!: (v: unknown) => void;
        // The POST for key-A will be held
        mocks.requestSpaApi.mockReturnValueOnce(new Promise(r => { resolvePost = r; }));

        // Key-B initial GET: none
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' });

        const keyA = makeKey('1', 'sha1');
        const keyB = makeKey('2', 'sha2');
        const ai = makeAiSelection();

        const { result, rerender } = renderHook(
            ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
            { initialProps: { ck: keyA } },
        );

        await waitFor(() => expect(result.current.state.status).toBe('idle'));

        // Click Classify on key-A
        act(() => { result.current.classify(); });
        expect(result.current.state.status).toBe('loading');

        // Navigate to key-B
        act(() => { rerender({ ck: keyB }); });
        expect(result.current.state.status).toBe('idle');

        // Resolve the POST for key-A with 'ready' — must be dropped
        await act(async () => {
            resolvePost({ status: 'ready', result: RESULT_A });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.result).toBeUndefined();
    });

    // ── Polling cancellation (using fake timers) ───────────────────────────

    it('cancels the polling interval when classificationKey changes', async () => {
        vi.useFakeTimers();
        try {
            const useClassification = await importHook();
            // keyA initial GET → running (poll interval is started)
            mocks.requestSpaApi.mockResolvedValueOnce({ status: 'running' });
            // keyB initial GET → none (no new polling for keyB)
            // Note: with fake timers, keyA poll ticks never fire before we switch
            // so the next consumed mock is always keyB's initial GET.
            mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' });

            const keyA = makeKey('1', 'sha1');
            const keyB = makeKey('2', 'sha2');
            const ai = makeAiSelection();

            const { result, rerender } = renderHook(
                ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
                { initialProps: { ck: keyA } },
            );

            // Flush keyA's initial GET → loading + poll interval started
            await act(async () => { await Promise.resolve(); });
            expect(result.current.state.status).toBe('loading');

            // Switch to key-B: cleanup clears keyA's interval; keyB's initial GET fires
            await act(async () => { rerender({ ck: keyB }); });

            // Flush keyB's initial GET (returns 'none') → idle, no polling
            await act(async () => { await Promise.resolve(); });
            expect(result.current.state.status).toBe('idle');

            // Reset mock so we can count any stale calls precisely
            mocks.requestSpaApi.mockReset();
            mocks.requestSpaApi.mockResolvedValue({ status: 'none' });

            // Advance 3 poll intervals — keyA's interval was cleared, so ZERO calls expected
            await act(async () => {
                vi.advanceTimersByTime(9_000);
                await Promise.resolve();
            });

            expect(mocks.requestSpaApi.mock.calls.length).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    // ── Stale-key guard: poll tick dropped after key change ───────────────

    it('drops a stale poll-tick result after key has changed', async () => {
        vi.useFakeTimers();
        try {
            const useClassification = await importHook();

            // Key-A initial GET: running
            mocks.requestSpaApi.mockResolvedValueOnce({ status: 'running' });

            let resolveStalePolls: ((v: unknown) => void) | undefined;
            mocks.requestSpaApi.mockImplementationOnce(
                () => new Promise(r => { resolveStalePolls = r; }),
            );

            // Key-B initial GET: none
            mocks.requestSpaApi.mockResolvedValue({ status: 'none' });

            const keyA = makeKey('1', 'sha1');
            const keyB = makeKey('2', 'sha2');
            const ai = makeAiSelection();

            const { result, rerender } = renderHook(
                ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
                { initialProps: { ck: keyA } },
            );

            // Flush initial GET
            await act(async () => { await Promise.resolve(); });
            expect(result.current.state.status).toBe('loading');

            // Advance timers to trigger first poll tick (which is held)
            await act(async () => { vi.advanceTimersByTime(3_000); });

            // Switch to key-B before stale poll tick resolves
            act(() => { rerender({ ck: keyB }); });
            expect(result.current.state.status).toBe('idle');

            // Resolve the stale poll tick with RESULT_A — must be dropped
            await act(async () => {
                resolveStalePolls?.({ status: 'ready', result: RESULT_A });
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(result.current.state.status).toBe('idle');
            expect(result.current.state.result).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    // ── Rapid PR switching A→B→A ──────────────────────────────────────────

    it('rapid A→B→A switching: final state reflects A only', async () => {
        const useClassification = await importHook();

        // Key-A first visit: none
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' });
        // Key-B: never resolves
        mocks.requestSpaApi.mockReturnValueOnce(new Promise(() => {}));
        // Key-A second visit: ready
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'ready', result: RESULT_A });

        const keyA = makeKey('1', 'sha1');
        const keyB = makeKey('2', 'sha2');
        const ai = makeAiSelection();

        const { result, rerender } = renderHook(
            ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
            { initialProps: { ck: keyA } },
        );

        act(() => { rerender({ ck: keyB }); });
        act(() => { rerender({ ck: keyA }); });

        await waitFor(() => expect(result.current.state.status).toBe('ready'));
        expect(result.current.state.result).toEqual(RESULT_A);
    });

    // ── Key becoming undefined ─────────────────────────────────────────────

    it('resets to idle when key transitions from defined to undefined', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'ready', result: RESULT_B });
        const ai = makeAiSelection();

        const { result, rerender } = renderHook(
            ({ ck }: { ck: ClassificationKey | undefined }) => useClassification(ck, ai),
            { initialProps: { ck: makeKey('2', 'sha2') } },
        );

        await waitFor(() => expect(result.current.state.status).toBe('ready'));

        act(() => { rerender({ ck: undefined }); });

        expect(result.current.state.status).toBe('idle');
        expect(result.current.state.result).toBeUndefined();
    });

    // ── aiSelection threaded into POST ────────────────────────────────────

    it('classify() sends provider from aiSelection in POST body', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' }); // initial GET
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'started' }); // POST

        const ai = makeAiSelection({ provider: 'copilot' });
        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), ai));

        await waitFor(() => expect(result.current.state.status).toBe('idle'));

        act(() => { result.current.classify(); });

        await waitFor(() => expect(result.current.state.status).toBe('loading'));

        const postCall = mocks.requestSpaApi.mock.calls.find(
            c => typeof c[1] === 'object' && (c[1] as any)?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse((postCall![1] as any).body);
        expect(body.provider).toBe('copilot');
        expect(body.model).toBeUndefined();
        expect(body.reasoningEffort).toBeUndefined();
    });

    it('classify() sends model from aiSelection in POST body', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' }); // initial GET
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'started' }); // POST

        const ai = makeAiSelection({ provider: 'claude', model: 'claude-opus-4.7' });
        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), ai));

        await waitFor(() => expect(result.current.state.status).toBe('idle'));
        act(() => { result.current.classify(); });
        await waitFor(() => expect(result.current.state.status).toBe('loading'));

        const postCall = mocks.requestSpaApi.mock.calls.find(
            c => typeof c[1] === 'object' && (c[1] as any)?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse((postCall![1] as any).body);
        expect(body.provider).toBe('claude');
        expect(body.model).toBe('claude-opus-4.7');
    });

    it('classify() sends reasoningEffort from aiSelection in POST body', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' }); // initial GET
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'started' }); // POST

        const ai = makeAiSelection({ provider: 'copilot', model: 'o4-mini', reasoningEffort: 'high' });
        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), ai));

        await waitFor(() => expect(result.current.state.status).toBe('idle'));
        act(() => { result.current.classify(); });
        await waitFor(() => expect(result.current.state.status).toBe('loading'));

        const postCall = mocks.requestSpaApi.mock.calls.find(
            c => typeof c[1] === 'object' && (c[1] as any)?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse((postCall![1] as any).body);
        expect(body.reasoningEffort).toBe('high');
    });

    it('classify() sends Auto routing request without a provider override', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' }); // initial GET
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'started' }); // POST

        const ai = makeAiSelection({ provider: undefined, effortTier: 'medium', autoProviderRouting: true });
        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), ai));

        await waitFor(() => expect(result.current.state.status).toBe('idle'));
        act(() => { result.current.classify(); });
        await waitFor(() => expect(result.current.state.status).toBe('loading'));

        const postCall = mocks.requestSpaApi.mock.calls.find(
            c => typeof c[1] === 'object' && (c[1] as any)?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse((postCall![1] as any).body);
        expect(body.provider).toBeUndefined();
        expect(body.autoProviderRouting).toBe(true);
        expect(body.effortTier).toBe('medium');
    });

    it('classify() uses the latest aiSelection when it changes between renders', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' }); // initial GET
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'started' }); // POST

        const key = makeKey('1', 'sha1');
        const aiA = makeAiSelection({ provider: 'copilot' });
        const aiB = makeAiSelection({ provider: 'claude', model: 'claude-sonnet-4.6' });

        const { result, rerender } = renderHook(
            ({ ai }: { ai: ResolvedModalJobAiSelection }) => useClassification(key, ai),
            { initialProps: { ai: aiA } },
        );

        await waitFor(() => expect(result.current.state.status).toBe('idle'));

        // Update to aiB before classifying
        act(() => { rerender({ ai: aiB }); });

        act(() => { result.current.classify(); });
        await waitFor(() => expect(result.current.state.status).toBe('loading'));

        const postCall = mocks.requestSpaApi.mock.calls.find(
            c => typeof c[1] === 'object' && (c[1] as any)?.method === 'POST',
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse((postCall![1] as any).body);
        // Should use aiB values, not aiA
        expect(body.provider).toBe('claude');
        expect(body.model).toBe('claude-sonnet-4.6');
    });

    it('classify() omits model from POST body when aiSelection has no model', async () => {
        const useClassification = await importHook();
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'none' }); // initial GET
        mocks.requestSpaApi.mockResolvedValueOnce({ status: 'started' }); // POST

        const ai = makeAiSelection({ provider: 'copilot' });
        const { result } = renderHook(() => useClassification(makeKey('1', 'sha1'), ai));

        await waitFor(() => expect(result.current.state.status).toBe('idle'));
        act(() => { result.current.classify(); });
        await waitFor(() => expect(result.current.state.status).toBe('loading'));

        const postCall = mocks.requestSpaApi.mock.calls.find(
            c => typeof c[1] === 'object' && (c[1] as any)?.method === 'POST',
        );
        const body = JSON.parse((postCall![1] as any).body);
        expect(body.model).toBeUndefined();
    });
});
