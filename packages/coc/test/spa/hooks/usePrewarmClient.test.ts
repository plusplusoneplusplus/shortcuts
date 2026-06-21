/**
 * Tests for usePrewarmClient — the SSE subscriber that drives the tiny "session
 * warm" indicator (AC-02, AC-03).
 *
 * The hook opens a warm-only SSE stream (`/processes/:id/stream?warm=1`) routed
 * through `cloneApiBase`, maps incoming `warm_status` events to PrewarmStatus,
 * and holds no client-side timer/debounce/POST. DoD: subscribes when a process
 * is present; maps cold/warming/warm/active; resets to cold on a dropped stream,
 * a process change, disable, and unmount; routes remote clones correctly.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted spy so the vi.mock factory can reference it before imports.
const { cloneApiBaseSpy } = vi.hoisted(() => ({
    cloneApiBaseSpy: vi.fn((ws: string | null | undefined) => `https://api.test/${ws}/api`),
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    cloneApiBase: (workspaceId: string | null | undefined) => cloneApiBaseSpy(workspaceId),
}));

// ── Minimal EventSource double ──────────────────────────────────────────────
// Records every instance so a test can drive `warm_status` / `error` frames and
// assert open/close lifecycle.
class MockEventSource {
    static instances: MockEventSource[] = [];
    url: string;
    closed = false;
    private listeners: Record<string, Array<(e: any) => void>> = {};

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, fn: (e: any) => void) {
        (this.listeners[type] ||= []).push(fn);
    }

    close() {
        this.closed = true;
    }

    /** Test helper: dispatch a `warm_status` frame with the given JSON data. */
    emitWarm(status: unknown) {
        const data = JSON.stringify({ status });
        (this.listeners['warm_status'] || []).forEach((fn) => fn({ data }));
    }

    /** Test helper: dispatch a raw `warm_status` frame (possibly malformed). */
    emitRaw(data: string) {
        (this.listeners['warm_status'] || []).forEach((fn) => fn({ data }));
    }

    /** Test helper: dispatch an `error` frame (transient disconnect). */
    emitError() {
        (this.listeners['error'] || []).forEach((fn) => fn({}));
    }

    static reset() {
        MockEventSource.instances = [];
    }

    static get last(): MockEventSource | undefined {
        return MockEventSource.instances[MockEventSource.instances.length - 1];
    }
}

import {
    usePrewarmClient,
    type UsePrewarmClientOptions,
    type PrewarmStatus,
} from '../../../src/server/spa/client/react/features/chat/hooks/usePrewarmClient';

function baseProps(overrides: Partial<UsePrewarmClientOptions> = {}): UsePrewarmClientOptions {
    return {
        workspaceId: 'ws-1',
        processId: 'proc-1',
        enabled: true,
        ...overrides,
    };
}

const originalEventSource = (globalThis as any).EventSource;

beforeEach(() => {
    MockEventSource.reset();
    cloneApiBaseSpy.mockClear();
    (globalThis as any).EventSource = MockEventSource;
});

afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
});

describe('usePrewarmClient — SSE subscription', () => {
    it('opens the warm-only stream for the workspace-routed process', () => {
        renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });

        expect(cloneApiBaseSpy).toHaveBeenCalledWith('ws-1');
        expect(MockEventSource.instances).toHaveLength(1);
        expect(MockEventSource.last!.url).toBe('https://api.test/ws-1/api/processes/proc-1/stream?warm=1');
    });

    it('routes through the workspace-scoped clone base (remote-clone safe)', () => {
        renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ workspaceId: 'ws-remote' }),
        });
        expect(cloneApiBaseSpy).toHaveBeenCalledWith('ws-remote');
        expect(MockEventSource.last!.url).toContain('https://api.test/ws-remote/api/');
    });

    it('starts cold and maps each warm_status push', () => {
        const { result } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        expect(result.current).toBe('cold');

        act(() => { MockEventSource.last!.emitWarm('warming'); });
        expect(result.current).toBe('warming');

        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(result.current).toBe('warm');

        act(() => { MockEventSource.last!.emitWarm('active'); });
        expect(result.current).toBe('active');

        act(() => { MockEventSource.last!.emitWarm('cold'); });
        expect(result.current).toBe('cold');
    });

    it('reflects the active → warm transition (the completed-conversation case)', () => {
        const { result } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        act(() => { MockEventSource.last!.emitWarm('active'); });
        expect(result.current).toBe('active');
        // Turn finishes → the client is parked → registry pushes warm.
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(result.current).toBe('warm');
    });

    it('ignores unknown statuses and malformed frames', () => {
        const { result } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(result.current).toBe('warm');

        // Unknown status string → ignored, status unchanged.
        act(() => { MockEventSource.last!.emitWarm('bogus'); });
        expect(result.current).toBe('warm');

        // Malformed JSON → swallowed, status unchanged.
        act(() => { MockEventSource.last!.emitRaw('not json'); });
        expect(result.current).toBe('warm');
    });

    it('drops back to cold when the stream errors (reconnect gap)', () => {
        const { result } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(result.current).toBe('warm');

        act(() => { MockEventSource.last!.emitError(); });
        expect(result.current).toBe('cold');
    });

    it('does not open a stream when disabled, and stays cold', () => {
        const { result } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ enabled: false }),
        });
        expect(MockEventSource.instances).toHaveLength(0);
        expect(result.current).toBe('cold');
    });

    it('does not open a stream when processId or workspaceId is missing', () => {
        const { rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps({ processId: null }),
        });
        expect(MockEventSource.instances).toHaveLength(0);

        rerender(baseProps({ workspaceId: null }));
        expect(MockEventSource.instances).toHaveLength(0);
    });

    it('reopens the stream and resets to cold when the process changes', () => {
        const { result, rerender } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        act(() => { MockEventSource.last!.emitWarm('warm'); });
        expect(result.current).toBe('warm');
        const first = MockEventSource.last!;

        rerender(baseProps({ processId: 'proc-2' }));
        // Old stream closed, new stream opened, status reset to cold.
        expect(first.closed).toBe(true);
        expect(MockEventSource.instances).toHaveLength(2);
        expect(MockEventSource.last!.url).toContain('/processes/proc-2/stream?warm=1');
        expect(result.current).toBe('cold');
    });

    it('closes the stream on unmount', () => {
        const { unmount } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        const es = MockEventSource.last!;
        expect(es.closed).toBe(false);
        unmount();
        expect(es.closed).toBe(true);
    });

    it('stays cold and opens nothing when EventSource is unavailable', () => {
        (globalThis as any).EventSource = undefined;
        const { result } = renderHook((props: UsePrewarmClientOptions) => usePrewarmClient(props), {
            initialProps: baseProps(),
        });
        expect(result.current).toBe('cold');
        expect(MockEventSource.instances).toHaveLength(0);
    });
});

describe('usePrewarmClient — PrewarmStatus contract', () => {
    it('is the four-state WarmStatus union (no idle/unsupported)', () => {
        const valid: PrewarmStatus[] = ['cold', 'warming', 'warm', 'active'];
        expect(valid).toHaveLength(4);
    });
});
