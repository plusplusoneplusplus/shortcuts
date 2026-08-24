/**
 * SqliteProcessStore — compaction_summary persistence (AC-04)
 *
 * The `/compact` route records the provider-generated summary on the
 * display-only compaction result turn so the chat can reveal it behind a
 * disclosure. These tests verify `compactionSummary` round-trips through
 * addProcess/getProcess and appendConversationTurn, stays undefined when the
 * provider produced no summary (the Codex path), survives a reopen of the
 * database, is stored untruncated, and is preserved on fork.
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
let dbPath: string;
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

const SUMMARY = '## Summary\n\nThe user asked about the process store, then we added a column.';

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-compaction-summary-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    store = new SqliteProcessStore({ dbPath });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — compactionSummary persistence', () => {
    it('round-trips compactionSummary on a display-only turn through addProcess/getProcess', async () => {
        await store.addProcess(makeProcess('p-1', {
            conversationTurns: [
                makeTurn(0, { role: 'user' }),
                makeTurn(1, {
                    role: 'assistant',
                    content: 'Context compacted — removed 7 messages, freed ~4200 tokens',
                    displayOnly: true,
                    compactionSummary: SUMMARY,
                }),
            ],
        }));

        const read = await store.getProcess('p-1');
        expect(read?.conversationTurns?.[1].compactionSummary).toBe(SUMMARY);
        expect(read?.conversationTurns?.[1].displayOnly).toBe(true);
        expect(read?.conversationTurns?.[0].compactionSummary).toBeUndefined();
    });

    it('persists compactionSummary via appendConversationTurn', async () => {
        await store.addProcess(makeProcess('p-2', { conversationTurns: [] }));

        await store.appendConversationTurn('p-2', (turnIndex) => ({
            role: 'assistant' as const,
            content: 'Context compacted — removed 1 message, freed ~10 tokens',
            timestamp: new Date('2025-01-01T00:00:00Z'),
            turnIndex,
            timeline: [],
            displayOnly: true,
            compactionSummary: SUMMARY,
        }));

        const read = await store.getProcess('p-2');
        expect(read?.conversationTurns?.[0].compactionSummary).toBe(SUMMARY);
    });

    it('leaves compactionSummary undefined when the provider produced no summary', async () => {
        await store.addProcess(makeProcess('p-3', {
            conversationTurns: [makeTurn(0, { role: 'assistant', displayOnly: true })],
        }));

        const read = await store.getProcess('p-3');
        expect(read?.conversationTurns?.[0].compactionSummary).toBeUndefined();
    });

    it('stores the full summary with no truncation', async () => {
        const long = 'A very wordy recap sentence. '.repeat(2000);
        await store.addProcess(makeProcess('p-4', {
            conversationTurns: [makeTurn(1, { role: 'assistant', displayOnly: true, compactionSummary: long })],
        }));

        const read = await store.getProcess('p-4');
        expect(read?.conversationTurns?.[0].compactionSummary).toBe(long);
        expect(read?.conversationTurns?.[0].compactionSummary?.length).toBe(long.length);
    });

    it('survives closing and reopening the database (visible from any tab after reload)', async () => {
        await store.addProcess(makeProcess('p-5', {
            conversationTurns: [makeTurn(1, { role: 'assistant', displayOnly: true, compactionSummary: SUMMARY })],
        }));
        store.close();

        store = new SqliteProcessStore({ dbPath });
        const read = await store.getProcess('p-5');
        expect(read?.conversationTurns?.[0].compactionSummary).toBe(SUMMARY);
    });

    it('preserves compactionSummary on fork', async () => {
        await store.addProcess(makeProcess('source-fork', {
            conversationTurns: [
                makeTurn(0, { role: 'user' }),
                makeTurn(1, { role: 'assistant', displayOnly: true, compactionSummary: SUMMARY }),
            ],
        }));

        const forked = await store.forkProcess!('source-fork', 'fork-1', 'sdk-session-forked');

        expect(forked.conversationTurns?.[1].compactionSummary).toBe(SUMMARY);
        expect(forked.conversationTurns?.[1].displayOnly).toBe(true);
    });
});
