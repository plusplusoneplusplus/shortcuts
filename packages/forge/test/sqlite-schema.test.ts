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
            'idx_schedule_runs_schedule_id',
            'idx_schedule_runs_repo_id',
            'idx_schedule_runs_status',
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
        expect(SCHEMA_VERSION).toBe(2);
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

    describe('V1 → V2 migration (seen_at column)', () => {
        it('fresh DB includes seen_at column', () => {
            initializeDatabase(db);

            const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('seen_at');
        });

        it('migrates a V1 database without data loss', () => {
            // Simulate a V1 database by creating the table WITHOUT seen_at
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            db.exec(`
                CREATE TABLE processes (
                    id                    TEXT PRIMARY KEY,
                    workspace_id          TEXT NOT NULL,
                    type                  TEXT,
                    prompt_preview        TEXT,
                    full_prompt           TEXT,
                    status                TEXT NOT NULL,
                    start_time            TEXT NOT NULL,
                    end_time              TEXT,
                    error                 TEXT,
                    result                TEXT,
                    result_file_path      TEXT,
                    raw_stdout_file_path  TEXT,
                    metadata              TEXT,
                    group_metadata        TEXT,
                    structured_result     TEXT,
                    parent_process_id     TEXT,
                    sdk_session_id        TEXT,
                    backend               TEXT,
                    working_directory     TEXT,
                    title                 TEXT,
                    token_limit           INTEGER,
                    current_tokens        INTEGER,
                    cumulative_token_usage TEXT,
                    stale                 INTEGER DEFAULT 0,
                    data_file_path        TEXT,
                    archived              INTEGER DEFAULT 0
                )
            `);
            db.pragma('user_version = 1');

            // Insert a row before migration
            db.prepare(`
                INSERT INTO processes (id, workspace_id, status, start_time, end_time)
                VALUES (?, ?, ?, ?, ?)
            `).run('p1', 'ws1', 'completed', '2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z');

            // Run initialization (should migrate V1 → V2)
            initializeDatabase(db);

            // Version should be 2
            expect(getSchemaVersion(db)).toBe(2);

            // seen_at column should exist
            const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
            expect(cols.map(c => c.name)).toContain('seen_at');

            // Existing data should be preserved with seen_at = NULL
            const row = db.prepare('SELECT id, status, seen_at FROM processes WHERE id = ?').get('p1') as any;
            expect(row.id).toBe('p1');
            expect(row.status).toBe('completed');
            expect(row.seen_at).toBeNull();
        });

        it('migration is idempotent on a V2 database', () => {
            initializeDatabase(db);
            expect(getSchemaVersion(db)).toBe(2);

            // Run again — should not throw
            expect(() => initializeDatabase(db)).not.toThrow();
            expect(getSchemaVersion(db)).toBe(2);
        });
    });
});
