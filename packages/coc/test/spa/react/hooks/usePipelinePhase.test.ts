import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePipelinePhase } from '../../../../src/server/spa/client/react/hooks/usePipelinePhase';

/**
 * Minimal mock EventSource that tracks addEventListener/removeEventListener.
 */
function createMockEventSource() {
    const listeners = new Map<string, Set<(e: Event) => void>>();

    const es = {
        addEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(handler);
        }),
        removeEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
            listeners.get(type)?.delete(handler);
        }),
        close: vi.fn(),
        // Helpers for tests
        _emit(type: string, data: any) {
            const event = { data: JSON.stringify(data) } as MessageEvent;
            for (const handler of listeners.get(type) ?? []) {
                handler(event);
            }
        },
        _emitError() {
            for (const handler of listeners.get('error') ?? []) {
                handler(new Event('error'));
            }
        },
        _listenerCount(type: string) {
            return listeners.get(type)?.size ?? 0;
        },
    } as unknown as EventSource & {
        _emit: (type: string, data: any) => void;
        _emitError: () => void;
        _listenerCount: (type: string) => number;
    };

    return es;
}

describe('usePipelinePhase', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns empty state when eventSource is null', () => {
        const { result } = renderHook(() => usePipelinePhase(null, undefined));
        expect(result.current.phases.size).toBe(0);
        expect(result.current.progress).toBeNull();
        expect(result.current.disconnected).toBe(false);
        expect(result.current.dagData).toBeNull();
    });

    it('updates phase state on pipeline-phase events', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        act(() => {
            es._emit('pipeline-phase', { phase: 'input', status: 'started' });
        });

        expect(result.current.phases.size).toBe(1);
        expect(result.current.phases.get('input')?.status).toBe('started');
        expect(result.current.phases.get('input')?.startedAt).toBeDefined();

        act(() => {
            es._emit('pipeline-phase', { phase: 'input', status: 'completed', durationMs: 100 });
        });

        expect(result.current.phases.get('input')?.status).toBe('completed');
        expect(result.current.phases.get('input')?.completedAt).toBeDefined();
        expect(result.current.phases.get('input')?.durationMs).toBe(100);
    });

    it('updates progress state on pipeline-progress events', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        act(() => {
            es._emit('pipeline-progress', {
                completedItems: 5,
                failedItems: 1,
                totalItems: 10,
                percentage: 60,
            });
        });

        expect(result.current.progress).toEqual({
            completedItems: 5,
            failedItems: 1,
            totalItems: 10,
            percentage: 60,
        });
    });

    it('throttles progress events at 250ms', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        // First progress event — applied immediately
        act(() => {
            vi.setSystemTime(1000);
            es._emit('pipeline-progress', {
                completedItems: 1,
                failedItems: 0,
                totalItems: 10,
                percentage: 10,
            });
        });
        expect(result.current.progress?.completedItems).toBe(1);

        // Second event 100ms later — should be throttled (not applied yet)
        act(() => {
            vi.setSystemTime(1100);
            es._emit('pipeline-progress', {
                completedItems: 2,
                failedItems: 0,
                totalItems: 10,
                percentage: 20,
            });
        });
        expect(result.current.progress?.completedItems).toBe(1); // still 1

        // Advance past the throttle window
        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(result.current.progress?.completedItems).toBe(2); // now applied
    });

    it('sets disconnected on EventSource error', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        expect(result.current.disconnected).toBe(false);

        act(() => {
            es._emitError();
        });

        expect(result.current.disconnected).toBe(true);
    });

    it('cleans up listeners on unmount', () => {
        const es = createMockEventSource();
        const { unmount } = renderHook(() => usePipelinePhase(es as any, undefined));

        expect(es._listenerCount('pipeline-phase')).toBe(1);
        expect(es._listenerCount('pipeline-progress')).toBe(1);
        expect(es._listenerCount('error')).toBe(1);

        unmount();

        expect(es.removeEventListener).toHaveBeenCalledTimes(3);
        expect(es._listenerCount('pipeline-phase')).toBe(0);
        expect(es._listenerCount('pipeline-progress')).toBe(0);
        expect(es._listenerCount('error')).toBe(0);
    });

    it('builds DAGChartData from live phases', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        act(() => {
            es._emit('pipeline-phase', { phase: 'input', status: 'completed', durationMs: 50 });
            es._emit('pipeline-phase', { phase: 'map', status: 'started' });
        });

        expect(result.current.dagData).not.toBeNull();
        expect(result.current.dagData!.nodes.length).toBeGreaterThanOrEqual(2);

        const inputNode = result.current.dagData!.nodes.find(n => n.phase === 'input');
        expect(inputNode?.state).toBe('completed');

        const mapNode = result.current.dagData!.nodes.find(n => n.phase === 'map');
        expect(mapNode?.state).toBe('running');
    });

    it('resets disconnected when eventSource changes', () => {
        const es1 = createMockEventSource();
        const { result, rerender } = renderHook(
            ({ es }) => usePipelinePhase(es as any, undefined),
            { initialProps: { es: es1 } },
        );

        act(() => {
            es1._emitError();
        });
        expect(result.current.disconnected).toBe(true);

        const es2 = createMockEventSource();
        rerender({ es: es2 });
        expect(result.current.disconnected).toBe(false);
    });

    it('preserves startedAt across status updates', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        act(() => {
            vi.setSystemTime(5000);
            es._emit('pipeline-phase', { phase: 'map', status: 'started' });
        });

        const startedAt = result.current.phases.get('map')?.startedAt;
        expect(startedAt).toBeDefined();

        act(() => {
            vi.setSystemTime(8000);
            es._emit('pipeline-phase', { phase: 'map', status: 'completed', durationMs: 3000 });
        });

        // startedAt should be preserved from the started event
        expect(result.current.phases.get('map')?.startedAt).toBe(startedAt);
        expect(result.current.phases.get('map')?.completedAt).toBeDefined();
    });

    it('handles parse errors gracefully', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => usePipelinePhase(es as any, undefined));

        // Simulate a bad event — should not throw
        const listeners = (es as any).addEventListener.mock.calls;
        const phaseHandler = listeners.find((c: any[]) => c[0] === 'pipeline-phase')?.[1];
        expect(phaseHandler).toBeDefined();

        act(() => {
            phaseHandler({ data: 'not json' } as MessageEvent);
        });

        expect(result.current.phases.size).toBe(0);
    });

    it('clears pending throttle timeout on unmount', () => {
        const es = createMockEventSource();
        const { unmount } = renderHook(() => usePipelinePhase(es as any, undefined));

        // Emit first, then second quickly to set up a pending timeout
        act(() => {
            vi.setSystemTime(1000);
            es._emit('pipeline-progress', { completedItems: 1, failedItems: 0, totalItems: 10, percentage: 10 });
        });
        act(() => {
            vi.setSystemTime(1100);
            es._emit('pipeline-progress', { completedItems: 2, failedItems: 0, totalItems: 10, percentage: 20 });
        });

        // Unmount before the timeout fires
        unmount();

        // Advancing timers should not cause errors
        act(() => {
            vi.advanceTimersByTime(500);
        });
    });
});
