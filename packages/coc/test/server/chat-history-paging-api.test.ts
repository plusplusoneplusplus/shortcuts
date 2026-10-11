import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteProcessStore, type AIProcess, type ConversationTurn } from '@plusplusoneplusplus/forge';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import { createRouter } from '../../src/server/shared/router';
import { registerTurnActionRoutes } from '../../src/server/processes/turn-actions-handler';
import type { Route } from '../../src/server/types';

describe('chat history paging API', () => {
    let directory: string;
    let store: SqliteProcessStore;
    let server: http.Server;
    let baseUrl: string;
    let enabled: boolean;

    async function seed(id = 'p', count = 200): Promise<void> {
        const turns: ConversationTurn[] = Array.from({ length: count }, (_, turnIndex) => ({
            turnIndex, role: turnIndex % 2 ? 'assistant' : 'user',
            content: `turn ${turnIndex}`, timestamp: new Date('2026-01-01T00:00:00Z'), timeline: [],
        }));
        const process: AIProcess = {
            id, type: 'chat', status: 'completed', promptPreview: 'paging fixture',
            fullPrompt: 'first prompt', result: 'last result', startTime: new Date('2026-01-01T00:00:00Z'),
            metadata: { type: 'chat', workspaceId: 'owner' }, conversationTurns: turns,
        };
        await store.addProcess(process);
    }

    beforeEach(async () => {
        enabled = true;
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-history-api-'));
        store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        await seed();
        const routes: Route[] = [];
        registerApiRoutes(routes, store, undefined, directory, undefined, undefined, false, () => ({
            excalidrawEnabled: false, canvasEnabled: false, kustoEnabled: false,
            chatStyleSelectorEnabled: false, chatProviderSwitchingEnabled: false,
            chatHistoryPagingEnabled: enabled, defaultChatStyle: 'default',
        }));
        registerTurnActionRoutes(routes, store, undefined, () => enabled);
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing fixture address');
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await new Promise<void>(resolve => server.close(() => resolve()));
        store.getDatabase().close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    async function read(url: string) {
        const response = await fetch(baseUrl + url);
        return { status: response.status, text: await response.text() };
    }

    it('bounds initial and contiguous older pages without any full-history read', async () => {
        vi.spyOn(store, 'getProcess').mockRejectedValue(new Error('Full hydration forbidden'));
        vi.spyOn(store, 'getConversationTurns').mockRejectedValue(new Error('Full hydration forbidden'));
        const initial = await read('/api/processes/p?workspace=owner&turnsLimit=30');
        expect(initial.status).toBe(200);
        const detail = JSON.parse(initial.text);
        expect(detail.process.conversationTurns.map((turn: ConversationTurn) => turn.turnIndex)).toEqual(Array.from({ length: 30 }, (_, index) => index + 170));
        expect(detail.history).toEqual({ oldestTurnIndex: 170, hasMore: true, totalTurns: 200, historyRevision: 0 });
        expect(detail.children).toEqual([]);
        const pages = [detail.process.conversationTurns as ConversationTurn[]];
        let cursor = detail.history.oldestTurnIndex;
        while (cursor > 0) {
            const result = await read(`/api/processes/p/turns?workspace=owner&beforeTurnIndex=${cursor}&limit=30`);
            expect(result.status).toBe(200);
            const page = JSON.parse(result.text);
            expect(page.turns.length).toBeLessThanOrEqual(31);
            expect(page.totalTurns).toBe(200);
            expect(page.historyRevision).toBe(0);
            expect(page.oldestTurnIndex).toBeLessThan(cursor);
            pages.unshift(page.turns);
            cursor = page.oldestTurnIndex;
            expect(page.hasMore).toBe(cursor > 0);
        }
        expect(pages.flat().map(turn => turn.turnIndex)).toEqual(Array.from({ length: 200 }, (_, index) => index));
        expect(store.getProcess).not.toHaveBeenCalled();
        expect(store.getConversationTurns).not.toHaveBeenCalled();
    });

    it.each([0, 1, 29, 30, 31])('returns correct metadata for %i turns and pair boundaries', async count => {
        await seed('short', count);
        const result = await read('/api/processes/short?workspace=owner&turnsLimit=30');
        expect(result.status).toBe(200);
        const { process, history } = JSON.parse(result.text);
        expect(process.conversationTurns).toHaveLength(count);
        expect(history).toEqual({ oldestTurnIndex: count ? 0 : null, hasMore: false, totalTurns: count, historyRevision: 0 });
    });

    it.each([0, 1])('returns an empty page at/below the first visible turn using cursor %i', async cursor => {
        await seed('empty', 0);
        const result = await read(`/api/processes/empty/turns?beforeTurnIndex=${cursor}&limit=30`);
        expect(result.status).toBe(200);
        expect(JSON.parse(result.text)).toEqual({ turns: [], oldestTurnIndex: null, hasMore: false, totalTurns: 0, historyRevision: 0 });
        const beforeFirst = await read('/api/processes/p/turns?beforeTurnIndex=0&limit=30');
        expect(JSON.parse(beforeFirst.text)).toMatchObject({ turns: [], oldestTurnIndex: null, hasMore: false, totalTurns: 200 });
    });

    it.each(['0', '-1', '201', '1.5', 'abc', '', 'Infinity', '9007199254740992'])('rejects invalid limits %s', async limit => {
        expect((await read(`/api/processes/p?turnsLimit=${limit}`)).status).toBe(400);
        expect((await read(`/api/processes/p/turns?limit=${limit}`)).status).toBe(400);
    });

    it.each(['-1', '1.5', 'abc', '', '9007199254740992'])('rejects invalid cursors %s', async cursor => {
        expect((await read(`/api/processes/p/turns?beforeTurnIndex=${cursor}`)).status).toBe(400);
    });

    it('rejects duplicate parameters and unknown or foreign processes', async () => {
        expect((await read('/api/processes/p/turns?limit=30&limit=30')).status).toBe(400);
        expect((await read('/api/processes/p?turnsLimit=30&turnsLimit=30')).status).toBe(400);
        expect((await read('/api/processes/missing?turnsLimit=30')).status).toBe(404);
        expect((await read('/api/processes/missing/turns?limit=30')).status).toBe(404);
        expect((await read('/api/processes/p?workspace=other&turnsLimit=30')).status).toBe(404);
        expect((await read('/api/processes/p/turns?workspace=other&limit=30')).status).toBe(404);
    });

    it('keeps unparameterized and flag-off detail responses byte-identical and gates older reads live', async () => {
        const before = await read('/api/processes/p?workspace=owner');
        expect(JSON.parse(before.text).history).toBeUndefined();
        expect(JSON.parse(before.text).process.conversationTurns).toHaveLength(200);
        enabled = false;
        expect((await read('/api/processes/p?workspace=owner')).text).toBe(before.text);
        expect((await read('/api/processes/p?workspace=owner&turnsLimit=30')).text).toBe(before.text);
        expect((await read('/api/processes/p?workspace=owner&turnsLimit=invalid')).text).toBe(before.text);
        expect((await read('/api/processes/p/turns?workspace=owner')).status).toBe(404);
        enabled = true;
        expect((await read('/api/processes/p/turns?workspace=owner')).status).toBe(200);
    });

    it('resolves queue-prefixed fork IDs on the bounded owner path', async () => {
        const result = await read('/api/processes/queue_p?workspace=owner&turnsLimit=30');
        expect(result.status).toBe(200);
        expect(JSON.parse(result.text).process.id).toBe('p');
        const older = await read('/api/processes/queue_p/turns?workspace=owner&beforeTurnIndex=170');
        expect(older.status).toBe(200);
        expect(JSON.parse(older.text).oldestTurnIndex).toBe(140);
    });

    it('reads pins outside the loaded range without full hydration and verifies their owner', async () => {
        store.pinTurn('p', 5, '2026-01-01T00:00:00Z');
        vi.spyOn(store, 'getProcess').mockRejectedValue(new Error('Full hydration forbidden'));
        const result = await read('/api/processes/queue_p/turns/pinned?workspace=owner');
        expect(result.status).toBe(200);
        expect(JSON.parse(result.text).turns.map((turn: ConversationTurn) => turn.turnIndex)).toEqual([5]);
        expect((await read('/api/processes/p/turns/pinned?workspace=other')).status).toBe(404);
        expect(store.getProcess).not.toHaveBeenCalled();
    });
});
