/**
 * Round-trip tests for the `mode` field on ConversationTurn.
 *
 * Verifies that `mode` set on a user turn is persisted and restored
 * via SqliteProcessStore's appendConversationTurn → getProcess path,
 * mirroring the existing `model` behavior.
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
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        metadata: { type: 'ai', workspaceId: 'ws-test' },
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
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-mode-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — conversation turn `mode` round-trip', () => {
    it('persists `mode` set on a user turn and returns it via getProcess', async () => {
        const proc = makeProcess('proc-mode-1');
        await store.addProcess(proc);
        await store.appendConversationTurn('proc-mode-1', (idx) =>
            makeUserTurn(idx, { mode: 'plan' })
        );

        const restored = await store.getProcess('proc-mode-1');
        expect(restored?.conversationTurns).toHaveLength(1);
        expect(restored?.conversationTurns?.[0].mode).toBe('plan');
    });

    it('omits `mode` when the original turn did not set it', async () => {
        const proc = makeProcess('proc-mode-2');
        await store.addProcess(proc);
        await store.appendConversationTurn('proc-mode-2', (idx) => makeUserTurn(idx));

        const restored = await store.getProcess('proc-mode-2');
        expect(restored?.conversationTurns?.[0].mode).toBeUndefined();
    });

    it('preserves `mode` alongside `model` and other fields', async () => {
        const proc = makeProcess('proc-mode-3');
        await store.addProcess(proc);
        await store.appendConversationTurn('proc-mode-3', (idx) =>
            makeUserTurn(idx, { mode: 'autopilot', model: 'gpt-5.4', pasteExternalized: true })
        );

        const restored = await store.getProcess('proc-mode-3');
        const turn = restored?.conversationTurns?.[0];
        expect(turn?.mode).toBe('autopilot');
        expect(turn?.model).toBe('gpt-5.4');
        expect(turn?.pasteExternalized).toBe(true);
    });

    it('persists different `mode` values across multiple user turns', async () => {
        const proc = makeProcess('proc-mode-4');
        await store.addProcess(proc);
        await store.appendConversationTurn('proc-mode-4', (idx) => makeUserTurn(idx, { mode: 'plan' }));
        await store.appendConversationTurn('proc-mode-4', (idx) => makeUserTurn(idx, { mode: 'autopilot' }));

        const restored = await store.getProcess('proc-mode-4');
        const modes = (restored?.conversationTurns ?? []).map(t => t.mode);
        expect(modes).toEqual(['plan', 'autopilot']);
    });
});
