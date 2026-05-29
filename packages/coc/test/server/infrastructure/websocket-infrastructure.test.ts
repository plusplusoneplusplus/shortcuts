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
import { ProcessWebSocketServer } from '../../../src/server/streaming/websocket';

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
        getHistory: vi.fn().mockReturnValue([]),
    };
    return {
        getQueueForRepo: vi.fn().mockReturnValue(mockManager),
        getAllQueues: vi.fn().mockReturnValue(new Map()),
        _mockManager: mockManager,
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

        it('per-repo broadcast does not include history', () => {
            const historyTask = { id: 'h1', repoId: 'r1', status: 'completed', completedAt: '2026-01-01', payload: { prompt: 'do stuff' }, title: 'Task 1' };
            registry._mockManager.getHistory.mockReturnValue([historyTask]);

            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'repo-1', type: 'completed' });

            const perRepo = broadcast.mock.calls[0][0] as any;
            expect(perRepo.queue.history).toBeUndefined();
        });

        it('aggregate broadcast does not include history', () => {
            const historyA = { id: 'ha', repoId: 'a', status: 'completed', completedAt: '2026-01-01', payload: {} };
            const historyB = { id: 'hb', repoId: 'b', status: 'failed', completedAt: '2026-01-02', payload: {} };
            const managerA = {
                getQueued: vi.fn().mockReturnValue([]),
                getRunning: vi.fn().mockReturnValue([]),
                getHistory: vi.fn().mockReturnValue([historyA]),
                getStats: vi.fn().mockReturnValue({ queued: 0, running: 0, total: 0, isPaused: false, isDraining: false }),
            };
            const managerB = {
                getQueued: vi.fn().mockReturnValue([]),
                getRunning: vi.fn().mockReturnValue([]),
                getHistory: vi.fn().mockReturnValue([historyB]),
                getStats: vi.fn().mockReturnValue({ queued: 0, running: 0, total: 0, isPaused: false, isDraining: false }),
            };
            registry.getAllQueues.mockReturnValue(new Map([['a', managerA], ['b', managerB]]));

            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'a', type: 'completed' });

            const aggregate = broadcast.mock.calls[1][0] as any;
            expect(aggregate.queue.history).toBeUndefined();
        });

        it('queue broadcasts include payload.provider for chat tasks', () => {
            registry._mockManager.getQueued.mockReturnValue([
                {
                    id: 'q-provider',
                    repoId: 'repo-1',
                    type: 'chat',
                    priority: 1,
                    status: 'queued',
                    displayName: 'Provider task',
                    createdAt: '2026-01-01',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        provider: 'codex',
                        planFilePath: '/data/repos/abc/tasks/provider/task.md',
                    },
                },
            ]);

            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'repo-1', type: 'enqueued' });

            const perRepo = broadcast.mock.calls[0][0] as any;
            expect(perRepo.queue.queued[0].payload.provider).toBe('codex');
        });

        it('does not call getHistory on managers', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            vi.spyOn(ws, 'broadcastProcessEvent');

            bridge.emit('queueChange', { repoPath: '/repo', repoId: 'r1', type: 'enqueued' });

            expect(registry._mockManager.getHistory).not.toHaveBeenCalled();
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

        it('forwards running schedule-triggered payloads to dashboard clients', () => {
            const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
            const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

            scheduleManager.emit('change', {
                type: 'schedule-triggered',
                repoId: 'r1',
                scheduleId: 's1',
                schedule: { id: 's1', name: 'Nightly Ralph' },
                run: { id: 'run-1', scheduleId: 's1', repoId: 'r1', status: 'running' },
            });

            expect(broadcast).toHaveBeenCalledOnce();
            const [event] = broadcast.mock.calls[0];
            expect(event).toMatchObject({
                type: 'schedule-triggered',
                repoId: 'r1',
                scheduleId: 's1',
                run: { id: 'run-1', status: 'running' },
            });
        });

        it.each(['missed', 'completed', 'failed'] as const)(
            'forwards %s schedule-run-complete payloads to dashboard clients',
            (status) => {
                const ws = createWebSocketInfrastructure(server, store, bridge, registry, scheduleManager);
                const broadcast = vi.spyOn(ws, 'broadcastProcessEvent');

                scheduleManager.emit('change', {
                    type: 'schedule-run-complete',
                    repoId: 'r1',
                    scheduleId: 's1',
                    schedule: { id: 's1', name: 'Nightly Ralph' },
                    run: {
                        id: `run-${status}`,
                        scheduleId: 's1',
                        repoId: 'r1',
                        status,
                        error: status === 'failed' ? 'final-check-failed' : undefined,
                    },
                });

                expect(broadcast).toHaveBeenCalledOnce();
                const [event] = broadcast.mock.calls[0];
                expect(event).toMatchObject({
                    type: 'schedule-run-complete',
                    repoId: 'r1',
                    scheduleId: 's1',
                    run: { id: `run-${status}`, status },
                });
                if (status === 'failed') {
                    expect((event as any).run.error).toBe('final-check-failed');
                }
            },
        );
    });
});
