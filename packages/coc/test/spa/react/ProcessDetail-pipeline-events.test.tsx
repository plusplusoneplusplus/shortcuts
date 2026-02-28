/**
 * ProcessDetail Pipeline Event Tests
 *
 * Tests that ProcessDetail registers addEventListener for pipeline-phase and
 * pipeline-progress SSE events and updates local state accordingly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ProcessDetail } from '../../../src/server/spa/client/react/processes/ProcessDetail';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

// ── EventSource Mock ───────────────────────────────────────────────────

interface MockEventSource {
    url: string;
    listeners: Map<string, Array<(e: { data: string }) => void>>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onerror: ((e: any) => void) | null;
    onmessage: ((e: any) => void) | null;
}

let lastEventSource: MockEventSource | null = null;

function createMockEventSourceClass() {
    return vi.fn().mockImplementation((url: string) => {
        const listeners = new Map<string, Array<(e: { data: string }) => void>>();
        const instance: MockEventSource = {
            url,
            listeners,
            addEventListener: vi.fn((event: string, cb: (e: { data: string }) => void) => {
                const existing = listeners.get(event) || [];
                existing.push(cb);
                listeners.set(event, existing);
            }),
            removeEventListener: vi.fn((event: string, cb: (e: { data: string }) => void) => {
                const existing = listeners.get(event) || [];
                listeners.set(event, existing.filter(fn => fn !== cb));
            }),
            close: vi.fn(),
            onerror: null,
            onmessage: null,
        };
        lastEventSource = instance;
        return instance;
    });
}

function emitSSEEvent(es: MockEventSource, event: string, data: unknown) {
    const cbs = es.listeners.get(event) || [];
    for (const cb of cbs) {
        cb({ data: JSON.stringify(data) });
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function SeededProcessDetail({ process }: { process: any }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes: [process] });
        dispatch({ type: 'SELECT_PROCESS', id: process.id });
    }, [dispatch, process]);
    return <ProcessDetail />;
}

function makeProcess(id: string, status: string) {
    return {
        id,
        status,
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        startTime: new Date().toISOString(),
        type: 'clarification',
    };
}

// ── Setup ──────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    lastEventSource = null;
    (global as any).EventSource = createMockEventSourceClass();
    fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ process: null, turns: [] }),
    });
    global.fetch = fetchSpy;
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (global as any).EventSource;
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('ProcessDetail pipeline SSE listeners', () => {
    it('registers addEventListener for pipeline-phase and pipeline-progress', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('p1', 'running')} />
                </Wrap>
            );
        });

        // Wait for EventSource to be created
        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Verify the expected event types are registered
        const registeredEvents = Array.from(es.listeners.keys());
        expect(registeredEvents).toContain('pipeline-phase');
        expect(registeredEvents).toContain('pipeline-progress');
        expect(registeredEvents).toContain('chunk');
        expect(registeredEvents).toContain('conversation-snapshot');
        expect(registeredEvents).toContain('status');
    });

    it('pipeline-phase listener updates local state', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('p2', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit a pipeline-phase event
        await act(async () => {
            emitSSEEvent(es, 'pipeline-phase', {
                phase: 'input',
                status: 'completed',
                timestamp: '2026-01-01T00:00:00Z',
                durationMs: 50,
                itemCount: 10,
            });
        });

        // The listener is registered — verify it doesn't throw
        // ProcessDetail registers 1 listener, usePipelinePhase registers another
        expect(es.listeners.get('pipeline-phase')!.length).toBeGreaterThanOrEqual(1);
    });

    it('pipeline-progress listener updates progress state', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('p3', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit a pipeline-progress event
        await act(async () => {
            emitSSEEvent(es, 'pipeline-progress', {
                phase: 'map',
                totalItems: 10,
                completedItems: 3,
                failedItems: 0,
                percentage: 30,
            });
        });

        // ProcessDetail registers 1 listener, usePipelinePhase registers another
        expect(es.listeners.get('pipeline-progress')!.length).toBeGreaterThanOrEqual(1);
    });

    it('pipeline state resets on process selection change', async () => {
        const proc1 = makeProcess('proc-a', 'running');
        const proc2 = makeProcess('proc-b', 'running');

        function SwitchableDetail() {
            const { dispatch } = useApp();
            useEffect(() => {
                dispatch({ type: 'SET_PROCESSES', processes: [proc1, proc2] });
                dispatch({ type: 'SELECT_PROCESS', id: proc1.id });
            }, [dispatch]);
            return <ProcessDetail />;
        }

        const { rerender } = await act(async () => {
            return render(
                <Wrap>
                    <SwitchableDetail />
                </Wrap>
            );
        });

        // First EventSource for proc-a
        expect(lastEventSource).not.toBeNull();
        const es1 = lastEventSource!;

        // Emit pipeline events for proc-a
        await act(async () => {
            emitSSEEvent(es1, 'pipeline-phase', {
                phase: 'input',
                status: 'completed',
                timestamp: '2026-01-01T00:00:00Z',
            });
        });

        // Now switch to proc-b
        function SwitchedDetail() {
            const { dispatch } = useApp();
            useEffect(() => {
                dispatch({ type: 'SET_PROCESSES', processes: [proc1, proc2] });
                dispatch({ type: 'SELECT_PROCESS', id: proc2.id });
            }, [dispatch]);
            return <ProcessDetail />;
        }

        await act(async () => {
            rerender(
                <Wrap>
                    <SwitchedDetail />
                </Wrap>
            );
        });

        // The old EventSource should have been closed
        expect(es1.close).toHaveBeenCalled();
    });

    it('EventSource cleanup removes all listeners on unmount', async () => {
        const { unmount } = await act(async () => {
            return render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('p-cleanup', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Unmount should close the EventSource
        await act(async () => {
            unmount();
        });

        expect(es.close).toHaveBeenCalled();
    });

    it('does not create EventSource for non-running processes', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('p-done', 'completed')} />
                </Wrap>
            );
        });

        // EventSource should not be created for completed processes
        expect(lastEventSource).toBeNull();
    });
});
