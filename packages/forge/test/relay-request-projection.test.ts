/**
 * Relay request projections: SQLite and file stores answer request
 * admission/result questions with the same semantics as the in-memory
 * reference, and SQLite answers them through indexes without reading
 * transcripts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    FileProcessStore,
    projectRelayRequest,
    SqliteProcessStore,
    type AIProcess,
    type ConversationTurn,
    type ProcessStore,
} from '../src/index';

let tmpDir: string;
let sqlite: SqliteProcessStore;
let file: FileProcessStore;

const turn = (turnIndex: number, role: 'user' | 'assistant', content: string, extra: Partial<ConversationTurn> = {}): ConversationTurn => ({
    role, content, turnIndex, timestamp: new Date(1_700_000_000_000 + turnIndex), timeline: [], ...extra,
});

const FIXTURES: Record<string, ConversationTurn[]> = {
    'answered and closed': [
        turn(0, 'user', 'q1', { relayRequestId: 'r1' }),
        turn(1, 'assistant', 'thinking', { toolCalls: [{ id: 't', name: 'x', status: 'completed', startTime: new Date(), args: { big: 'x'.repeat(2000) } }] }),
        turn(2, 'assistant', 'final answer'),
        turn(3, 'user', 'q2', { relayRequestId: 'r2' }),
        turn(4, 'assistant', 'other answer'),
    ],
    'open with streaming and display-only turns': [
        turn(0, 'user', 'q1', { relayRequestId: 'r1' }),
        turn(1, 'assistant', 'settled'),
        turn(2, 'assistant', 'notice', { displayOnly: true }),
        turn(3, 'assistant', 'partial', { streaming: true }),
    ],
    'interrupted failure': [
        turn(0, 'user', 'q1', { relayRequestId: 'r1' }),
        turn(1, 'assistant', 'partial output', { interrupted: true, interruptionReason: 'usage limit resets at 5pm (UTC)' }),
    ],
    'error content failure after earlier answer': [
        turn(0, 'user', 'q1', { relayRequestId: 'r1' }),
        turn(1, 'assistant', 'earlier answer'),
        turn(2, 'assistant', 'Error: session limit reached'),
    ],
    'request not found': [
        turn(0, 'user', 'q1', { relayRequestId: 'other' }),
        turn(1, 'assistant', 'answer'),
    ],
    'request user turn without answer yet': [
        turn(0, 'user', 'q0'),
        turn(1, 'assistant', 'a0'),
        turn(2, 'user', 'q1', { relayRequestId: 'r1' }),
    ],
};

function processWith(id: string, turns: ConversationTurn[], extra: Partial<AIProcess> = {}): AIProcess {
    return {
        id, type: 'clarification', promptPreview: 'p', fullPrompt: 'p', status: 'completed',
        startTime: new Date(1_700_000_000_000), metadata: { type: 'chat', workspaceId: 'ws', mode: 'sentinel' } as AIProcess['metadata'],
        conversationTurns: turns, ...extra,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-projection-'));
    sqlite = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'p.db') });
    file = new FileProcessStore({ dataDir: path.join(tmpDir, 'file') });
    await file.registerWorkspace({ id: 'ws', name: 'ws', rootPath: tmpDir });
});

afterEach(async () => {
    sqlite.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('relay request projections', () => {
    it.each(Object.keys(FIXTURES))('matches the reference semantics: %s', async name => {
        const turns = FIXTURES[name];
        const expected = projectRelayRequest(turns, 'r1');
        for (const store of [sqlite, file] as ProcessStore[]) {
            await store.addProcess(processWith('p', turns));
            expect(await store.getRelayRequestProjection!('p', 'r1')).toEqual(expected);
            expect(await store.hasRelayRequestAdmission!('p', 'r1')).toBe(expected.found);
        }
    });

    it('agrees with the documented reference cases', () => {
        expect(projectRelayRequest(FIXTURES['answered and closed'], 'r1')).toEqual({ found: true, pending: false, closed: true, answer: 'final answer' });
        expect(projectRelayRequest(FIXTURES['open with streaming and display-only turns'], 'r1')).toEqual({ found: true, pending: false, closed: false, answer: 'settled' });
        expect(projectRelayRequest(FIXTURES['interrupted failure'], 'r1')).toEqual({
            found: true, pending: false, closed: false,
            failure: { interrupted: true, interruptionReason: 'usage limit resets at 5pm (UTC)', content: 'partial output' },
        });
        expect(projectRelayRequest(FIXTURES['request not found'], 'r1')).toEqual({ found: false, pending: false, closed: false });
    });

    it('detects pending-message admission and notice receipts without a user turn', async () => {
        for (const store of [sqlite, file] as ProcessStore[]) {
            await store.addProcess(processWith('p', [turn(0, 'assistant', 'notice', { displayOnly: true, relayRequestId: 'notice-1' })], {
                pendingMessages: [{ id: 'm1', content: 'later', relayRequestId: 'r-pending', createdAt: new Date().toISOString() } as never],
            }));
            expect(await store.hasRelayRequestAdmission!('p', 'r-pending')).toBe(true);
            expect(await store.getRelayRequestProjection!('p', 'r-pending')).toEqual({ found: false, pending: true, closed: false });
            expect(await store.hasRelayRequestAdmission!('p', 'notice-1')).toBe(false);
            expect(await store.hasRelayReceiptTurn!('p', 'notice-1')).toBe(true);
            expect(await store.hasRelayReceiptTurn!('p', 'missing')).toBe(false);
            expect(await store.hasRelayRequestAdmission!('missing', 'r-pending')).toBe(false);
        }
    });

    it('projects owner fields without turns', async () => {
        for (const store of [sqlite, file] as ProcessStore[]) {
            await store.addProcess(processWith('p', FIXTURES['answered and closed'], { status: 'failed', error: 'boom' }));
            expect(await store.getProcessOwnerProjection!('p')).toEqual({
                id: 'p', status: 'failed', workspaceId: 'ws', mode: 'sentinel', error: 'boom',
            });
            expect(await store.getProcessOwnerProjection!('missing')).toBeUndefined();
        }
    });

    it('tolerates malformed metadata JSON', async () => {
        await sqlite.addProcess(processWith('p', []));
        sqlite.getDatabase().prepare("UPDATE processes SET metadata = '{bad' WHERE id = 'p'").run();
        expect(await sqlite.getProcessOwnerProjection('p')).toEqual({ id: 'p', status: 'completed' });
        expect(await sqlite.hasRelayRequestAdmission('p', 'r1')).toBe(false);
    });

    it('uses relay and role indexes for boundary lookups', () => {
        const db = sqlite.getDatabase();
        const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('p', 'r1') as Array<{ detail: string }>)
            .map(row => row.detail).join('\n');
        expect(plan("SELECT 1 FROM conversation_turns WHERE process_id = ? AND relay_request_id = ? AND role = 'user' LIMIT 1"))
            .toMatch(/idx_turns_relay_request|idx_turns_process_role/);
        expect(plan("SELECT turn_index FROM conversation_turns WHERE process_id = ? AND role = 'user' AND turn_index > ? ORDER BY turn_index LIMIT 1"))
            .toContain('idx_turns_process_role');
    });
});
