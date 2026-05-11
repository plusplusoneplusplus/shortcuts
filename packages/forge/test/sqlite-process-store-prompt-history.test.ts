/**
 * SqliteProcessStore — getRecentUserPrompts tests.
 *
 * Validates the recent-initial-prompts query used by chat-input
 * up/down arrow history navigation: workspace-scoped, dedupe, archived
 * exclusion, ordering by start_time DESC.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { SqliteProcessStore, AIProcess, AIProcessStatus, ConversationTurn } from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(
    id: string,
    fullPrompt: string,
    overrides?: Partial<AIProcess>,
): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: fullPrompt.slice(0, 60),
        fullPrompt,
        status: 'completed' as AIProcessStatus,
        startTime: new Date('2024-06-01T12:00:00Z'),
        metadata: { type: 'ai', workspaceId: 'ws-test' },
        ...overrides,
    };
}

function makeUserTurn(turnIndex: number, content: string, timestamp: string): ConversationTurn {
    return {
        turnIndex,
        role: 'user',
        content,
        timestamp: new Date(timestamp),
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-history-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getRecentUserPrompts', () => {
    it('returns [] for an empty workspaceId', () => {
        expect(store.getRecentUserPrompts('')).toEqual([]);
    });

    it('returns [] when the workspace has no processes', () => {
        expect(store.getRecentUserPrompts('ws-empty')).toEqual([]);
    });

    it('returns the workspace prompts ordered most-recent first', async () => {
        await store.addProcess(makeProcess('p1', 'first prompt', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p2', 'second prompt', {
            startTime: new Date('2024-06-01T11:00:00Z'),
        }));
        await store.addProcess(makeProcess('p3', 'third prompt', {
            startTime: new Date('2024-06-01T12:00:00Z'),
        }));
        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'third prompt',
            'second prompt',
            'first prompt',
        ]);
    });

    it('deduplicates by exact text, keeping the most recent occurrence', async () => {
        await store.addProcess(makeProcess('p1', 'rebase the branch', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p2', 'fix the bug', {
            startTime: new Date('2024-06-01T11:00:00Z'),
        }));
        await store.addProcess(makeProcess('p3', 'rebase the branch', {
            startTime: new Date('2024-06-01T12:00:00Z'),
        }));
        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'rebase the branch',
            'fix the bug',
        ]);
    });

    it('treats different cases / whitespace as distinct entries', async () => {
        await store.addProcess(makeProcess('p1', 'Rebase the branch', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p2', 'rebase the branch', {
            startTime: new Date('2024-06-01T11:00:00Z'),
        }));
        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'rebase the branch',
            'Rebase the branch',
        ]);
    });

    it('scopes results to the requested workspace', async () => {
        await store.addProcess(makeProcess('p1', 'workspace one prompt', {
            metadata: { type: 'ai', workspaceId: 'ws-one' },
        }));
        await store.addProcess(makeProcess('p2', 'workspace two prompt', {
            metadata: { type: 'ai', workspaceId: 'ws-two' },
        }));
        expect(store.getRecentUserPrompts('ws-one')).toEqual([
            'workspace one prompt',
        ]);
        expect(store.getRecentUserPrompts('ws-two')).toEqual([
            'workspace two prompt',
        ]);
    });

    it('excludes archived processes', async () => {
        await store.addProcess(makeProcess('p1', 'kept prompt', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p2', 'archived prompt', {
            startTime: new Date('2024-06-01T11:00:00Z'),
        }));
        await store.archiveProcess('p2');
        expect(store.getRecentUserPrompts('ws-test')).toEqual(['kept prompt']);
    });

    it('excludes empty and whitespace-only prompts', async () => {
        await store.addProcess(makeProcess('p1', 'real prompt', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        // Persist a whitespace-only prompt directly to bypass any client-side guard.
        await store.addProcess(makeProcess('p2', '   ', {
            startTime: new Date('2024-06-01T11:00:00Z'),
        }));
        expect(store.getRecentUserPrompts('ws-test')).toEqual(['real prompt']);
    });

    it('honors the limit option', async () => {
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`p${i}`, `prompt ${i}`, {
                startTime: new Date(`2024-06-01T1${i}:00:00Z`),
            }));
        }
        expect(store.getRecentUserPrompts('ws-test', { limit: 2 })).toEqual([
            'prompt 4',
            'prompt 3',
        ]);
    });

    it('clamps limit into [1, 200]', async () => {
        await store.addProcess(makeProcess('p1', 'only prompt'));
        expect(store.getRecentUserPrompts('ws-test', { limit: 0 })).toEqual([
            'only prompt',
        ]);
        expect(store.getRecentUserPrompts('ws-test', { limit: -10 })).toEqual([
            'only prompt',
        ]);
    });

    it('returns enough unique entries even when many recent rows are duplicates', async () => {
        // 30 dup'd "ping" spread across days, then 1 "pong" oldest. With limit=2
        // and dedup, we must still surface "pong" — verifying the fetchLimit > limit logic.
        for (let i = 0; i < 30; i++) {
            const day = String((i % 28) + 1).padStart(2, '0');
            const hour = String(i % 24).padStart(2, '0');
            await store.addProcess(makeProcess(`p${i}`, 'ping', {
                startTime: new Date(`2024-06-${day}T${hour}:00:00Z`),
            }));
        }
        await store.addProcess(makeProcess('pold', 'pong', {
            startTime: new Date('2024-05-30T10:00:00Z'),
        }));
        expect(store.getRecentUserPrompts('ws-test', { limit: 2 })).toEqual([
            'ping',
            'pong',
        ]);
    });

    it('includes user follow-up turns from conversation_turns', async () => {
        await store.addProcess(makeProcess('p1', 'initial prompt', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(2, 'follow-up one', '2024-06-01T11:00:00Z'),
        );
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(4, 'follow-up two', '2024-06-01T12:00:00Z'),
        );
        // Assistant turns must NOT show up.
        await store.appendConversationTurn('p1', () => ({
            turnIndex: 3,
            role: 'assistant',
            content: 'an assistant reply',
            timestamp: new Date('2024-06-01T11:30:00Z'),
        }));

        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'follow-up two',
            'follow-up one',
            'initial prompt',
        ]);
    });

    it('merges initial prompts and follow-up turns sorted by timestamp DESC', async () => {
        await store.addProcess(makeProcess('p-old', 'old initial', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p-new', 'new initial', {
            startTime: new Date('2024-06-01T15:00:00Z'),
        }));
        // A follow-up to the old process that is more recent than the new
        // initial prompt — it should sort above 'new initial'.
        await store.appendConversationTurn('p-old', (idx) =>
            makeUserTurn(2, 'late follow-up', '2024-06-01T16:00:00Z'),
        );

        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'late follow-up',
            'new initial',
            'old initial',
        ]);
    });

    it('excludes follow-up turns from archived processes', async () => {
        await store.addProcess(makeProcess('p1', 'kept initial', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(2, 'kept follow-up', '2024-06-01T11:00:00Z'),
        );
        await store.addProcess(makeProcess('p2', 'archived initial', {
            startTime: new Date('2024-06-01T12:00:00Z'),
        }));
        await store.appendConversationTurn('p2', (idx) =>
            makeUserTurn(2, 'archived follow-up', '2024-06-01T13:00:00Z'),
        );
        await store.archiveProcess('p2');

        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'kept follow-up',
            'kept initial',
        ]);
    });

    it('excludes assistant turns and empty/whitespace turns', async () => {
        await store.addProcess(makeProcess('p1', 'real initial', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.appendConversationTurn('p1', () => ({
            turnIndex: 2,
            role: 'assistant',
            content: 'assistant reply',
            timestamp: new Date('2024-06-01T11:00:00Z'),
        }));
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(3, '   ', '2024-06-01T12:00:00Z'),
        );
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(4, 'real follow-up', '2024-06-01T13:00:00Z'),
        );

        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'real follow-up',
            'real initial',
        ]);
    });

    it('deduplicates across the initial+turn union (most recent wins)', async () => {
        await store.addProcess(makeProcess('p1', 'help me debug', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(2, 'help me debug', '2024-06-01T15:00:00Z'),
        );
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(3, 'one more thing', '2024-06-01T16:00:00Z'),
        );

        expect(store.getRecentUserPrompts('ws-test')).toEqual([
            'one more thing',
            'help me debug',
        ]);
    });
});
