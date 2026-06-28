/**
 * SqliteProcessStore Tests — getConversationTurns and listRecentProcesses
 *
 * Validates the new lightweight conversation turn accessor and
 * recent process listing methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    SqliteProcessStore,
    AIProcess,
    AIProcessStatus,
    ConversationTurn,
} from '../src/index';
import type { PendingMessage } from '../src/index';

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

function makeTurn(index: number, overrides?: Partial<ConversationTurn>): ConversationTurn {
    return {
        role: 'user',
        content: `message-${index}`,
        timestamp: new Date(),
        turnIndex: index,
        timeline: [],
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-new-methods-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// getConversationTurns
// ============================================================================

describe('SqliteProcessStore.getConversationTurns', () => {
    it('returns empty array for nonexistent process', async () => {
        const turns = await store.getConversationTurns('nonexistent');
        expect(turns).toEqual([]);
    });

    it('returns turns in order for a process', async () => {
        const p = makeProcess('p1', {
            conversationTurns: [
                makeTurn(0, { content: 'Hello' }),
                makeTurn(1, { role: 'assistant', content: 'Hi there!' }),
                makeTurn(2, { content: 'How are you?' }),
            ],
        });
        await store.addProcess(p);

        const turns = await store.getConversationTurns('p1');

        expect(turns).toHaveLength(3);
        expect(turns[0].content).toBe('Hello');
        expect(turns[0].turnIndex).toBe(0);
        expect(turns[1].content).toBe('Hi there!');
        expect(turns[1].role).toBe('assistant');
        expect(turns[2].content).toBe('How are you?');
        expect(turns[2].turnIndex).toBe(2);
    });

    it('returns turns added via appendConversationTurn', async () => {
        const p = makeProcess('p1');
        await store.addProcess(p);

        await store.appendConversationTurn('p1', (idx) => makeTurn(idx, { content: 'First' }));
        await store.appendConversationTurn('p1', (idx) => makeTurn(idx, { role: 'assistant', content: 'Second' }));

        const turns = await store.getConversationTurns('p1');
        expect(turns).toHaveLength(2);
        expect(turns[0].content).toBe('First');
        expect(turns[1].content).toBe('Second');
    });

    it('does not include turns from other processes', async () => {
        const p1 = makeProcess('p1', {
            conversationTurns: [makeTurn(0, { content: 'P1 turn' })],
        });
        const p2 = makeProcess('p2', {
            conversationTurns: [makeTurn(0, { content: 'P2 turn' })],
        });
        await store.addProcess(p1);
        await store.addProcess(p2);

        const turns = await store.getConversationTurns('p1');
        expect(turns).toHaveLength(1);
        expect(turns[0].content).toBe('P1 turn');
    });
});

// ============================================================================
// listRecentProcesses
// ============================================================================

describe('SqliteProcessStore.listRecentProcesses', () => {
    it('returns empty array when no processes exist', async () => {
        const entries = await store.listRecentProcesses({});
        expect(entries).toEqual([]);
    });

    it('returns processes ordered by recency (descending)', async () => {
        const now = Date.now();
        for (let i = 0; i < 5; i++) {
            await store.addProcess(
                makeProcess(`p${i}`, {
                    startTime: new Date(now + i * 1000),
                    metadata: { type: 'ai', workspaceId: 'ws-1' },
                }),
            );
        }

        const entries = await store.listRecentProcesses({ limit: 5 });

        expect(entries).toHaveLength(5);
        // Most recent first (p4, p3, p2, p1, p0)
        expect(entries[0].id).toBe('p4');
        expect(entries[4].id).toBe('p0');
    });

    it('respects limit parameter', async () => {
        for (let i = 0; i < 10; i++) {
            await store.addProcess(
                makeProcess(`p${i}`, {
                    startTime: new Date(Date.now() + i * 1000),
                    metadata: { type: 'ai', workspaceId: 'ws-1' },
                }),
            );
        }

        const entries = await store.listRecentProcesses({ limit: 3 });
        expect(entries).toHaveLength(3);
    });

    it('clamps limit to maximum of 100', async () => {
        for (let i = 0; i < 125; i++) {
            await store.addProcess(
                makeProcess(`p${i}`, {
                    startTime: new Date(Date.now() + i * 1000),
                    metadata: { type: 'ai', workspaceId: 'ws-1' },
                }),
            );
        }

        const entries = await store.listRecentProcesses({ limit: 100 });
        expect(entries).toHaveLength(100);
    });

    it('filters by workspaceId', async () => {
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-1' } }));
        await store.addProcess(makeProcess('p2', { metadata: { type: 'ai', workspaceId: 'ws-2' } }));
        await store.addProcess(makeProcess('p3', { metadata: { type: 'ai', workspaceId: 'ws-1' } }));

        const entries = await store.listRecentProcesses({ workspaceId: 'ws-1' });

        expect(entries).toHaveLength(2);
        expect(entries.every(e => e.workspaceId === 'ws-1')).toBe(true);
    });

    it('excludes process by excludeProcessId', async () => {
        const now = Date.now();
        await store.addProcess(makeProcess('p1', { startTime: new Date(now) }));
        await store.addProcess(makeProcess('p2', { startTime: new Date(now + 1000) }));
        await store.addProcess(makeProcess('p3', { startTime: new Date(now + 2000) }));

        const entries = await store.listRecentProcesses({ excludeProcessId: 'p2' });

        expect(entries).toHaveLength(2);
        expect(entries.every(e => e.id !== 'p2')).toBe(true);
    });

    it('filters by since using activity time', async () => {
        await store.addProcess(makeProcess('old', {
            startTime: new Date('2026-04-28T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-28T12:00:00.000Z'),
        }));
        await store.addProcess(makeProcess('active', {
            startTime: new Date('2026-04-28T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T12:00:00.000Z'),
        }));

        const entries = await store.listRecentProcesses({
            since: new Date('2026-04-29T00:00:00.000Z'),
        });

        expect(entries.map(e => e.id)).toEqual(['active']);
        expect(entries[0].activityAt).toBe('2026-04-29T12:00:00.000Z');
    });

    it('filters by until using an exclusive activity upper bound', async () => {
        await store.addProcess(makeProcess('included', {
            startTime: new Date('2026-04-29T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T23:59:59.000Z'),
        }));
        await store.addProcess(makeProcess('excluded', {
            startTime: new Date('2026-04-29T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-30T00:00:00.000Z'),
        }));

        const entries = await store.listRecentProcesses({
            until: new Date('2026-04-30T00:00:00.000Z'),
        });

        expect(entries.map(e => e.id)).toEqual(['included']);
    });

    it('filters by bounded activity time and supports offset', async () => {
        await store.addProcess(makeProcess('before', {
            startTime: new Date('2026-04-28T23:00:00.000Z'),
            lastEventAt: new Date('2026-04-28T23:00:00.000Z'),
        }));
        await store.addProcess(makeProcess('first', {
            startTime: new Date('2026-04-29T01:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T01:00:00.000Z'),
        }));
        await store.addProcess(makeProcess('second', {
            startTime: new Date('2026-04-29T02:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T02:00:00.000Z'),
        }));
        await store.addProcess(makeProcess('after', {
            startTime: new Date('2026-04-30T00:00:00.000Z'),
            lastEventAt: new Date('2026-04-30T00:00:00.000Z'),
        }));

        const entries = await store.listRecentProcesses({
            since: new Date('2026-04-29T00:00:00.000Z'),
            until: new Date('2026-04-30T00:00:00.000Z'),
            limit: 1,
            offset: 1,
        });

        expect(entries.map(e => e.id)).toEqual(['first']);
    });

    it('does not include archived processes', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.updateProcess('p2', { archived: true } as any);

        const entries = await store.listRecentProcesses({});

        expect(entries).toHaveLength(1);
        expect(entries[0].id).toBe('p1');
    });

    it('returns correct summary fields', async () => {
        const now = new Date();
        const endTime = new Date(now.getTime() + 5000);
        await store.addProcess(
            makeProcess('p1', {
                status: 'completed',
                startTime: now,
                endTime,
                promptPreview: 'Test prompt preview',
                metadata: { type: 'ai', workspaceId: 'ws-1' },
            }),
        );
        await store.updateProcess('p1', { title: 'My Session' });

        const entries = await store.listRecentProcesses({});

        expect(entries).toHaveLength(1);
        const e = entries[0];
        expect(e.id).toBe('p1');
        expect(e.title).toBe('My Session');
        expect(e.status).toBe('completed');
        expect(e.promptPreview).toBe('Test prompt preview');
        expect(e.workspaceId).toBe('ws-1');
        expect(e.startTime).toBeDefined();
    });

    it('defaults limit to 10', async () => {
        for (let i = 0; i < 15; i++) {
            await store.addProcess(
                makeProcess(`p${i}`, {
                    startTime: new Date(Date.now() + i * 1000),
                }),
            );
        }

        const entries = await store.listRecentProcesses({});
        expect(entries).toHaveLength(10);
    });
});

// ============================================================================
// appendPendingMessage
// ============================================================================

describe('SqliteProcessStore.appendPendingMessage', () => {
    function makePending(id: string, content: string): PendingMessage {
        return { id, content, createdAt: new Date().toISOString() };
    }

    it('appends a pending message and returns the full array', async () => {
        await store.addProcess(makeProcess('pm1'));

        const result = await store.appendPendingMessage('pm1', makePending('m1', 'first'));

        expect(result).toHaveLength(1);
        expect(result![0].content).toBe('first');

        const updated = await store.getProcess('pm1');
        expect(updated!.pendingMessages).toHaveLength(1);
        expect(updated!.pendingMessages![0].id).toBe('m1');
    });

    it('accumulates pending messages in order', async () => {
        await store.addProcess(makeProcess('pm2'));

        await store.appendPendingMessage('pm2', makePending('m1', 'first'));
        await store.appendPendingMessage('pm2', makePending('m2', 'second'));
        await store.appendPendingMessage('pm2', makePending('m3', 'third'));

        const updated = await store.getProcess('pm2');
        expect(updated!.pendingMessages!.map(m => m.content)).toEqual(['first', 'second', 'third']);
    });

    it('returns undefined for a non-existent process', async () => {
        const result = await store.appendPendingMessage('no-such', makePending('m1', 'x'));
        expect(result).toBeUndefined();
    });
});
