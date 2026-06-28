/**
 * POST /api/processes/:id/turns/:turnIndex/rewind — Rewind Route Tests (AC-03)
 *
 * Validates the destructive in-place rewind endpoint: provider/idle/eligibility
 * guards (all typed), the SDK-truncate-FIRST then CoC-hard-delete ordering, the
 * removed-message composer-restore payload, warm-client eviction, and the
 * turn-rewound WebSocket broadcast.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

const mockRewindSession = vi.fn();
const mockEvictWarm = vi.fn();

// Provide a stubbed sdkServiceRegistry while keeping the REAL SDK_PROVIDER_COPILOT
// constant and isRewindUnsupportedError guard (the endpoint imports all three).
vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: {
            getOrThrow: () => ({ rewindSession: mockRewindSession, evictWarm: mockEvictWarm }),
        },
    };
});

// Stub SSE handler (unused by this route but imported by the module).
vi.mock('../../../src/server/streaming/sse-handler', () => ({
    handleProcessStream: vi.fn(),
    emitMessageQueued: vi.fn(),
    emitPendingMessageAdded: vi.fn(),
    emitMessageSteering: vi.fn(),
}));

vi.mock('../../../src/server/core/attachment-utils', () => ({
    processMessageAttachments: vi.fn().mockReturnValue({
        sdkAttachments: [],
        validatedImages: undefined,
        fileAttachmentMeta: undefined,
        textContext: undefined,
    }),
    hasAttachments: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/core/image-utils', () => ({
    saveImagesToTempFiles: vi.fn(),
    cleanupTempDir: vi.fn(),
    isImageDataUrl: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

/** Seed a settled copilot conversation: user(0) / assistant(1) / user(2) / assistant(3). */
async function seedConversation(store: MockProcessStore, id = 'proc-1'): Promise<void> {
    await store.addProcess({
        id,
        type: 'chat',
        status: 'completed',
        startTime: new Date(),
        promptPreview: 'hello',
        sdkSessionId: 'sdk-session-1',
        metadata: { type: 'chat', workspaceId: 'ws-test', provider: 'copilot' },
        workingDirectory: '/tmp/project',
        conversationTurns: [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [], sdkEventId: 'evt-0' },
            { role: 'assistant', content: 'reply 1', timestamp: new Date(), turnIndex: 1, timeline: [] },
            { role: 'user', content: 'second', timestamp: new Date(), turnIndex: 2, timeline: [], images: ['data:image/png;base64,AAA'], sdkEventId: 'evt-2' },
            { role: 'assistant', content: 'reply 2', timestamp: new Date(), turnIndex: 3, timeline: [] },
        ],
    } as any);
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/turns/:turnIndex/rewind', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let broadcastSpy: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        store = createMockProcessStore();
        broadcastSpy = vi.fn();
        const getWsServer = () => ({ broadcastProcessEvent: broadcastSpy });

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            dataDir: '/tmp/test-coc',
            gitOpsStore: {} as any,
            getWsServer: getWsServer as any,
        });

        const router = createRouter({ routes });
        server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        store.processes.clear();
        mockRewindSession.mockReset();
        mockEvictWarm.mockReset();
        broadcastSpy.mockClear();
        (store.truncateConversationTurns as ReturnType<typeof vi.fn>).mockClear();
    });

    it('returns 404 when the process does not exist', async () => {
        const res = await request(baseUrl, '/api/processes/nope/turns/0/rewind', { method: 'POST', body: '{}' });
        expect(res.status).toBe(404);
        expect(mockRewindSession).not.toHaveBeenCalled();
    });

    it('rewinds a copilot conversation: truncates SDK FIRST, hard-deletes CoC turns, returns the restored message', async () => {
        await seedConversation(store);
        mockRewindSession.mockResolvedValue({ eventsRemoved: 2, upToEventId: 'evt-2' });

        const res = await request(baseUrl, '/api/processes/proc-1/turns/2/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        const data = res.json();
        // Composer-restore payload from the removed user turn (text + images).
        expect(data.restored.content).toBe('second');
        expect(data.restored.images).toEqual(['data:image/png;base64,AAA']);
        expect(data.turnsRemoved).toBe(2); // turns 2 and 3

        // SDK truncation anchored on the target user turn's captured event id.
        expect(mockRewindSession).toHaveBeenCalledWith('sdk-session-1', 'evt-2');
        // CoC hard-delete happened at the target index.
        expect(store.truncateConversationTurns).toHaveBeenCalledWith('proc-1', 2);

        // Surviving turns are exactly the ones before the target.
        const after = await store.getProcess('proc-1');
        expect(after?.conversationTurns?.map(t => t.turnIndex)).toEqual([0, 1]);
    });

    it('invalidates the warm client and broadcasts turn-rewound on success', async () => {
        await seedConversation(store);
        mockRewindSession.mockResolvedValue({ eventsRemoved: 2, upToEventId: 'evt-2' });

        await request(baseUrl, '/api/processes/proc-1/turns/2/rewind', { method: 'POST', body: '{}' });

        expect(mockEvictWarm).toHaveBeenCalledWith({ warmKey: 'proc-1' });
        expect(broadcastSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'turn-rewound', processId: 'proc-1', turnIndex: 2, turnsRemoved: 2 }),
        );
    });

    it('restores text only when the rewound turn has no images', async () => {
        await seedConversation(store);
        mockRewindSession.mockResolvedValue({ eventsRemoved: 4, upToEventId: 'evt-0' });

        const res = await request(baseUrl, '/api/processes/proc-1/turns/0/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data.restored.content).toBe('first');
        expect(data.restored.images).toBeUndefined();
        expect(data.turnsRemoved).toBe(4); // whole conversation
        const after = await store.getProcess('proc-1');
        expect(after?.conversationTurns).toEqual([]);
    });

    it('rejects a non-copilot conversation with a typed REWIND_UNSUPPORTED error and does not touch either store', async () => {
        await store.addProcess({
            id: 'proc-claude',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            sdkSessionId: 'sdk-c',
            metadata: { type: 'chat', workspaceId: 'ws-test', provider: 'claude' },
            conversationTurns: [
                { role: 'user', content: 'q', timestamp: new Date(), turnIndex: 0, timeline: [], sdkEventId: 'evt-0' },
            ],
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-claude/turns/0/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(409);
        expect(res.json().code).toBe('REWIND_UNSUPPORTED');
        expect(mockRewindSession).not.toHaveBeenCalled();
        expect(store.truncateConversationTurns).not.toHaveBeenCalled();
    });

    it('rejects a running conversation with CONVERSATION_NOT_IDLE', async () => {
        await seedConversation(store, 'proc-run');
        store.processes.set('proc-run', { ...store.processes.get('proc-run')!, status: 'running' });

        const res = await request(baseUrl, '/api/processes/proc-run/turns/2/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(409);
        expect(res.json().code).toBe('CONVERSATION_NOT_IDLE');
        expect(mockRewindSession).not.toHaveBeenCalled();
    });

    it('rejects a conversation with buffered pending messages as not idle', async () => {
        await seedConversation(store, 'proc-pending');
        store.processes.set('proc-pending', {
            ...store.processes.get('proc-pending')!,
            pendingMessages: [{ id: 'p1', content: 'queued', createdAt: new Date().toISOString() }] as any,
        });

        const res = await request(baseUrl, '/api/processes/proc-pending/turns/2/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(409);
        expect(res.json().code).toBe('CONVERSATION_NOT_IDLE');
        expect(mockRewindSession).not.toHaveBeenCalled();
    });

    it('returns 404 when the turn index does not exist', async () => {
        await seedConversation(store);
        const res = await request(baseUrl, '/api/processes/proc-1/turns/9/rewind', { method: 'POST', body: '{}' });
        expect(res.status).toBe(404);
        expect(mockRewindSession).not.toHaveBeenCalled();
    });

    it('rejects an assistant-turn target with TURN_NOT_REWINDABLE', async () => {
        await seedConversation(store);
        const res = await request(baseUrl, '/api/processes/proc-1/turns/1/rewind', { method: 'POST', body: '{}' });
        expect(res.status).toBe(400);
        expect(res.json().code).toBe('TURN_NOT_REWINDABLE');
        expect(mockRewindSession).not.toHaveBeenCalled();
    });

    it('rejects a user turn with no captured sdkEventId as TURN_NOT_REWINDABLE', async () => {
        await store.addProcess({
            id: 'proc-legacy',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            sdkSessionId: 'sdk-l',
            metadata: { type: 'chat', workspaceId: 'ws-test', provider: 'copilot' },
            conversationTurns: [
                { role: 'user', content: 'legacy', timestamp: new Date(), turnIndex: 0, timeline: [] }, // no sdkEventId
            ],
        } as any);

        const res = await request(baseUrl, '/api/processes/proc-legacy/turns/0/rewind', { method: 'POST', body: '{}' });
        expect(res.status).toBe(400);
        expect(res.json().code).toBe('TURN_NOT_REWINDABLE');
        expect(mockRewindSession).not.toHaveBeenCalled();
    });

    it('maps a thrown RewindUnsupportedError to 409 and leaves CoC turns intact', async () => {
        await seedConversation(store);
        const err: any = new Error('Rewind is not supported for provider.');
        err.code = 'REWIND_UNSUPPORTED'; // recognized by isRewindUnsupportedError across bundles
        mockRewindSession.mockRejectedValue(err);

        const res = await request(baseUrl, '/api/processes/proc-1/turns/2/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(409);
        expect(res.json().code).toBe('REWIND_UNSUPPORTED');
        // SDK threw → CoC turns must NOT be deleted.
        expect(store.truncateConversationTurns).not.toHaveBeenCalled();
        const after = await store.getProcess('proc-1');
        expect(after?.conversationTurns?.length).toBe(4);
    });

    it('returns 500 and leaves CoC turns intact when SDK truncation fails generically', async () => {
        await seedConversation(store);
        mockRewindSession.mockRejectedValue(new Error('resume failed: session missing'));

        const res = await request(baseUrl, '/api/processes/proc-1/turns/2/rewind', { method: 'POST', body: '{}' });

        expect(res.status).toBe(500);
        expect(store.truncateConversationTurns).not.toHaveBeenCalled();
        const after = await store.getProcess('proc-1');
        expect(after?.conversationTurns?.length).toBe(4);
    });
});
