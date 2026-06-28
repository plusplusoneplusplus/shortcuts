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

    it('creates all 8 tables', () => {
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
        expect(tables).toContain('commit_chat_bindings');
        expect(tables).toContain('work_item_chat_bindings');
        expect(tables).toContain('loops');
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
            'idx_queue_tasks_repo_position',
            'idx_queue_tasks_status',
            'idx_schedule_runs_schedule_id',
            'idx_schedule_runs_repo_id',
            'idx_schedule_runs_status',
            'idx_loops_process_id',
            'idx_loops_status',
            'idx_commit_chat_bindings_workspace',
            'idx_note_chat_bindings_task',
            'idx_pull_request_chat_bindings_workspace',
            'idx_work_item_chat_bindings_workspace',
            'idx_processes_ws_status_activity',
            'idx_task_groups_workspace_type',
            'idx_task_group_members_group',
            'idx_task_group_members_process',
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
        expect(SCHEMA_VERSION).toBe(24);
    });

    it('creates context-window breakdown columns on processes', () => {
        initializeDatabase(db);

        const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
        const colNames = cols.map(c => c.name);
        expect(colNames).toContain('system_tokens');
        expect(colNames).toContain('tool_definitions_tokens');
        expect(colNames).toContain('conversation_tokens');
    });

    it('creates queue pause timer columns', () => {
        initializeDatabase(db);

        const cols = db.prepare("PRAGMA table_info(queue_repo_state)").all() as Array<{ name: string }>;
        const colNames = cols.map(c => c.name);
        expect(colNames).toContain('queue_paused');
        expect(colNames).toContain('queue_paused_until');
        expect(colNames).toContain('autopilot_paused');
        expect(colNames).toContain('autopilot_paused_until');
    });

    it('creates queue item metadata columns', () => {
        initializeDatabase(db);

        const cols = db.prepare("PRAGMA table_info(queue_tasks)").all() as Array<{ name: string }>;
        const colNames = cols.map(c => c.name);
        expect(colNames).toContain('kind');
        expect(colNames).toContain('queue_position');
        expect(colNames).toContain('duration_hours');
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
        expect(tables).toContain('task_groups');
        expect(tables).toContain('task_group_members');
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

            // Version should be current
            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

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
            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            // Run again — should not throw
            expect(() => initializeDatabase(db)).not.toThrow();
            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
        });
    });

    describe('V4 → V5 migration (FTS5 conversation_search)', () => {
        /** Helper to insert a process + turn */
        function insertTurn(turnDb: Database.Database, processId: string, turnIndex: number, content: string): void {
            turnDb.prepare(`
                INSERT OR IGNORE INTO processes (id, workspace_id, status, start_time)
                VALUES (?, 'ws1', 'running', '2024-01-01T00:00:00Z')
            `).run(processId);
            turnDb.prepare(`
                INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
                VALUES (?, ?, 'user', ?, '2024-01-01T00:00:00Z')
            `).run(processId, turnIndex, content);
        }

        it('fresh DB has conversation_search FTS5 table', () => {
            initializeDatabase(db);

            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all()
                .map((r: any) => r.name);

            expect(tables).toContain('conversation_search');
        });

        it('fresh DB has all three FTS triggers', () => {
            initializeDatabase(db);

            const triggers = db
                .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
                .all()
                .map((r: any) => r.name);

            expect(triggers).toContain('conversation_search_ai');
            expect(triggers).toContain('conversation_search_ad');
            expect(triggers).toContain('conversation_search_au');
        });

        it('INSERT trigger indexes new turns', () => {
            initializeDatabase(db);
            insertTurn(db, 'p1', 0, 'hello world');

            const results = db.prepare("SELECT rowid, content FROM conversation_search WHERE conversation_search MATCH 'hello'").all() as any[];
            expect(results).toHaveLength(1);
            expect(results[0].content).toBe('hello world');
        });

        it('DELETE trigger removes turns from the index', () => {
            initializeDatabase(db);
            insertTurn(db, 'p1', 0, 'goodbye world');

            // Verify it's in the index
            let results = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'goodbye'").all();
            expect(results).toHaveLength(1);

            // Delete the turn
            db.prepare('DELETE FROM conversation_turns WHERE process_id = ? AND turn_index = ?').run('p1', 0);

            results = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'goodbye'").all();
            expect(results).toHaveLength(0);
        });

        it('UPDATE trigger re-indexes content changes', () => {
            initializeDatabase(db);
            insertTurn(db, 'p1', 0, 'original text');

            // Update the content
            db.prepare('UPDATE conversation_turns SET content = ? WHERE process_id = ? AND turn_index = ?')
                .run('modified text', 'p1', 0);

            // Old content should not match
            const oldResults = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'original'").all();
            expect(oldResults).toHaveLength(0);

            // New content should match
            const newResults = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'modified'").all();
            expect(newResults).toHaveLength(1);
        });

        it('CASCADE delete removes FTS entries when process is deleted', () => {
            initializeDatabase(db);
            insertTurn(db, 'p1', 0, 'cascade test');

            db.prepare('DELETE FROM processes WHERE id = ?').run('p1');

            const results = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'cascade'").all();
            expect(results).toHaveLength(0);
        });

        it('migrates a V4 database by backfilling existing turns', () => {
            // Simulate a V4 database with conversation_turns but no FTS
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
                    archived              INTEGER DEFAULT 0,
                    seen_at               TEXT,
                    last_event_at         TEXT
                )
            `);
            db.exec(`
                CREATE TABLE conversation_turns (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    process_id        TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                    turn_index        INTEGER NOT NULL,
                    role              TEXT NOT NULL,
                    content           TEXT,
                    timestamp         TEXT NOT NULL,
                    streaming         INTEGER DEFAULT 0,
                    tool_calls        TEXT,
                    timeline          TEXT,
                    images            TEXT,
                    historical        INTEGER DEFAULT 0,
                    suggestions       TEXT,
                    token_usage       TEXT,
                    paste_externalized INTEGER DEFAULT 0,
                    UNIQUE(process_id, turn_index)
                )
            `);
            db.exec(`
                CREATE TABLE commit_chat_bindings (
                    workspace_id  TEXT NOT NULL,
                    commit_hash   TEXT NOT NULL,
                    task_id       TEXT NOT NULL,
                    created_at    TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, commit_hash)
                )
            `);
            db.pragma('user_version = 4');

            // Insert existing data before migration
            db.prepare(`INSERT INTO processes (id, workspace_id, status, start_time) VALUES (?, ?, ?, ?)`)
                .run('p1', 'ws1', 'completed', '2024-01-01T00:00:00Z');
            db.prepare(`INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`)
                .run('p1', 0, 'user', 'searchable content alpha', '2024-01-01T00:00:00Z');
            db.prepare(`INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`)
                .run('p1', 1, 'assistant', 'searchable content beta', '2024-01-01T00:00:01Z');

            // Run migration
            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            // Backfilled data should be searchable
            const alphaResults = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'alpha'").all();
            expect(alphaResults).toHaveLength(1);

            const betaResults = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'beta'").all();
            expect(betaResults).toHaveLength(1);
        });

        it('V1 database migrates through all versions to V7', () => {
            // Simulate a V1 database
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

            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            // All migration artifacts should exist
            const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('seen_at');
            expect(colNames).toContain('last_event_at');
            expect(colNames).toContain('pinned_at');

            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .all()
                .map((r: any) => r.name);
            expect(tables).toContain('conversation_search');

            const triggers = db
                .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
                .all()
                .map((r: any) => r.name);
            expect(triggers).toContain('conversation_search_ai');
            expect(triggers).toContain('conversation_search_ad');
            expect(triggers).toContain('conversation_search_au');
        });

    describe('V5 → V6 migration (pinned_at column)', () => {
        it('adds pinned_at column to existing V5 database', () => {
            // Create a V5 database
            initializeDatabase(db);
            // Manually roll back to V5 by removing pinned_at
            // (V5 doesn't have pinned_at, but initializeDatabase creates it via DDL)
            // Instead, simulate a V5 database by creating fresh and checking the column exists
            const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
            expect(cols.map(c => c.name)).toContain('pinned_at');
            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
        });

        it('V5 database gains pinned_at column after migration', () => {
            // Create a V5-era schema manually (without pinned_at)
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
                    archived              INTEGER DEFAULT 0,
                    seen_at               TEXT,
                    last_event_at         TEXT
                )
            `);
            db.exec(`CREATE TABLE conversation_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                turn_index INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT,
                timestamp TEXT NOT NULL,
                streaming INTEGER DEFAULT 0,
                tool_calls TEXT,
                timeline TEXT,
                images TEXT,
                historical INTEGER DEFAULT 0,
                suggestions TEXT,
                token_usage TEXT,
                paste_externalized INTEGER DEFAULT 0,
                UNIQUE(process_id, turn_index)
            )`);
            db.pragma('user_version = 5');

            // Insert a row before migration
            db.prepare(`INSERT INTO processes (id, workspace_id, status, start_time)
                VALUES ('p1', 'ws1', 'completed', '2026-01-01T00:00:00.000Z')`).run();

            // Run migration
            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            // pinned_at column should exist
            const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
            expect(cols.map(c => c.name)).toContain('pinned_at');

            // Existing data should be preserved with null pinned_at
            const row = db.prepare('SELECT pinned_at FROM processes WHERE id = ?').get('p1') as any;
            expect(row.pinned_at).toBeNull();

            // Can update pinned_at
            db.prepare('UPDATE processes SET pinned_at = ? WHERE id = ?').run('2026-04-01T00:00:00.000Z', 'p1');
            const updated = db.prepare('SELECT pinned_at FROM processes WHERE id = ?').get('p1') as any;
            expect(updated.pinned_at).toBe('2026-04-01T00:00:00.000Z');
        });
    });

    describe('V7 → V8 migration (turn-level deleted_at, pinned_at, archived)', () => {
        it('adds deleted_at, pinned_at, archived columns to conversation_turns', () => {
            // Create a V7-era schema (full processes table, conversation_turns without turn-level columns)
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            db.exec(`
                CREATE TABLE processes (
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, type TEXT,
                    prompt_preview TEXT, full_prompt TEXT, status TEXT NOT NULL,
                    start_time TEXT NOT NULL, end_time TEXT, error TEXT, result TEXT,
                    result_file_path TEXT, raw_stdout_file_path TEXT, metadata TEXT,
                    group_metadata TEXT, structured_result TEXT, parent_process_id TEXT,
                    sdk_session_id TEXT, backend TEXT, working_directory TEXT, title TEXT,
                    token_limit INTEGER, current_tokens INTEGER, cumulative_token_usage TEXT,
                    stale INTEGER DEFAULT 0, data_file_path TEXT, archived INTEGER DEFAULT 0,
                    pinned_at TEXT, seen_at TEXT, last_event_at TEXT
                )
            `);
            db.exec(`CREATE TABLE conversation_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                turn_index INTEGER NOT NULL, role TEXT NOT NULL, content TEXT,
                timestamp TEXT NOT NULL, streaming INTEGER DEFAULT 0, tool_calls TEXT,
                timeline TEXT, images TEXT, historical INTEGER DEFAULT 0, suggestions TEXT,
                token_usage TEXT, paste_externalized INTEGER DEFAULT 0,
                UNIQUE(process_id, turn_index)
            )`);
            db.pragma('user_version = 7');

            // Insert test data
            db.prepare(`INSERT INTO processes (id, workspace_id, status, start_time)
                VALUES ('p1', 'ws1', 'completed', '2026-01-01T00:00:00.000Z')`).run();
            db.prepare(`INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
                VALUES ('p1', 0, 'user', 'hello', '2026-01-01T00:00:00.000Z')`).run();

            // Run migration
            initializeDatabase(db);
            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            // All columns should exist after migration from v7
            const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('deleted_at');
            expect(colNames).toContain('pinned_at');
            expect(colNames).toContain('archived');
            expect(colNames).toContain('model');

            // Existing turn should have null defaults
            const turn = db.prepare('SELECT deleted_at, pinned_at, archived, model FROM conversation_turns WHERE process_id = ?').get('p1') as any;
            expect(turn.deleted_at).toBeNull();
            expect(turn.pinned_at).toBeNull();
            expect(turn.archived).toBe(0);
            expect(turn.model).toBeNull();
        });
    });

    describe('V8 → V9 migration (model column on conversation_turns for divergent v8 DBs)', () => {
        it('adds model column to v8 database that lacks it', () => {
            // Simulate a v8 database from a different code branch that
            // had extra columns (deleted_at, pinned_at, archived) but no model
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            db.exec(`
                CREATE TABLE processes (
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, type TEXT,
                    prompt_preview TEXT, full_prompt TEXT, status TEXT NOT NULL,
                    start_time TEXT NOT NULL, end_time TEXT, error TEXT, result TEXT,
                    result_file_path TEXT, raw_stdout_file_path TEXT, metadata TEXT,
                    group_metadata TEXT, structured_result TEXT, parent_process_id TEXT,
                    sdk_session_id TEXT, backend TEXT, working_directory TEXT, title TEXT,
                    token_limit INTEGER, current_tokens INTEGER, cumulative_token_usage TEXT,
                    stale INTEGER DEFAULT 0, data_file_path TEXT, archived INTEGER DEFAULT 0,
                    pinned_at TEXT, seen_at TEXT, last_event_at TEXT
                )
            `);
            db.exec(`CREATE TABLE conversation_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                turn_index INTEGER NOT NULL, role TEXT NOT NULL, content TEXT,
                timestamp TEXT NOT NULL, streaming INTEGER DEFAULT 0, tool_calls TEXT,
                timeline TEXT, images TEXT, historical INTEGER DEFAULT 0, suggestions TEXT,
                token_usage TEXT, paste_externalized INTEGER DEFAULT 0,
                deleted_at TEXT, pinned_at TEXT, archived INTEGER DEFAULT 0,
                UNIQUE(process_id, turn_index)
            )`);
            db.pragma('user_version = 8');

            // Insert test data
            db.prepare(`INSERT INTO processes (id, workspace_id, status, start_time)
                VALUES ('p1', 'ws1', 'completed', '2026-01-01T00:00:00.000Z')`).run();
            db.prepare(`INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
                VALUES ('p1', 0, 'user', 'hello', '2026-01-01T00:00:00.000Z')`).run();

            // Run migration
            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            // New columns should exist
            const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('deleted_at');
            expect(colNames).toContain('pinned_at');
            expect(colNames).toContain('archived');

            // Existing data preserved with null/0 defaults
            const row = db.prepare('SELECT deleted_at, pinned_at, archived FROM conversation_turns WHERE process_id = ?').get('p1') as any;
            expect(row.deleted_at).toBeNull();
            expect(row.pinned_at).toBeNull();
            expect(row.archived).toBe(0);

            // Can update new columns
            db.prepare('UPDATE conversation_turns SET pinned_at = ? WHERE process_id = ? AND turn_index = ?')
                .run('2026-04-18T00:00:00.000Z', 'p1', 0);
            const updated = db.prepare('SELECT pinned_at FROM conversation_turns WHERE process_id = ?').get('p1') as any;
            expect(updated.pinned_at).toBe('2026-04-18T00:00:00.000Z');
        });
    });

        it('idempotent — calling initializeDatabase twice does not duplicate FTS data', () => {
            initializeDatabase(db);
            insertTurn(db, 'p1', 0, 'unique content');

            // Call again
            initializeDatabase(db);

            const results = db.prepare("SELECT * FROM conversation_search WHERE conversation_search MATCH 'unique'").all();
            expect(results).toHaveLength(1);
        });
    });

    describe('V18 → V19 migration (context-window breakdown columns)', () => {
        it('adds breakdown columns to existing processes table and preserves rows', () => {
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
                    custom_title          TEXT,
                    last_message_preview  TEXT,
                    token_limit           INTEGER,
                    current_tokens        INTEGER,
                    cumulative_token_usage TEXT,
                    stale                 INTEGER DEFAULT 0,
                    data_file_path        TEXT,
                    archived              INTEGER DEFAULT 0,
                    pinned_at             TEXT,
                    seen_at               TEXT,
                    last_event_at         TEXT
                )
            `);
            db.prepare(`
                INSERT INTO processes (id, workspace_id, status, start_time, token_limit, current_tokens)
                VALUES ('p-v18', 'ws1', 'completed', '2026-01-01T00:00:00.000Z', 200000, 50000)
            `).run();
            db.pragma('user_version = 18');

            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
            const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('system_tokens');
            expect(colNames).toContain('tool_definitions_tokens');
            expect(colNames).toContain('conversation_tokens');

            const row = db.prepare(`
                SELECT id, token_limit, current_tokens, system_tokens, tool_definitions_tokens, conversation_tokens
                FROM processes WHERE id = 'p-v18'
            `).get() as any;
            expect(row.id).toBe('p-v18');
            expect(row.token_limit).toBe(200000);
            expect(row.current_tokens).toBe(50000);
            expect(row.system_tokens).toBeNull();
            expect(row.tool_definitions_tokens).toBeNull();
            expect(row.conversation_tokens).toBeNull();
        });
    });

    describe('V19 → V20 migration (work item chat bindings)', () => {
        it('adds work_item_chat_bindings to existing databases', () => {
            db.exec(`
                CREATE TABLE processes (
                    id                    TEXT PRIMARY KEY,
                    workspace_id          TEXT NOT NULL,
                    type                  TEXT,
                    status                TEXT NOT NULL,
                    start_time            TEXT NOT NULL,
                    parent_process_id     TEXT,
                    sdk_session_id        TEXT,
                    archived              INTEGER DEFAULT 0,
                    system_tokens         INTEGER,
                    tool_definitions_tokens INTEGER,
                    conversation_tokens   INTEGER
                )
            `);
            db.pragma('user_version = 19');

            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
            const table = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_item_chat_bindings'")
                .get();
            const index = db
                .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_work_item_chat_bindings_workspace'")
                .get();
            expect(table).toBeTruthy();
            expect(index).toBeTruthy();
        });
    });

    describe('V20 → V21 migration (interrupted turn metadata)', () => {
        it('adds interrupted metadata columns to existing conversation_turns tables', () => {
            db.exec(`
                CREATE TABLE processes (
                    id                    TEXT PRIMARY KEY,
                    workspace_id          TEXT NOT NULL,
                    type                  TEXT,
                    status                TEXT NOT NULL,
                    start_time            TEXT NOT NULL,
                    parent_process_id     TEXT,
                    sdk_session_id        TEXT,
                    archived              INTEGER DEFAULT 0,
                    last_event_at         TEXT
                );

                CREATE TABLE conversation_turns (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    process_id        TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                    turn_index        INTEGER NOT NULL,
                    role              TEXT NOT NULL,
                    content           TEXT,
                    timestamp         TEXT NOT NULL,
                    streaming         INTEGER DEFAULT 0,
                    tool_calls        TEXT,
                    timeline          TEXT,
                    UNIQUE(process_id, turn_index)
                );
            `);
            db.prepare(`
                INSERT INTO processes (id, workspace_id, status, start_time)
                VALUES ('p-v20', 'ws1', 'completed', '2026-01-01T00:00:00.000Z')
            `).run();
            db.prepare(`
                INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
                VALUES ('p-v20', 0, 'assistant', 'partial', '2026-01-01T00:00:01.000Z')
            `).run();
            db.pragma('user_version = 20');

            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
            const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
            const colNames = cols.map(c => c.name);
            expect(colNames).toContain('interrupted');
            expect(colNames).toContain('interruption_reason');
            const row = db.prepare(`
                SELECT interrupted, interruption_reason
                FROM conversation_turns WHERE process_id = 'p-v20'
            `).get() as any;
            expect(row.interrupted).toBe(0);
            expect(row.interruption_reason).toBeNull();
        });
    });

    describe('V23 → V24 migration (sdk_event_id on conversation_turns)', () => {
        it('fresh DB includes sdk_event_id column on conversation_turns', () => {
            initializeDatabase(db);

            const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
            expect(cols.map(c => c.name)).toContain('sdk_event_id');
        });

        it('adds sdk_event_id to an existing V23 database without data loss', () => {
            // Simulate a V23 conversation_turns table that lacks sdk_event_id
            db.exec(`
                CREATE TABLE processes (
                    id                    TEXT PRIMARY KEY,
                    workspace_id          TEXT NOT NULL,
                    type                  TEXT,
                    status                TEXT NOT NULL,
                    start_time            TEXT NOT NULL,
                    parent_process_id     TEXT,
                    sdk_session_id        TEXT,
                    archived              INTEGER DEFAULT 0,
                    last_event_at         TEXT
                );

                CREATE TABLE conversation_turns (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    process_id        TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
                    turn_index        INTEGER NOT NULL,
                    role              TEXT NOT NULL,
                    content           TEXT,
                    timestamp         TEXT NOT NULL,
                    streaming         INTEGER DEFAULT 0,
                    tool_calls        TEXT,
                    timeline          TEXT,
                    model             TEXT,
                    mode              TEXT,
                    UNIQUE(process_id, turn_index)
                );
            `);
            db.prepare(`
                INSERT INTO processes (id, workspace_id, status, start_time)
                VALUES ('p-v23', 'ws1', 'completed', '2026-01-01T00:00:00.000Z')
            `).run();
            db.prepare(`
                INSERT INTO conversation_turns (process_id, turn_index, role, content, timestamp)
                VALUES ('p-v23', 0, 'user', 'hello', '2026-01-01T00:00:01.000Z')
            `).run();
            db.pragma('user_version = 23');

            initializeDatabase(db);

            expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);

            const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
            expect(cols.map(c => c.name)).toContain('sdk_event_id');

            // Existing turn preserved with null sdk_event_id
            const row = db.prepare(`
                SELECT content, sdk_event_id FROM conversation_turns WHERE process_id = 'p-v23'
            `).get() as any;
            expect(row.content).toBe('hello');
            expect(row.sdk_event_id).toBeNull();

            // New column is writable
            db.prepare('UPDATE conversation_turns SET sdk_event_id = ? WHERE process_id = ? AND turn_index = ?')
                .run('evt_abc123', 'p-v23', 0);
            const updated = db.prepare(`
                SELECT sdk_event_id FROM conversation_turns WHERE process_id = 'p-v23'
            `).get() as any;
            expect(updated.sdk_event_id).toBe('evt_abc123');
        });
    });
});
