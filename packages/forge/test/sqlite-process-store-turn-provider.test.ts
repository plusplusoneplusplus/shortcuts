/**
 * Round-trip tests for the `provider` field on ConversationTurn.
 *
 * A turn records the concrete AI provider that ran it so a conversation that
 * switches providers keeps honest per-turn attribution. The store must keep
 * each turn's own value, leave legacy turns unattributed rather than guessing
 * from the process, and carry the field through a fork copy.
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
    serializeProcess,
    deserializeProcess,
} from '../src/index';

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
        metadata: { type: 'ai', workspaceId: 'ws-test', provider: 'copilot' },
        ...overrides,
    };
}

function makeUserTurn(index: number, overrides?: Partial<ConversationTurn>): ConversationTurn {
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-turn-provider-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — conversation turn `provider` round-trip', () => {
    it('persists `provider` set on a user turn and returns it via getProcess', async () => {
        await store.addProcess(makeProcess('proc-provider-1'));
        await store.appendConversationTurn('proc-provider-1', (idx) =>
            makeUserTurn(idx, { provider: 'codex' })
        );

        const restored = await store.getProcess('proc-provider-1');
        expect(restored?.conversationTurns?.[0].provider).toBe('codex');
    });

    it('omits `provider` for turns recorded before attribution existed', async () => {
        await store.addProcess(makeProcess('proc-provider-2'));
        await store.appendConversationTurn('proc-provider-2', (idx) => makeUserTurn(idx));

        const restored = await store.getProcess('proc-provider-2');
        expect(restored?.conversationTurns?.[0].provider).toBeUndefined();
    });

    it('keeps each turn on its own provider across a switch', async () => {
        await store.addProcess(makeProcess('proc-provider-3'));
        await store.appendConversationTurn('proc-provider-3', (idx) => makeUserTurn(idx, { provider: 'copilot' }));
        await store.appendConversationTurn('proc-provider-3', (idx) => ({
            ...makeUserTurn(idx),
            role: 'assistant' as const,
            provider: 'copilot',
        }));
        await store.appendConversationTurn('proc-provider-3', (idx) => makeUserTurn(idx, { provider: 'claude' }));

        // The conversation has since moved on to Claude; earlier turns must not
        // be re-attributed to it.
        await store.updateProcess('proc-provider-3', {
            metadata: { type: 'ai', workspaceId: 'ws-test', provider: 'claude' },
        });

        const restored = await store.getProcess('proc-provider-3');
        expect((restored?.conversationTurns ?? []).map(t => t.provider)).toEqual(['copilot', 'copilot', 'claude']);
    });

    it('preserves `provider` alongside `model` and `mode`', async () => {
        await store.addProcess(makeProcess('proc-provider-4'));
        await store.appendConversationTurn('proc-provider-4', (idx) =>
            makeUserTurn(idx, { provider: 'opencode', model: 'gpt-5.4', mode: 'autopilot' })
        );

        const turn = (await store.getProcess('proc-provider-4'))?.conversationTurns?.[0];
        expect(turn?.provider).toBe('opencode');
        expect(turn?.model).toBe('gpt-5.4');
        expect(turn?.mode).toBe('autopilot');
    });

    it('carries `provider` through a fork copy', async () => {
        await store.addProcess(makeProcess('proc-provider-5'));
        await store.appendConversationTurn('proc-provider-5', (idx) => makeUserTurn(idx, { provider: 'copilot' }));
        await store.appendConversationTurn('proc-provider-5', (idx) => makeUserTurn(idx, { provider: 'codex' }));

        const forked = await store.forkProcess('proc-provider-5', 'proc-provider-5-fork', 'sdk-session-fork');

        expect((forked?.conversationTurns ?? []).map(t => t.provider)).toEqual(['copilot', 'codex']);
    });
});

describe('process serialization — conversation turn `provider`', () => {
    it('survives a serialize/deserialize round trip (file-store path)', () => {
        const proc = makeProcess('proc-provider-serialize', {
            conversationTurns: [
                makeUserTurn(0, { provider: 'copilot' }),
                makeUserTurn(1),
            ],
        });

        const restored = deserializeProcess(serializeProcess(proc));

        expect(restored.conversationTurns?.[0].provider).toBe('copilot');
        expect(restored.conversationTurns?.[1].provider).toBeUndefined();
    });
});
