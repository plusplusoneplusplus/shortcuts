import { describe, it, expect, vi } from 'vitest';
import { ProcessTrackerAdapter } from '../../src/map-reduce/process-tracker-adapter';
import type { ProcessTracker, ExecutionStats } from '../../src/map-reduce/types';

function makeTracker(overrides: Partial<ProcessTracker> = {}): ProcessTracker {
    return {
        registerProcess: vi.fn().mockReturnValue('proc-1'),
        updateProcess: vi.fn(),
        registerGroup: vi.fn().mockReturnValue('grp-1'),
        completeGroup: vi.fn(),
        attachSessionMetadata: vi.fn(),
        ...overrides,
    };
}

const STATS: ExecutionStats = {
    totalItems: 5, successfulMaps: 4, failedMaps: 1,
    mapPhaseTimeMs: 100, reducePhaseTimeMs: 50, maxConcurrency: 3,
};

describe('ProcessTrackerAdapter', () => {
    describe('with tracker', () => {
        it('registerGroup delegates to tracker', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            expect(adapter.registerGroup('test group')).toBe('grp-1');
            expect(tracker.registerGroup).toHaveBeenCalledWith('test group');
        });

        it('registerProcess delegates to tracker', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            expect(adapter.registerProcess('desc', 'grp-1')).toBe('proc-1');
            expect(tracker.registerProcess).toHaveBeenCalledWith('desc', 'grp-1');
        });

        it('completeProcess serializes output and calls updateProcess', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.completeProcess('proc-1', { result: 42 });
            expect(tracker.updateProcess).toHaveBeenCalledWith(
                'proc-1', 'completed', undefined, undefined, JSON.stringify({ result: 42 })
            );
        });

        it('completeProcess attaches session metadata when output has sessionId', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.completeProcess('proc-1', { sessionId: 'sess-abc' });
            expect(tracker.attachSessionMetadata).toHaveBeenCalledWith('proc-1', {
                sessionId: 'sess-abc', backend: 'copilot-sdk',
            });
        });

        it('completeProcess does not attach session metadata when output lacks sessionId', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.completeProcess('proc-1', { data: 'no session' });
            expect(tracker.attachSessionMetadata).not.toHaveBeenCalled();
        });

        it('completeProcess handles non-serializable output gracefully', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            const circular: Record<string, unknown> = {};
            circular.self = circular;
            adapter.completeProcess('proc-1', circular);
            // structuredResult should be undefined but updateProcess still called
            expect(tracker.updateProcess).toHaveBeenCalledWith(
                'proc-1', 'completed', undefined, undefined, undefined
            );
        });

        it('failProcess calls updateProcess with failed status', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.failProcess('proc-1', 'something broke');
            expect(tracker.updateProcess).toHaveBeenCalledWith('proc-1', 'failed', undefined, 'something broke');
        });

        it('completeGroup delegates to tracker', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.completeGroup('grp-1', 'Done', STATS);
            expect(tracker.completeGroup).toHaveBeenCalledWith('grp-1', 'Done', STATS);
        });
    });

    describe('without tracker', () => {
        it('registerGroup returns undefined', () => {
            const adapter = new ProcessTrackerAdapter();
            expect(adapter.registerGroup('test')).toBeUndefined();
        });

        it('registerProcess returns undefined', () => {
            const adapter = new ProcessTrackerAdapter();
            expect(adapter.registerProcess('test')).toBeUndefined();
        });

        it('completeProcess does not throw', () => {
            const adapter = new ProcessTrackerAdapter();
            adapter.completeProcess('proc-1', { x: 1 });
        });

        it('failProcess does not throw', () => {
            const adapter = new ProcessTrackerAdapter();
            adapter.failProcess('proc-1', 'error');
        });

        it('completeGroup does not throw', () => {
            const adapter = new ProcessTrackerAdapter();
            adapter.completeGroup('grp-1', 'Done', STATS);
        });
    });

    describe('with undefined processId', () => {
        it('completeProcess is a no-op', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.completeProcess(undefined, { x: 1 });
            expect(tracker.updateProcess).not.toHaveBeenCalled();
        });

        it('failProcess is a no-op', () => {
            const tracker = makeTracker();
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.failProcess(undefined, 'error');
            expect(tracker.updateProcess).not.toHaveBeenCalled();
        });
    });

    describe('without attachSessionMetadata method', () => {
        it('completeProcess still completes without attaching session metadata', () => {
            const tracker = makeTracker({ attachSessionMetadata: undefined });
            const adapter = new ProcessTrackerAdapter(tracker);
            adapter.completeProcess('proc-1', { sessionId: 'sess-abc' });
            expect(tracker.updateProcess).toHaveBeenCalledWith(
                'proc-1', 'completed', undefined, undefined, JSON.stringify({ sessionId: 'sess-abc' })
            );
        });
    });
});
