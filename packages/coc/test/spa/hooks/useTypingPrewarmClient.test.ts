/**
 * Tests for useTypingPrewarmClient — the side-effect hook that prewarms the
 * backend provider client while the user types a follow-up.
 *
 * It is deliberately separate from useWarmClientStatus (the stream observer):
 * this hook only POSTs `/processes/:id/prewarm` (routed per workspace) and never
 * touches the displayed warm status. DoD: schedules one debounced prewarm on the
 * first non-empty input; reschedules while pending; fires at most once per typing
 * window; resets the latch on empty input or a (workspace, process) key change;
 * suppresses when disabled; swallows errors; routes through the workspace client.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted spies so the vi.mock factory can reference them before imports.
const { getClientSpy, prewarmSpy } = vi.hoisted(() => {
    const prewarmSpy = vi.fn().mockResolvedValue({ warming: true, provider: 'copilot' });
    const getClientSpy = vi.fn((_ws: string | null | undefined) => ({ processes: { prewarm: prewarmSpy } }));
    return { getClientSpy, prewarmSpy };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: (ws: string | null | undefined) => getClientSpy(ws),
}));

import {
    useTypingPrewarmClient,
    type UseTypingPrewarmClientOptions,
} from '../../../src/server/spa/client/react/features/chat/hooks/useTypingPrewarmClient';

const DEBOUNCE = 500;

function baseProps(overrides: Partial<UseTypingPrewarmClientOptions> = {}): UseTypingPrewarmClientOptions {
    return {
        input: '',
        workspaceId: 'ws-1',
        processId: 'proc-1',
        enabled: true,
        debounceMs: DEBOUNCE,
        ...overrides,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    getClientSpy.mockClear();
    prewarmSpy.mockClear();
    prewarmSpy.mockResolvedValue({ warming: true, provider: 'copilot' });
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
});

describe('useTypingPrewarmClient', () => {
    it('schedules exactly one prewarm after the debounce on the first non-empty input', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: '' }),
        });
        // Empty composer → nothing scheduled yet.
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        // User types → debounce starts.
        rerender(baseProps({ input: 'h' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE - 1); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(1); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        expect(prewarmSpy).toHaveBeenCalledWith('proc-1', { workspace: 'ws-1' });
    });

    it('reschedules the timer when typing continues before the debounce fires', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE - 100); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        // Another keystroke before the timer fires resets the debounce window.
        rerender(baseProps({ input: 'he' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE - 1); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(1); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('fires at most once per typing window (no second call while text remains)', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);

        // Continued typing must not issue another prewarm.
        rerender(baseProps({ input: 'hello' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE * 3); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('re-arms the latch when the composer is cleared, allowing a fresh prewarm', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);

        // Clear → close the window.
        rerender(baseProps({ input: '' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);

        // Type again → a new window → a second prewarm.
        rerender(baseProps({ input: 'again' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(2);
    });

    it('re-arms the latch when the processId changes', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        expect(prewarmSpy).toHaveBeenLastCalledWith('proc-1', { workspace: 'ws-1' });

        // Same text, different conversation → a fresh prewarm for the new process.
        rerender(baseProps({ input: 'h', processId: 'proc-2' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(2);
        expect(prewarmSpy).toHaveBeenLastCalledWith('proc-2', { workspace: 'ws-1' });
    });

    it('re-arms the latch when the workspaceId changes', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);

        rerender(baseProps({ input: 'h', workspaceId: 'ws-2' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(2);
        expect(getClientSpy).toHaveBeenLastCalledWith('ws-2');
        expect(prewarmSpy).toHaveBeenLastCalledWith('proc-1', { workspace: 'ws-2' });
    });

    it('routes through the workspace-specific client (remote-clone safe)', () => {
        renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h', workspaceId: 'ws-remote' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(getClientSpy).toHaveBeenCalledWith('ws-remote');
        expect(prewarmSpy).toHaveBeenCalledWith('proc-1', { workspace: 'ws-remote' });
    });

    it('does nothing when disabled', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h', enabled: false }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE * 2); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        // Re-enabling resumes scheduling.
        rerender(baseProps({ input: 'h', enabled: true }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('does nothing when workspaceId or processId is missing', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h', workspaceId: null }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        rerender(baseProps({ input: 'h', processId: null }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('ignores whitespace-only input', () => {
        renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: '   \n\t ' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('cancels a pending prewarm when the composer is cleared before it fires', () => {
        const { rerender } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE - 100); });
        rerender(baseProps({ input: '' }));
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('cancels a pending prewarm on unmount', () => {
        const { unmount } = renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        act(() => { vi.advanceTimersByTime(DEBOUNCE - 100); });
        unmount();
        act(() => { vi.advanceTimersByTime(DEBOUNCE); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('swallows prewarm errors without throwing', () => {
        prewarmSpy.mockRejectedValueOnce(new Error('prewarm failed'));
        renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h' }),
        });
        expect(() => act(() => { vi.advanceTimersByTime(DEBOUNCE); })).not.toThrow();
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('fires on the next tick when debounceMs is 0', () => {
        renderHook((p: UseTypingPrewarmClientOptions) => useTypingPrewarmClient(p), {
            initialProps: baseProps({ input: 'h', debounceMs: 0 }),
        });
        expect(prewarmSpy).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(0); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });
});
