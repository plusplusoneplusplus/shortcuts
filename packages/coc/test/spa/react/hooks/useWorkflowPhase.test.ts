/**
 * Tests for useWorkflowPhase — SSE workflow-phase and workflow-progress events.
 * Note: an equivalent test suite exists as usePipelinePhase.test.ts which covers
 * this hook in more detail. This file focuses on acceptance criteria from the
 * react-hooks-streaming plan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkflowPhase } from '../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowPhase';

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
            for (const h of listeners.get(type) ?? []) h(event);
        },
        _emitError() {
            for (const h of listeners.get('error') ?? []) h(new Event('error'));
        },
    };
    return es as unknown as EventSource & {
        _emit: (type: string, data: any) => void;
        _emitError: () => void;
    };
}

describe('useWorkflowPhase', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('returns empty state when eventSource is null', () => {
        const { result } = renderHook(() => useWorkflowPhase(null, undefined));
        expect(result.current.phases.size).toBe(0);
        expect(result.current.progress).toBeNull();
        expect(result.current.disconnected).toBe(false);
    });

    it('updates phase on workflow-phase started event', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useWorkflowPhase(es as any, undefined));
        act(() => { es._emit('workflow-phase', { phase: 'input', status: 'started' }); });
        expect(result.current.phases.get('input')?.status).toBe('started');
        expect(result.current.phases.get('input')?.startedAt).toBeDefined();
    });

    it('updates phase on workflow-phase completed event', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useWorkflowPhase(es as any, undefined));
        act(() => { es._emit('workflow-phase', { phase: 'input', status: 'completed', durationMs: 200 }); });
        expect(result.current.phases.get('input')?.status).toBe('completed');
        expect(result.current.phases.get('input')?.durationMs).toBe(200);
    });

    it('updates progress on workflow-progress event', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useWorkflowPhase(es as any, undefined));
        act(() => {
            es._emit('workflow-progress', {
                completedItems: 3, failedItems: 0, totalItems: 10, percentage: 30,
            });
        });
        expect(result.current.progress?.completedItems).toBe(3);
        expect(result.current.progress?.percentage).toBe(30);
    });

    it('sets disconnected on error event', () => {
        const es = createMockEventSource();
        const { result } = renderHook(() => useWorkflowPhase(es as any, undefined));
        act(() => { es._emitError(); });
        expect(result.current.disconnected).toBe(true);
    });

    it('cleans up listeners on unmount', () => {
        const es = createMockEventSource();
        const { unmount } = renderHook(() => useWorkflowPhase(es as any, undefined));
        unmount();
        expect(es.removeEventListener).toHaveBeenCalled();
    });
});
