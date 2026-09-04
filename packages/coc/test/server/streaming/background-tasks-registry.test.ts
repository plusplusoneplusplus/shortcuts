/**
 * Verifies BackgroundTasksRegistry — the in-memory "latest snapshot per process"
 * store that lets a freshly-opened SSE stream replay background-task state that
 * was emitted before it connected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { BackgroundTasksInfo } from '@plusplusoneplusplus/forge';
import { BackgroundTasksRegistry, backgroundTasksRegistry } from '../../../src/server/streaming/background-tasks-registry';

function makeInfo(overrides: Partial<BackgroundTasksInfo> = {}): BackgroundTasksInfo {
    return {
        backgroundAgents: [],
        backgroundShells: [{ id: 's1', type: 'shell', description: 'npm run test' }],
        backgroundTotalActive: 1,
        backgroundWaitingForDrain: true,
        ...overrides,
    };
}

describe('BackgroundTasksRegistry', () => {
    let registry: BackgroundTasksRegistry;

    beforeEach(() => {
        registry = new BackgroundTasksRegistry();
    });

    it('round-trips a recorded snapshot', () => {
        const info = makeInfo();
        registry.record('p-1', info);
        expect(registry.get('p-1')).toEqual(info);
    });

    it('returns undefined for a process that never recorded', () => {
        expect(registry.get('p-missing')).toBeUndefined();
    });

    it('deletes rather than stores a snapshot with nothing active', () => {
        registry.record('p-1', makeInfo());
        registry.record('p-1', makeInfo({
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: false,
        }));
        expect(registry.get('p-1')).toBeUndefined();
    });

    it('never stores a zero snapshot even as the first write', () => {
        registry.record('p-1', makeInfo({
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: false,
        }));
        expect(registry.get('p-1')).toBeUndefined();
    });

    it('overwrites an earlier snapshot with the latest one', () => {
        registry.record('p-1', makeInfo());
        const latest = makeInfo({
            backgroundAgents: [{ id: 'a1', description: 'research' }],
            backgroundTotalActive: 2,
        });
        registry.record('p-1', latest);
        expect(registry.get('p-1')).toEqual(latest);
    });

    it('clear is idempotent and leaves siblings untouched', () => {
        const other = makeInfo({ backgroundTotalActive: 3 });
        registry.record('p-1', makeInfo());
        registry.record('p-2', other);

        registry.clear('p-1');
        registry.clear('p-1');
        registry.clear('p-never-recorded');

        expect(registry.get('p-1')).toBeUndefined();
        expect(registry.get('p-2')).toEqual(other);
    });

    it('holds independent snapshots per process', () => {
        const a = makeInfo({ backgroundTotalActive: 1 });
        const b = makeInfo({ backgroundTotalActive: 5 });
        registry.record('p-a', a);
        registry.record('p-b', b);
        expect(registry.get('p-a')).toEqual(a);
        expect(registry.get('p-b')).toEqual(b);
    });

    it('dispose drops every entry', () => {
        registry.record('p-a', makeInfo());
        registry.record('p-b', makeInfo());
        registry.dispose();
        expect(registry.get('p-a')).toBeUndefined();
        expect(registry.get('p-b')).toBeUndefined();
    });

    it('exports a module singleton', () => {
        expect(backgroundTasksRegistry).toBeInstanceOf(BackgroundTasksRegistry);
    });
});
