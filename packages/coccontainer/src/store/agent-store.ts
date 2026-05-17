/**
 * Agent Store
 *
 * SQLite-backed registry for CoC agent addresses.
 * Stored at ~/.coccontainer/agents.db
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

export interface Agent {
    id: string;
    name: string;
    address: string;
    tunnelId?: string;
    status: 'online' | 'offline' | 'unknown';
    lastSeenAt: string | null;
    createdAt: string;
}

export interface AgentStore {
    add(address: string, name?: string, tunnelId?: string): Agent;
    remove(idOrName: string): boolean;
    rename(id: string, newName: string): Agent | undefined;
    update(id: string, fields: { name?: string; address?: string; tunnelId?: string | null }): Agent | undefined;
    list(): Agent[];
    get(idOrName: string): Agent | undefined;
    updateStatus(id: string, status: Agent['status']): void;
    close(): void;
}

export function createAgentStore(dataDir: string): AgentStore {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'agents.db');
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL UNIQUE,
            tunnel_id TEXT,
            status TEXT NOT NULL DEFAULT 'unknown',
            last_seen_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    // Migration: add tunnel_id column for existing databases
    const cols = db.pragma('table_info(agents)') as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'tunnel_id')) {
        db.exec(`ALTER TABLE agents ADD COLUMN tunnel_id TEXT`);
    }

    const insertStmt = db.prepare(
        `INSERT INTO agents (id, name, address, tunnel_id) VALUES (?, ?, ?, ?)`
    );
    const deleteByIdStmt = db.prepare(`DELETE FROM agents WHERE id = ?`);
    const deleteByNameStmt = db.prepare(`DELETE FROM agents WHERE name = ?`);
    const selectAllStmt = db.prepare(`SELECT * FROM agents ORDER BY created_at`);
    const selectByIdStmt = db.prepare(`SELECT * FROM agents WHERE id = ?`);
    const selectByNameStmt = db.prepare(`SELECT * FROM agents WHERE name = ?`);
    const selectByAddressStmt = db.prepare(`SELECT * FROM agents WHERE address = ?`);
    const updateStatusStmt = db.prepare(
        `UPDATE agents SET status = ?, last_seen_at = CASE WHEN ? = 'online' THEN datetime('now') ELSE last_seen_at END WHERE id = ?`
    );
    const renameStmt = db.prepare(`UPDATE agents SET name = ? WHERE id = ?`);

    function toAgent(row: Record<string, unknown>): Agent {
        return {
            id: row.id as string,
            name: row.name as string,
            address: row.address as string,
            tunnelId: (row.tunnel_id as string) || undefined,
            status: row.status as Agent['status'],
            lastSeenAt: row.last_seen_at as string | null,
            createdAt: row.created_at as string,
        };
    }

    return {
        add(address: string, name?: string, tunnelId?: string): Agent {
            // Normalize address: strip trailing slash
            const normalizedAddress = address.replace(/\/+$/, '');

            // Check for duplicate address
            const existing = selectByAddressStmt.get(normalizedAddress) as Record<string, unknown> | undefined;
            if (existing) {
                throw new Error(`Agent with address '${normalizedAddress}' already registered (id: ${existing.id})`);
            }

            const id = randomUUID();
            const agentName = name ?? new URL(normalizedAddress).host;
            insertStmt.run(id, agentName, normalizedAddress, tunnelId || null);
            return toAgent(selectByIdStmt.get(id) as Record<string, unknown>);
        },

        remove(idOrName: string): boolean {
            let result = deleteByIdStmt.run(idOrName);
            if (result.changes === 0) {
                result = deleteByNameStmt.run(idOrName);
            }
            return result.changes > 0;
        },

        rename(id: string, newName: string): Agent | undefined {
            renameStmt.run(newName, id);
            const row = selectByIdStmt.get(id) as Record<string, unknown> | undefined;
            return row ? toAgent(row) : undefined;
        },

        update(id: string, fields: { name?: string; address?: string; tunnelId?: string | null }): Agent | undefined {
            const current = selectByIdStmt.get(id) as Record<string, unknown> | undefined;
            if (!current) return undefined;
            const newName = fields.name ?? current.name as string;
            const newAddress = fields.address ?? current.address as string;
            const newTunnelId = fields.tunnelId === undefined ? current.tunnel_id as string | null : fields.tunnelId;
            db.prepare(`UPDATE agents SET name = ?, address = ?, tunnel_id = ? WHERE id = ?`)
                .run(newName, newAddress, newTunnelId, id);
            return toAgent(selectByIdStmt.get(id) as Record<string, unknown>);
        },

        list(): Agent[] {
            return (selectAllStmt.all() as Record<string, unknown>[]).map(toAgent);
        },

        get(idOrName: string): Agent | undefined {
            const row = (selectByIdStmt.get(idOrName) ?? selectByNameStmt.get(idOrName)) as Record<string, unknown> | undefined;
            return row ? toAgent(row) : undefined;
        },

        updateStatus(id: string, status: Agent['status']): void {
            updateStatusStmt.run(status, status, id);
        },

        close(): void {
            db.close();
        },
    };
}
