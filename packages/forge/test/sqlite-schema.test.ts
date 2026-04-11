import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initializeDatabase, getSchemaVersion, SCHEMA_VERSION } from '../src/sqlite-schema';

describe('sqlite-schema', () => {
    let db: Database.Database;

    beforeEach(() => {
        db = new Database(':memory:');
    });

    afterEach(() => {
        db.close();
    });

    it('creates all 6 tables', () => {
        initializeDatabase(db);

        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((r: any) => r.name);

        expect(tables).toContain('processes');
        expect(tables).toContain('conversation_turns');
        expect(tables).toContain('workspaces');
        expect(tables).toContain('wikis');
        expect(tables).toContain('queue_tasks');
        expect(tables).toContain('queue_repo_state');
    });

    it('creates all expected indexes', () => {
        initializeDatabase(db);

        const indexes = db
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
            .all()
            .map((r: any) => r.name);

        const expected = [
            'idx_processes_workspace_id',
            'idx_processes_status',
            'idx_processes_type',
            'idx_processes_start_time',
            'idx_processes_parent',
            'idx_processes_sdk_session',
            'idx_processes_active',
            'idx_turns_process_id',
            'idx_turns_streaming',
            'idx_queue_tasks_repo_id',
            'idx_queue_tasks_status',
        ];

        for (const name of expected) {
            expect(indexes).toContain(name);
        }
        // Exactly the indexes we expect (no extras with our prefix)
        expect(indexes).toHaveLength(expected.length);
    });

    describe('PRAGMAs', () => {
        it('enables foreign_keys', () => {
            initializeDatabase(db);
            const fk = db.pragma('foreign_keys', { simple: true });
            expect(fk).toBe(1);
        });

        it('sets journal_mode to WAL on a file-backed DB', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-schema-test-'));
            const dbPath = path.join(tmpDir, 'test.db');
            const fileDb = new Database(dbPath);
            try {
                initializeDatabase(fileDb);
                const mode = fileDb.pragma('journal_mode', { simple: true });
                expect(mode).toBe('wal');
            } finally {
                fileDb.close();
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });
    });

    it('getSchemaVersion returns SCHEMA_VERSION after initialization', () => {
        initializeDatabase(db);
        expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
        expect(SCHEMA_VERSION).toBe(1);
    });

    it('is idempotent — calling initializeDatabase twice does not throw', () => {
        initializeDatabase(db);
        expect(() => initializeDatabase(db)).not.toThrow();

        // Still has the same tables and version
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all()
            .map((r: any) => r.name);
        expect(tables).toContain('processes');
        expect(tables).toContain('conversation_turns');
        expect(tables).toContain('workspaces');
        expect(tables).toContain('wikis');
        expect(tables).toContain('queue_tasks');
        expect(tables).toContain('queue_repo_state');
        expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    });

    it('enforces FK constraint — conversation_turns rejects nonexistent process_id', () => {
        initializeDatabase(db);

        const insert = db.prepare(`
            INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        expect(() =>
            insert.run('nonexistent-process', 0, 'user', 'hello', new Date().toISOString())
        ).toThrow(/FOREIGN KEY/);
    });

    it('enforces UNIQUE constraint on (process_id, turn_index)', () => {
        initializeDatabase(db);

        // Insert a process first to satisfy FK
        db.prepare(`
            INSERT INTO processes (id, workspace_id, status, start_time)
            VALUES (?, ?, ?, ?)
        `).run('p1', 'ws1', 'running', new Date().toISOString());

        const insertTurn = db.prepare(`
            INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        const now = new Date().toISOString();
        insertTurn.run('p1', 0, 'user', 'first', now);

        expect(() =>
            insertTurn.run('p1', 0, 'user', 'duplicate', now)
        ).toThrow(/UNIQUE/);
    });

    it('CASCADE deletes conversation_turns when a process is removed', () => {
        initializeDatabase(db);

        db.prepare(`
            INSERT INTO processes (id, workspace_id, status, start_time)
            VALUES (?, ?, ?, ?)
        `).run('p1', 'ws1', 'completed', new Date().toISOString());

        db.prepare(`
            INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `).run('p1', 0, 'user', 'hello', new Date().toISOString());

        // Verify the turn exists
        const before = db.prepare('SELECT COUNT(*) as cnt FROM conversation_turns WHERE process_id = ?').get('p1') as any;
        expect(before.cnt).toBe(1);

        // Delete the process
        db.prepare('DELETE FROM processes WHERE id = ?').run('p1');

        // Turn should be cascade-deleted
        const after = db.prepare('SELECT COUNT(*) as cnt FROM conversation_turns WHERE process_id = ?').get('p1') as any;
        expect(after.cnt).toBe(0);
    });
});
