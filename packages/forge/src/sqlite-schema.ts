import Database from 'better-sqlite3';

export { Database };
export type { Database as DatabaseType } from 'better-sqlite3';

export const SCHEMA_VERSION = 21;

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
                custom_title          TEXT,
                last_message_preview  TEXT,
                token_limit           INTEGER,
                current_tokens        INTEGER,
                system_tokens         INTEGER,
                tool_definitions_tokens INTEGER,
                conversation_tokens   INTEGER,
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
                interrupted       INTEGER DEFAULT 0,
                interruption_reason TEXT,
                tool_calls        TEXT,
                timeline          TEXT,
                images            TEXT,
                historical        INTEGER DEFAULT 0,
                suggestions       TEXT,
                token_usage       TEXT,
                paste_externalized INTEGER DEFAULT 0,
                deleted_at        TEXT,
                pinned_at         TEXT,
                archived          INTEGER DEFAULT 0,
                model             TEXT,
                mode              TEXT,
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
                repo_id                  TEXT PRIMARY KEY,
                is_paused                INTEGER DEFAULT 0,
                pause_reason             TEXT,
                queue_paused             INTEGER DEFAULT 0,
                queue_paused_until       INTEGER,
                autopilot_paused         INTEGER DEFAULT 0,
                autopilot_paused_until   INTEGER
            )
        `);
        ensureColumn(db, 'queue_repo_state', 'queue_paused', 'INTEGER DEFAULT 0');
        ensureColumn(db, 'queue_repo_state', 'queue_paused_until', 'INTEGER');
        ensureColumn(db, 'queue_repo_state', 'autopilot_paused', 'INTEGER DEFAULT 0');
        ensureColumn(db, 'queue_repo_state', 'autopilot_paused_until', 'INTEGER');

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

        // ── loops ────────────────────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS loops (
                id                    TEXT PRIMARY KEY,
                process_id            TEXT NOT NULL,
                description           TEXT NOT NULL DEFAULT '',
                interval_ms           INTEGER NOT NULL,
                status                TEXT NOT NULL DEFAULT 'active',
                created_at            TEXT NOT NULL,
                last_tick_at          TEXT,
                next_tick_at          TEXT,
                tick_count            INTEGER NOT NULL DEFAULT 0,
                consecutive_failures  INTEGER NOT NULL DEFAULT 0,
                expires_at            TEXT NOT NULL,
                paused_reason         TEXT,
                prompt                TEXT NOT NULL DEFAULT '',
                model                 TEXT
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

            CREATE INDEX IF NOT EXISTS idx_loops_process_id
                ON loops(process_id);

            CREATE INDEX IF NOT EXISTS idx_loops_status
                ON loops(status);
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

        // ── note_chat_bindings ───────────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS note_chat_bindings (
                workspace_id  TEXT NOT NULL,
                note_path     TEXT NOT NULL,
                task_id       TEXT NOT NULL,
                created_at    TEXT NOT NULL,
                PRIMARY KEY (workspace_id, note_path)
            )
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_note_chat_bindings_task
                ON note_chat_bindings(workspace_id, task_id);
        `);

        // ── pull_request_chat_bindings ───────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS pull_request_chat_bindings (
                workspace_id  TEXT NOT NULL,
                pr_id         TEXT NOT NULL,
                task_id       TEXT NOT NULL,
                created_at    TEXT NOT NULL,
                PRIMARY KEY (workspace_id, pr_id)
            )
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_pull_request_chat_bindings_workspace
                ON pull_request_chat_bindings(workspace_id);
        `);

        // ── work_item_chat_bindings ─────────────────────────────────
        db.exec(`
            CREATE TABLE IF NOT EXISTS work_item_chat_bindings (
                workspace_id  TEXT NOT NULL,
                work_item_id  TEXT NOT NULL,
                task_id       TEXT NOT NULL,
                created_at    TEXT NOT NULL,
                PRIMARY KEY (workspace_id, work_item_id)
            )
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_work_item_chat_bindings_workspace
                ON work_item_chat_bindings(workspace_id);
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
        if (versionBefore < 10) {
            migrateV9toV10(db);
        }
        if (versionBefore < 12) {
            migrateV11toV12(db);
        }
        if (versionBefore < 13) {
            migrateV12toV13(db);
        }
        if (versionBefore < 14) {
            migrateV13toV14(db);
        }
        if (versionBefore < 15) {
            migrateV14toV15(db);
        }
        if (versionBefore < 16) {
            migrateV15toV16(db);
        }
        if (versionBefore < 17) {
            migrateV16toV17(db);
        }
        if (versionBefore < 18) {
            migrateV17toV18(db);
        }
        if (versionBefore < 19) {
            migrateV18toV19(db);
        }
        if (versionBefore < 20) {
            migrateV19toV20(db);
        }
        if (versionBefore < 21) {
            migrateV20toV21(db);
        }

        // Stamp the schema version
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });

    migrate();
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some(existing => existing.name === column)) {
        return;
    }
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
 * V7 → V8: add `deleted_at TEXT`, `pinned_at TEXT`, `archived INTEGER DEFAULT 0`
 * columns to `conversation_turns` for per-message delete, pin, archive.
 */
function migrateV7toV8(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'deleted_at')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN deleted_at TEXT');
    }
    if (!cols.some(c => c.name === 'pinned_at')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN pinned_at TEXT');
    }
    if (!cols.some(c => c.name === 'archived')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN archived INTEGER DEFAULT 0');
    }
}

/**
 * V8 → V9: add `model TEXT` column to `conversation_turns` for model-change tracking.
 */
function migrateV8toV9(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'model')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN model TEXT');
    }
}

/**
 * V9 → V10: ensure all columns from both branches exist on `conversation_turns`.
 *
 * Databases may have been created at v8 or v9 from different code branches
 * that each added a subset of columns.  This migration idempotently adds
 * any that are still missing.
 */
function migrateV9toV10(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('deleted_at')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN deleted_at TEXT');
    }
    if (!colNames.has('pinned_at')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN pinned_at TEXT');
    }
    if (!colNames.has('archived')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN archived INTEGER DEFAULT 0');
    }
    if (!colNames.has('model')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN model TEXT');
    }
}

/**
 * V11 → V12: add `mode TEXT` column to `conversation_turns` for mode-change tracking.
 */
function migrateV11toV12(db: Database.Database): void {
    const cols = db.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'mode')) {
        db.exec('ALTER TABLE conversation_turns ADD COLUMN mode TEXT');
    }
}

/**
 * V12 → V13: add `loops` table for the loop subsystem.
 * The CREATE TABLE IF NOT EXISTS above handles fresh databases;
 * this migration is a no-op but keeps the version chain explicit.
 */
function migrateV12toV13(_db: Database.Database): void {
    // Table already created by the idempotent DDL above.
}

/**
 * V13 → V14: add `note_chat_bindings` table for the per-note chat mapping.
 * Must run AFTER migrateV6toV7 (which drops a legacy table of the same name)
 * so it cannot be relied on solely from the upfront DDL.
 */
function migrateV13toV14(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS note_chat_bindings (
            workspace_id  TEXT NOT NULL,
            note_path     TEXT NOT NULL,
            task_id       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            PRIMARY KEY (workspace_id, note_path)
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_note_chat_bindings_task
            ON note_chat_bindings(workspace_id, task_id);
    `);
}

/**
 * V14 → V15: add `pull_request_chat_bindings` table.
 * The CREATE TABLE IF NOT EXISTS above handles fresh databases;
 * this migration keeps the version chain explicit for existing DBs.
 */
function migrateV14toV15(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS pull_request_chat_bindings (
            workspace_id  TEXT NOT NULL,
            pr_id         TEXT NOT NULL,
            task_id       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            PRIMARY KEY (workspace_id, pr_id)
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pull_request_chat_bindings_workspace
            ON pull_request_chat_bindings(workspace_id);
    `);
}

/**
 * V15 → V16: add `custom_title TEXT` and `last_message_preview TEXT` columns to
 * `processes`. `custom_title` holds a user-set session name (orthogonal to the
 * AI-generated `title`). `last_message_preview` is a denormalized snapshot of
 * the most recent conversation turn's cleaned content, used as a sidebar
 * fallback label when no `custom_title` is set.
 */
function migrateV15toV16(db: Database.Database): void {
    ensureColumn(db, 'processes', 'custom_title', 'TEXT');
    ensureColumn(db, 'processes', 'last_message_preview', 'TEXT');
}

/**
 * V16 → V17: backfill `last_message_preview` from the most recent USER turn for
 * processes where the column is NULL. V16 also wrote previews from assistant
 * turns; from V17 onwards only user turns refresh the preview so the sidebar
 * always shows the latest user prompt as a fallback label.
 */
function migrateV16toV17(db: Database.Database): void {
    // Pull processes that have no preview yet but at least one user turn.
    const rows = db.prepare(`
        SELECT p.id AS pid,
               (SELECT ct.content FROM conversation_turns ct
                WHERE ct.process_id = p.id AND ct.role = 'user'
                ORDER BY ct.turn_index DESC LIMIT 1) AS content
        FROM processes p
        WHERE p.last_message_preview IS NULL
    `).all() as Array<{ pid: string; content: string | null }>;

    if (rows.length === 0) return;

    const update = db.prepare('UPDATE processes SET last_message_preview = ? WHERE id = ?');
    for (const r of rows) {
        const preview = computeMessagePreviewSync(r.content);
        if (preview !== undefined) {
            update.run(preview, r.pid);
        }
    }
}

/**
 * V17 → V18: backfill `last_event_at` from `start_time` for any legacy rows
 * where it is NULL, then create a composite index on
 * (workspace_id, status, last_event_at DESC). After backfill the hot history
 * sort can drop `COALESCE(last_event_at, start_time)` and rely on the column
 * directly, so this index satisfies both the WHERE and the ORDER BY.
 */
function migrateV17toV18(db: Database.Database): void {
    db.exec(`UPDATE processes SET last_event_at = start_time WHERE last_event_at IS NULL`);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_processes_ws_status_activity
            ON processes(workspace_id, status, last_event_at DESC)
    `);
}

/**
 * V18 -> V19: add persisted context-window breakdown columns to `processes`.
 */
function migrateV18toV19(db: Database.Database): void {
    ensureColumn(db, 'processes', 'system_tokens', 'INTEGER');
    ensureColumn(db, 'processes', 'tool_definitions_tokens', 'INTEGER');
    ensureColumn(db, 'processes', 'conversation_tokens', 'INTEGER');
}

/**
 * V19 -> V20: add `work_item_chat_bindings` table for one remembered chat per
 * workspace + work item.
 */
function migrateV19toV20(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_item_chat_bindings (
            workspace_id  TEXT NOT NULL,
            work_item_id  TEXT NOT NULL,
            task_id       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            PRIMARY KEY (workspace_id, work_item_id)
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_work_item_chat_bindings_workspace
            ON work_item_chat_bindings(workspace_id);
    `);
}

/**
 * V20 -> V21: add turn-level interruption metadata for preserved partial
 * assistant output after mid-stream failures/timeouts.
 */
function migrateV20toV21(db: Database.Database): void {
    ensureColumn(db, 'conversation_turns', 'interrupted', 'INTEGER DEFAULT 0');
    ensureColumn(db, 'conversation_turns', 'interruption_reason', 'TEXT');
}

/**
 * Local copy of computeMessagePreview kept here to avoid a circular import
 * (`sqlite-schema` is a leaf module). Behaviour must stay in sync with
 * `utils/message-preview.ts` — both strip markdown, collapse whitespace, and
 * truncate to 120 chars.
 */
function computeMessagePreviewSync(content: string | null | undefined, maxLength: number = 120): string | undefined {
    if (!content) return undefined;
    let text = content;
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(/`[^`\n]*`/g, ' ');
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length === 0) return undefined;
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trimEnd();
}
