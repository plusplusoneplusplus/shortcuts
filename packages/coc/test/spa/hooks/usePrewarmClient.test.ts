/**
 * Tests for usePrewarmClient — debounced, latched, workspace-routed prewarm of
 * the provider client while the user types a follow-up (AC-05).
 *
 * DoD: single debounced call; workspace-scoped routing; no fire on empty input;
 * cleaned up on unmount.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted spies so the vi.mock factory can reference them before imports.
const { prewarmSpy, getClientSpy } = vi.hoisted(() => ({
    prewarmSpy: vi.fn(),
    getClientSpy: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: (workspaceId: string | null | undefined) => {
        getClientSpy(workspaceId);
        return { processes: { prewarm: prewarmSpy } };
    },
}));

import {
    usePrewarmClient,
    PREWARM_DEBOUNCE_MS,
    type UsePrewarmClientOptions,
} from '../../../src/server/spa/client/react/features/chat/hooks/usePrewarmClient';

function baseProps(overrides: Partial<UsePrewarmClientOptions> = {}): UsePrewarmClientOptions {
    return {
        input: '',
        workspaceId: 'ws-1',
        processId: 'proc-1',
        enabled: true,
        ...overrides,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    prewarmSpy.mockReset().mockResolvedValue({ warming: true });
    getClientSpy.mockReset();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('usePrewarmClient', () => {
    it('fires a single debounced prewarm on non-empty input', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });

        rerender(baseProps({ input: 'hello' }));
        // Not yet — still inside the debounce window.
        expect(prewarmSpy).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });

        expect(prewarmSpy).toHaveBeenCalledTimes(1);
        expect(prewarmSpy).toHaveBeenCalledWith('proc-1', { workspace: 'ws-1' });
    });

    it('routes through the workspace-scoped client (remote-clone safe)', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ workspaceId: 'ws-remote' }),
        });
        rerender(baseProps({ input: 'hi', workspaceId: 'ws-remote' }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });

        expect(getClientSpy).toHaveBeenCalledWith('ws-remote');
        expect(prewarmSpy).toHaveBeenCalledWith('proc-1', { workspace: 'ws-remote' });
    });

    it('does not fire on empty / whitespace-only input', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        rerender(baseProps({ input: '   ' }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('debounces rapid typing into a single call', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        rerender(baseProps({ input: 'h' }));
        act(() => { vi.advanceTimersByTime(200); });
        rerender(baseProps({ input: 'he' }));
        act(() => { vi.advanceTimersByTime(200); });
        rerender(baseProps({ input: 'hel' }));
        // Only 200ms elapsed since the last keystroke → nothing yet.
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('fires at most once per warm window even as typing continues', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        rerender(baseProps({ input: 'hello' }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);

        // Continued typing must NOT issue a second prewarm in the same window.
        rerender(baseProps({ input: 'hello world' }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 2); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('re-arms after the composer empties (send / clear)', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        rerender(baseProps({ input: 'first' }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);

        // Send clears the composer → latch resets.
        rerender(baseProps({ input: '' }));
        // Next follow-up types → a fresh prewarm fires.
        rerender(baseProps({ input: 'second' }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(prewarmSpy).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending prewarm when the composer clears before the debounce (send)', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        rerender(baseProps({ input: 'typing' }));
        act(() => { vi.advanceTimersByTime(200); }); // still mid-debounce
        rerender(baseProps({ input: '' }));          // send clears the input
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('cleans up the pending prewarm on unmount', () => {
        const { rerender, unmount } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        rerender(baseProps({ input: 'hello' }));
        unmount();
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('does not fire when disabled', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ enabled: false }),
        });
        rerender(baseProps({ input: 'hello', enabled: false }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('does not fire when processId or workspaceId is missing', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ processId: null }),
        });
        rerender(baseProps({ input: 'hello', processId: null }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();

        rerender(baseProps({ input: 'hello', workspaceId: null }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS * 4); });
        expect(prewarmSpy).not.toHaveBeenCalled();
    });

    it('honours a custom debounce window', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ debounceMs: 1000 }),
        });
        rerender(baseProps({ input: 'hello', debounceMs: 1000 }));
        act(() => { vi.advanceTimersByTime(500); });
        expect(prewarmSpy).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(500); });
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });
});

describe('usePrewarmClient — warm status (AC-02)', () => {
    const TTL = 1000;

    // Drive the prewarm-response promise to resolution under fake timers.
    async function flush() {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    it('walks idle → warming → warm across a successful prewarm', async () => {
        prewarmSpy.mockResolvedValue({ warming: true, provider: 'copilot' });
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: TTL }),
        });
        expect(result.current).toBe('idle');

        rerender(baseProps({ input: 'hello', ttlMs: TTL }));
        // Still inside the debounce window — not warming yet.
        expect(result.current).toBe('idle');

        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        // Debounce fired → POST is in flight.
        expect(result.current).toBe('warming');

        await flush();
        // POST resolved { warming: true } → warm.
        expect(result.current).toBe('warm');
    });

    it('decays from warm back to idle after the TTL window', async () => {
        prewarmSpy.mockResolvedValue({ warming: true, provider: 'copilot' });
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: TTL }),
        });
        rerender(baseProps({ input: 'hello', ttlMs: TTL }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        await flush();
        expect(result.current).toBe('warm');

        // Composer still has text (latched), so nothing re-fires — warmth simply
        // lapses once the TTL elapses.
        await act(async () => { vi.advanceTimersByTime(TTL); });
        expect(result.current).toBe('idle');
    });

    it('becomes unsupported and never flips to warm afterward (sticky)', async () => {
        prewarmSpy.mockResolvedValue({ warming: false, provider: 'claude', reason: 'unsupported' });
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: TTL }),
        });
        rerender(baseProps({ input: 'hello', ttlMs: TTL }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        await flush();
        expect(result.current).toBe('unsupported');

        // A later prewarm that *would* report warm must not override the sticky
        // unsupported verdict for the session.
        prewarmSpy.mockResolvedValue({ warming: true, provider: 'claude' });
        rerender(baseProps({ input: '', ttlMs: TTL }));   // composer cleared
        expect(result.current).toBe('unsupported');        // survives the reset
        rerender(baseProps({ input: 'again', ttlMs: TTL }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        await flush();
        expect(result.current).toBe('unsupported');
    });

    it('resets to idle when the composer is cleared', async () => {
        prewarmSpy.mockResolvedValue({ warming: true, provider: 'copilot' });
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: TTL }),
        });
        rerender(baseProps({ input: 'hello', ttlMs: TTL }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        await flush();
        expect(result.current).toBe('warm');

        rerender(baseProps({ input: '', ttlMs: TTL }));   // send / manual clear
        expect(result.current).toBe('idle');
    });

    it('goes back to idle when the prewarm reports an error', async () => {
        prewarmSpy.mockResolvedValue({ warming: false, provider: 'copilot', reason: 'error' });
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: TTL }),
        });
        rerender(baseProps({ input: 'hello', ttlMs: TTL }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        expect(result.current).toBe('warming');
        await flush();
        expect(result.current).toBe('idle');
    });

    it('stays idle when warming is disabled (ttlMs === 0 kill-switch)', async () => {
        prewarmSpy.mockResolvedValue({ warming: true, provider: 'copilot' });
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: 0 }),
        });
        rerender(baseProps({ input: 'hello', ttlMs: 0 }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        // Never claims warm, never pulses.
        expect(result.current).toBe('idle');
        await flush();
        expect(result.current).toBe('idle');
        // The prewarm POST still fires (server no-ops) — existing behavior intact.
        expect(prewarmSpy).toHaveBeenCalledTimes(1);
    });

    it('clears the decay timer on unmount (no timer leaks)', async () => {
        prewarmSpy.mockResolvedValue({ warming: true, provider: 'copilot' });
        const { result, rerender, unmount } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ ttlMs: TTL }),
        });
        rerender(baseProps({ input: 'hello', ttlMs: TTL }));
        act(() => { vi.advanceTimersByTime(PREWARM_DEBOUNCE_MS); });
        await flush();
        expect(result.current).toBe('warm');   // decay timer is now scheduled

        unmount();
        // The pending decay timer must be cancelled on unmount.
        expect(vi.getTimerCount()).toBe(0);
        // Advancing past the TTL must not throw or setState on the torn-down hook.
        expect(() => { act(() => { vi.advanceTimersByTime(TTL * 2); }); }).not.toThrow();
    });
});
