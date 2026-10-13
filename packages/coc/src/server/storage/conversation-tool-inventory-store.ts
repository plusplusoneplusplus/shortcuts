import { randomUUID } from 'node:crypto';
import type { NativeDatabase, NativeStatement } from '@plusplusoneplusplus/coc-native';
import {
    createRuntimeToolInventory,
    type RuntimeToolInventory,
    type ToolInventoryCategory,
    type ToolInventoryDescriptor,
    type ToolInventorySource,
} from '@plusplusoneplusplus/coc-agent-sdk';

const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const SOURCES: readonly ToolInventorySource[] = ['builtin', 'coc', 'mcp'];
const PROVIDERS = new Set(['copilot', 'codex', 'claude', 'opencode']);

export interface ConversationToolInventoryTurn {
    readonly workspaceId: string;
    readonly processId: string;
    readonly turnId: string;
    readonly turnIndex: number;
    readonly provider: string;
    readonly startedAt: string;
}

export type ConversationToolInventory =
    | { state: 'unavailable' }
    | { state: 'pending'; turn: ConversationToolInventoryTurn }
    | { state: 'captured'; turn: ConversationToolInventoryTurn; snapshot: RuntimeToolInventory };

interface InventoryRow {
    turn_id: string;
    turn_index: number;
    provider: string;
    started_at: string;
    snapshot: string | null;
    snapshot_bytes: number | null;
}

/** Lazy, latest-turn-only storage outside process metadata, transcripts and SSE. */
export class ConversationToolInventoryStore {
    private readonly begin: NativeStatement;
    private readonly capture: NativeStatement;
    private readonly read: NativeStatement;

    constructor(db: NativeDatabase) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS conversation_tool_inventory (
                process_id TEXT PRIMARY KEY REFERENCES processes(id) ON DELETE CASCADE,
                turn_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                provider TEXT NOT NULL,
                started_at TEXT NOT NULL,
                snapshot TEXT
            )
        `);
        // Ownership follows the process row, including workspace ID re-keying.
        this.begin = db.prepare(`
            INSERT INTO conversation_tool_inventory
                (process_id, turn_id, turn_index, provider, started_at, snapshot)
            SELECT id, @turnId, @turnIndex, @provider, @startedAt, NULL
            FROM processes WHERE id = @processId AND workspace_id = @workspaceId
            ON CONFLICT(process_id) DO UPDATE SET
                turn_id = excluded.turn_id, turn_index = excluded.turn_index,
                provider = excluded.provider, started_at = excluded.started_at, snapshot = NULL
        `);
        this.capture = db.prepare(`
            UPDATE conversation_tool_inventory SET snapshot = @snapshot
            WHERE process_id = @processId AND turn_id = @turnId AND provider = @provider
                AND snapshot IS NULL
                AND EXISTS (
                    SELECT 1 FROM processes
                    WHERE id = @processId AND workspace_id = @workspaceId
                )
        `);
        this.read = db.prepare(`
            SELECT i.turn_id, i.turn_index, i.provider, i.started_at,
                CASE WHEN length(CAST(i.snapshot AS BLOB)) <= ${MAX_SNAPSHOT_BYTES}
                    THEN i.snapshot ELSE NULL END AS snapshot,
                length(CAST(i.snapshot AS BLOB)) AS snapshot_bytes
            FROM conversation_tool_inventory i JOIN processes p ON p.id = i.process_id
            WHERE p.id = ? AND p.workspace_id = ?
        `);
    }

    /** Call before provider initialization; committing pending revokes the preceding turn. */
    beginTurn(
        workspaceId: string, processId: string, provider: string, turnIndex: number,
    ): ConversationToolInventoryTurn {
        if (!workspaceId || !processId || !PROVIDERS.has(provider)
            || !Number.isSafeInteger(turnIndex) || turnIndex < 0) {
            throw new Error('Invalid conversation tool inventory turn');
        }
        const turn = Object.freeze({
            workspaceId, processId, provider, turnIndex,
            turnId: randomUUID(), startedAt: new Date().toISOString(),
        });
        if (this.begin.run({ ...turn }).changes !== 1) {
            throw new Error('Conversation tool inventory owner not found');
        }
        return turn;
    }

    /** False means a superseded, deleted, wrong-owner or already captured turn. */
    record(turn: ConversationToolInventoryTurn, inventory: RuntimeToolInventory): boolean {
        const snapshot = sanitizeSnapshot(inventory);
        if (snapshot.provider !== turn.provider) {
            throw new Error('Conversation tool inventory provider mismatch');
        }
        return this.capture.run({
            processId: turn.processId, workspaceId: turn.workspaceId,
            turnId: turn.turnId, provider: turn.provider, snapshot: JSON.stringify(snapshot),
        }).changes === 1;
    }

    get(workspaceId: string, processId: string): ConversationToolInventory {
        const row = this.read.get(processId, workspaceId) as InventoryRow | undefined;
        if (!row) return { state: 'unavailable' };
        if (row.snapshot_bytes !== null && row.snapshot_bytes > MAX_SNAPSHOT_BYTES) {
            throw new Error('Stored conversation tool inventory exceeds safety limits');
        }
        const turn: ConversationToolInventoryTurn = {
            workspaceId, processId, turnId: row.turn_id, turnIndex: row.turn_index,
            provider: row.provider, startedAt: row.started_at,
        };
        if (row.snapshot === null) return { state: 'pending', turn };
        const snapshot = sanitizeSnapshot(JSON.parse(row.snapshot));
        if (snapshot.provider !== turn.provider) {
            throw new Error('Stored conversation tool inventory provider mismatch');
        }
        return { state: 'captured', turn, snapshot };
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSource(value: unknown): value is ToolInventorySource {
    return value === 'builtin' || value === 'coc' || value === 'mcp';
}

/** Validate metadata and reuse the SDK's safe, bounded descriptor projection. */
function sanitizeSnapshot(value: unknown): RuntimeToolInventory {
    if (!isRecord(value) || value.version !== 1
        || typeof value.provider !== 'string' || !PROVIDERS.has(value.provider)
        || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt))
        || value.capturedAt.length > 64 || typeof value.truncated !== 'boolean'
        || !Array.isArray(value.tools) || value.tools.length > 10000 || !Array.isArray(value.categories)
        || value.categories.length !== SOURCES.length) {
        throw new Error('Invalid conversation tool inventory snapshot');
    }
    const categories: ToolInventoryCategory[] = value.categories.map(category => {
        if (!isRecord(category) || !isSource(category.source)
            || (category.status !== 'complete' && category.status !== 'partial' && category.status !== 'unavailable')
            || (category.reason !== undefined && (typeof category.reason !== 'string' || category.reason.length > 2048))) {
            throw new Error('Invalid conversation tool inventory category');
        }
        return {
            source: category.source, status: category.status,
            ...(typeof category.reason === 'string' ? { reason: category.reason } : {}),
        };
    });
    if (new Set(categories.map(category => category.source)).size !== SOURCES.length
        || (value.truncated && categories.every(category => category.status === 'complete'))) {
        throw new Error('Invalid conversation tool inventory completeness');
    }
    const descriptors: ToolInventoryDescriptor[] = value.tools.map(tool => {
        if (!isRecord(tool) || !isSource(tool.source) || typeof tool.name !== 'string'
            || (tool.description !== undefined && typeof tool.description !== 'string')
            || (tool.source === 'mcp' && typeof tool.serverName !== 'string')
            || (tool.inputSchema !== undefined && typeof tool.inputSchema !== 'boolean' && !isRecord(tool.inputSchema))) {
            throw new Error('Invalid conversation tool inventory descriptor');
        }
        return {
            name: tool.name, source: tool.source,
            ...(tool.source === 'mcp' && typeof tool.serverName === 'string' ? { serverName: tool.serverName } : {}),
            ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
            ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        };
    });
    const snapshot = createRuntimeToolInventory(value.provider, descriptors, categories);
    snapshot.capturedAt = value.capturedAt;
    snapshot.truncated ||= value.truncated;
    if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES) {
        throw new Error('Conversation tool inventory exceeds safety limits');
    }
    return snapshot;
}
