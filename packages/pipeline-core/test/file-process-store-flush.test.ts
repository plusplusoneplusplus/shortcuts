/**
 * FileProcessStore Flush Handler Tests — Write Queue and Concurrent Writes
 *
 * Tests the write-queue serialization for concurrent addProcess calls,
 * concurrent writes to different workspaces, and the flush handler mechanism.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { FileProcessStore, AIProcess, AIProcessStatus } from '../src/index';

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'completed' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

describe('FileProcessStore flush handlers and write-queue', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-flush-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // 25. Write queue serializes concurrent addProcess to same workspace
    it('should serialize concurrent addProcess calls to the same workspace', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const n = 10;

        await Promise.all(
            Array.from({ length: n }, (_, i) =>
                store.addProcess(makeProcess(`p${i}`, { metadata: { type: 'ai', workspaceId: 'ws-a' } }))
            )
        );

        // All files must exist
        for (let i = 0; i < n; i++) {
            const filePath = path.join(tmpDir, 'processes', 'ws-a', `p${i}.json`);
            const exists = await fs.access(filePath).then(() => true, () => false);
            expect(exists).toBe(true);
        }

        // index.json must have exactly n entries
        const indexRaw = await fs.readFile(
            path.join(tmpDir, 'processes', 'ws-a', 'index.json'),
            'utf-8'
        );
        const index: unknown[] = JSON.parse(indexRaw);
        expect(index).toHaveLength(n);
    });

    // 26. Concurrent writes to different workspaces do not deadlock
    it('should handle concurrent addProcess calls to different workspaces', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        await Promise.all([
            ...Array.from({ length: 5 }, (_, i) =>
                store.addProcess(makeProcess(`a${i}`, { metadata: { type: 'ai', workspaceId: 'ws-a' } }))
            ),
            ...Array.from({ length: 5 }, (_, i) =>
                store.addProcess(makeProcess(`b${i}`, { metadata: { type: 'ai', workspaceId: 'ws-b' } }))
            ),
        ]);

        const all = await store.getAllProcesses();
        expect(all).toHaveLength(10);
    });

    // 27. registerFlushHandler called on flush trigger
    it('should call registered flush handler on requestFlush', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const handler = vi.fn(async () => {});

        store.registerFlushHandler('proc-1', handler);
        await store.requestFlush('proc-1');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    // 28. Unregistered handler not called after unregister
    it('should not call handler after unregisterFlushHandler', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const handler = vi.fn(async () => {});

        store.registerFlushHandler('proc-2', handler);
        store.unregisterFlushHandler('proc-2');
        await store.requestFlush('proc-2');

        expect(handler).not.toHaveBeenCalled();
    });
});
