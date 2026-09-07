import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProcessEventBus, type ProcessEventBus } from '../src/process-event-bus';
import { FileProcessStore } from '../src/file-process-store';
import { SqliteProcessStore } from '../src/sqlite-process-store';

describe.each(['factory', 'file', 'sqlite'] as const)('%s process event bus', kind => {
    let bus: ProcessEventBus;
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'process-event-bus-'));
        bus = kind === 'file' ? new FileProcessStore({ dataDir: dir })
            : kind === 'sqlite' ? new SqliteProcessStore({ dbPath: join(dir, 'processes.db') })
                : createProcessEventBus();
    });
    afterEach(async () => {
        if (bus instanceof SqliteProcessStore) bus.close();
        await rm(dir, { recursive: true, force: true });
    });

    it('isolates process IDs and dispatches chunk, custom and completion events in order', () => {
        const received = vi.fn();
        const other = vi.fn();
        bus.onProcessOutput('repo-a/process', received);
        bus.onProcessOutput('repo-b/process', other);
        const event = { type: 'suggestions' as const, suggestions: ['next'] };
        bus.emitProcessOutput('repo-a/process', 'hello');
        bus.emitProcessEvent('repo-a/process', event);
        bus.emitProcessComplete('repo-a/process', 'completed', '2s');
        expect(received.mock.calls.map(([e]) => e)).toEqual([
            { type: 'chunk', content: 'hello' }, event,
            { type: 'complete', status: 'completed', duration: '2s' },
        ]);
        expect(received.mock.calls[1][0]).toBe(event);
        expect(other).not.toHaveBeenCalled();
    });

    it('removes only the requested subscription and allows repeated unsubscribe', () => {
        const callback = vi.fn();
        const unsubscribe = bus.onProcessOutput('p', callback);
        bus.onProcessOutput('p', callback);
        unsubscribe();
        unsubscribe();
        bus.emitProcessOutput('p', 'once');
        expect(callback).toHaveBeenCalledExactlyOnceWith({ type: 'chunk', content: 'once' });
    });

    it('releases completed listeners without affecting a fresh subscription to the same ID', () => {
        const oldListener = vi.fn();
        const newListener = vi.fn();
        const unsubscribe = bus.onProcessOutput('p', oldListener);
        bus.emitProcessComplete('p', 'failed', '1s');
        bus.onProcessOutput('p', newListener);
        unsubscribe();
        bus.emitProcessOutput('p', 'retry');
        expect(oldListener).toHaveBeenCalledTimes(1);
        expect(newListener).toHaveBeenCalledExactlyOnceWith({ type: 'chunk', content: 'retry' });
    });

    it('does not replay events emitted without listeners', () => {
        bus.emitProcessComplete('absent', 'cancelled', '0s');
        bus.emitProcessOutput('p', 'before subscription');
        bus.emitProcessEvent('p', { type: 'chunk', content: 'also before' });
        const listener = vi.fn();
        bus.onProcessOutput('p', listener);
        expect(listener).not.toHaveBeenCalled();
        bus.emitProcessComplete('p', 'completed', '1s');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not clean up on a generic complete event', () => {
        const listener = vi.fn();
        bus.onProcessOutput('p', listener);
        bus.emitProcessEvent('p', { type: 'complete', status: 'completed', duration: '1s' });
        bus.emitProcessOutput('p', 'still subscribed');
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

it('isolates factory instances even for identical process IDs', () => {
    const first = createProcessEventBus();
    const second = createProcessEventBus();
    const listener = vi.fn();
    first.onProcessOutput('p', listener);
    second.emitProcessOutput('p', 'another store');
    second.emitProcessComplete('p', 'completed', '1s');
    expect(listener).not.toHaveBeenCalled();
    first.emitProcessOutput('p', 'own store');
    expect(listener).toHaveBeenCalledTimes(1);
});
