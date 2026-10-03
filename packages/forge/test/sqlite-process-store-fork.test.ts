/**
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
    type BotControlMetadata,
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
            metadata: {
                type: 'chat',
                workspaceId: 'ws-test',
                stoppedChatResume: { resumable: false, reason: 'strict-resume-failed' },
                rewindHistory: [{ previousSessionId: 'old-session' }],
            },
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-1', 'fork-1');

        expect(forked.id).toBe('fork-1');
        expect(forked.sdkSessionId).toBeUndefined();
        expect(forked.activeProviderSession).toBeUndefined();
        expect(forked.status).toBe('completed');
        expect(forked.title).toBe('[Fork] Original Chat');
        expect(forked.promptPreview).toBe('[Fork] test prompt');
        expect(forked.metadata?.forkSourceId).toBe('source-1');
        expect(forked.metadata?.workspaceId).toBe('ws-test');
        expect(forked.metadata?.stoppedChatResume).toBeUndefined();
        expect(forked.metadata?.rewindHistory).toBeUndefined();
        expect(forked.metadata).not.toHaveProperty('botControl');
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

        const forked = await store.forkProcess!('source-2', 'fork-2');

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

        const forked = await store.forkProcess!('source-3', 'fork-3');

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

        const forked = await store.forkProcess!('source-4', 'fork-4', 1);

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

        const forked = await store.forkProcess!('source-5', 'fork-5');

        expect(forked.conversationTurns).toHaveLength(2);
        const indices = forked.conversationTurns!.map(t => t.turnIndex);
        expect(indices).toEqual([0, 2]);
    });

    it('throws when source process does not exist', async () => {
        await expect(
            store.forkProcess!('nonexistent', 'fork-x')
        ).rejects.toThrow('Source process not found');
    });

    it('emits process-added change event', async () => {
        const source = makeProcess('source-6', {
            conversationTurns: [makeTurn(0)],
        });
        await store.addProcess(source);

        const changeSpy = vi.fn();
        store.onProcessChange = changeSpy;

        await store.forkProcess!('source-6', 'fork-6');

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

        const forked = await store.forkProcess!('source-7', 'fork-7');

        expect(forked.parentProcessId).toBeUndefined();
    });

    it('works with zero turns', async () => {
        const source = makeProcess('source-8', {
            conversationTurns: [],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-8', 'fork-8');

        expect(forked.conversationTurns).toHaveLength(0);
    });

    it('uses source promptPreview when title is missing', async () => {
        const source = makeProcess('source-9', {
            title: undefined,
            promptPreview: 'my prompt',
            conversationTurns: [],
        });
        await store.addProcess(source);

        const forked = await store.forkProcess!('source-9', 'fork-9');

        expect(forked.title).toBe('[Fork] my prompt');
    });
});

describe('SqliteProcessStore.forkProcess - bot control isolation', () => {
    const cases = [
        { source: 'teams', workspaceId: 'ws-a', provider: 'copilot', upToTurnIndex: undefined },
        { source: 'teams', workspaceId: 'ws-b', provider: 'codex', upToTurnIndex: 1 },
        { source: 'whatsapp', workspaceId: 'ws-a', provider: 'codex', upToTurnIndex: undefined },
        { source: 'whatsapp', workspaceId: 'ws-b', provider: 'copilot', upToTurnIndex: 1 },
    ] as const;

    function botControl(source: BotControlMetadata['source']): BotControlMetadata {
        return {
            state: 'active',
            source,
            controllerKey: `${source}-bridge`,
            controllerLabel: source === 'teams' ? 'Teams bridge' : 'WhatsApp bridge',
            externalThreadUrl: source === 'teams'
                ? 'https://teams.microsoft.com/l/message/test-thread'
                : 'https://web.whatsapp.com/test-thread',
        };
    }

    it.each(cases)(
        'does not inherit $source control in $workspaceId with provider $provider',
        async ({ source, workspaceId, provider, upToTurnIndex }) => {
            const metadata = {
                type: 'chat',
                workspaceId,
                provider,
                model: 'test-model',
                botControl: botControl(source),
                commitChat: { commitHash: 'test-commit' },
            };
            await store.addProcess(makeProcess('managed', {
                metadata,
                conversationTurns: [makeTurn(0), makeTurn(1), makeTurn(2), makeTurn(3)],
            }));
            const sourceBefore = await store.getProcess('managed');
            const changeSpy = vi.fn();
            store.onProcessChange = changeSpy;

            const forked = await store.forkProcess('managed', 'fork', upToTurnIndex);

            expect(forked.metadata).toEqual({
                type: 'chat',
                workspaceId,
                provider,
                model: 'test-model',
                commitChat: { commitHash: 'test-commit' },
                forkSourceId: 'managed',
            });
            expect(forked.conversationTurns).toHaveLength(upToTurnIndex === undefined ? 4 : 2);
            expect(changeSpy).toHaveBeenCalledExactlyOnceWith({
                type: 'process-added',
                process: forked,
            });
            expect(changeSpy.mock.calls[0][0].process.metadata).not.toHaveProperty('botControl');
            expect(await store.getProcess('managed')).toEqual(sourceBefore);

            store.close();
            store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
            expect((await store.getProcess('fork', workspaceId))?.metadata).toEqual(forked.metadata);
            expect((await store.getProcess('managed', workspaceId))?.metadata).toEqual(metadata);
            const listed = await store.getAllProcesses({ workspaceId, exclude: ['conversation'] });
            expect(listed.find(process => process.id === 'fork')?.metadata).not.toHaveProperty('botControl');
            expect(listed.find(process => process.id === 'managed')?.metadata?.botControl).toEqual(metadata.botControl);
            expect(await store.getAllProcesses({ workspaceId: 'ws-other' })).toEqual([]);

            const secondFork = await store.forkProcess('fork', 'second-fork');
            expect(secondFork.metadata).not.toHaveProperty('botControl');
            expect(secondFork.metadata?.forkSourceId).toBe('fork');
            expect((await store.getProcess('managed'))?.metadata?.botControl).toEqual(metadata.botControl);
        },
    );

    it('drops malformed control without validating or copying it into the fork', async () => {
        await store.addProcess(makeProcess('malformed'));
        store.getDatabase().prepare('UPDATE processes SET metadata = ? WHERE id = ?').run(
            JSON.stringify({ type: 'chat', workspaceId: 'ws-test', botControl: { state: 'invalid' } }),
            'malformed',
        );

        const forked = await store.forkProcess('malformed', 'fork');

        expect(forked.metadata).not.toHaveProperty('botControl');
        expect((await store.getProcess('fork'))?.metadata).not.toHaveProperty('botControl');
        expect((await store.getProcess('malformed'))?.metadata?.botControl).toEqual({ state: 'invalid' });
    });

    it.each(['teams', 'whatsapp'] as const)(
        'preserves %s control and rolls back a failed fork before retry',
        async source => {
            await store.addProcess(makeProcess('managed', {
                metadata: { type: 'chat', workspaceId: 'ws-test', botControl: botControl(source) },
                conversationTurns: [makeTurn(0), makeTurn(1)],
            }));
            const sourceBefore = await store.getProcess('managed');
            const changeSpy = vi.fn();
            store.onProcessChange = changeSpy;
            const db = store.getDatabase();
            db.exec(`
                CREATE TRIGGER reject_fork_turn BEFORE INSERT ON conversation_turns
                WHEN NEW.process_id = 'fork'
                BEGIN SELECT RAISE(ABORT, 'fork turn persistence failed'); END;
            `);

            await expect(store.forkProcess('managed', 'fork')).rejects.toThrow('fork turn persistence failed');

            expect(await store.getProcess('fork')).toBeUndefined();
            expect(await store.getConversationTurns('fork')).toEqual([]);
            expect(await store.getProcess('managed')).toEqual(sourceBefore);
            expect(changeSpy).not.toHaveBeenCalled();
            db.exec('DROP TRIGGER reject_fork_turn');

            const forked = await store.forkProcess('managed', 'fork');
            expect(forked.metadata).not.toHaveProperty('botControl');
            expect(forked.conversationTurns).toHaveLength(2);
            expect(await store.getProcess('managed')).toEqual(sourceBefore);
            expect(changeSpy).toHaveBeenCalledTimes(1);
        },
    );
});

describe('SqliteProcessStore.forkProcess — commit-chat association', () => {
    it('preserves metadata.commitChat on the fork', async () => {
        const commitChat = {
            commitHash: '5fdf6cd18f978b84fb02b7ac82c740a4d2d7d5e3',
            commitMessage: '[MoE] Single-launch moe_align',
        };
        await store.addProcess(makeProcess('src-commit', {
            metadata: { type: 'chat', workspaceId: 'ws-test', commitChat },
        }));

        const forked = await store.forkProcess('src-commit', 'fork-commit');

        expect(forked.metadata?.commitChat).toEqual(commitChat);
        expect((await store.getProcess('fork-commit'))?.metadata?.commitChat).toEqual(commitChat);
    });
});
