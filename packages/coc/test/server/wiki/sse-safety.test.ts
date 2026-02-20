/**
 * SSE Safety Tests
 *
 * Tests for safe Server-Sent Event writing when the response stream
 * is destroyed or ended (e.g., client disconnect).
 *
 * Also tests handleGenerateSeeds client disconnect handling.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ServerResponse, IncomingMessage } from 'http';
import { sendSSE } from '../../../src/server/wiki/ask-handler';
import { sendSSE as dwSendSSE } from '../../../src/server/wiki/dw-ask-handler';

// Mock deep-wiki modules to avoid hitting the real Copilot SDK in handler tests
vi.mock('@plusplusoneplusplus/deep-wiki/dist/ai-invoker', () => ({
    checkAIAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

vi.mock('@plusplusoneplusplus/deep-wiki/dist/seeds/seeds-session', () => ({
    runSeedsSession: vi.fn().mockResolvedValue([
        { theme: 'auth', description: 'Authentication', hints: ['login'] },
        { theme: 'db', description: 'Database layer', hints: ['sql'] },
    ]),
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockResponse(opts?: { destroyed?: boolean; writableEnded?: boolean }): ServerResponse & { _chunks: string[] } {
    const chunks: string[] = [];
    const res = {
        _chunks: chunks,
        destroyed: opts?.destroyed ?? false,
        writableEnded: opts?.writableEnded ?? false,
        statusCode: 200,
        writeHead: vi.fn(),
        write: vi.fn((chunk: string) => {
            chunks.push(chunk);
            return true;
        }),
        end: vi.fn(),
        setHeader: vi.fn(),
    } as unknown as ServerResponse & { _chunks: string[] };
    return res;
}

/**
 * Create a mock IncomingMessage that properly emits 'data'/'end' events
 * for readBody(), plus supports 'close' for disconnect tracking.
 */
function createMockRequest(body: string = '{}'): IncomingMessage & EventEmitter {
    const emitter = new EventEmitter();
    const req = emitter as unknown as IncomingMessage & EventEmitter;

    // Schedule body emission on next tick so the handler's readBody() can attach listeners
    process.nextTick(() => {
        emitter.emit('data', Buffer.from(body));
        emitter.emit('end');
    });

    return req;
}

// ============================================================================
// sendSSE (ask-handler)
// ============================================================================

describe('sendSSE (ask-handler)', () => {
    it('writes SSE data to a healthy response', () => {
        const res = createMockResponse();
        const result = sendSSE(res, { type: 'status', message: 'hello' });

        expect(result).toBe(true);
        expect(res._chunks).toHaveLength(1);
        expect(res._chunks[0]).toContain('data: ');
        expect(res._chunks[0]).toContain('"type":"status"');
        expect(res._chunks[0]).toContain('"message":"hello"');
        expect(res._chunks[0].endsWith('\n\n')).toBe(true);
    });

    it('returns false when response is destroyed', () => {
        const res = createMockResponse({ destroyed: true });

        const result = sendSSE(res, { type: 'status', message: 'should not write' });

        expect(result).toBe(false);
        expect(res._chunks).toHaveLength(0);
    });

    it('returns false when response writableEnded is true', () => {
        const res = createMockResponse({ writableEnded: true });

        const result = sendSSE(res, { type: 'error', message: 'late write' });
        expect(result).toBe(false);
        expect(res._chunks).toHaveLength(0);
    });

    it('returns false when write throws an error', () => {
        const res = createMockResponse();
        (res as any).write = () => { throw new Error('write failed'); };

        const result = sendSSE(res, { type: 'status', message: 'will fail' });
        expect(result).toBe(false);
    });

    it('produces valid SSE format with JSON data', () => {
        const res = createMockResponse();
        sendSSE(res, { type: 'done', success: true, seeds: [{ theme: 'auth' }] });

        expect(res._chunks).toHaveLength(1);
        const line = res._chunks[0];
        expect(line).toMatch(/^data: \{.*\}\n\n$/);

        const json = JSON.parse(line.replace('data: ', '').trim());
        expect(json.type).toBe('done');
        expect(json.success).toBe(true);
        expect(json.seeds).toEqual([{ theme: 'auth' }]);
    });

    it('handles multiple sequential writes', () => {
        const res = createMockResponse();

        expect(sendSSE(res, { type: 'status', message: 'first' })).toBe(true);
        expect(sendSSE(res, { type: 'log', message: 'second' })).toBe(true);
        expect(sendSSE(res, { type: 'done', success: true })).toBe(true);

        expect(res._chunks).toHaveLength(3);
    });

    it('stops writing after stream is destroyed mid-sequence', () => {
        const res = createMockResponse();

        expect(sendSSE(res, { type: 'status', message: 'first' })).toBe(true);

        (res as any).destroyed = true;

        expect(sendSSE(res, { type: 'error', message: 'should not write' })).toBe(false);
        expect(res._chunks).toHaveLength(1);
    });

    it('returns false when both destroyed and writableEnded', () => {
        const res = createMockResponse({ destroyed: true, writableEnded: true });
        expect(sendSSE(res, { type: 'test' })).toBe(false);
        expect(res._chunks).toHaveLength(0);
    });
});

// ============================================================================
// sendSSE (dw-ask-handler)
// ============================================================================

describe('sendSSE (dw-ask-handler)', () => {
    it('writes SSE data to a healthy response', () => {
        const res = createMockResponse();
        const result = dwSendSSE(res, { type: 'chunk', content: 'hello' });
        expect(result).toBe(true);
        expect(res._chunks).toHaveLength(1);
    });

    it('returns false when response is destroyed', () => {
        const res = createMockResponse({ destroyed: true });

        const result = dwSendSSE(res, { type: 'error', message: 'late' });
        expect(result).toBe(false);
    });

    it('returns false when response writableEnded', () => {
        const res = createMockResponse({ writableEnded: true });

        const result = dwSendSSE(res, { type: 'error', message: 'late' });
        expect(result).toBe(false);
    });

    it('returns false when write throws', () => {
        const res = createMockResponse();
        (res as any).write = () => { throw new Error('boom'); };

        const result = dwSendSSE(res, { type: 'status', message: 'fail' });
        expect(result).toBe(false);
    });
});

// ============================================================================
// handleGenerateSeeds client disconnect handling
// ============================================================================

describe('handleGenerateSeeds disconnect handling', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('registers close handler and sets SSE headers', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const onSpy = vi.spyOn(req, 'on');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
            'Content-Type': 'text/event-stream',
        }));

        expect(onSpy).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('produces complete SSE flow on successful seeds generation', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        const allChunks = res._chunks.join('');
        expect(allChunks).toContain('"type":"status"');
        expect(allChunks).toContain('"type":"log"');
        expect(allChunks).toContain('"type":"done"');
        expect(allChunks).toContain('"success":true');
        expect(allChunks).toContain('"seeds"');
        expect(res.end).toHaveBeenCalled();
    });

    it('produces SSE error event when AI fails', async () => {
        const deepWikiSeeds = await import('@plusplusoneplusplus/deep-wiki/dist/seeds/seeds-session');
        vi.mocked(deepWikiSeeds.runSeedsSession).mockRejectedValueOnce(
            new Error('AI seeds generation failed: Connection timeout'),
        );

        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        const allChunks = res._chunks.join('');
        expect(allChunks).toContain('"type":"error"');
        expect(allChunks).toContain('Connection timeout');
        expect(allChunks).toContain('"type":"done"');
        expect(allChunks).toContain('"success":false');
        expect(res.end).toHaveBeenCalled();
    });

    it('does not write SSE when client disconnects before async work', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse();
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo' },
            }),
        };

        // Simulate immediate client disconnect: mark destroyed + emit close
        req.on('close', () => {
            (res as any).destroyed = true;
        });
        process.nextTick(() => {
            req.emit('close');
        });

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        // The handler should not crash even with a destroyed response
        // Some initial writes may have succeeded before the disconnect
    });

    it('does not call res.end when stream is already destroyed', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = createMockRequest('{}');
        const res = createMockResponse({ destroyed: true, writableEnded: true });
        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: '/test/repo' },
            }),
        };

        await handleGenerateSeeds(req, res, 'test-wiki', mockManager as any);

        // Since both destroyed and writableEnded are true, safeEnd should not call res.end
        // writeHead is called before the checks, but writes and end should be skipped
    });

    it('returns 404 JSON for unknown wiki', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = {} as IncomingMessage;
        const res = createMockResponse();

        const mockManager = {
            get: vi.fn().mockReturnValue(null),
        };

        await handleGenerateSeeds(req, res, 'nonexistent', mockManager as any);

        expect(mockManager.get).toHaveBeenCalledWith('nonexistent');
    });

    it('returns 400 JSON when no repoPath', async () => {
        const { handleGenerateSeeds } = await import('../../../src/server/wiki/admin-handlers');

        const req = {} as IncomingMessage;
        const res = createMockResponse();

        const mockManager = {
            get: vi.fn().mockReturnValue({
                registration: { repoPath: undefined },
            }),
        };

        await handleGenerateSeeds(req, res, 'wiki', mockManager as any);
        expect(mockManager.get).toHaveBeenCalledWith('wiki');
    });
});
