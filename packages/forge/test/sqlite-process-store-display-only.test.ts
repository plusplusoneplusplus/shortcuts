/**
 * SqliteProcessStore — display_only persistence (AC-03)
 *
 * The `/compact` route appends a display-only assistant turn ("Context
 * compacted — …") to the transcript. These tests verify the `displayOnly` flag
 * round-trips through the store via addProcess/getProcess and
 * appendConversationTurn, defaults to falsy for normal turns, and is preserved
 * on fork (the copied turn must stay excluded from model prompt history).
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-display-only-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — displayOnly persistence', () => {
    it('round-trips displayOnly on an assistant turn through addProcess/getProcess', async () => {
        const proc = makeProcess('p-1', {
            conversationTurns: [
                makeTurn(0, { role: 'user' }),
                makeTurn(1, { role: 'assistant', content: 'Context compacted — removed 7 messages, freed ~4200 tokens', displayOnly: true }),
            ],
        });
        await store.addProcess(proc);

        const read = await store.getProcess('p-1');
        expect(read?.conversationTurns?.[1].displayOnly).toBe(true);
        // A normal turn carries no display-only flag.
        expect(read?.conversationTurns?.[0].displayOnly).toBeFalsy();
    });

    it('persists displayOnly via appendConversationTurn', async () => {
        await store.addProcess(makeProcess('p-2', { conversationTurns: [] }));

        await store.appendConversationTurn('p-2', (turnIndex) => ({
            role: 'assistant' as const,
            content: 'Context compacted — removed 1 message, freed ~10 tokens',
            timestamp: new Date('2025-01-01T00:00:00Z'),
            turnIndex,
            timeline: [],
            displayOnly: true,
        }));

        const read = await store.getProcess('p-2');
        expect(read?.conversationTurns).toHaveLength(1);
        expect(read?.conversationTurns?.[0].displayOnly).toBe(true);
        expect(read?.conversationTurns?.[0].content).toContain('Context compacted');
    });

    it('leaves displayOnly falsy when not provided (normal turns)', async () => {
        const proc = makeProcess('p-3', {
            conversationTurns: [makeTurn(0, { role: 'assistant' })],
        });
        await store.addProcess(proc);

        const read = await store.getProcess('p-3');
        expect(read?.conversationTurns?.[0].displayOnly).toBeFalsy();
    });

    it('preserves displayOnly on fork so the copied turn stays out of prompt history', async () => {
        const source = makeProcess('source-fork', {
            conversationTurns: [
                makeTurn(0, { role: 'user' }),
                makeTurn(1, { role: 'assistant', displayOnly: true }),
            ],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-fork', 'fork-1', 'sdk-session-forked');

        expect(forked.conversationTurns).toHaveLength(2);
        expect(forked.conversationTurns?.[1].displayOnly).toBe(true);
    });
});
