/**
 * Container Session Store
 *
 * SQLite-backed persistence for container sessions. Stores session metadata
 * and turns with per-turn routing decisions. Uses an in-process SQLite
 * database (same pattern as LoopStore).
 */

import type Database from 'better-sqlite3';
import type {
    ContainerSession,
    ContainerSessionTurn,
    ContainerSessionStatus,
    RoutingDecision,
} from './container-session-types';

// ============================================================================
// Schema
// ============================================================================

const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS container_sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    routing_override_agent_id TEXT,
    routing_override_workspace_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)`;

const CREATE_TURNS_TABLE = `
CREATE TABLE IF NOT EXISTS container_session_turns (
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    routing_agent_id TEXT NOT NULL,
    routing_workspace_id TEXT NOT NULL,
    routing_confidence REAL NOT NULL DEFAULT 1.0,
    routing_reason TEXT NOT NULL DEFAULT '',
    downstream_process_id TEXT,
    timestamp TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_index),
    FOREIGN KEY (session_id) REFERENCES container_sessions(id) ON DELETE CASCADE
)`;

// ============================================================================
// Store
// ============================================================================

export class ContainerSessionStore {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.db.exec(CREATE_SESSIONS_TABLE);
        this.db.exec(CREATE_TURNS_TABLE);
    }

    /** Create a new container session. */
    create(id: string): ContainerSession {
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO container_sessions (id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)`,
        ).run(id, now, now);
        return { id, status: 'active', routingOverride: null, createdAt: now, updatedAt: now, turns: [] };
    }

    /** Get a session by ID (with all turns). Returns null if not found. */
    get(id: string): ContainerSession | null {
        const row = this.db.prepare(`SELECT * FROM container_sessions WHERE id = ?`).get(id) as any;
        if (!row) return null;
        const turns = this.getTurns(id);
        return {
            id: row.id,
            status: row.status as ContainerSessionStatus,
            routingOverride: row.routing_override_agent_id
                ? { agentId: row.routing_override_agent_id, workspaceId: row.routing_override_workspace_id }
                : null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            turns,
        };
    }

    /** List sessions ordered by most recent activity. */
    list(limit = 50, offset = 0): ContainerSession[] {
        const rows = this.db.prepare(
            `SELECT * FROM container_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        ).all(limit, offset) as any[];
        return rows.map(row => ({
            id: row.id,
            status: row.status as ContainerSessionStatus,
            routingOverride: row.routing_override_agent_id
                ? { agentId: row.routing_override_agent_id, workspaceId: row.routing_override_workspace_id }
                : null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            turns: [], // turns loaded lazily
        }));
    }

    /** Add a turn to a session. */
    addTurn(sessionId: string, turn: ContainerSessionTurn): void {
        this.db.prepare(
            `INSERT INTO container_session_turns
             (session_id, turn_index, role, content, routing_agent_id, routing_workspace_id, routing_confidence, routing_reason, downstream_process_id, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            sessionId,
            turn.index,
            turn.role,
            turn.content,
            turn.routing.agentId,
            turn.routing.workspaceId,
            turn.routing.confidence,
            turn.routing.reason,
            turn.downstreamProcessId,
            turn.timestamp,
        );
        this.db.prepare(`UPDATE container_sessions SET updated_at = ? WHERE id = ?`).run(turn.timestamp, sessionId);
    }

    /** Update the downstream process ID for a turn. */
    updateTurnProcessId(sessionId: string, turnIndex: number, processId: string): void {
        this.db.prepare(
            `UPDATE container_session_turns SET downstream_process_id = ? WHERE session_id = ? AND turn_index = ?`,
        ).run(processId, sessionId, turnIndex);
    }

    /** Set or clear the routing override for a session. */
    setRoutingOverride(sessionId: string, override: { agentId: string; workspaceId: string } | null): void {
        const now = new Date().toISOString();
        if (override) {
            this.db.prepare(
                `UPDATE container_sessions SET routing_override_agent_id = ?, routing_override_workspace_id = ?, updated_at = ? WHERE id = ?`,
            ).run(override.agentId, override.workspaceId, now, sessionId);
        } else {
            this.db.prepare(
                `UPDATE container_sessions SET routing_override_agent_id = NULL, routing_override_workspace_id = NULL, updated_at = ? WHERE id = ?`,
            ).run(now, sessionId);
        }
    }

    /** Close a session. */
    close(sessionId: string): void {
        const now = new Date().toISOString();
        this.db.prepare(`UPDATE container_sessions SET status = 'closed', updated_at = ? WHERE id = ?`).run(now, sessionId);
    }

    /** Delete a session and all its turns. */
    delete(sessionId: string): boolean {
        const result = this.db.prepare(`DELETE FROM container_sessions WHERE id = ?`).run(sessionId);
        this.db.prepare(`DELETE FROM container_session_turns WHERE session_id = ?`).run(sessionId);
        return result.changes > 0;
    }

    /** Get the turn count for a session. */
    turnCount(sessionId: string): number {
        const row = this.db.prepare(
            `SELECT COUNT(*) as cnt FROM container_session_turns WHERE session_id = ?`,
        ).get(sessionId) as any;
        return row?.cnt ?? 0;
    }

    // ── Private ─────────────────────────────────────────────────────────────

    private getTurns(sessionId: string): ContainerSessionTurn[] {
        const rows = this.db.prepare(
            `SELECT * FROM container_session_turns WHERE session_id = ? ORDER BY turn_index ASC`,
        ).all(sessionId) as any[];
        return rows.map(row => ({
            index: row.turn_index,
            role: row.role,
            content: row.content,
            routing: {
                agentId: row.routing_agent_id,
                workspaceId: row.routing_workspace_id,
                confidence: row.routing_confidence,
                reason: row.routing_reason,
            },
            downstreamProcessId: row.downstream_process_id,
            timestamp: row.timestamp,
        }));
    }
}
