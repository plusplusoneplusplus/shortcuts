/**
 * SqliteProcessStore.forkProcess() Tests
 *
 * Validates forking a process: new process creation, turn copying,
 * metadata linkage, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-fork-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore.forkProcess', () => {
    it('creates a new process with copied turns and metadata', async () => {
        const source = makeProcess('source-1', {
            conversationTurns: [makeTurn(0), makeTurn(1), makeTurn(2), makeTurn(3)],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-1', 'fork-1', 'sdk-session-forked');

        expect(forked.id).toBe('fork-1');
        expect(forked.sdkSessionId).toBe('sdk-session-forked');
        expect(forked.status).toBe('completed');
        expect(forked.title).toBe('[Fork] Original Chat');
        expect(forked.promptPreview).toBe('[Fork] test prompt');
        expect(forked.metadata?.forkSourceId).toBe('source-1');
        expect(forked.metadata?.workspaceId).toBe('ws-test');
        expect(forked.workingDirectory).toBe('/tmp/test');
        expect(forked.conversationTurns).toHaveLength(4);
    });

    it('marks all copied turns as historical and non-streaming', async () => {
        const source = makeProcess('source-2', {
            conversationTurns: [
                makeTurn(0, { streaming: false }),
                makeTurn(1, { streaming: true }),
            ],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-2', 'fork-2', 'sdk-forked-2');

        for (const turn of forked.conversationTurns!) {
            expect(turn.historical).toBe(true);
            expect(turn.streaming).toBeFalsy();
        }
    });

    it('preserves turn content and role', async () => {
        const source = makeProcess('source-3', {
            conversationTurns: [
                makeTurn(0, { role: 'user', content: 'Hello' }),
                makeTurn(1, { role: 'assistant', content: 'Hi there!' }),
            ],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-3', 'fork-3', 'sdk-forked-3');

        expect(forked.conversationTurns![0].role).toBe('user');
        expect(forked.conversationTurns![0].content).toBe('Hello');
        expect(forked.conversationTurns![1].role).toBe('assistant');
        expect(forked.conversationTurns![1].content).toBe('Hi there!');
    });

    it('respects upToTurnIndex parameter', async () => {
        const source = makeProcess('source-4', {
            conversationTurns: [makeTurn(0), makeTurn(1), makeTurn(2), makeTurn(3)],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-4', 'fork-4', 'sdk-forked-4', 1);

        expect(forked.conversationTurns).toHaveLength(2);
        expect(forked.conversationTurns![0].turnIndex).toBe(0);
        expect(forked.conversationTurns![1].turnIndex).toBe(1);
    });

    it('excludes soft-deleted turns', async () => {
        const source = makeProcess('source-5', {
            conversationTurns: [makeTurn(0), makeTurn(1), makeTurn(2)],
        });
        await store.addProcess(source);

        // Soft-delete turn 1 via direct DB update
        const db = store.getDatabase();
        db.prepare('UPDATE conversation_turns SET deleted_at = ? WHERE process_id = ? AND turn_index = ?')
            .run(new Date().toISOString(), 'source-5', 1);

        const forked = await store.forkProcess!('source-5', 'fork-5', 'sdk-forked-5');

        expect(forked.conversationTurns).toHaveLength(2);
        const indices = forked.conversationTurns!.map(t => t.turnIndex);
        expect(indices).toEqual([0, 2]);
    });

    it('throws when source process does not exist', async () => {
        await expect(
            store.forkProcess!('nonexistent', 'fork-x', 'sdk-x')
        ).rejects.toThrow('Source process not found');
    });

    it('emits process-added change event', async () => {
        const source = makeProcess('source-6', {
            conversationTurns: [makeTurn(0)],
        });
        await store.addProcess(source);

        const changeSpy = vi.fn();
        store.onProcessChange = changeSpy;

        await store.forkProcess!('source-6', 'fork-6', 'sdk-forked-6');

        expect(changeSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'process-added',
                process: expect.objectContaining({ id: 'fork-6' }),
            })
        );
    });

    it('forked process is independent (no parentProcessId)', async () => {
        const source = makeProcess('source-7', {
            conversationTurns: [makeTurn(0)],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-7', 'fork-7', 'sdk-forked-7');

        expect(forked.parentProcessId).toBeUndefined();
    });

    it('works with zero turns', async () => {
        const source = makeProcess('source-8', {
            conversationTurns: [],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-8', 'fork-8', 'sdk-forked-8');

        expect(forked.conversationTurns).toHaveLength(0);
    });

    it('uses source promptPreview when title is missing', async () => {
        const source = makeProcess('source-9', {
            title: undefined,
            promptPreview: 'my prompt',
            conversationTurns: [],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-9', 'fork-9', 'sdk-forked-9');

        expect(forked.title).toBe('[Fork] my prompt');
    });
});
