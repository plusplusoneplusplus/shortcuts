/**
 * SqliteProcessStore Tests — customTitle + lastMessagePreview
 *
 * Validates the rename-session feature columns added in schema v16:
 *   - custom_title: user-set name, separate from AI-generated title.
 *   - last_message_preview: denormalized snapshot of the newest turn.
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

function makeTurn(index: number, overrides?: Partial<ConversationTurn>): ConversationTurn {
    return {
        role: 'assistant',
        content: `message-${index}`,
        timestamp: new Date(),
        turnIndex: index,
        timeline: [],
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-customtitle-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore — customTitle & lastMessagePreview', () => {
    it('updateProcess persists customTitle to its own column', async () => {
        await store.addProcess(makeProcess('p-ct-1', { title: 'AI Title' }));
        await store.updateProcess('p-ct-1', { customTitle: 'My Custom Name' });
        const loaded = await store.getProcess('p-ct-1');
        expect(loaded?.customTitle).toBe('My Custom Name');
        expect(loaded?.title).toBe('AI Title');
    });

    it('updateProcess can clear customTitle via empty string', async () => {
        await store.addProcess(makeProcess('p-ct-2'));
        await store.updateProcess('p-ct-2', { customTitle: 'Initial' });
        await store.updateProcess('p-ct-2', { customTitle: '' });
        const loaded = await store.getProcess('p-ct-2');
        expect(loaded?.customTitle).toBeFalsy();
    });

    it('appendConversationTurn updates lastMessagePreview only from user turns', async () => {
        await store.addProcess(makeProcess('p-lmp-1'));
        // Assistant turn — should NOT refresh the preview.
        await store.appendConversationTurn('p-lmp-1', (idx) => makeTurn(idx, {
            content: 'first reply from assistant',
        }));
        const after1 = await store.getProcess('p-lmp-1');
        expect(after1?.lastMessagePreview).toBeFalsy();

        // User turn — should refresh the preview.
        await store.appendConversationTurn('p-lmp-1', (idx) => makeTurn(idx, {
            role: 'user',
            content: 'follow-up question from user',
        }));
        const after2 = await store.getProcess('p-lmp-1');
        expect(after2?.lastMessagePreview).toContain('follow-up');

        // Subsequent assistant turn — must NOT overwrite the user-prompt snapshot.
        await store.appendConversationTurn('p-lmp-1', (idx) => makeTurn(idx, {
            content: 'another assistant reply',
        }));
        const after3 = await store.getProcess('p-lmp-1');
        expect(after3?.lastMessagePreview).toContain('follow-up');
    });

    it('appendConversationTurn strips markdown from preview', async () => {
        await store.addProcess(makeProcess('p-lmp-2'));
        await store.appendConversationTurn('p-lmp-2', (idx) => makeTurn(idx, {
            role: 'user',
            content: '```ts\nconst x = 1;\n```\nThe answer is **42**.',
        }));
        const loaded = await store.getProcess('p-lmp-2');
        // Code fences should be removed; "answer is 42" should remain.
        expect(loaded?.lastMessagePreview).not.toContain('```');
        expect(loaded?.lastMessagePreview).toContain('42');
    });

    it('getProcessSummaries returns customTitle and lastMessagePreview', async () => {
        await store.addProcess(makeProcess('p-sum-1', {
            customTitle: 'Renamed Session',
        }));
        await store.appendConversationTurn('p-sum-1', (idx) => makeTurn(idx, {
            role: 'user',
            content: 'latest activity here',
        }));
        const { entries } = await store.getProcessSummaries!({ workspaceId: 'ws-test' });
        const entry = entries.find((e: any) => e.id === 'p-sum-1');
        expect(entry?.customTitle).toBe('Renamed Session');
        expect(entry?.lastMessagePreview).toContain('latest activity');
    });
});
