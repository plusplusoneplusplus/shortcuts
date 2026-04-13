/**
 * In-Memory Process Store Tests
 *
 * Verifies createStubStore() implements the ProcessStore interface correctly,
 * including getProcessCount.
 */

import { describe, it, expect } from 'vitest';
import { createStubStore } from '../../src/server/in-memory-process-store';
import type { AIProcess, AIProcessStatus } from '@plusplusoneplusplus/forge';

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test',
        fullPrompt: 'test',
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

describe('createStubStore', () => {
    it('getProcessCount returns 0 for empty store', async () => {
        const store = createStubStore();
        expect(await store.getProcessCount()).toBe(0);
    });

    it('getProcessCount reflects added processes', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.addProcess(makeProcess('p3'));
        expect(await store.getProcessCount()).toBe(3);
    });

    it('getProcessCount decreases after removeProcess', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        expect(await store.getProcessCount()).toBe(2);

        await store.removeProcess('p1');
        expect(await store.getProcessCount()).toBe(1);
    });

    it('getProcessCount returns 0 after clearProcesses', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.clearProcesses();
        expect(await store.getProcessCount()).toBe(0);
    });

    it('addProcess + getProcess round-trip', async () => {
        const store = createStubStore();
        const p = makeProcess('p1', { status: 'completed' });
        await store.addProcess(p);

        const result = await store.getProcess('p1');
        expect(result).toBeDefined();
        expect(result!.id).toBe('p1');
        expect(result!.status).toBe('completed');
    });

    it('getAllProcesses returns all stored processes', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));

        const all = await store.getAllProcesses();
        expect(all).toHaveLength(2);
        const ids = all.map(p => p.id).sort();
        expect(ids).toEqual(['p1', 'p2']);
    });

    it('updateProcess modifies existing process', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1', { status: 'running' }));
        await store.updateProcess('p1', { status: 'completed' as AIProcessStatus });

        const result = await store.getProcess('p1');
        expect(result!.status).toBe('completed');
    });

    it('onProcessChange fires on add, update, remove, clear', async () => {
        const store = createStubStore();
        const events: string[] = [];
        store.onProcessChange = (event) => events.push(event.type);

        await store.addProcess(makeProcess('p1'));
        await store.updateProcess('p1', { status: 'completed' as AIProcessStatus });
        await store.removeProcess('p1');
        await store.addProcess(makeProcess('p2'));
        await store.clearProcesses();

        expect(events).toEqual([
            'process-added',
            'process-updated',
            'process-removed',
            'process-added',
            'processes-cleared',
        ]);
    });

    it('getProcessIds returns empty array for empty store', async () => {
        const store = createStubStore();
        expect(await store.getProcessIds()).toEqual([]);
    });

    it('getProcessIds returns all process IDs', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.addProcess(makeProcess('p3'));

        const ids = await store.getProcessIds();
        expect(ids).toHaveLength(3);
        expect(new Set(ids)).toEqual(new Set(['p1', 'p2', 'p3']));
    });

    it('getProcessIds reflects removals', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.removeProcess('p1');

        const ids = await store.getProcessIds();
        expect(ids).toEqual(['p2']);
    });

    it('getProcessIds returns empty array after clearProcesses', async () => {
        const store = createStubStore();
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.clearProcesses();

        expect(await store.getProcessIds()).toEqual([]);
    });
});
