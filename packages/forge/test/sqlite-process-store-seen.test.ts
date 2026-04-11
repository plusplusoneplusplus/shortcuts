/**
 * SqliteProcessStore — Seen State Tests
 *
 * Validates getSeenMap, markSeen, markManySeen, markUnseen, getUnseenCount
 * methods for read/unread tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { SqliteProcessStore, AIProcess, AIProcessStatus } from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        metadata: { type: 'ai', workspaceId: 'ws-test' },
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-seen-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Seen state', () => {
    it('getSeenMap returns empty map for workspace with no seen processes', () => {
        const map = store.getSeenMap('ws-test');
        expect(map).toEqual({});
    });

    it('markSeen + getSeenMap round-trip', async () => {
        const endTime = '2024-06-01T12:00:00.000Z';
        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(endTime),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        store.markSeen('p1', endTime);

        const map = store.getSeenMap('ws1');
        expect(map).toEqual({ p1: endTime });
    });

    it('markManySeen batch update', async () => {
        const t1 = '2024-06-01T12:00:00.000Z';
        const t2 = '2024-06-01T13:00:00.000Z';
        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(t1),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));
        await store.addProcess(makeProcess('p2', {
            status: 'completed',
            endTime: new Date(t2),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        store.markManySeen([
            { processId: 'p1', seenAt: t1 },
            { processId: 'p2', seenAt: t2 },
        ]);

        const map = store.getSeenMap('ws1');
        expect(map).toEqual({ p1: t1, p2: t2 });
    });

    it('markUnseen sets column to NULL', async () => {
        const endTime = '2024-06-01T12:00:00.000Z';
        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(endTime),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        store.markSeen('p1', endTime);
        expect(store.getSeenMap('ws1')).toEqual({ p1: endTime });

        store.markUnseen('p1');
        expect(store.getSeenMap('ws1')).toEqual({});
    });

    it('getUnseenCount returns correct count', async () => {
        const t1 = '2024-06-01T12:00:00.000Z';
        const t2 = '2024-06-01T13:00:00.000Z';
        const t3 = '2024-06-01T14:00:00.000Z';

        // Completed + seen
        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(t1),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));
        store.markSeen('p1', t1);

        // Completed + unseen (no seen_at)
        await store.addProcess(makeProcess('p2', {
            status: 'completed',
            endTime: new Date(t2),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        // Failed + unseen
        await store.addProcess(makeProcess('p3', {
            status: 'failed',
            endTime: new Date(t3),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        // Running (no endTime) — should not count
        await store.addProcess(makeProcess('p4', {
            status: 'running',
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        expect(store.getUnseenCount('ws1')).toBe(2); // p2 and p3
    });

    it('getUnseenCount detects re-runs (seen_at != end_time)', async () => {
        const originalEnd = '2024-06-01T12:00:00.000Z';
        const newEnd = '2024-06-01T15:00:00.000Z';

        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(originalEnd),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));

        // Mark as seen at original end time
        store.markSeen('p1', originalEnd);
        expect(store.getUnseenCount('ws1')).toBe(0);

        // Simulate re-run: update end_time
        await store.updateProcess('p1', { endTime: new Date(newEnd) });
        expect(store.getUnseenCount('ws1')).toBe(1);
    });

    it('getSeenMap is workspace-scoped', async () => {
        const t1 = '2024-06-01T12:00:00.000Z';
        const t2 = '2024-06-01T13:00:00.000Z';

        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(t1),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));
        await store.addProcess(makeProcess('p2', {
            status: 'completed',
            endTime: new Date(t2),
            metadata: { type: 'ai', workspaceId: 'ws2' },
        }));

        store.markSeen('p1', t1);
        store.markSeen('p2', t2);

        expect(store.getSeenMap('ws1')).toEqual({ p1: t1 });
        expect(store.getSeenMap('ws2')).toEqual({ p2: t2 });
    });

    it('markManySeen with empty array is a no-op', () => {
        expect(() => store.markManySeen([])).not.toThrow();
    });

    it('markSeen on nonexistent process is a no-op', () => {
        // Should not throw — UPDATE with no matching row is fine
        expect(() => store.markSeen('nonexistent', '2024-01-01T00:00:00Z')).not.toThrow();
    });

    it('deleting a process removes its seen state', async () => {
        const endTime = '2024-06-01T12:00:00.000Z';
        await store.addProcess(makeProcess('p1', {
            status: 'completed',
            endTime: new Date(endTime),
            metadata: { type: 'ai', workspaceId: 'ws1' },
        }));
        store.markSeen('p1', endTime);
        expect(store.getSeenMap('ws1')).toEqual({ p1: endTime });

        await store.removeProcess('p1');
        expect(store.getSeenMap('ws1')).toEqual({});
    });
});
