/**
 * Process store — truncateConversationTurns (AC-03)
 *
 * The rewind feature destructively truncates a copilot conversation back to a
 * chosen user turn: that turn and everything after it are hard-deleted from the
 * CoC store (mirroring the SDK history events a rewind drops), the removed turns
 * are returned so the composer can be repopulated, and conversation-derived
 * process metadata (lastEventAt / lastMessagePreview) is recomputed from what
 * survives. These tests pin that contract for the SQLite and File stores.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    SqliteProcessStore,
    FileProcessStore,
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

/** A 4-turn conversation: user(0) assistant(1) user(2) assistant(3). */
function fourTurns(): ConversationTurn[] {
    return [
        makeTurn(0, { role: 'user', content: 'first question', sdkEventId: 'evt_0' }),
        makeTurn(1, { role: 'assistant', content: 'first answer' }),
        makeTurn(2, { role: 'user', content: 'second question', sdkEventId: 'evt_2', images: ['data:image/png;base64,AAAA'] }),
        makeTurn(3, { role: 'assistant', content: 'second answer' }),
    ];
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-truncate-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — truncateConversationTurns', () => {
    it('hard-deletes the target user turn and everything after it, keeping earlier turns', async () => {
        await store.addProcess(makeProcess('p-trunc-1', { conversationTurns: fourTurns() }));

        const result = await store.truncateConversationTurns('p-trunc-1', 2);

        expect(result).toBeDefined();
        expect(result!.removed.map(t => t.turnIndex)).toEqual([2, 3]);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1]);

        // The deletion is durable: a re-read shows only the survivors.
        const read = await store.getProcess('p-trunc-1');
        expect(read?.conversationTurns?.map(t => t.turnIndex)).toEqual([0, 1]);
        expect(read?.conversationTurns?.map(t => t.content)).toEqual(['first question', 'first answer']);
    });

    it('returns the removed target user turn with its content AND images for composer restore', async () => {
        await store.addProcess(makeProcess('p-trunc-2', { conversationTurns: fourTurns() }));

        const result = await store.truncateConversationTurns('p-trunc-2', 2);

        const removedTarget = result!.removed.find(t => t.turnIndex === 2);
        expect(removedTarget?.role).toBe('user');
        expect(removedTarget?.content).toBe('second question');
        expect(removedTarget?.images).toEqual(['data:image/png;base64,AAAA']);
        expect(removedTarget?.sdkEventId).toBe('evt_2');
    });

    it('recomputes lastEventAt and lastMessagePreview from the surviving turns', async () => {
        await store.addProcess(makeProcess('p-trunc-3', { conversationTurns: fourTurns() }));

        await store.truncateConversationTurns('p-trunc-3', 2);

        const read = await store.getProcess('p-trunc-3');
        // The last surviving user turn drives the sidebar preview.
        expect(read?.lastMessagePreview).toBe('first question');
        // lastEventAt reflects the last surviving turn (assistant at index 1).
        expect(read?.lastEventAt?.toISOString()).toBe('2025-01-01T00:00:01.000Z');
    });

    it('truncating at index 0 empties the conversation and clears the preview', async () => {
        await store.addProcess(makeProcess('p-trunc-4', { conversationTurns: fourTurns() }));

        const result = await store.truncateConversationTurns('p-trunc-4', 0);

        expect(result!.removed.map(t => t.turnIndex)).toEqual([0, 1, 2, 3]);
        expect(result!.allTurns).toEqual([]);

        const read = await store.getProcess('p-trunc-4');
        expect(read?.conversationTurns ?? []).toEqual([]);
        expect(read?.lastMessagePreview).toBeUndefined();
        expect(read?.lastEventAt).toBeUndefined();
    });

    it('is a successful no-op when fromTurnIndex is past the last turn', async () => {
        await store.addProcess(makeProcess('p-trunc-5', { conversationTurns: fourTurns() }));

        const result = await store.truncateConversationTurns('p-trunc-5', 99);

        expect(result!.removed).toEqual([]);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1, 2, 3]);

        const read = await store.getProcess('p-trunc-5');
        expect(read?.conversationTurns).toHaveLength(4);
    });

    it('returns undefined for an unknown process', async () => {
        const result = await store.truncateConversationTurns('does-not-exist', 0);
        expect(result).toBeUndefined();
    });

    it('does not renumber survivors — a follow-up turn appends after the kept turns', async () => {
        await store.addProcess(makeProcess('p-trunc-6', { conversationTurns: fourTurns() }));

        await store.truncateConversationTurns('p-trunc-6', 2);

        // The resend after a rewind must land at index 2 (max survivor index + 1).
        const appended = await store.appendConversationTurn('p-trunc-6', (turnIndex) => ({
            role: 'user' as const,
            content: 'edited resend',
            timestamp: new Date('2025-01-01T00:05:00Z'),
            turnIndex,
            timeline: [],
        }));

        expect(appended?.turn.turnIndex).toBe(2);
        const read = await store.getProcess('p-trunc-6');
        expect(read?.conversationTurns?.map(t => t.turnIndex)).toEqual([0, 1, 2]);
        expect(read?.conversationTurns?.[2].content).toBe('edited resend');
    });
});

describe('FileProcessStore — truncateConversationTurns', () => {
    let fileTmpDir: string;
    let fileStore: FileProcessStore;

    beforeEach(async () => {
        fileTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-store-truncate-test-'));
        fileStore = new FileProcessStore({ dataDir: fileTmpDir });
    });

    afterEach(async () => {
        await fs.rm(fileTmpDir, { recursive: true, force: true });
    });

    it('removes the target turn and everything after it and recomputes the preview', async () => {
        await fileStore.addProcess(makeProcess('pf-1', {
            metadata: { type: 'chat', workspaceId: 'ws-a' },
            conversationTurns: fourTurns(),
        }));

        const result = await fileStore.truncateConversationTurns('pf-1', 2);

        expect(result!.removed.map(t => t.turnIndex)).toEqual([2, 3]);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1]);

        const read = await fileStore.getProcess('pf-1', 'ws-a');
        expect(read?.conversationTurns?.map(t => t.turnIndex)).toEqual([0, 1]);
        expect(read?.lastMessagePreview).toBe('first question');
    });

    it('returns undefined for an unknown process', async () => {
        const result = await fileStore.truncateConversationTurns('missing', 0);
        expect(result).toBeUndefined();
    });
});
