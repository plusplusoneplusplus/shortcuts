import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useItemProcessEvents } from '../../../../src/server/spa/client/react/hooks/useItemProcessEvents';

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

describe('useItemProcessEvents', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns empty state when eventSource is null', () => {
        const { result } = renderHook(() => useItemProcessEvents(null));
        expect(result.current.items.size).toBe(0);
        expect(result.current.isConnected).toBe(true);
    });

    it('updates items on item-process events', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useItemProcessEvents(es as any));

        act(() => {
            es._emit('item-process', {
                processId: 'proc-1-m0',
                itemIndex: 0,
                status: 'running',
                promptPreview: 'Analyze...',
            });
        });

        expect(result.current.items.size).toBe(1);
        const item = result.current.items.get('proc-1-m0');
        expect(item?.status).toBe('running');
        expect(item?.itemIndex).toBe(0);
        expect(item?.promptPreview).toBe('Analyze...');
    });

    it('updates existing items with new status', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useItemProcessEvents(es as any));

        act(() => {
            vi.setSystemTime(1000);
            es._emit('item-process', {
                processId: 'proc-1-m0',
                itemIndex: 0,
                status: 'running',
            });
        });

        act(() => {
            vi.setSystemTime(2000);
            es._emit('item-process', {
                processId: 'proc-1-m0',
                itemIndex: 0,
                status: 'completed',
                durationMs: 1000,
            });
        });

        // Second update is throttled, advance timer
        act(() => {
            vi.advanceTimersByTime(250);
        });

        expect(result.current.items.get('proc-1-m0')?.status).toBe('completed');
        expect(result.current.items.get('proc-1-m0')?.durationMs).toBe(1000);
    });

    it('tracks multiple items simultaneously', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useItemProcessEvents(es as any));

        act(() => {
            vi.setSystemTime(1000);
            es._emit('item-process', { processId: 'm0', itemIndex: 0, status: 'running' });
        });
        act(() => {
            vi.setSystemTime(2000);
            es._emit('item-process', { processId: 'm1', itemIndex: 1, status: 'completed' });
        });

        // Allow throttled updates
        act(() => {
            vi.advanceTimersByTime(250);
        });

        expect(result.current.items.size).toBe(2);
        expect(result.current.items.get('m0')?.status).toBe('running');
        expect(result.current.items.get('m1')?.status).toBe('completed');
    });

    it('throttles updates at 250ms', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useItemProcessEvents(es as any));

        // First event — applied immediately
        act(() => {
            vi.setSystemTime(1000);
            es._emit('item-process', { processId: 'm0', itemIndex: 0, status: 'running' });
        });
        expect(result.current.items.get('m0')?.status).toBe('running');

        // Second event 100ms later — throttled
        act(() => {
            vi.setSystemTime(1100);
            es._emit('item-process', { processId: 'm0', itemIndex: 0, status: 'completed' });
        });
        expect(result.current.items.get('m0')?.status).toBe('running');

        // Advance past throttle window
        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(result.current.items.get('m0')?.status).toBe('completed');
    });

    it('sets disconnected on EventSource error', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useItemProcessEvents(es as any));

        expect(result.current.isConnected).toBe(true);

        act(() => {
            es._emitError();
        });

        expect(result.current.isConnected).toBe(false);
    });

    it('cleans up listeners on unmount', () => {
        const es = createMockEventSource();
        const { unmount } = renderHook(() => useItemProcessEvents(es as any));

        expect(es._listenerCount('item-process')).toBe(1);
        expect(es._listenerCount('error')).toBe(1);

        unmount();

        expect(es.removeEventListener).toHaveBeenCalledTimes(2);
        expect(es._listenerCount('item-process')).toBe(0);
        expect(es._listenerCount('error')).toBe(0);
    });

    it('handles parse errors gracefully', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useItemProcessEvents(es as any));

        const listeners = (es as any).addEventListener.mock.calls;
        const handler = listeners.find((c: any[]) => c[0] === 'item-process')?.[1];
        expect(handler).toBeDefined();

        act(() => {
            handler({ data: 'not json' } as MessageEvent);
        });

        expect(result.current.items.size).toBe(0);
    });

    it('clears pending throttle timeout on unmount', () => {
        const es = createMockEventSource();
        const { unmount } = renderHook(() => useItemProcessEvents(es as any));

        act(() => {
            vi.setSystemTime(1000);
            es._emit('item-process', { processId: 'm0', itemIndex: 0, status: 'running' });
        });
        act(() => {
            vi.setSystemTime(1100);
            es._emit('item-process', { processId: 'm0', itemIndex: 0, status: 'completed' });
        });

        unmount();

        // Advancing timers should not cause errors
        act(() => {
            vi.advanceTimersByTime(500);
        });
    });
});
