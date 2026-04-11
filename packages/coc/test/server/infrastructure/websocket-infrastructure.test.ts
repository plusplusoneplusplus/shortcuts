/**
 * createWebSocketInfrastructure Tests
 *
 * Regression coverage for the extracted WebSocket infrastructure builder.
 * Verifies that createWebSocketInfrastructure correctly:
 * - Creates and returns a ProcessWebSocketServer
 * - Wires drain events from the bridge to the WS server
 * - Wires store.onProcessChange to the WS server
 * - Wires queue-change events from the bridge to the WS server
 * - Wires schedule-change events from the scheduleManager to the WS server
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import { createWebSocketInfrastructure } from '../../../src/server/infrastructure/websocket-infrastructure';
import { ProcessWebSocketServer } from '../../../src/server/websocket';

// ============================================================================
// Helpers / minimal fakes
// ============================================================================

function makeServer(): http.Server {
    // ProcessWebSocketServer.attach() only calls server.on('upgrade', ...).
    return { on: vi.fn() } as unknown as http.Server;
}

function makeStore(): any {
    let changeCallback: any;
    return {
        get onProcessChange() { return changeCallback; },
        set onProcessChange(cb: any) { changeCallback = cb; },
    };
}

function makeBridge(): any {
    const emitter = new EventEmitter();
    return {
        on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
        emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
    };
}

function makeRegistry(): any {
    const mockManager = {
        getStats: vi.fn().mockReturnValue({ queued: 0, running: 0, total: 0, isPaused: false, isDraining: false }),
        getQueued: vi.fn().mockReturnValue([]),
        getRunning: vi.fn().mockReturnValue([]),
    };
    return {
        getQueueForRepo: vi.fn().mockReturnValue(mockManager),
        getAllQueues: vi.fn().mockReturnValue(new Map()),
    };
}

function makeScheduleManager(): any {
    const emitter = new EventEmitter();
    return {
        on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
        emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('createWebSocketInfrastructure', () => {
    let server: http.Server;
    let store: ReturnType<typeof makeStore>;
    let bridge: ReturnType<typeof makeBridge>;
    let registry: ReturnType<typeof makeRegistry>;
    let scheduleManager: ReturnType<typeof makeScheduleManager>;

    beforeEach(() => {
        server = makeServer();
        store = makeStore();
        bridge = makeBridge();
        registry = makeRegistry();
        scheduleManager = makeScheduleManager();
    });

    it('returns a ProcessWebSocketServer instance', () => {
        const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
        expect(ws).toBeInstanceOf(ProcessWebSocketServer);
    });

    it('sets store.onProcessChange to a function', () => {
        createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
        expect(typeof store.onProcessChange).toBe('function');
    });

    describe('drain event wiring', () => {
        it.each(['drain-start', 'drain-progress', 'drain-complete', 'drain-timeout'] as const)(
            'forwards %s from bridge to wsServer',
            (eventType) => {
                const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
                const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

                bridge.emit(eventType, { queued: 1, running: 2, outcome: 'completed' as const });

                expect(broadcast).toHaveBeenCalledOnce();
                expect(broadcast.mock.calls[0][0]).toMatchObject({ type: eventType });
            },
        );
    });

    describe('store process change wiring', () => {
        it('broadcasts process-added event', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            store.onProcessChange({
                type: 'process-added',
                process: { id: 'p1', status: 'running', output: [], metadata: {} } as any,
            });

            expect(broadcast).toHaveBeenCalledOnce();
            const [event] = broadcast.mock.calls[0];
            expect((event as any).type).toBe('process-added');
        });

        it('broadcasts process-updated event', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            store.onProcessChange({
                type: 'process-updated',
                process: { id: 'p1', status: 'completed', output: [], metadata: {} } as any,
            });

            expect(broadcast).toHaveBeenCalledOnce();
            expect((broadcast.mock.calls[0][0] as any).type).toBe('process-updated');
        });

        it('broadcasts process-removed event', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            store.onProcessChange({
                type: 'process-removed',
                process: { id: 'p1', status: 'completed', output: [], metadata: {} } as any,
            });

            expect(broadcast).toHaveBeenCalledOnce();
            expect((broadcast.mock.calls[0][0] as any).type).toBe('process-removed');
            expect((broadcast.mock.calls[0][0] as any).processId).toBe('p1');
        });

        it('broadcasts processes-cleared event', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            store.onProcessChange({ type: 'processes-cleared' });

            expect(broadcast).toHaveBeenCalledOnce();
            expect((broadcast.mock.calls[0][0] as any).type).toBe('processes-cleared');
        });

        it('does not broadcast process-added when event.process is undefined', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            store.onProcessChange({ type: 'process-added', process: undefined });

            expect(broadcast).not.toHaveBeenCalled();
        });
    });

    describe('queue change wiring', () => {
        it('broadcasts queue-updated when bridge emits queueChange', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'r1', type: 'enqueued' });

            // Expect 2 broadcasts: per-repo + aggregate
            expect(broadcast).toHaveBeenCalledTimes(2);
            const types = broadcast.mock.calls.map((c) => (c[0] as any).type);
            expect(types).toEqual(['queue-updated', 'queue-updated']);
        });

        it('per-repo broadcast includes repoId', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'repo-123', type: 'enqueued' });

            const perRepo = broadcast.mock.calls[0][0] as any;
            expect(perRepo.queue.repoId).toBe('repo-123');
        });

        it('aggregate broadcast has no repoId', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'r1', type: 'enqueued' });

            const aggregate = broadcast.mock.calls[1][0] as any;
            expect(aggregate.queue.repoId).toBeUndefined();
        });
    });

    describe('schedule change wiring', () => {
        it('broadcasts schedule event when scheduleManager emits change', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            scheduleManager.emit('change', {
                type: 'schedule-added',
                repoId: 'r1',
                scheduleId: 's1',
                schedule: { id: 's1' },
                run: undefined,
            });

            expect(broadcast).toHaveBeenCalledOnce();
            const [event] = broadcast.mock.calls[0];
            expect((event as any).type).toBe('schedule-added');
            expect((event as any).repoId).toBe('r1');
            expect((event as any).scheduleId).toBe('s1');
        });
    });
});
