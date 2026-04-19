/**
 * SqliteProcessStore — Turn Actions Tests
 *
 * Validates per-message delete, pin, and archive operations on conversation turns.
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
        role: 'user',
        content: `message-${index}`,
        timestamp: new Date(),
        turnIndex: index,
        timeline: [],
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-turn-actions-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Soft Delete
// ============================================================================

describe('SqliteProcessStore — Turn Soft Delete', () => {
    it('softDeleteTurn sets deleted_at on the turn', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));
        await store.appendConversationTurn('p1', () => makeTurn(1, { role: 'assistant', content: 'reply' }));

        store.softDeleteTurn('p1', 0);

        const proc = await store.getProcess('p1');
        const turn0 = proc!.conversationTurns!.find(t => t.turnIndex === 0);
        expect(turn0?.deletedAt).toBeInstanceOf(Date);
    });

    it('restoreTurn clears deleted_at', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));

        store.softDeleteTurn('p1', 0);
        let proc = await store.getProcess('p1');
        expect(proc!.conversationTurns![0].deletedAt).toBeInstanceOf(Date);

        store.restoreTurn('p1', 0);
        proc = await store.getProcess('p1');
        expect(proc!.conversationTurns![0].deletedAt).toBeUndefined();
    });

    it('hardDeleteTurn only removes soft-deleted turns', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));
        await store.appendConversationTurn('p1', () => makeTurn(1, { role: 'assistant', content: 'reply' }));

        // Hard delete without soft delete first — should not remove
        store.hardDeleteTurn('p1', 0);
        let proc = await store.getProcess('p1');
        expect(proc!.conversationTurns!.length).toBe(2);

        // Soft delete first, then hard delete
        store.softDeleteTurn('p1', 0);
        store.hardDeleteTurn('p1', 0);
        proc = await store.getProcess('p1');
        expect(proc!.conversationTurns!.length).toBe(1);
        expect(proc!.conversationTurns![0].turnIndex).toBe(1);
    });
});

// ============================================================================
// Pin
// ============================================================================

describe('SqliteProcessStore — Turn Pin', () => {
    it('pinTurn sets pinned_at and auto-unarchives', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));

        // Archive first
        store.archiveTurn('p1', 0);
        let proc = await store.getProcess('p1');
        expect(proc!.conversationTurns![0].archived).toBe(true);

        // Pin — should also unarchive
        const pinnedAt = '2026-04-18T10:00:00.000Z';
        store.pinTurn('p1', 0, pinnedAt);
        proc = await store.getProcess('p1');
        const turn = proc!.conversationTurns![0];
        expect(turn.pinnedAt).toBeInstanceOf(Date);
        expect(turn.pinnedAt!.toISOString()).toBe(pinnedAt);
        expect(turn.archived).toBeUndefined(); // auto-unarchived
    });

    it('unpinTurn clears pinned_at', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));

        store.pinTurn('p1', 0, new Date().toISOString());
        store.unpinTurn('p1', 0);

        const proc = await store.getProcess('p1');
        expect(proc!.conversationTurns![0].pinnedAt).toBeUndefined();
    });

    it('getPinnedTurns returns only pinned, non-deleted turns', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));
        await store.appendConversationTurn('p1', () => makeTurn(1, { role: 'assistant', content: 'reply' }));
        await store.appendConversationTurn('p1', () => makeTurn(2, { content: 'msg-2' }));

        store.pinTurn('p1', 0, '2026-04-01T12:00:00.000Z');
        store.pinTurn('p1', 1, '2026-04-02T12:00:00.000Z');
        // Pin then soft-delete turn 2
        store.pinTurn('p1', 2, '2026-04-03T12:00:00.000Z');
        store.softDeleteTurn('p1', 2);

        const pinned = store.getPinnedTurns('p1');
        expect(pinned.length).toBe(2);
        // Ordered by pinned_at DESC
        expect(pinned[0].turnIndex).toBe(1);
        expect(pinned[1].turnIndex).toBe(0);
    });
});

// ============================================================================
// Archive
// ============================================================================

describe('SqliteProcessStore — Turn Archive', () => {
    it('archiveTurn sets archived flag', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));

        store.archiveTurn('p1', 0);

        const proc = await store.getProcess('p1');
        expect(proc!.conversationTurns![0].archived).toBe(true);
    });

    it('unarchiveTurn clears archived flag', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));

        store.archiveTurn('p1', 0);
        store.unarchiveTurn('p1', 0);

        const proc = await store.getProcess('p1');
        expect(proc!.conversationTurns![0].archived).toBeUndefined();
    });
});

// ============================================================================
// New turn fields round-trip
// ============================================================================

describe('SqliteProcessStore — Turn fields round-trip', () => {
    it('new fields default to null/0 for freshly appended turns', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.appendConversationTurn('p1', () => makeTurn(0));

        const proc = await store.getProcess('p1');
        const turn = proc!.conversationTurns![0];
        expect(turn.deletedAt).toBeUndefined();
        expect(turn.pinnedAt).toBeUndefined();
        expect(turn.archived).toBeUndefined();
    });
});
