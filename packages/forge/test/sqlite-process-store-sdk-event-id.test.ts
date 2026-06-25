/**
 * SqliteProcessStore — sdk_event_id persistence (AC-01)
 *
 * The copilot-sdk `user.message` event id is the durable anchor used to rewind
 * (truncate) chat history. These tests verify it round-trips through the store,
 * is absent when unset, and is intentionally NOT copied on fork (a forked
 * conversation gets a new SDK session, so the old event ids are meaningless and
 * the copied turns must stay non-rewindable).
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

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'completed' as AIProcessStatus,
        startTime: new Date('2025-01-01T00:00:00Z'),
        endTime: new Date('2025-01-01T00:01:00Z'),
        sdkSessionId: 'sdk-session-original',
        title: 'Original Chat',
        metadata: { type: 'chat', workspaceId: 'ws-test' },
        workingDirectory: '/tmp/test',
        ...overrides,
    };
}

function makeTurn(index: number, overrides?: Partial<ConversationTurn>): ConversationTurn {
    return {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message-${index}`,
        timestamp: new Date(`2025-01-01T00:00:${String(index).padStart(2, '0')}Z`),
        turnIndex: index,
        timeline: [],
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-sdk-event-id-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — sdkEventId persistence', () => {
    it('round-trips sdkEventId on a user turn through addProcess/getProcess', async () => {
        const proc = makeProcess('p-1', {
            conversationTurns: [
                makeTurn(0, { role: 'user', sdkEventId: 'evt_user_0' }),
                makeTurn(1, { role: 'assistant' }),
            ],
        });
        await store.addProcess(proc);

        const read = await store.getProcess('p-1');
        expect(read?.conversationTurns?.[0].sdkEventId).toBe('evt_user_0');
        // Assistant turn never carries an event id.
        expect(read?.conversationTurns?.[1].sdkEventId).toBeUndefined();
    });

    it('persists sdkEventId via appendConversationTurn', async () => {
        await store.addProcess(makeProcess('p-2', { conversationTurns: [] }));

        await store.appendConversationTurn('p-2', (turnIndex) => ({
            role: 'user' as const,
            content: 'hi',
            timestamp: new Date('2025-01-01T00:00:00Z'),
            turnIndex,
            timeline: [],
            sdkEventId: 'evt_appended',
        }));

        const read = await store.getProcess('p-2');
        expect(read?.conversationTurns).toHaveLength(1);
        expect(read?.conversationTurns?.[0].sdkEventId).toBe('evt_appended');
    });

    it('leaves sdkEventId undefined when not provided (legacy/non-copilot turns)', async () => {
        const proc = makeProcess('p-3', {
            conversationTurns: [makeTurn(0, { role: 'user' })],
        });
        await store.addProcess(proc);

        const read = await store.getProcess('p-3');
        expect(read?.conversationTurns?.[0]).not.toHaveProperty('sdkEventId');
    });

    it('does NOT copy sdkEventId on fork — copied turns stay non-rewindable', async () => {
        const source = makeProcess('source-fork', {
            conversationTurns: [
                makeTurn(0, { role: 'user', sdkEventId: 'evt_source_0' }),
                makeTurn(1, { role: 'assistant' }),
            ],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-fork', 'fork-1', 'sdk-session-forked');

        expect(forked.conversationTurns).toHaveLength(2);
        // The fork has a new SDK session, so the source event id must not carry over.
        expect(forked.conversationTurns?.[0].sdkEventId).toBeUndefined();
    });
});
