/**
 * FileProcessStore Flush Handler Tests
 *
 * Tests the requestFlush / registerFlushHandler / unregisterFlushHandler
 * mechanism used to flush buffered streaming content on SSE reconnect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { FileProcessStore } from '../src/index';

describe('FileProcessStore flush handlers', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-flush-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should call registered flush handler on requestFlush', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const handler = vi.fn(async () => {});

        store.registerFlushHandler('proc-1', handler);
        await store.requestFlush('proc-1');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should be a no-op when no handler is registered', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        // Should not throw
        await store.requestFlush('nonexistent');
    });

    it('should not call handler after unregister', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const handler = vi.fn(async () => {});

        store.registerFlushHandler('proc-2', handler);
        store.unregisterFlushHandler('proc-2');
        await store.requestFlush('proc-2');

        expect(handler).not.toHaveBeenCalled();
    });

    it('should replace handler on re-register', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const handler1 = vi.fn(async () => {});
        const handler2 = vi.fn(async () => {});

        store.registerFlushHandler('proc-3', handler1);
        store.registerFlushHandler('proc-3', handler2);
        await store.requestFlush('proc-3');

        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple processes independently', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const handler1 = vi.fn(async () => {});
        const handler2 = vi.fn(async () => {});

        store.registerFlushHandler('proc-a', handler1);
        store.registerFlushHandler('proc-b', handler2);

        await store.requestFlush('proc-a');

        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).not.toHaveBeenCalled();
    });

    it('unregisterFlushHandler is a no-op for unknown id', () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        // Should not throw
        store.unregisterFlushHandler('unknown');
    });
});
