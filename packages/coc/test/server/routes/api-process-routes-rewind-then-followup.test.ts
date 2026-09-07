/**
 * Rewind → follow-up session continuity (AC-03, Definition of Done 3).
 *
 * The edit-a-message flow is client-only: it rewinds, then sends a normal
 * follow-up. Which provider session that follow-up resumes is decided entirely
 * server-side — the SPA send path carries no session id at all — so the DoD
 * item "a follow-up after the edit lands in the correct (post-rewind) session,
 * not the abandoned one" cannot be asserted from a component test.
 *
 * It matters most for claude, whose rewind is a `forkSession` that yields a NEW
 * session id swapped onto the same process. If the follow-up route were to read
 * a stale process snapshot, the resumed session would be the orphaned pre-fork
 * one and the edited turn would land in a conversation the user can no longer
 * see. These tests drive the two real routes back-to-back over one store and
 * assert the session the follow-up actually resumes.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';

// ============================================================================
// Mocks
// ============================================================================

const mockRewindSession = vi.fn();
const mockEvictWarm = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: {
            get: () => ({ rewindSession: mockRewindSession, evictWarm: mockEvictWarm }),
        },
    };
});

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
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(bodyStr) });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

const ABANDONED_SESSION = 'sdk-session-before-rewind';

/**
 * A settled chat the user could edit: user(0)/assistant(1)/user(2)/assistant(3),
 * both user turns carrying rewind anchors.
 *
 * Status is `cancelled` — a terminal status, so rewind's idle guard passes, and
 * the one status for which the follow-up route resolves an explicit
 * `resumeSessionId` off the process rather than letting the live bridge pick.
 * That makes the resumed session observable at the route boundary.
 */
async function seedEditableChat(store: MockProcessStore, id: string, provider: string): Promise<void> {
    await store.addProcess({
        id,
        type: 'chat',
        status: 'cancelled',
        startTime: new Date(),
        promptPreview: 'hello',
        sdkSessionId: ABANDONED_SESSION,
        metadata: { type: 'chat', workspaceId: 'ws-test', provider },
        workingDirectory: '/tmp/project',
        conversationTurns: [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [], sdkEventId: 'evt-0' },
            { role: 'assistant', content: 'reply 1', timestamp: new Date(), turnIndex: 1, timeline: [] },
            { role: 'user', content: 'second', timestamp: new Date(), turnIndex: 2, timeline: [], sdkEventId: 'evt-2' },
            { role: 'assistant', content: 'reply 2', timestamp: new Date(), turnIndex: 3, timeline: [] },
        ],
    } as any);
}

// ============================================================================
// Tests
// ============================================================================

describe('rewind then follow-up: the resumed session is the post-rewind one', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let enqueueMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
        store = createMockProcessStore();
        enqueueMock = vi.fn().mockResolvedValue('new-task-id');

        const bridge: QueueExecutorBridge = {
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            isSessionAlive: vi.fn().mockResolvedValue(true),
            enqueue: enqueueMock,
            // No parent task: delivery falls through to `enqueue`, where the
            // resolved resumeSessionId is visible in the task payload.
            findTaskByProcessId: vi.fn().mockReturnValue(undefined),
        };

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            bridge,
            dataDir: '/tmp/test-coc',
            gitOpsStore: {} as any,
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
        enqueueMock.mockClear();
    });

    /** The payload the follow-up route handed the queue. */
    const enqueuedPayload = () => enqueueMock.mock.calls[0][0].payload;

    it('resumes the forked session, not the abandoned one, on a claude chat', async () => {
        await seedEditableChat(store, 'proc-claude', 'claude');
        mockRewindSession.mockResolvedValue({ eventsRemoved: 2, upToEventId: 'evt-2', newSessionId: 'sdk-session-forked' });

        const rewind = await request(baseUrl, '/api/processes/proc-claude/turns/2/rewind', { method: 'POST', body: '{}' });
        expect(rewind.status).toBe(200);

        // The edited message, sent exactly as a normal follow-up would be.
        const send = await request(baseUrl, '/api/processes/proc-claude/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'edited text' }),
        });
        expect(send.status).toBe(202);

        expect(enqueueMock).toHaveBeenCalledTimes(1);
        expect(enqueuedPayload().resumeSessionId).toBe('sdk-session-forked');
        expect(enqueuedPayload().resumeSessionId).not.toBe(ABANDONED_SESSION);
        expect(enqueuedPayload().prompt).toBe('edited text');
    });

    it('keeps resuming the same session on an in-place provider (opencode)', async () => {
        await seedEditableChat(store, 'proc-oc', 'opencode');
        // Staged revert: same session id, history truncated in place.
        mockRewindSession.mockResolvedValue({ eventsRemoved: 2, upToEventId: 'evt-2' });

        expect((await request(baseUrl, '/api/processes/proc-oc/turns/2/rewind', { method: 'POST', body: '{}' })).status).toBe(200);
        expect((await request(baseUrl, '/api/processes/proc-oc/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'edited text' }),
        })).status).toBe(202);

        expect(enqueuedPayload().resumeSessionId).toBe(ABANDONED_SESSION);
    });

    it('attaches a later follow-up to the same post-rewind process', async () => {
        await seedEditableChat(store, 'proc-claude-2', 'claude');
        mockRewindSession.mockResolvedValue({ eventsRemoved: 2, upToEventId: 'evt-2', newSessionId: 'sdk-session-forked' });

        await request(baseUrl, '/api/processes/proc-claude-2/turns/2/rewind', { method: 'POST', body: '{}' });
        await request(baseUrl, '/api/processes/proc-claude-2/message', { method: 'POST', body: JSON.stringify({ content: 'edited text' }) });

        // The edited message is now queued, so the conversation is no longer
        // terminal and a second follow-up buffers behind it rather than
        // enqueueing a second task — the normal drain-on-completion path.
        const second = await request(baseUrl, '/api/processes/proc-claude-2/message', {
            method: 'POST',
            body: JSON.stringify({ content: 'a normal follow-up' }),
        });
        expect(second.status).toBe(202);
        expect(enqueueMock).toHaveBeenCalledTimes(1);

        // It buffered onto THIS process — the one now carrying the forked
        // session — so it drains into the post-rewind conversation.
        const after = await store.getProcess('proc-claude-2');
        expect(after?.sdkSessionId).toBe('sdk-session-forked');
        expect(after?.pendingMessages?.map((m: any) => m.content)).toEqual(['a normal follow-up']);
    });

    it('leaves the follow-up on the original session when the rewind fails', async () => {
        await seedEditableChat(store, 'proc-claude-3', 'claude');
        mockRewindSession.mockRejectedValue(new Error('fork exploded'));

        const rewind = await request(baseUrl, '/api/processes/proc-claude-3/turns/2/rewind', { method: 'POST', body: '{}' });
        expect(rewind.status).toBe(500);

        // Nothing was truncated, so a later send continues where the user left off.
        const after = await store.getProcess('proc-claude-3');
        expect(after?.sdkSessionId).toBe(ABANDONED_SESSION);
        expect(after?.conversationTurns?.map((t: any) => t.turnIndex)).toEqual([0, 1, 2, 3]);

        await request(baseUrl, '/api/processes/proc-claude-3/message', { method: 'POST', body: JSON.stringify({ content: 'anything' }) });
        expect(enqueuedPayload().resumeSessionId).toBe(ABANDONED_SESSION);
    });
});
