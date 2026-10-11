import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PAGE_TURNS, SqliteProcessStore, type AIProcess, type ConversationTurn, type ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { handleProcessStream } from '../../src/server/streaming/sse-handler';
import type { WarmStatusBridge } from '../../src/server/streaming/warm-status-bridge';
import { createBotControlMetadata } from '../../src/server/messaging/bot-control-metadata';
import { createMockProcessStore, createProcessFixture } from '../helpers/mock-process-store';
import { parseSSEFrames } from '../helpers/sse-test-utils';

function turns(count: number): ConversationTurn[] {
    return Array.from({ length: count }, (_, turnIndex) => ({
        turnIndex,
        role: turnIndex % 2 === 0 ? 'user' : 'assistant',
        content: `persisted-${turnIndex}`,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        provider: turnIndex < 170 ? 'codex' : 'copilot',
        segmentId: turnIndex < 170 ? 'old' : 'current',
        timeline: [],
    }));
}

const requests: IncomingMessage[] = [];
function request(query = ''): IncomingMessage {
    const req = new PassThrough() as unknown as IncomingMessage;
    req.url = `/api/processes/chat/stream${query}`;
    requests.push(req);
    return req;
}

function response() {
    const chunks: string[] = [];
    return {
        chunks,
        writeHead: vi.fn(),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string) => { chunks.push(chunk); return true; }),
        end: vi.fn((body?: string) => { if (body) chunks.push(body); }),
    };
}

function snapshot(res: ReturnType<typeof response>) {
    return parseSSEFrames(res.chunks).find(frame => frame.event === 'conversation-snapshot')?.data;
}

function rejectFullReads(store: ReturnType<typeof createMockProcessStore> | SqliteProcessStore) {
    vi.spyOn(store, 'getProcess').mockImplementation(async () => { throw new Error('Full process read forbidden'); });
    store.getConversationTurns ??= vi.fn(async () => []);
    vi.spyOn(store, 'getConversationTurns').mockImplementation(async () => { throw new Error('Full turns read forbidden'); });
}

function boundedStore(process: AIProcess, count = PAGE_TURNS) {
    const store = createMockProcessStore({ initialProcesses: [process] });
    const pageTurns = (process.conversationTurns ?? []).slice(-count);
    store.getProcessHistory = vi.fn(async () => ({
        process: { ...process, conversationTurns: pageTurns },
        page: {
            turns: pageTurns,
            oldestTurnIndex: pageTurns[0]?.turnIndex ?? null,
            hasMore: (process.conversationTurns?.length ?? 0) > pageTurns.length,
            totalTurns: process.conversationTurns?.length ?? 0,
            historyRevision: 7,
        },
    }));
    rejectFullReads(store);
    return store;
}

afterEach(() => {
    for (const req of requests.splice(0)) req.emit('close');
    vi.restoreAllMocks();
});

describe('bounded SSE conversation history', () => {
    it('reads only the latest SQLite page before and after flush, preserving snapshot attribution and context', async () => {
        const directory = join(process.cwd(), `.sse-history-test-${randomUUID()}`);
        mkdirSync(directory);
        const store = new SqliteProcessStore({ dbPath: join(directory, 'processes.db') });
        try {
            const history = turns(200);
            history[199].streaming = true;
            const process = createProcessFixture({
                id: 'chat', status: 'running',
                metadata: { workspaceId: 'owner', botControl: createBotControlMetadata('teams') },
                activeProviderSession: { provider: 'copilot', sessionId: 'session', segmentId: 'current', firstTurnIndex: 170 },
                conversationTurns: history,
                tokenLimit: 100000, currentTokens: 456, systemTokens: 123,
                toolDefinitionsTokens: 45, conversationTokens: 288,
                pendingAskUser: [{ questionId: 'question', question: 'Choose?', type: 'text', turnIndex: 199, index: 0, batchSize: 1 }],
                pendingMessages: [{ id: 'pending', content: 'later', provider: 'claude', createdAt: '2026-01-01T00:00:00Z' }],
            });
            await store.addProcess(process);
            const oldResponse = response();
            await handleProcessStream(request('?workspace=owner'), oldResponse as unknown as ServerResponse, 'chat', store, undefined, undefined, () => true);
            const oldSnapshot = snapshot(oldResponse)!;
            const read = vi.spyOn(store, 'getProcessHistory');
            rejectFullReads(store);
            const flush = vi.fn(async () => {
                store.getDatabase().prepare('UPDATE conversation_turns SET content = ? WHERE process_id = ? AND turn_index = ?')
                    .run('flushed-tail', 'chat', 199);
            });
            store.requestFlush = flush;
            const res = response();
            await handleProcessStream(request('?workspace=owner'), res as unknown as ServerResponse, 'chat', store, undefined, undefined, () => true, () => true);
            const paged = snapshot(res)!;
            expect(read.mock.calls).toEqual([
                ['chat', 'owner', { limit: PAGE_TURNS }],
                ['chat', 'owner', { limit: PAGE_TURNS }],
            ]);
            expect(flush).toHaveBeenCalledExactlyOnceWith('chat');
            expect(paged.turns).toHaveLength(PAGE_TURNS);
            expect(paged.turns[0].turnIndex).toBe(170);
            expect(paged.turns.at(-1).content).toBe('flushed-tail');
            expect(paged).toEqual({
                ...oldSnapshot, turns: paged.turns,
                totalTurns: 200, oldestTurnIndex: 170, hasMore: true, historyRevision: 0,
            });
            expect(paged.runningTurn).toEqual({ turnIndex: 199, provider: 'copilot', segmentId: 'current' });
            expect(paged.botControl).toEqual({ state: 'active', source: 'teams', controllerLabel: 'Teams bridge' });
            expect(parseSSEFrames(res.chunks).filter(frame => frame.event === 'ask-user').map(frame => frame.data))
                .toEqual(parseSSEFrames(oldResponse.chunks).filter(frame => frame.event === 'ask-user').map(frame => frame.data));
            expect(parseSSEFrames(res.chunks).filter(frame => frame.event === 'chunk')).toEqual([]);
            expect(res.chunks.join('')).not.toContain('persisted-0');
            expect(store.getProcess).not.toHaveBeenCalled();
            expect(store.getConversationTurns).not.toHaveBeenCalled();
            expect(process.pendingMessages![0].provider).toBe('claude');
        } finally {
            for (const req of requests.splice(0)) req.emit('close');
            store.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it.each([false, true])('preserves the exact flag-off snapshot frame with bot identification %s', async (botEnabled) => {
        const history = turns(2);
        history[1].streaming = true;
        const process = createProcessFixture({
            id: 'chat', status: 'running', conversationTurns: history,
            metadata: { botControl: createBotControlMetadata('teams') },
            activeProviderSession: { provider: 'copilot', segmentId: 'current', firstTurnIndex: 0 },
            tokenLimit: 100, currentTokens: 12, systemTokens: 2, toolDefinitionsTokens: 3, conversationTokens: 7,
        });
        const store = createMockProcessStore({ initialProcesses: [process] });
        store.getProcessHistory = vi.fn(async () => { throw new Error('Bounded reads forbidden with flag off'); });
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, () => botEnabled);
        expect(res.chunks[0]).toBe(`event: conversation-snapshot\ndata: ${JSON.stringify({
            turns: history,
            activeProviderSession: process.activeProviderSession,
            runningTurn: { turnIndex: 1, provider: 'codex', segmentId: 'old' },
            ...(botEnabled ? { botControl: { state: 'active', source: 'teams', controllerLabel: 'Teams bridge' } } : {}),
            sessionTokenLimit: 100, sessionCurrentTokens: 12,
            sessionSystemTokens: 2, sessionToolTokens: 3, sessionConversationTokens: 7,
        })}\n\n`);
        expect(store.getProcessHistory).not.toHaveBeenCalled();
    });

    it('retains paired 31-turn pages and the next running turn while pending providers do not relabel it', async () => {
        const process = createProcessFixture({
            id: 'chat', status: 'running', conversationTurns: turns(201),
            activeProviderSession: { provider: 'codex', sessionId: 'outgoing', segmentId: 'old', firstTurnIndex: 0 },
            pendingMessages: [{ id: 'pending', content: 'later', provider: 'claude', createdAt: '2026-01-01T00:00:00Z' }],
        });
        const store = boundedStore(process, 31);
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, undefined, () => true);
        expect(snapshot(res)).toMatchObject({
            turns: expect.any(Array), oldestTurnIndex: 170, totalTurns: 201,
            activeProviderSession: { provider: 'codex', sessionId: 'outgoing', segmentId: 'old', firstTurnIndex: 0 },
            runningTurn: { turnIndex: 201, provider: 'copilot', segmentId: 'current' },
        });
        expect(snapshot(res)!.turns).toHaveLength(31);
    });

    it.each([false, true])('sends empty paging metadata with bot identification %s', async (botEnabled) => {
        const store = boundedStore(createProcessFixture({ id: 'chat', status: 'completed', conversationTurns: [] }));
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, () => botEnabled, () => true);
        expect(snapshot(res)).toMatchObject({ turns: [], totalTurns: 0, oldestTurnIndex: null, hasMore: false, historyRevision: 7 });
        expect(Object.hasOwn(snapshot(res)!, 'botControl')).toBe(botEnabled);
        expect(snapshot(res)!.runningTurn).toBeUndefined();
    });

    it('keeps empty flag-off streams snapshot-free without bot identification', async () => {
        const store = createMockProcessStore({ initialProcesses: [createProcessFixture({ id: 'chat', status: 'completed', conversationTurns: [] })] });
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, () => false, () => false);
        expect(parseSSEFrames(res.chunks)).toEqual([
            { event: 'status', data: { status: 'completed' } },
            { event: 'done', data: { processId: 'chat' } },
        ]);
    });

    it.each(['workspace', 'workspaceId'])('rejects foreign %s ownership before SSE headers', async (ownerHint) => {
        const store = boundedStore(createProcessFixture({ id: 'chat', metadata: { workspaceId: 'foreign' } }));
        const res = response();
        await handleProcessStream(request(`?${ownerHint}=owner`), res as unknown as ServerResponse, 'chat', store, undefined, undefined, undefined, () => true);
        expect(store.getProcessHistory).toHaveBeenCalledWith('chat', 'owner', { limit: PAGE_TURNS });
        expect(res.writeHead).toHaveBeenCalledExactlyOnceWith(404, { 'Content-Type': 'application/json' });
        expect(res.flushHeaders).not.toHaveBeenCalled();
        expect(res.chunks).toEqual(['{"error":"Process not found"}']);
    });

    it.each(['missing', 'foreign'])('closes without replay when the bounded flush read becomes %s', async (reason) => {
        const store = boundedStore(createProcessFixture({ id: 'chat', status: 'running', metadata: { workspaceId: 'owner' }, conversationTurns: turns(200) }));
        store.requestFlush = vi.fn(async () => {});
        vi.mocked(store.getProcessHistory).mockResolvedValueOnce(await store.getProcessHistory('chat'))
            .mockResolvedValueOnce(reason === 'missing' ? undefined : {
                process: createProcessFixture({ id: 'chat', metadata: { workspaceId: 'foreign' } }),
                page: { turns: [], oldestTurnIndex: null, totalTurns: 0, hasMore: false, historyRevision: 7 },
            });
        const res = response();
        await handleProcessStream(request('?workspace=owner'), res as unknown as ServerResponse, 'chat', store, undefined, undefined, undefined, () => true);
        expect(store.requestFlush).toHaveBeenCalledExactlyOnceWith('chat');
        expect(res.end).toHaveBeenCalled();
        expect(res.chunks).toEqual([]);
        expect(store.onProcessOutput).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing bounded process without full-read fallback', async () => {
        const store = boundedStore(createProcessFixture({ id: 'chat' }));
        vi.mocked(store.getProcessHistory).mockResolvedValue(undefined);
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, undefined, () => true);
        expect(res.writeHead).toHaveBeenCalledExactlyOnceWith(404, { 'Content-Type': 'application/json' });
    });

    it('captures paging at connection opening so a gate change during flush cannot trigger full hydration', async () => {
        const store = boundedStore(createProcessFixture({ id: 'chat', status: 'running', conversationTurns: turns(200) }));
        let enabled = true;
        const gate = vi.fn(() => enabled);
        store.requestFlush = vi.fn(async () => { enabled = false; });
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, undefined, gate);
        expect(gate).toHaveBeenCalledTimes(1);
        expect(store.getProcessHistory).toHaveBeenCalledTimes(2);
        expect(snapshot(res)!.turns).toHaveLength(PAGE_TURNS);
    });

    it('relays live provider, token and pending events without another history read or replay', async () => {
        const store = boundedStore(createProcessFixture({ id: 'chat', status: 'running', conversationTurns: turns(200) }));
        let emit!: (event: ProcessOutputEvent) => void;
        store.onProcessOutput = vi.fn((_id, callback) => { emit = callback; return vi.fn(); });
        const res = response();
        await handleProcessStream(request(), res as unknown as ServerResponse, 'chat', store, undefined, undefined, undefined, () => true);
        const binding = { provider: 'claude', segmentId: 'next', firstTurnIndex: 200 };
        emit({ type: 'provider-session', activeProviderSession: binding, turnIndex: 201 });
        emit({ type: 'chunk', content: 'live-token' });
        emit({
            type: 'token-usage', turnIndex: 201,
            tokenUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            sessionTokenLimit: 100, sessionCurrentTokens: 12, sessionSystemTokens: 2,
            sessionToolTokens: 3, sessionConversationTokens: 7,
        });
        emit({ type: 'pending-message-added', pendingMessage: { id: 'later', content: 'pending', createdAt: '2026-01-01T00:00:00Z' } } as ProcessOutputEvent);
        const frames = parseSSEFrames(res.chunks);
        expect(frames.filter(frame => frame.event === 'conversation-snapshot')).toHaveLength(1);
        expect(frames.find(frame => frame.event === 'provider-session')!.data).toEqual({ activeProviderSession: binding, turnIndex: 201 });
        expect(frames.find(frame => frame.event === 'chunk')!.data).toEqual({ content: 'live-token' });
        expect(frames.find(frame => frame.event === 'pending-message-added')!.data)
            .toMatchObject({ pendingMessage: { id: 'later', content: 'pending' } });
        expect(frames.find(frame => frame.event === 'token-usage')!.data).toEqual({
            turnIndex: 201, tokenUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            sessionTokenLimit: 100, sessionCurrentTokens: 12, sessionSystemTokens: 2,
            sessionToolTokens: 3, sessionConversationTokens: 7,
        });
        expect(store.getProcessHistory).toHaveBeenCalledTimes(1);
    });

    it('keeps warm-only streams bounded, snapshot-free and open for a completed conversation', async () => {
        const store = boundedStore(createProcessFixture({
            id: 'chat', status: 'completed', conversationTurns: turns(200),
            activeProviderSession: { provider: 'codex', segmentId: 'old', firstTurnIndex: 0 },
        }));
        store.requestFlush = vi.fn(async () => {});
        const unregister = vi.fn();
        const bridge = { register: vi.fn(() => unregister), getCurrentStatus: vi.fn(() => 'warm') } as unknown as WarmStatusBridge;
        const req = request('?warm=1');
        const res = response();
        await handleProcessStream(req, res as unknown as ServerResponse, 'chat', store, bridge, undefined, undefined, () => true);
        expect(parseSSEFrames(res.chunks)).toEqual([
            { event: 'warm_status', data: { status: 'warm' } },
            { event: 'heartbeat', data: {} },
        ]);
        expect(bridge.getCurrentStatus).toHaveBeenCalledWith('copilot', 'chat', undefined);
        expect(store.requestFlush).not.toHaveBeenCalled();
        expect(res.end).not.toHaveBeenCalled();
        req.emit('close');
        expect(unregister).toHaveBeenCalledTimes(1);
    });
});
