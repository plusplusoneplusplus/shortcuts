/**
 * POST /api/processes/:id/compact — Compact Route Tests (AC-04)
 *
 * Validates the conversation-compaction endpoint: the not-found / no-session /
 * idle / unsupported-provider guards, the optional customInstructions body
 * passthrough, the CompactResult JSON shape on the happy path, and generic
 * failure mapping. The CoC transcript is never rewritten by this route — it only
 * forwards to sdkService.compactSession and returns the result.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../../src/server/shared/router';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';
import { CompactUnsupportedError } from '@plusplusoneplusplus/forge';

// ============================================================================
// Mocks
// ============================================================================

const mockCompactSession = vi.fn();

// Stub the SDK registry but keep the REAL isCompactUnsupportedError guard and the
// REAL CompactUnsupportedError class (the route imports the guard dynamically).
vi.mock('@plusplusoneplusplus/forge', async () => {
    const actual = await vi.importActual('@plusplusoneplusplus/forge');
    return {
        ...actual as object,
        sdkServiceRegistry: { getOrThrow: () => ({ compactSession: mockCompactSession }) },
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

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/compact', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;

    beforeAll(async () => {
        store = createMockProcessStore();

        const routes: Route[] = [];
        registerApiProcessRoutes({
            routes,
            store,
            dataDir: '/tmp/test-coc',
            gitOpsStore: {} as any,
        });

        const router = createRouter({ routes });
        server = http.createServer(router);

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });

        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        store.processes.clear();
        mockCompactSession.mockReset();
    });

    it('returns 404 when process does not exist', async () => {
        const res = await request(baseUrl, '/api/processes/nonexistent/compact', {
            method: 'POST',
            body: '{}',
        });
        expect(res.status).toBe(404);
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it('returns 400 when process has no sdkSessionId', async () => {
        await store.addProcess({
            id: 'no-sdk',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'test',
        });

        const res = await request(baseUrl, '/api/processes/no-sdk/compact', {
            method: 'POST',
            body: '{}',
        });
        expect(res.status).toBe(400);
        expect(res.json().error).toContain('SDK session');
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it('returns 409 when a turn is active (non-terminal status)', async () => {
        await store.addProcess({
            id: 'running-proc',
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'busy',
            sdkSessionId: 'sdk-running',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
        });

        const res = await request(baseUrl, '/api/processes/running-proc/compact', {
            method: 'POST',
            body: '{}',
        });
        expect(res.status).toBe(409);
        expect(res.json().code).toBe('CONVERSATION_NOT_IDLE');
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it('returns 409 when pending messages are buffered', async () => {
        await store.addProcess({
            id: 'pending-proc',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'queued work',
            sdkSessionId: 'sdk-pending',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
            pendingMessages: [{ id: 'm1', content: 'hi', timestamp: new Date() }],
        } as any);

        const res = await request(baseUrl, '/api/processes/pending-proc/compact', {
            method: 'POST',
            body: '{}',
        });
        expect(res.status).toBe(409);
        expect(res.json().code).toBe('CONVERSATION_NOT_IDLE');
        expect(mockCompactSession).not.toHaveBeenCalled();
    });

    it('compacts an idle conversation and returns 200 with the CompactResult', async () => {
        await store.addProcess({
            id: 'proc-ok',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hello',
            sdkSessionId: 'sdk-123',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
        });

        // Capture the persisted process state at the moment compaction runs, to
        // prove the in-progress marking (AC-01) happens BEFORE the SDK call.
        let midFlight: { status?: string; compaction?: any } | undefined;
        mockCompactSession.mockImplementation(async () => {
            const p = store.processes.get('proc-ok');
            midFlight = { status: p?.status, compaction: (p?.metadata as any)?.compaction };
            return {
                success: true,
                tokensRemoved: 4200,
                messagesRemoved: 7,
                summaryContent: 'Summary of the conversation so far.',
            };
        });

        const res = await request(baseUrl, '/api/processes/proc-ok/compact', {
            method: 'POST',
            body: '{}',
        });

        expect(res.status).toBe(200);
        const data = res.json();
        expect(data).toEqual({
            success: true,
            tokensRemoved: 4200,
            messagesRemoved: 7,
            summaryContent: 'Summary of the conversation so far.',
        });
        // Empty body → customInstructions omitted (undefined).
        expect(mockCompactSession).toHaveBeenCalledWith('sdk-123', undefined);

        // While compacting: status flipped to a non-terminal value and the
        // compaction lifecycle recorded as running, with the prior terminal
        // status preserved for restoration.
        expect(midFlight?.status).toBe('running');
        expect(midFlight?.compaction).toMatchObject({ state: 'running', priorStatus: 'completed' });
        expect(typeof midFlight?.compaction?.startedAt).toBe('string');

        // After completion: prior terminal status restored, lifecycle marked
        // completed with the removed counts + a settle timestamp, and the rest of
        // the metadata preserved.
        const after = store.processes.get('proc-ok');
        expect(after?.status).toBe('completed');
        expect((after?.metadata as any)?.provider).toBe('copilot');
        expect((after?.metadata as any)?.compaction).toMatchObject({
            state: 'completed',
            priorStatus: 'completed',
            messagesRemoved: 7,
            tokensRemoved: 4200,
        });
        expect(typeof (after?.metadata as any)?.compaction?.completedAt).toBe('string');
    });

    it('forwards a non-empty customInstructions body to compactSession', async () => {
        await store.addProcess({
            id: 'proc-instr',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hello',
            sdkSessionId: 'sdk-456',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
        });

        mockCompactSession.mockResolvedValue({ success: true, tokensRemoved: 0, messagesRemoved: 0 });

        const res = await request(baseUrl, '/api/processes/proc-instr/compact', {
            method: 'POST',
            body: JSON.stringify({ customInstructions: 'focus on the auth refactor' }),
        });

        expect(res.status).toBe(200);
        expect(mockCompactSession).toHaveBeenCalledWith('sdk-456', 'focus on the auth refactor');
        // Custom instructions are recorded on the compaction metadata so the SPA
        // can show enough text to make the `/compact` action recognizable (AC-02).
        const after = store.processes.get('proc-instr');
        expect((after?.metadata as any)?.compaction).toMatchObject({
            state: 'completed',
            customInstructions: 'focus on the auth refactor',
        });
    });

    it('omits a blank (whitespace-only) customInstructions', async () => {
        await store.addProcess({
            id: 'proc-blank',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hello',
            sdkSessionId: 'sdk-789',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
        });

        mockCompactSession.mockResolvedValue({ success: true, tokensRemoved: 0, messagesRemoved: 0 });

        await request(baseUrl, '/api/processes/proc-blank/compact', {
            method: 'POST',
            body: JSON.stringify({ customInstructions: '   ' }),
        });

        expect(mockCompactSession).toHaveBeenCalledWith('sdk-789', undefined);
    });

    it('returns 422 when the provider does not support compaction', async () => {
        await store.addProcess({
            id: 'proc-claude',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hello',
            sdkSessionId: 'sdk-claude',
            metadata: { type: 'chat', provider: 'claude', workspaceId: 'ws-test' },
        });

        mockCompactSession.mockRejectedValue(new CompactUnsupportedError('claude'));

        const res = await request(baseUrl, '/api/processes/proc-claude/compact', {
            method: 'POST',
            body: '{}',
        });

        expect(res.status).toBe(422);
        const data = res.json();
        expect(data.code).toBe('COMPACT_UNSUPPORTED');
        expect(data.error).toContain('claude');

        // Failure restores the prior terminal status and records the lifecycle as
        // failed so the UI stops showing the in-progress bubble (AC-01).
        const after = store.processes.get('proc-claude');
        expect(after?.status).toBe('completed');
        expect((after?.metadata as any)?.compaction).toMatchObject({
            state: 'failed',
            priorStatus: 'completed',
        });
        expect(typeof (after?.metadata as any)?.compaction?.error).toBe('string');
    });

    it('returns 500 when compaction fails for a generic reason', async () => {
        await store.addProcess({
            id: 'proc-boom',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hello',
            sdkSessionId: 'sdk-boom',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
        });

        mockCompactSession.mockRejectedValue(new Error('rpc.history.compact unavailable'));

        const res = await request(baseUrl, '/api/processes/proc-boom/compact', {
            method: 'POST',
            body: '{}',
        });

        expect(res.status).toBe(500);
        expect(res.json().error).toContain('compact SDK session');

        // A generic failure also restores the prior terminal status and records
        // the captured error message on the compaction lifecycle (AC-01).
        const after = store.processes.get('proc-boom');
        expect(after?.status).toBe('completed');
        expect((after?.metadata as any)?.compaction).toMatchObject({
            state: 'failed',
            priorStatus: 'completed',
            error: 'rpc.history.compact unavailable',
        });
    });

    it('does not mutate process state when the idle guard rejects (409)', async () => {
        await store.addProcess({
            id: 'proc-busy',
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'busy',
            sdkSessionId: 'sdk-busy',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-test' },
        });

        const res = await request(baseUrl, '/api/processes/proc-busy/compact', {
            method: 'POST',
            body: '{}',
        });

        expect(res.status).toBe(409);
        // The guard runs before any state mutation: no compaction metadata is
        // written and the status is untouched.
        const after = store.processes.get('proc-busy');
        expect(after?.status).toBe('running');
        expect((after?.metadata as any)?.compaction).toBeUndefined();
        expect(mockCompactSession).not.toHaveBeenCalled();
    });
});
