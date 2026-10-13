import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import {
    createRuntimeToolInventory, unavailableToolInventory,
    type RuntimeToolInventory, type ToolInventoryCategory,
} from '@plusplusoneplusplus/coc-agent-sdk';
import { ConversationToolInventoryStore } from '../../../src/server/storage/conversation-tool-inventory-store';

const categories: ToolInventoryCategory[] = [
    { source: 'builtin', status: 'complete' },
    { source: 'coc', status: 'complete' },
    { source: 'mcp', status: 'partial', reason: 'Discovery incomplete.' },
];

function inventory(provider = 'copilot'): RuntimeToolInventory {
    return createRuntimeToolInventory(provider, [
        { name: 'read', source: 'builtin', description: 'Read a file.', inputSchema: { type: 'object' } },
        { name: 'list_workspaces', source: 'coc', inputSchema: true },
        { name: 'search', source: 'mcp', serverName: 'docs' },
    ], categories);
}

function addProcess(db: NativeDatabase, id = 'proc-1', workspaceId = 'ws-1') {
    db.prepare(`
        INSERT INTO processes (id, workspace_id, status, start_time)
        VALUES (?, ?, 'running', ?)
    `).run(id, workspaceId, new Date().toISOString());
}

describe('ConversationToolInventoryStore', () => {
    let db: NativeDatabase;
    let store: ConversationToolInventoryStore;
    beforeEach(() => {
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        addProcess(db);
        store = new ConversationToolInventoryStore(db);
    });
    afterEach(() => db.close());

    it('does not backfill older conversations or confuse them with pending capture', () => {
        expect(store.getForProcess('ws-1', 'proc-1')).toEqual({ state: 'unavailable' });
        expect(store.getForProcess('ws-2', 'proc-1')).toBeUndefined();
        expect(store.getForProcess('ws-1', 'missing')).toBeUndefined();
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'unavailable' });
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'pending', turn });
        expect(Object.isFrozen(turn)).toBe(true);
    });

    it('round-trips unused descriptors, absent metadata, category status and capture time', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        expect(store.record(turn, snapshot)).toBe(true);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'captured', turn, snapshot });
    });

    it.each(['copilot', 'codex', 'claude', 'opencode'])('retains explicit unavailable categories for %s', provider => {
        const turn = store.beginTurn('ws-1', 'proc-1', provider, 0);
        const snapshot = unavailableToolInventory(provider);
        store.record(turn, snapshot);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'captured', turn, snapshot });
    });

    it('replaces the old capture with pending before a new provider starts', () => {
        const previous = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        store.record(previous, inventory());
        const latest = store.beginTurn('ws-1', 'proc-1', 'claude', 2);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'pending', turn: latest });
        expect(store.record(previous, inventory())).toBe(false);
        store.record(latest, inventory('claude'));
        expect(db.prepare('SELECT count(*) AS count FROM conversation_tool_inventory').get()).toEqual({ count: 1 });
    });

    it('rejects stale same-provider captures even if the caller reuses a turn index', () => {
        const stale = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const latest = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        expect(latest.turnId).not.toBe(stale.turnId);
        expect(store.record(stale, inventory())).toBe(false);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'pending', turn: latest });
    });

    it('captures once; duplicate callbacks cannot rewrite history', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const original = inventory();
        expect(store.record(turn, original)).toBe(true);
        expect(store.record(turn, unavailableToolInventory('copilot'))).toBe(false);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'captured', turn, snapshot: original });
    });

    it('isolates process and workspace owners without clobbering another capture', () => {
        addProcess(db, 'proc-2', 'ws-2');
        const first = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const second = store.beginTurn('ws-2', 'proc-2', 'claude', 0);
        expect(() => store.beginTurn('ws-2', 'proc-1', 'codex', 1)).toThrow(/owner not found/);
        expect(store.record({ ...first, workspaceId: 'ws-2' }, inventory())).toBe(false);
        expect(store.get('ws-2', 'proc-1')).toEqual({ state: 'unavailable' });
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'pending', turn: first });
        expect(store.get('ws-2', 'proc-2')).toEqual({ state: 'pending', turn: second });
    });

    it('follows workspace re-keying through the owning process', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        store.record(turn, snapshot);
        db.prepare('UPDATE processes SET workspace_id = ? WHERE id = ?').run('ws-renamed', 'proc-1');
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'unavailable' });
        expect(store.get('ws-renamed', 'proc-1')).toEqual({
            state: 'captured', turn: { ...turn, workspaceId: 'ws-renamed' }, snapshot,
        });
    });

    it('preserves historical tools across completion, archive and settings/metadata changes', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        store.record(turn, snapshot);
        db.prepare(`UPDATE processes SET status = 'completed', archived = 1, metadata = ? WHERE id = ?`)
            .run(JSON.stringify({ provider: 'claude', disabledLlmTools: ['list_workspaces'] }), 'proc-1');
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'captured', turn, snapshot });
        const process = db.prepare('SELECT * FROM processes WHERE id = ?').get('proc-1');
        expect(JSON.stringify(process)).not.toContain('Read a file.');
    });

    it('deletes the snapshot with its process and rejects a delayed capture after deletion', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        store.record(turn, inventory());
        db.prepare('DELETE FROM processes WHERE id = ?').run('proc-1');
        expect(db.prepare('SELECT count(*) AS count FROM conversation_tool_inventory').get()).toEqual({ count: 0 });
        expect(store.record(turn, inventory())).toBe(false);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'unavailable' });
    });

    it('projects descriptor and envelope fields rather than serializing runtime objects', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        const runtimeObject = {
            ...snapshot, environment: { credential: 'private-value' }, invocationArguments: 'private-value',
            tools: snapshot.tools.map(tool => ({
                ...tool, handler: () => {}, headers: { credential: 'private-value' }, command: 'private-value',
            })),
        };
        expect(store.record(turn, runtimeObject)).toBe(true);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'captured', turn, snapshot });
        expect(JSON.stringify(db.prepare('SELECT snapshot FROM conversation_tool_inventory').get()))
            .not.toContain('private-value');
    });

    it('sanitizes schemas and visibly reports omitted descriptors without mutating input', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        const schema: Record<string, unknown> = {};
        schema.cycle = schema;
        snapshot.tools[0].inputSchema = schema;
        store.record(turn, snapshot);
        const result = store.get('ws-1', 'proc-1');
        expect(result.state).toBe('captured');
        if (result.state !== 'captured') throw new Error('Expected captured inventory');
        expect(result.snapshot.tools.map(tool => tool.name)).toEqual(['list_workspaces', 'search']);
        expect(result.snapshot.truncated).toBe(true);
        expect(result.snapshot.categories[0].status).toBe('partial');
        expect(snapshot.categories[0].status).toBe('complete');
    });

    it('never invokes schema getters or persists unsafe prototype keys', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        let called = false;
        const schema = Object.defineProperty({}, 'credential', {
            enumerable: true, get() { called = true; throw new Error('Getter must not run'); },
        });
        snapshot.tools[0].inputSchema = schema;
        snapshot.tools[1].inputSchema = JSON.parse('{"__proto__":{"private":"value"}}');
        store.record(turn, snapshot);
        expect(called).toBe(false);
        const result = store.get('ws-1', 'proc-1');
        if (result.state !== 'captured') throw new Error('Expected captured inventory');
        expect(result.snapshot.tools.map(tool => tool.name)).toEqual(['search']);
        expect(result.snapshot.truncated).toBe(true);
        expect(result.snapshot.categories.map(category => category.status)).toEqual(['partial', 'partial', 'partial']);
    });

    it('bounds snapshots and preserves per-category truncation metadata', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const large = createRuntimeToolInventory('copilot', Array.from({ length: 600 }, (_, i) => ({
            name: `tool-${i}`, source: 'builtin', description: 'x'.repeat(16384),
        })), categories);
        store.record(turn, large);
        const result = store.get('ws-1', 'proc-1');
        expect(result.state).toBe('captured');
        if (result.state !== 'captured') throw new Error('Expected captured inventory');
        expect(result.snapshot).toEqual(large);
        expect(result.snapshot.truncated).toBe(true);
        expect(result.snapshot.categories[1].status).toBe('complete');
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024 * 1024);
    });

    it('does not rewrite a captured snapshot on reconstruction or expose mutable cached objects', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        store.record(turn, snapshot);
        const read = store.get('ws-1', 'proc-1');
        if (read.state !== 'captured') throw new Error('Expected captured inventory');
        read.snapshot.tools.length = 0;
        expect(new ConversationToolInventoryStore(db).get('ws-1', 'proc-1'))
            .toEqual({ state: 'captured', turn, snapshot });
    });

    it('rejects invalid turns, mismatched providers and malformed completeness before writing', () => {
        for (const index of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => store.beginTurn('ws-1', 'proc-1', 'copilot', index)).toThrow(/Invalid/);
        }
        expect(() => store.beginTurn('', 'proc-1', 'copilot', 0)).toThrow(/Invalid/);
        expect(() => store.beginTurn('ws-1', 'proc-1', 'other', 0)).toThrow(/Invalid/);
        expect(() => store.beginTurn('ws-1', 'missing', 'copilot', 0)).toThrow(/owner/);
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        expect(() => store.record(turn, inventory('claude'))).toThrow(/provider mismatch/);
        const invalid = inventory();
        invalid.categories = [categories[0], categories[0], categories[2]];
        expect(() => store.record(turn, invalid)).toThrow(/completeness/);
        expect(store.get('ws-1', 'proc-1')).toEqual({ state: 'pending', turn });
    });

    it('surfaces malformed or oversized durable data instead of reporting a complete or pending capture', () => {
        store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const update = db.prepare('UPDATE conversation_tool_inventory SET snapshot = ?');
        update.run('{');
        expect(() => store.get('ws-1', 'proc-1')).toThrow();
        update.run(JSON.stringify({ ...inventory(), categories: [] }));
        expect(() => store.get('ws-1', 'proc-1')).toThrow(/snapshot/);
        update.run(JSON.stringify({ ...inventory('claude') }));
        expect(() => store.get('ws-1', 'proc-1')).toThrow(/provider mismatch/);
        update.run('x'.repeat(1024 * 1024 + 1));
        expect(() => store.get('ws-1', 'proc-1')).toThrow(/safety limits/);
    });

    it('validates durable metadata and descriptors before browser exposure', () => {
        store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        const invalidSnapshots = [
            { ...snapshot, version: 2 },
            { ...snapshot, provider: 'unsupported' },
            { ...snapshot, capturedAt: 'not-a-date' },
            { ...snapshot, truncated: 'false' },
            { ...snapshot, categories: categories.map(category => ({ ...category, status: 'invented' })) },
            { ...snapshot, categories: categories.map(category => ({ ...category, reason: 'x'.repeat(2049) })) },
            { ...snapshot, truncated: true, categories: categories.map(category => ({ ...category, status: 'complete' })) },
            { ...snapshot, tools: [null] },
            { ...snapshot, tools: [{ name: 'read', source: 'configured' }] },
            { ...snapshot, tools: [{ name: 'read', source: 'mcp' }] },
            { ...snapshot, tools: [{ name: 'read', source: 'builtin', description: {} }] },
            { ...snapshot, tools: [{ name: 'read', source: 'builtin', inputSchema: [] }] },
        ];
        for (const invalid of invalidSnapshots) {
            db.prepare('UPDATE conversation_tool_inventory SET snapshot = ?').run(JSON.stringify(invalid));
            expect(() => store.get('ws-1', 'proc-1')).toThrow(/Invalid/);
        }
    });

    it('propagates database failures instead of claiming capture succeeded', () => {
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        db.exec('DROP TABLE conversation_tool_inventory');
        expect(() => store.record(turn, inventory())).toThrow();
        expect(() => store.get('ws-1', 'proc-1')).toThrow();
        expect(() => store.beginTurn('ws-1', 'proc-1', 'copilot', 1)).toThrow();
    });
});

it.each(['pending', 'captured'] as const)('persists %s across database close/reopen without provider discovery', state => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-inventory-'));
    const filename = path.join(directory, 'processes.db');
    let db: NativeDatabase | undefined;
    try {
        db = new NativeDatabase(filename);
        initializeDatabase(db);
        addProcess(db);
        const store = new ConversationToolInventoryStore(db);
        const turn = store.beginTurn('ws-1', 'proc-1', 'copilot', 0);
        const snapshot = inventory();
        if (state === 'captured') store.record(turn, snapshot);
        db.close();
        db = undefined;
        db = new NativeDatabase(filename);
        initializeDatabase(db);
        expect(new ConversationToolInventoryStore(db).get('ws-1', 'proc-1'))
            .toEqual(state === 'captured' ? { state, turn, snapshot } : { state, turn });
    } finally {
        db?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
