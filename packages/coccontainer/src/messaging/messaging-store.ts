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

export interface ProcessSender {
    senderAadId: string;
    senderName: string;
}

export class MessagingStore {
    private db: ReturnType<typeof Database>;

    // In-memory LRU cache for recent message bindings (avoids SQLite lookups)
    private static readonly CACHE_MAX = 50;
    private _cache: Map<string, MessageBinding> = new Map();

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

        // Update LRU cache
        const binding: MessageBinding = { processId, agentId, sessionLabel, workspaceId };
        this._cache.delete(waMessageId);
        this._cache.set(waMessageId, binding);
        if (this._cache.size > MessagingStore.CACHE_MAX) {
            // Evict oldest entry (first key in Map iteration order)
            const oldest = this._cache.keys().next().value!;
            this._cache.delete(oldest);
        }
    }

    /** Look up the CoC process for a WA message ID. Cache-first, then SQLite. */
    lookupMessage(waMessageId: string): MessageBinding | null {
        // Check in-memory cache first
        const cached = this._cache.get(waMessageId);
        if (cached) {
            // Move to end (most recently accessed)
            this._cache.delete(waMessageId);
            this._cache.set(waMessageId, cached);
            return cached;
        }

        // Fall back to SQLite
        const row = this.db.prepare(
            `SELECT process_id, agent_id, session_label, workspace_id FROM wa_message_map WHERE wa_message_id = ?`
        ).get(waMessageId) as { process_id: string; agent_id: string; session_label: string; workspace_id: string | null } | undefined;
        if (!row) return null;
        const binding: MessageBinding = { processId: row.process_id, agentId: row.agent_id, sessionLabel: row.session_label, workspaceId: row.workspace_id ?? undefined };

        // Populate cache with this lookup result
        this._cache.set(waMessageId, binding);
        if (this._cache.size > MessagingStore.CACHE_MAX) {
            const oldest = this._cache.keys().next().value!;
            this._cache.delete(oldest);
        }
        return binding;
    }

    /** Get the most recent WA message ID for a process (for reply threading). */
    getLastMessageId(processId: string): string | null {
        const row = this.db.prepare(
            `SELECT wa_message_id FROM wa_message_map WHERE process_id = ? ORDER BY created_at DESC LIMIT 1`
        ).get(processId) as { wa_message_id: string } | undefined;
        return row?.wa_message_id ?? null;
    }

    /** Get the most recently active session (last outbound message). */
    getLastActiveSession(): MessageBinding | null {
        const row = this.db.prepare(
            `SELECT wa_message_id, process_id, agent_id, session_label, workspace_id FROM wa_message_map ORDER BY created_at DESC LIMIT 1`
        ).get() as { wa_message_id: string; process_id: string; agent_id: string; session_label: string; workspace_id: string | null } | undefined;
        if (!row) return null;
        return {
            processId: row.process_id,
            agentId: row.agent_id,
            sessionLabel: row.session_label,
            workspaceId: row.workspace_id ?? undefined,
            waMessageId: row.wa_message_id,
        };
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

    /** Store the sender info for a process (for @mentions on outbound). */
    setProcessSender(processId: string, senderAadId: string, senderName: string): void {
        this.db.prepare(
            `INSERT OR REPLACE INTO process_senders (process_id, sender_aad_id, sender_name) VALUES (?, ?, ?)`
        ).run(processId, senderAadId, senderName);
    }

    /** Get the sender info for a process. */
    getProcessSender(processId: string): ProcessSender | null {
        const row = this.db.prepare(
            `SELECT sender_aad_id, sender_name FROM process_senders WHERE process_id = ?`
        ).get(processId) as { sender_aad_id: string; sender_name: string } | undefined;
        if (!row) return null;
        return { senderAadId: row.sender_aad_id, senderName: row.sender_name };
    }

    /** Get the last pushed turn index for a process (0 = nothing pushed yet). */
    getWatermark(processId: string): number {
        const row = this.db.prepare(
            `SELECT last_turn_index FROM wa_push_watermarks WHERE process_id = ?`
        ).get(processId) as { last_turn_index: number } | undefined;
        return row?.last_turn_index ?? 0;
    }

    /** Update the last pushed turn index for a process. */
    setWatermark(processId: string, lastTurnIndex: number): void {
        this.db.prepare(
            `INSERT OR REPLACE INTO wa_push_watermarks (process_id, last_turn_index, updated_at) VALUES (?, ?, unixepoch())`
        ).run(processId, lastTurnIndex);
    }

    /** Get distinct recent processes for a given agent (last 1 hour by default). */
    getRecentProcesses(agentId: string, maxAgeSec: number = 3600): Array<{ processId: string; workspaceId?: string }> {
        const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
        const rows = this.db.prepare(
            `SELECT DISTINCT process_id, workspace_id FROM wa_message_map
             WHERE agent_id = ? AND created_at >= ?
             ORDER BY created_at DESC`
        ).all(agentId, cutoff) as Array<{ process_id: string; workspace_id: string | null }>;
        return rows.map(r => ({ processId: r.process_id, workspaceId: r.workspace_id ?? undefined }));
    }

    /** Check if a completion was already sent for a process. */
    isCompletionSent(processId: string): boolean {
        const row = this.db.prepare(
            `SELECT completion_sent FROM teams_completion_state WHERE process_id = ?`
        ).get(processId) as { completion_sent: number } | undefined;
        return row?.completion_sent === 1;
    }

    /** Mark a process completion as sent. */
    markCompletionSent(processId: string): void {
        this.db.prepare(
            `INSERT INTO teams_completion_state (process_id, completion_sent, updated_at) VALUES (?, 1, unixepoch())
             ON CONFLICT(process_id) DO UPDATE SET completion_sent = 1, updated_at = unixepoch()`
        ).run(processId);
    }

    /** Get the persisted user turn count for a process. */
    getUserTurnCount(processId: string): number {
        const row = this.db.prepare(
            `SELECT user_turn_count FROM teams_completion_state WHERE process_id = ?`
        ).get(processId) as { user_turn_count: number } | undefined;
        return row?.user_turn_count ?? 0;
    }

    /** Update the persisted user turn count for a process. Resets completion_sent on new turns. */
    setUserTurnCount(processId: string, count: number): void {
        this.db.prepare(
            `INSERT INTO teams_completion_state (process_id, user_turn_count, completion_sent, updated_at) VALUES (?, ?, 0, unixepoch())
             ON CONFLICT(process_id) DO UPDATE SET user_turn_count = ?, completion_sent = 0, updated_at = unixepoch()`
        ).run(processId, count, count);
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

            CREATE TABLE IF NOT EXISTS wa_push_watermarks (
                process_id      TEXT PRIMARY KEY,
                last_turn_index INTEGER NOT NULL DEFAULT 0,
                updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS process_senders (
                process_id      TEXT PRIMARY KEY,
                sender_aad_id   TEXT NOT NULL,
                sender_name     TEXT NOT NULL,
                created_at      INTEGER NOT NULL DEFAULT (unixepoch())
            );

            CREATE TABLE IF NOT EXISTS teams_completion_state (
                process_id      TEXT PRIMARY KEY,
                completion_sent INTEGER NOT NULL DEFAULT 0,
                user_turn_count INTEGER NOT NULL DEFAULT 0,
                updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
            );
        `);
        // Migration: add workspace_id if table already exists without it
        try {
            this.db.exec(`ALTER TABLE wa_message_map ADD COLUMN workspace_id TEXT`);
        } catch { /* column already exists */ }
    }
}
