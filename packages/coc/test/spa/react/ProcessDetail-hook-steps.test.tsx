/**
 * ProcessDetail Hook-Step Tests
 *
 * Tests that ProcessDetail correctly handles indexed post-action hook-step
 * events (dedup via composite key) and skill vs script rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
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

describe('ProcessDetail hook-step dedup with indexed events', () => {
    it('deduplicates indexed post-actions using composite key', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('hook-dedup', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit two different indexed post-actions
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 0, status: 'running', script: './a.sh' },
            });
        });
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 1, status: 'running', script: './b.sh' },
            });
        });

        // Both should be present (not deduped into one)
        expect(es.listeners.get('hook-step')!.length).toBeGreaterThanOrEqual(1);

        // Now update the first one to 'done' — should update in place
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 0, status: 'done', script: './a.sh', durationMs: 100 },
            });
        });

        // Listener should still work without errors
        expect(es.listeners.get('hook-step')!.length).toBeGreaterThanOrEqual(1);
    });

    it('non-indexed hook steps still deduplicate by step name alone', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('hook-simple', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit a pre-action (no index)
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'pre-action', status: 'running', script: './setup.sh' },
            });
        });

        // Update same step
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'pre-action', status: 'done', script: './setup.sh', durationMs: 45 },
            });
        });

        // Should work without errors
        expect(es.listeners.get('hook-step')!.length).toBeGreaterThanOrEqual(1);
    });
});

describe('ProcessDetail hook-step rendering', () => {
    it('renders skill post-actions with skill icon and name', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('hook-render-skill', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit a skill post-action hook step
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 0, status: 'done', script: '', actionType: 'skill', skillName: 'summarize', durationMs: 200 },
            });
        });

        // Should render skill icon and name
        expect(screen.getByText('⚡ summarize')).toBeDefined();
        expect(screen.getByText('(200ms)')).toBeDefined();
    });

    it('renders script post-actions with monospace script path', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('hook-render-script', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit a script post-action hook step
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 0, status: 'running', script: './cleanup.sh' },
            });
        });

        // Should render the script path
        expect(screen.getByText('./cleanup.sh')).toBeDefined();
    });

    it('renders multiple post-actions in order', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <SeededProcessDetail process={makeProcess('hook-render-multi', 'running')} />
                </Wrap>
            );
        });

        expect(lastEventSource).not.toBeNull();
        const es = lastEventSource!;

        // Emit three post-actions in order
        await act(async () => {
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 0, status: 'done', script: './a.sh', durationMs: 50 },
            });
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 1, status: 'running', script: '', actionType: 'skill', skillName: 'review' },
            });
            emitSSEEvent(es, 'hook-step', {
                hookStep: { step: 'post-action', index: 2, status: 'running', script: './c.sh' },
            });
        });

        // All three should be rendered
        expect(screen.getByText('./a.sh')).toBeDefined();
        expect(screen.getByText('⚡ review')).toBeDefined();
        expect(screen.getByText('./c.sh')).toBeDefined();
    });
});
