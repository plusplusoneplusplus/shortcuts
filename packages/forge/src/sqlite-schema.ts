import Database from 'better-sqlite3';

export { Database };
export type { Database as DatabaseType } from 'better-sqlite3';

export const SCHEMA_VERSION = 9;

/**
 * Read the current schema version from the database.
 */
export function getSchemaVersion(db: Database.Database): number {
    const row = db.pragma('user_version', { simple: true });
    return row as number;
}

/**
 * Run all PRAGMAs, CREATE TABLE, and CREATE INDEX statements inside a
 * transaction.  Every statement uses IF NOT EXISTS so the function is
 * idempotent — safe to call on an already-initialised database.
 *
 * For existing databases, incremental migrations are applied after the
 * idempotent schema creation, then the version is stamped.
 */
export function initializeDatabase(db: Database.Database): void {
    // PRAGMAs must run outside the transaction
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const versionBefore = getSchemaVersion(db);

    const migrate = db.transaction(() => {
        // ── processes ────────────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS processes (
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
                pinned_at             TEXT,
                seen_at               TEXT,
                last_event_at         TEXT
            )
        `);

        // ── conversation_turns ───────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS conversation_turns (
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
                model             TEXT,
                UNIQUE(process_id, turn_index)
            )
        `);

        // ── workspaces ───────────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS workspaces (
                id                   TEXT PRIMARY KEY,
                name                 TEXT NOT NULL,
                root_path            TEXT NOT NULL,
                color                TEXT,
                remote_url           TEXT,
                description          TEXT,
                enabled_mcp_servers  TEXT,
                disabled_skills      TEXT,
                extra_skill_folders  TEXT,
                virtual              INTEGER DEFAULT 0
            )
        `);

        // ── wikis ────────────────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS wikis (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                wiki_dir      TEXT NOT NULL,
                repo_path     TEXT,
                color         TEXT,
                ai_enabled    INTEGER NOT NULL DEFAULT 1,
                registered_at TEXT NOT NULL
            )
        `);

        // ── queue_tasks ──────────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS queue_tasks (
                id                TEXT PRIMARY KEY,
                repo_id           TEXT NOT NULL,
                folder_path       TEXT,
                type              TEXT NOT NULL,
                priority          TEXT NOT NULL DEFAULT 'normal',
                status            TEXT NOT NULL DEFAULT 'queued',
                created_at        INTEGER NOT NULL,
                started_at        INTEGER,
                completed_at      INTEGER,
                display_name      TEXT,
                process_id        TEXT,
                error             TEXT,
                retry_count       INTEGER DEFAULT 0,
                concurrency_mode  TEXT,
                frozen            INTEGER DEFAULT 0,
                admitted          INTEGER DEFAULT 0,
                payload           TEXT NOT NULL DEFAULT '{}',
                config            TEXT NOT NULL DEFAULT '{}',
                result            TEXT
            )
        `);

        // ── queue_repo_state ────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS queue_repo_state (
                repo_id       TEXT PRIMARY KEY,
                is_paused     INTEGER DEFAULT 0,
                pause_reason  TEXT
            )
        `);

        // ── schedule_runs ────────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS schedule_runs (
                id            TEXT PRIMARY KEY,
                schedule_id   TEXT NOT NULL,
                repo_id       TEXT NOT NULL,
                started_at    TEXT NOT NULL,
                completed_at  TEXT,
                status        TEXT NOT NULL,
                error         TEXT,
                duration_ms   INTEGER,
                process_id    TEXT,
                task_id       TEXT
            )
        `);

        // ── FTS5 full-text search index on conversation_turns ────────
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search
            USING fts5(
                content,
                tokenize='unicode61 remove_diacritics 2'
            )
        `);

        db.exec(`
            CREATE TRIGGER IF NOT EXISTS conversation_search_ai
            AFTER INSERT ON conversation_turns BEGIN
                INSERT INTO conversation_search(rowid, content)
                VALUES (new.id, new.content);
            END
        `);

        db.exec(`
            CREATE TRIGGER IF NOT EXISTS conversation_search_ad
            AFTER DELETE ON conversation_turns BEGIN
                DELETE FROM conversation_search WHERE rowid = old.id;
            END
        `);

        db.exec(`
            CREATE TRIGGER IF NOT EXISTS conversation_search_au
            AFTER UPDATE OF content ON conversation_turns BEGIN
                DELETE FROM conversation_search WHERE rowid = old.id;
                INSERT INTO conversation_search(rowid, content)
                VALUES (new.id, new.content);
            END
        `);

        // ── indexes ──────────────────────────────────────────────────
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_processes_workspace_id
                ON processes(workspace_id);

            CREATE INDEX IF NOT EXISTS idx_processes_status
                ON processes(status);

            CREATE INDEX IF NOT EXISTS idx_processes_type
                ON processes(type);

            CREATE INDEX IF NOT EXISTS idx_processes_start_time
                ON processes(start_time);

            CREATE INDEX IF NOT EXISTS idx_processes_parent
                ON processes(parent_process_id);

            CREATE INDEX IF NOT EXISTS idx_processes_sdk_session
                ON processes(sdk_session_id);

            CREATE INDEX IF NOT EXISTS idx_processes_active
                ON processes(archived, status, start_time)
                WHERE archived = 0;

            CREATE INDEX IF NOT EXISTS idx_turns_process_id
                ON conversation_turns(process_id, turn_index);

            CREATE INDEX IF NOT EXISTS idx_turns_streaming
                ON conversation_turns(process_id)
                WHERE streaming = 1;

            CREATE INDEX IF NOT EXISTS idx_queue_tasks_repo_id
                ON queue_tasks(repo_id);

            CREATE INDEX IF NOT EXISTS idx_queue_tasks_status
                ON queue_tasks(status);

            CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_id
                ON schedule_runs(schedule_id);

            CREATE INDEX IF NOT EXISTS idx_schedule_runs_repo_id
                ON schedule_runs(repo_id);

            CREATE INDEX IF NOT EXISTS idx_schedule_runs_status
                ON schedule_runs(status);
        `);

        // ── commit_chat_bindings ─────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS commit_chat_bindings (
                workspace_id  TEXT NOT NULL,
                commit_hash   TEXT NOT NULL,
                task_id       TEXT NOT NULL,
                created_at    TEXT NOT NULL,
                PRIMARY KEY (workspace_id, commit_hash)
            )
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_commit_chat_bindings_workspace
                ON commit_chat_bindings(workspace_id);
        `);

        // ── incremental migrations for existing databases ───────────
        // Guards use only `versionBefore < N` (not `>= 1`) so that
        // databases at version 0 with pre-existing tables still get
        // columns added by later migrations.  Every migration is
        // idempotent (checks column/table existence before ALTER).
        if (versionBefore < 2) {
            migrateV1toV2(db);
        }
        if (versionBefore < 3) {
            migrateV2toV3(db);
        }
        if (versionBefore < 4) {
            migrateV3toV4(db);
        }
        if (versionBefore < 5) {
            migrateV4toV5(db);
        }
        if (versionBefore < 6) {
            migrateV5toV6(db);
        }
        if (versionBefore < 7) {
            migrateV6toV7(db);
        }
        if (versionBefore < 8) {
            migrateV7toV8(db);
        }
        if (versionBefore < 9) {
            migrateV8toV9(db);
        }

        // Stamp the schema version
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });

    migrate();
}

/**
 * V1 → V2: add `seen_at TEXT` column to `processes`.
 */
function migrateV1toV2(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'seen_at')) {
        db.exec('ALTER TABLE processes ADD COLUMN seen_at TEXT');
    }
}

/**
 * V2 → V3: add `commit_chat_bindings` table.
 * The CREATE TABLE IF NOT EXISTS above handles fresh databases;
 * this migration is a no-op but keeps the version chain explicit.
 */
function migrateV2toV3(_db: Database.Database): void {
    // Table already created by the idempotent DDL above.
}

/**
 * V3 → V4: add `last_event_at TEXT` column to `processes`.
 */
function migrateV3toV4(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'last_event_at')) {
        db.exec('ALTER TABLE processes ADD COLUMN last_event_at TEXT');
    }
}

/**
 * V4 → V5: add FTS5 `conversation_search` index with triggers.
 * The CREATE VIRTUAL TABLE + triggers use IF NOT EXISTS above,
 * so this migration only needs to backfill existing data.
 */
function migrateV4toV5(db: Database.Database): void {
    const turnsCount = (db.prepare('SELECT COUNT(*) as cnt FROM conversation_turns').get() as any).cnt;
    if (turnsCount === 0) return;

    const ftsCount = (db.prepare('SELECT COUNT(*) as cnt FROM conversation_search').get() as any).cnt;
    if (ftsCount > 0) return;

    db.exec('INSERT INTO conversation_search(rowid, content) SELECT id, content FROM conversation_turns');
}

/**
 * V5 → V6: add `pinned_at TEXT` column to `processes`.
 */
function migrateV5toV6(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(processes)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'pinned_at')) {
        db.exec('ALTER TABLE processes ADD COLUMN pinned_at TEXT');
    }
}

/**
 * V6 → V7: drop `note_chat_bindings` table (replaced by localStorage-based single-chat model).
 */
function migrateV6toV7(db: Database.Database): void {
    db.exec('DROP TABLE IF EXISTS note_chat_bindings');
}

/**
 * V7 → V8: add `model TEXT` column to `conversation_turns` for model-change tracking.
 */
function migrateV7toV8(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'model')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN model TEXT');
    }
}

/**
 * V8 → V9: ensure `model TEXT` column exists on `conversation_turns`.
 *
 * Some v8 databases were created from a different code branch whose v8
 * schema did not include the `model` column.  This migration is
 * idempotent — it only adds the column when missing.
 */
function migrateV8toV9(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'model')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN model TEXT');
    }
}
