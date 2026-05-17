/**
 * MessagingStore — SQLite persistence for WhatsApp ↔ CoC message mapping.
 *
 * Stored at {dataDir}/messaging.db. Only instantiated when messaging is enabled.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface MessageBinding {
    processId: string;
    agentId: string;
    sessionLabel: string;
    workspaceId?: string;
    waMessageId?: string;
}

export interface GlobalSession {
    processId: string;
    agentId: string;
}

export class MessagingStore {
    private db: ReturnType<typeof Database>;

    constructor(dataDir: string) {
        fs.mkdirSync(dataDir, { recursive: true });
        const dbPath = path.join(dataDir, 'messaging.db');
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.ensureTables();
    }

    /** Bind a WA message ID to a CoC process/agent. */
    bindMessage(waMessageId: string, processId: string, agentId: string, sessionLabel: string, workspaceId?: string): void {
        this.db.prepare(
            `INSERT OR REPLACE INTO wa_message_map (wa_message_id, process_id, agent_id, session_label, workspace_id) VALUES (?, ?, ?, ?, ?)`
        ).run(waMessageId, processId, agentId, sessionLabel, workspaceId ?? null);
    }

    /** Look up the CoC process for a WA message ID. */
    lookupMessage(waMessageId: string): MessageBinding | null {
        const row = this.db.prepare(
            `SELECT process_id, agent_id, session_label, workspace_id FROM wa_message_map WHERE wa_message_id = ?`
        ).get(waMessageId) as { process_id: string; agent_id: string; session_label: string; workspace_id: string | null } | undefined;
        if (!row) return null;
        return { processId: row.process_id, agentId: row.agent_id, sessionLabel: row.session_label, workspaceId: row.workspace_id ?? undefined };
    }

    /** Get the most recent WA message ID for a process (for reply threading). */
    getLastMessageId(processId: string): string | null {
        const row = this.db.prepare(
            `SELECT wa_message_id FROM wa_message_map WHERE process_id = ? ORDER BY created_at DESC LIMIT 1`
        ).get(processId) as { wa_message_id: string } | undefined;
        return row?.wa_message_id ?? null;
    }

    /** Get the global session for a WA sender. */
    getGlobalSession(senderJid: string): GlobalSession | null {
        const row = this.db.prepare(
            `SELECT process_id, agent_id FROM wa_global_sessions WHERE sender_jid = ?`
        ).get(senderJid) as { process_id: string; agent_id: string } | undefined;
        if (!row) return null;
        return { processId: row.process_id, agentId: row.agent_id };
    }

    /** Set (or update) the global session for a WA sender. */
    setGlobalSession(senderJid: string, processId: string, agentId: string): void {
        this.db.prepare(
            `INSERT OR REPLACE INTO wa_global_sessions (sender_jid, process_id, agent_id) VALUES (?, ?, ?)`
        ).run(senderJid, processId, agentId);
    }

    /** Close the database. */
    close(): void {
        this.db.close();
    }

    private ensureTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS wa_message_map (
                wa_message_id   TEXT PRIMARY KEY,
                process_id      TEXT NOT NULL,
                agent_id        TEXT NOT NULL,
                session_label   TEXT NOT NULL,
                workspace_id    TEXT,
                created_at      INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS wa_global_sessions (
                sender_jid      TEXT PRIMARY KEY,
                process_id      TEXT NOT NULL,
                agent_id        TEXT NOT NULL,
                created_at      INTEGER NOT NULL DEFAULT (unixepoch())
            );
        `);
        // Migration: add workspace_id if table already exists without it
        try {
            this.db.exec(`ALTER TABLE wa_message_map ADD COLUMN workspace_id TEXT`);
        } catch { /* column already exists */ }
    }
}
