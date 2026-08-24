/**
 * SqliteProcessStore — repo_group_context persistence
 *
 * The repo-group member listing injected into a user turn's outgoing prompt is
 * recorded on that turn so the chat can disclose it. These tests verify it
 * round-trips through the store, stays absent when unset, survives a fork (the
 * copied turn still shows what the model was told), and that the narrow
 * `updateTurnRepoGroupContext` write only touches user turns.
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

const BLOCK = '<repo_group_context>\nRepo group "My Team" members:\n- Repo A: /repos/a\n</repo_group_context>';

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: 'test prompt',
        status: 'completed' as AIProcessStatus,
        startTime: new Date('2025-01-01T00:00:00Z'),
        metadata: { type: 'chat', workspaceId: 'ws-test' },
        workingDirectory: path.join('/tmp', 'test'),
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-repo-group-ctx-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — repoGroupContext persistence', () => {
    it('round-trips the injected block on a user turn', async () => {
        await store.addProcess(makeProcess('p-1', {
            conversationTurns: [
                makeTurn(0, { role: 'user', repoGroupContext: BLOCK }),
                makeTurn(1, { role: 'assistant' }),
            ],
        }));

        const read = await store.getProcess('p-1');
        expect(read?.conversationTurns?.[0].repoGroupContext).toBe(BLOCK);
        expect(read?.conversationTurns?.[1].repoGroupContext).toBeUndefined();
    });

    it('leaves repoGroupContext absent for non-group chats and legacy turns', async () => {
        await store.addProcess(makeProcess('p-2', {
            conversationTurns: [makeTurn(0, { role: 'user' })],
        }));

        const read = await store.getProcess('p-2');
        expect(read?.conversationTurns?.[0]).not.toHaveProperty('repoGroupContext');
    });

    it('preserves the block on fork', async () => {
        await store.addProcess(makeProcess('source-fork', {
            conversationTurns: [
                makeTurn(0, { role: 'user', repoGroupContext: BLOCK }),
                makeTurn(1, { role: 'assistant' }),
            ],
        }));

        const forked = await store.forkProcess!('source-fork', 'fork-1', 'sdk-session-forked');

        expect(forked.conversationTurns?.[0].repoGroupContext).toBe(BLOCK);
    });
});

describe('SqliteProcessStore — updateTurnRepoGroupContext', () => {
    it('persists the block on the user turn at the given index only', async () => {
        await store.addProcess(makeProcess('p-upd-1', {
            conversationTurns: [
                makeTurn(0, { role: 'user' }),
                makeTurn(1, { role: 'assistant' }),
                makeTurn(2, { role: 'user' }),
            ],
        }));

        await store.updateTurnRepoGroupContext('p-upd-1', 2, BLOCK);

        const read = await store.getProcess('p-upd-1');
        expect(read?.conversationTurns?.[2].repoGroupContext).toBe(BLOCK);
        expect(read?.conversationTurns?.[0].repoGroupContext).toBeUndefined();
        expect(read?.conversationTurns?.[1].repoGroupContext).toBeUndefined();
    });

    it('is a no-op on an assistant turn', async () => {
        await store.addProcess(makeProcess('p-upd-2', {
            conversationTurns: [
                makeTurn(0, { role: 'user' }),
                makeTurn(1, { role: 'assistant' }),
            ],
        }));

        await store.updateTurnRepoGroupContext('p-upd-2', 1, BLOCK);

        const read = await store.getProcess('p-upd-2');
        expect(read?.conversationTurns?.[1].repoGroupContext).toBeUndefined();
    });

    it('is a no-op for an out-of-range turn index', async () => {
        await store.addProcess(makeProcess('p-upd-3', {
            conversationTurns: [makeTurn(0, { role: 'user' })],
        }));

        await expect(store.updateTurnRepoGroupContext('p-upd-3', 9, BLOCK)).resolves.toBeUndefined();

        const read = await store.getProcess('p-upd-3');
        expect(read?.conversationTurns?.[0].repoGroupContext).toBeUndefined();
    });

    it('overwrites a previously recorded block when membership changes', async () => {
        await store.addProcess(makeProcess('p-upd-4', {
            conversationTurns: [makeTurn(0, { role: 'user', repoGroupContext: BLOCK })],
        }));

        const next = BLOCK.replace('- Repo A: /repos/a', '- Repo B: /repos/b');
        await store.updateTurnRepoGroupContext('p-upd-4', 0, next);

        const read = await store.getProcess('p-upd-4');
        expect(read?.conversationTurns?.[0].repoGroupContext).toBe(next);
    });
});
