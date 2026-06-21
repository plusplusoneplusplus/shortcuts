/**
 * WarmStatusBridge Tests
 *
 * Verifies the bridge that relays WarmClientRegistry transitions
 * (service.onWarmStatusChange) onto interested processes' SSE channels as
 * `warm-status` ProcessOutputEvents (AC-01).
 */

import { describe, it, expect, vi } from 'vitest';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { makeWarmKey, type WarmStatus, type WarmStateChangeListener } from '@plusplusoneplusplus/coc-agent-sdk';
import { WarmStatusBridge, type WarmStatusServiceLookup } from '../../src/server/streaming/warm-status-bridge';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A fake warming-capable service that lets the test drive transitions. */
function createWarmingService() {
    const listeners = new Set<WarmStateChangeListener>();
    return {
        onWarmStatusChange(listener: WarmStateChangeListener): () => void {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        /** Drive a transition for a key as the registry would. */
        emit(key: string, status: WarmStatus): void {
            for (const l of [...listeners]) { l(key, status); }
        },
        get listenerCount(): number { return listeners.size; },
    };
}

/** A registry that returns the given service per provider name. */
function createRegistry(map: Record<string, ReturnType<typeof createWarmingService> | { /* no warm hook */ }>): WarmStatusServiceLookup {
    return { get: (name: string) => (map[name] as any) };
}

function createMockStore(): Pick<ProcessStore, 'emitProcessEvent'> {
    return { emitProcessEvent: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WarmStatusBridge', () => {
    it('relays a transition to an interested process as a warm-status event', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();

        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        copilot.emit(makeWarmKey('copilot', '/repo'), 'warm');

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('p1', { type: 'warm-status', warmStatus: 'warm' });
    });

    it('relays every status in the lifecycle (warming → active → warm → cold)', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();
        const key = makeWarmKey('copilot', '/repo');

        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        for (const status of ['warming', 'active', 'warm', 'cold'] as const) {
            copilot.emit(key, status);
        }

        const statuses = (store.emitProcessEvent as any).mock.calls.map((c: any[]) => c[1].warmStatus);
        expect(statuses).toEqual(['warming', 'active', 'warm', 'cold']);
    });

    it('does not relay a transition for a different key', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();

        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo-a' });
        copilot.emit(makeWarmKey('copilot', '/repo-b'), 'warm');

        expect(store.emitProcessEvent).not.toHaveBeenCalled();
    });

    it('fans a transition out to every process interested in the same key', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const storeA = createMockStore();
        const storeB = createMockStore();
        const key = makeWarmKey('copilot', '/repo');

        bridge.register({ store: storeA as any, processId: 'pA', provider: 'copilot', workingDirectory: '/repo' });
        bridge.register({ store: storeB as any, processId: 'pB', provider: 'copilot', workingDirectory: '/repo' });
        copilot.emit(key, 'active');

        expect(storeA.emitProcessEvent).toHaveBeenCalledWith('pA', { type: 'warm-status', warmStatus: 'active' });
        expect(storeB.emitProcessEvent).toHaveBeenCalledWith('pB', { type: 'warm-status', warmStatus: 'active' });
    });

    it('subscribes to a provider service only once across many registrations', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();

        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        bridge.register({ store: store as any, processId: 'p2', provider: 'copilot', workingDirectory: '/repo' });
        bridge.register({ store: store as any, processId: 'p3', provider: 'copilot', workingDirectory: '/other' });

        expect(copilot.listenerCount).toBe(1);
    });

    it('stops relaying after unregister', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();
        const key = makeWarmKey('copilot', '/repo');

        const unregister = bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        copilot.emit(key, 'warm');
        unregister();
        copilot.emit(key, 'cold');

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('p1', { type: 'warm-status', warmStatus: 'warm' });
    });

    it('unregister is idempotent and only removes its own process', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const storeA = createMockStore();
        const storeB = createMockStore();
        const key = makeWarmKey('copilot', '/repo');

        const unregisterA = bridge.register({ store: storeA as any, processId: 'pA', provider: 'copilot', workingDirectory: '/repo' });
        bridge.register({ store: storeB as any, processId: 'pB', provider: 'copilot', workingDirectory: '/repo' });

        unregisterA();
        unregisterA(); // second call is a no-op
        copilot.emit(key, 'warm');

        expect(storeA.emitProcessEvent).not.toHaveBeenCalled();
        expect(storeB.emitProcessEvent).toHaveBeenCalledWith('pB', { type: 'warm-status', warmStatus: 'warm' });
    });

    it('ref-counts interest per process: a second stream survives the first closing (regression)', () => {
        // A conversation can have two open streams registering the same processId:
        // the main chat stream (open while running) and the warm-only stream (open
        // across completion). Closing the first must NOT drop the second's interest,
        // otherwise the `active → warm` push at turn completion never reaches the SPA.
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();
        const key = makeWarmKey('copilot', '/repo');

        const closeMain = bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        const closeWarm = bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });

        // Main chat stream closes when the turn completes.
        closeMain();
        // The warm-only stream is still open → the parked-client push must arrive.
        copilot.emit(key, 'warm');
        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('p1', { type: 'warm-status', warmStatus: 'warm' });

        // Once the last stream closes, interest is dropped.
        closeWarm();
        copilot.emit(key, 'cold');
        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
    });

    it('fans out once per process even when registered by multiple streams', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();
        const key = makeWarmKey('copilot', '/repo');

        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        copilot.emit(key, 'active');

        // Two registrations for one processId still produce a single emit.
        expect(store.emitProcessEvent).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for a provider that cannot stay warm (no onWarmStatusChange, e.g. Claude)', () => {
        const claude = {}; // no onWarmStatusChange method
        const bridge = new WarmStatusBridge(createRegistry({ claude }));
        const store = createMockStore();

        // Must not throw and must register no subscription.
        const unregister = bridge.register({ store: store as any, processId: 'p1', provider: 'claude', workingDirectory: '/repo' });
        expect(() => unregister()).not.toThrow();
        expect(store.emitProcessEvent).not.toHaveBeenCalled();
    });

    it('is a no-op for an unregistered provider', () => {
        const bridge = new WarmStatusBridge(createRegistry({}));
        const store = createMockStore();

        expect(() => {
            const unregister = bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
            unregister();
        }).not.toThrow();
        expect(store.emitProcessEvent).not.toHaveBeenCalled();
    });

    it('dispose tears down the provider subscription', () => {
        const copilot = createWarmingService();
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        const store = createMockStore();

        bridge.register({ store: store as any, processId: 'p1', provider: 'copilot', workingDirectory: '/repo' });
        expect(copilot.listenerCount).toBe(1);

        bridge.dispose();
        expect(copilot.listenerCount).toBe(0);

        // After dispose, a stale transition reaches no one.
        copilot.emit(makeWarmKey('copilot', '/repo'), 'warm');
        expect(store.emitProcessEvent).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// getCurrentStatus — synchronous snapshot read for the warm-only SSE stream (AC-02)
// ---------------------------------------------------------------------------

describe('WarmStatusBridge.getCurrentStatus', () => {
    it('returns the provider status for a supported provider, passing through the cwd', () => {
        const copilot = { getWarmStatus: vi.fn((_opts: { workingDirectory?: string }) => 'warm' as WarmStatus) };
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));

        expect(bridge.getCurrentStatus('copilot', '/repo')).toBe('warm');
        expect(copilot.getWarmStatus).toHaveBeenCalledWith({ workingDirectory: '/repo' });
    });

    it('reflects each lifecycle status the provider reports', () => {
        for (const status of ['cold', 'warming', 'warm', 'active'] as const) {
            const codex = { getWarmStatus: vi.fn(() => status as WarmStatus) };
            const bridge = new WarmStatusBridge(createRegistry({ codex }));
            expect(bridge.getCurrentStatus('codex', '/repo')).toBe(status);
        }
    });

    it('returns cold when the provider service is missing', () => {
        const bridge = new WarmStatusBridge(createRegistry({}));
        expect(bridge.getCurrentStatus('copilot', '/repo')).toBe('cold');
    });

    it('returns cold when the service lacks getWarmStatus (e.g. Claude)', () => {
        const claude = { onWarmStatusChange: () => () => { /* warm transitions only */ } };
        const bridge = new WarmStatusBridge(createRegistry({ claude }));
        expect(bridge.getCurrentStatus('claude', '/repo')).toBe('cold');
    });

    it('returns cold when getWarmStatus throws (best-effort isolation)', () => {
        const copilot = { getWarmStatus: () => { throw new Error('registry boom'); } };
        const bridge = new WarmStatusBridge(createRegistry({ copilot }));
        expect(bridge.getCurrentStatus('copilot', '/repo')).toBe('cold');
    });

    it('returns cold when the registry lookup itself throws', () => {
        const throwingRegistry: WarmStatusServiceLookup = {
            get: () => { throw new Error('lookup boom'); },
        };
        const bridge = new WarmStatusBridge(throwingRegistry);
        expect(bridge.getCurrentStatus('copilot', '/repo')).toBe('cold');
    });
});
