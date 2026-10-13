import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitOpsStore, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createRuntimeToolInventory, unavailableToolInventory } from '@plusplusoneplusplus/coc-agent-sdk';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import { createRouter } from '../../../src/server/shared/router';
import { ConversationToolInventoryStore } from '../../../src/server/storage/conversation-tool-inventory-store';
import type { Route } from '../../../src/server/types';

function snapshot(provider = 'copilot') {
    return createRuntimeToolInventory(provider, [
        { name: 'unused_builtin', source: 'builtin', description: 'An unused runtime tool.', inputSchema: { type: 'object' } },
        { name: 'list_workspaces', source: 'coc', inputSchema: true },
        { name: 'lookup', source: 'mcp', serverName: 'docs' },
    ], [
        { source: 'builtin', status: 'complete' },
        { source: 'coc', status: 'complete' },
        { source: 'mcp', status: 'partial', reason: 'Runtime discovery is incomplete.' },
    ]);
}

describe('owner-scoped tool inventory HTTP contract', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let inventories: ConversationToolInventoryStore;
    let server: http.Server;
    let baseUrl: string;
    let client: CocClient;
    let omitInventoryStore: boolean;

    function openStore() {
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        inventories = new ConversationToolInventoryStore(store.getDatabase());
    }

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-inventory-route-'));
        openStore();
        omitInventoryStore = false;
        await store.addProcess({
            id: 'proc-1', type: 'chat', status: 'running', startTime: new Date(),
            promptPreview: 'Conversation', metadata: { workspaceId: 'owner' },
        });
        await store.addProcess({
            id: 'queue_proc-2', type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Another conversation', metadata: { workspaceId: 'other' },
        });
        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes, store, dataDir, gitOpsStore: new GitOpsStore({ dataDir }),
            get toolInventoryStore() { return omitInventoryStore ? undefined : inventories; },
        });
        server = http.createServer(createRouter({ routes }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as http.AddressInfo).port}`;
        client = new CocClient({ baseUrl });
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns unavailable for owned historical chats without probing or hydrating history', async () => {
        const fullRead = vi.spyOn(store, 'getProcess');
        const historyRead = vi.spyOn(store, 'getProcessHistory');
        await expect(client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .resolves.toEqual({ state: 'unavailable' });
        expect(fullRead).not.toHaveBeenCalled();
        expect(historyRead).not.toHaveBeenCalled();
    });

    it.each(['', '?workspace=', '?workspace=%20', '?workspace=owner&workspace=other'])(
        'rejects missing or ambiguous owner query %s', async query => {
            const response = await fetch(`${baseUrl}/api/processes/proc-1/tool-inventory${query}`);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ code: 'BAD_REQUEST' });
        },
    );

    it('rejects absent/foreign conversations even without a snapshot and keeps aliases owner-scoped', async () => {
        for (const [id, workspace] of [['proc-1', 'other'], ['missing', 'owner'], ['queue_proc-1', 'other'], ['queue_proc-2', 'owner']]) {
            await expect(client.processes.getToolInventory(id, { workspace }))
                .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
        }
        await expect(client.processes.getToolInventory('queue_proc-1', { workspace: 'owner' }))
            .resolves.toEqual({ state: 'unavailable' });
        await expect(client.processes.getToolInventory('queue_proc-2', { workspace: 'other' }))
            .resolves.toEqual({ state: 'unavailable' });
    });

    it('returns only latest-turn descriptor data and explicit completeness without private capture ownership', async () => {
        const turn = inventories.beginTurn('owner', 'proc-1', 'copilot', 0);
        const captured = snapshot();
        inventories.record(turn, {
            ...captured,
            tools: captured.tools.map(tool => ({ ...tool, command: 'not-public', headers: { secret: 'not-public' } })),
        });
        const response = await client.processes.getToolInventory('queue_proc-1', { workspace: 'owner' });
        expect(response).toEqual({
            state: 'captured',
            turn: { turnId: turn.turnId, turnIndex: 0, provider: 'copilot', startedAt: turn.startedAt },
            snapshot: captured,
        });
        expect(JSON.stringify(response)).not.toContain('not-public');
        expect(response).not.toHaveProperty('turn.workspaceId');
        expect(response).not.toHaveProperty('turn.processId');
        expect((await client.processes.get('proc-1', { workspace: 'owner' })).process)
            .not.toHaveProperty('toolInventory');
    });

    it('replaces preceding tools with pending and keeps the new concrete provider', async () => {
        const previous = inventories.beginTurn('owner', 'proc-1', 'copilot', 0);
        inventories.record(previous, snapshot());
        const next = inventories.beginTurn('owner', 'proc-1', 'claude', 2);
        const pending = await client.processes.getToolInventory('proc-1', { workspace: 'owner' });
        expect(pending).toEqual({
            state: 'pending',
            turn: { turnId: next.turnId, turnIndex: 2, provider: 'claude', startedAt: next.startedAt },
        });
        expect(JSON.stringify(pending)).not.toContain('unused_builtin');
        inventories.record(next, snapshot('claude'));
        expect(await client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .toMatchObject({ state: 'captured', snapshot: { provider: 'claude' } });
    });

    it.each(['copilot', 'codex', 'claude', 'opencode'])('preserves explicitly unavailable categories for %s', async provider => {
        const turn = inventories.beginTurn('owner', 'proc-1', provider, 0);
        const captured = unavailableToolInventory(provider);
        inventories.record(turn, captured);
        expect(await client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .toMatchObject({ state: 'captured', snapshot: captured });
    });

    it('retains completion/archive/settings-independent capture across restart', async () => {
        const turn = inventories.beginTurn('owner', 'proc-1', 'copilot', 0);
        const captured = snapshot();
        inventories.record(turn, captured);
        await store.updateProcess('proc-1', {
            status: 'completed', metadata: { workspaceId: 'owner', provider: 'claude', disabledLlmTools: ['list_workspaces'] },
        });
        store.archiveProcess('proc-1');
        store.close();
        openStore();
        await expect(client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .resolves.toMatchObject({ state: 'captured', snapshot: captured });
    });

    it('makes truncation and metadata omissions visible through the API', async () => {
        const turn = inventories.beginTurn('owner', 'proc-1', 'copilot', 0);
        const captured = snapshot();
        captured.tools[0].description = 'x'.repeat(20000);
        inventories.record(turn, captured);
        const response = await client.processes.getToolInventory('proc-1', { workspace: 'owner' });
        expect(response).toMatchObject({
            state: 'captured', snapshot: { truncated: true, categories: expect.arrayContaining([{ source: 'builtin', status: 'partial', reason: expect.any(String) }]) },
        });
        if (response.state !== 'captured') throw new Error('Expected captured inventory');
        expect(response.snapshot.tools[0].description).toHaveLength(16384);
        expect(response.snapshot.tools[2]).not.toHaveProperty('inputSchema');
    });

    it.each(['corrupt', 'oversized', 'provider-mismatch'])('surfaces %s durable data rather than a success-shaped fallback', async kind => {
        inventories.beginTurn('owner', 'proc-1', 'copilot', 0);
        const value = kind === 'corrupt' ? '{' : kind === 'oversized' ? 'x'.repeat(1024 * 1024 + 1) : JSON.stringify(snapshot('claude'));
        store.getDatabase().prepare('UPDATE conversation_tool_inventory SET snapshot = ? WHERE process_id = ?').run(value, 'proc-1');
        await expect(client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
        await expect(client.processes.getToolInventory('proc-1', { workspace: 'other' }))
            .rejects.toMatchObject({ status: 404 });
    });

    it('surfaces missing storage capability and storage read failures', async () => {
        omitInventoryStore = true;
        await expect(client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
        omitInventoryStore = false;
        vi.spyOn(inventories, 'getForProcess').mockImplementation(() => { throw new Error('Read failed'); });
        await expect(client.processes.getToolInventory('proc-1', { workspace: 'owner' }))
            .rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    });
});
