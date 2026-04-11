import Database from 'better-sqlite3';

export { Database };
export type { Database as DatabaseType } from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

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
 */
export function initializeDatabase(db: Database.Database): void {
    // PRAGMAs must run outside the transaction
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

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
                archived              INTEGER DEFAULT 0
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
        `);

        // Stamp the schema version
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });

    migrate();
}
