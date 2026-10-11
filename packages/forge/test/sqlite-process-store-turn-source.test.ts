import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import { initializeDatabase, SCHEMA_VERSION } from '../src/sqlite-schema';
import { serializeProcess, deserializeProcess } from '../src/ai/process-serialization';
import type { AIProcess, TurnSource } from '../src/ai/process-interfaces';

describe('durable trigger wake turn identity', () => {
    let directory: string;
    let store: SqliteProcessStore;
    const source: TurnSource = { source: 'trigger', triggerId: 'rule-1', deliveryId: 'delivery-1' };
    const process: AIProcess = {
        id: 'sentinel-1', type: 'chat', status: 'completed', promptPreview: 'Wake', fullPrompt: 'Wake',
        startTime: new Date('2026-01-01T00:00:00.000Z'),
        conversationTurns: [{
            role: 'user', content: 'Wake', timestamp: new Date('2026-01-01T00:00:00.000Z'),
            turnIndex: 0, turnSource: source, relayRequestId: 'delivery-1',
        }],
    };
    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-turn-source-'));
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
    });
    afterEach(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

    it('round-trips attribution through JSON serialization', () => {
        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns?.[0].turnSource).toEqual(source);
        expect(deserializeProcess(serialized).conversationTurns?.[0].turnSource).toEqual(source);
    });

    it('retains identity on SQLite reads, forks and database reopen', async () => {
        await store.addProcess(process);
        expect((await store.getProcess(process.id))?.conversationTurns?.[0].turnSource).toEqual(source);
        expect((await store.getConversationTurns(process.id))[0].turnSource).toEqual(source);
        expect((await store.getAllProcesses())[0].conversationTurns?.[0].turnSource).toEqual(source);
        expect((await store.forkProcess(process.id, 'fork-1', 'session-1')).conversationTurns?.[0].turnSource).toEqual(source);
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        expect((await store.getProcess(process.id))?.conversationTurns?.[0]).toMatchObject({
            turnSource: source, relayRequestId: 'delivery-1',
        });
    });

    it('migrates a V40 database additively and idempotently', () => {
        const db = new NativeDatabase(':memory:');
        try {
            initializeDatabase(db);
            // V40 predates the V42 history-revision triggers that reference turn_source.
            db.exec(`
                DROP TRIGGER history_turn_update; DROP TRIGGER history_turn_delete;
                DROP TRIGGER history_turn_insert; DROP TRIGGER history_turn_replace; DROP TRIGGER history_compaction_complete;
                ALTER TABLE processes DROP COLUMN history_revision;
                ALTER TABLE conversation_turns DROP COLUMN turn_source;
            `);
            db.pragma('user_version = 40');
            initializeDatabase(db);
            initializeDatabase(db);
            const columns = db.prepare('PRAGMA table_info(conversation_turns)').all<{ name: string }>();
            expect(columns.filter(column => column.name === 'turn_source')).toHaveLength(1);
            expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'history_%'").all())
                .toHaveLength(5);
            expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
        } finally { db.close(); }
    });
});
