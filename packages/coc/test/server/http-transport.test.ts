/**
 * HttpTransport Tests
 *
 * Tests for the HttpTransport EditorTransport implementation:
 * - send() routes different message types to correct REST endpoints
 * - onBackendMessage() receives WebSocket-triggered state updates
 * - connect/disconnect lifecycle
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    sentMessages: string[] = [];
    closed = false;

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    send(data: string): void { this.sentMessages.push(data); }
    close(): void { this.closed = true; this.readyState = MockWebSocket.CLOSED; }

    simulateOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    simulateMessage(data: any): void {
        this.onmessage?.({ data: JSON.stringify(data) });
    }

    static instances: MockWebSocket[] = [];
    static reset(): void { MockWebSocket.instances = []; }
}

/** Track fetch calls */
interface FetchCall {
    url: string;
    method: string;
    body?: any;
}

let fetchCalls: FetchCall[] = [];
let fetchResponses: Map<string, { status: number; body: any }> = new Map();

function mockFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const method = init?.method || 'GET';
    let body: any;
    if (init?.body) {
        try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    fetchCalls.push({ url: urlStr, method, body });

    // Find matching response
    const key = `${method} ${urlStr}`;
    const resp = fetchResponses.get(key) || fetchResponses.get(urlStr) || { status: 200, body: {} };

    return Promise.resolve({
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: () => Promise.resolve(resp.body),
    } as Response);
}

// ============================================================================
// Test setup
// ============================================================================

let HttpTransport: typeof import('../../src/server/spa/client/http-transport').HttpTransport;

describe('HttpTransport', () => {
    beforeEach(async () => {
        MockWebSocket.reset();
        fetchCalls = [];
        fetchResponses = new Map();

        // Mock globals
        (globalThis as any).WebSocket = MockWebSocket;
        (globalThis as any).location = { protocol: 'http:', host: 'localhost:4000' };
        (globalThis as any).fetch = mockFetch;

        vi.useFakeTimers();
        vi.resetModules();

        const mod = await import('../../src/server/spa/client/http-transport');
        HttpTransport = mod.HttpTransport;
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (globalThis as any).fetch;
    });

    describe('send() → REST routing', () => {
        it('should POST addComment to correct endpoint', async () => {
            const transport = new HttpTransport('docs/readme.md');
            await transport.send({
                type: 'addComment',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10, selectedText: 'hello' },
                comment: 'nice',
            } as any);

            expect(fetchCalls).toHaveLength(1);
            expect(fetchCalls[0].method).toBe('POST');
            expect(fetchCalls[0].url).toContain('/review/files/');
            expect(fetchCalls[0].url).toContain('/comments');
            expect(fetchCalls[0].body.comment).toBe('nice');
        });

        it('should PATCH editComment to correct endpoint', async () => {
            const transport = new HttpTransport('docs/readme.md');
            await transport.send({
                type: 'editComment',
                commentId: 'c1',
                comment: 'edited',
            });

            expect(fetchCalls).toHaveLength(1);
            expect(fetchCalls[0].method).toBe('PATCH');
            expect(fetchCalls[0].url).toContain('/comments/c1');
            expect(fetchCalls[0].body.comment).toBe('edited');
        });

        it('should DELETE deleteComment', async () => {
            fetchResponses.set('DELETE /api/review/files/docs%2Freadme.md/comments/c1', { status: 204, body: {} });

            const transport = new HttpTransport('docs/readme.md');
            await transport.send({ type: 'deleteComment', commentId: 'c1' });

            expect(fetchCalls).toHaveLength(1);
            expect(fetchCalls[0].method).toBe('DELETE');
        });

        it('should PATCH resolveComment with status resolved', async () => {
            const transport = new HttpTransport('docs/readme.md');
            await transport.send({ type: 'resolveComment', commentId: 'c1' });

            expect(fetchCalls[0].method).toBe('PATCH');
            expect(fetchCalls[0].body.status).toBe('resolved');
        });

        it('should PATCH reopenComment with status open', async () => {
            const transport = new HttpTransport('docs/readme.md');
            await transport.send({ type: 'reopenComment', commentId: 'c1' });

            expect(fetchCalls[0].method).toBe('PATCH');
            expect(fetchCalls[0].body.status).toBe('open');
        });

        it('should POST resolveAll', async () => {
            const transport = new HttpTransport('docs/readme.md');
            await transport.send({ type: 'resolveAll' });

            expect(fetchCalls[0].method).toBe('POST');
            expect(fetchCalls[0].url).toContain('/resolve-all');
        });

        it('should DELETE deleteAll', async () => {
            const transport = new HttpTransport('docs/readme.md');
            await transport.send({ type: 'deleteAll' });

            expect(fetchCalls[0].method).toBe('DELETE');
            expect(fetchCalls[0].url).toContain('/comments');
        });

        it('should fetch initial state on ready message', async () => {
            fetchResponses.set(
                `GET /api/review/files/${encodeURIComponent('docs/readme.md')}`,
                { status: 200, body: { content: '# Hello', comments: [], path: 'docs/readme.md' } },
            );

            const handler = vi.fn();
            const transport = new HttpTransport('docs/readme.md');
            transport.onBackendMessage(handler);

            await transport.send({ type: 'ready' });
            // Wait for async dispatch
            await vi.advanceTimersByTimeAsync(0);

            expect(fetchCalls).toHaveLength(1);
            expect(fetchCalls[0].method).toBe('GET');
            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                type: 'update',
                content: '# Hello',
            }));
        });

        it('should resolve image paths to server URL', async () => {
            const handler = vi.fn();
            const transport = new HttpTransport('docs/readme.md');
            transport.onBackendMessage(handler);

            await transport.send({
                type: 'resolveImagePath',
                path: 'images/screenshot.png',
                imgId: 'img1',
            });

            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                type: 'imageResolved',
                imgId: 'img1',
                uri: expect.stringContaining('/review/images/'),
            }));
        });

        it('should not throw on unhandled message types', async () => {
            const transport = new HttpTransport('docs/readme.md');
            // AI messages are not implemented yet — should be a no-op
            await expect(transport.send({ type: 'askAI', context: {} } as any)).resolves.toBeUndefined();
        });
    });

    describe('connect/disconnect lifecycle', () => {
        it('should establish WebSocket connection on connect', () => {
            const transport = new HttpTransport('docs/readme.md');
            transport.connect();

            expect(MockWebSocket.instances).toHaveLength(1);
        });

        it('should close WebSocket on disconnect', () => {
            const transport = new HttpTransport('docs/readme.md');
            transport.connect();
            transport.disconnect();

            expect(MockWebSocket.instances[0].closed).toBe(true);
        });

        it('should set isConnected to true on welcome message', () => {
            const transport = new HttpTransport('docs/readme.md');
            transport.connect();

            expect(transport.isConnected).toBe(false);

            MockWebSocket.instances[0].simulateOpen();
            MockWebSocket.instances[0].simulateMessage({
                type: 'welcome',
                clientId: 'abc',
                timestamp: Date.now(),
            });

            expect(transport.isConnected).toBe(true);
        });

        it('should set isConnected to false on disconnect', () => {
            const transport = new HttpTransport('docs/readme.md');
            transport.connect();

            MockWebSocket.instances[0].simulateOpen();
            MockWebSocket.instances[0].simulateMessage({ type: 'welcome', clientId: 'abc', timestamp: Date.now() });
            expect(transport.isConnected).toBe(true);

            transport.disconnect();
            expect(transport.isConnected).toBe(false);
        });

        it('should fire onDidChangeConnection on connect/disconnect', () => {
            const transport = new HttpTransport('docs/readme.md');
            const listener = vi.fn();
            transport.onDidChangeConnection(listener);

            transport.connect();
            MockWebSocket.instances[0].simulateOpen();
            MockWebSocket.instances[0].simulateMessage({ type: 'welcome', clientId: 'abc', timestamp: Date.now() });

            expect(listener).toHaveBeenCalledWith(true);

            transport.disconnect();
            expect(listener).toHaveBeenCalledWith(false);
        });
    });

    describe('WebSocket event → refetch', () => {
        it('should refetch state on comment-added WebSocket event', async () => {
            fetchResponses.set(
                `GET /api/review/files/${encodeURIComponent('docs/readme.md')}`,
                { status: 200, body: { content: '# Updated', comments: [{ id: 'c1' }], path: 'docs/readme.md' } },
            );

            const handler = vi.fn();
            const transport = new HttpTransport('docs/readme.md');
            transport.onBackendMessage(handler);
            transport.connect();

            const ws = MockWebSocket.instances[0];
            ws.simulateOpen();
            ws.simulateMessage({
                type: 'comment-added',
                filePath: 'docs/readme.md',
                comment: { id: 'c1' },
            });

            // Wait for the async refetch
            await vi.advanceTimersByTimeAsync(10);

            expect(handler).toHaveBeenCalledWith(expect.objectContaining({
                type: 'update',
                content: '# Updated',
            }));

            transport.disconnect();
        });

        it('should refetch state on comment-deleted WebSocket event', async () => {
            fetchResponses.set(
                `GET /api/review/files/${encodeURIComponent('docs/readme.md')}`,
                { status: 200, body: { content: '# Hello', comments: [], path: 'docs/readme.md' } },
            );

            const handler = vi.fn();
            const transport = new HttpTransport('docs/readme.md');
            transport.onBackendMessage(handler);
            transport.connect();

            MockWebSocket.instances[0].simulateOpen();
            MockWebSocket.instances[0].simulateMessage({
                type: 'comment-deleted',
                filePath: 'docs/readme.md',
                commentId: 'c1',
            });

            await vi.advanceTimersByTimeAsync(10);

            expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));

            transport.disconnect();
        });
    });

    describe('onMessage (webview → backend listener)', () => {
        it('should register and dispose message listeners', () => {
            const transport = new HttpTransport('docs/readme.md');
            const listener = vi.fn();
            const disposable = transport.onMessage(listener);

            expect(disposable.dispose).toBeInstanceOf(Function);
            disposable.dispose();
            // After dispose, should not receive messages
        });
    });

    describe('EditorTransport interface compliance', () => {
        it('should have isConnected property', () => {
            const transport = new HttpTransport('docs/readme.md');
            expect(typeof transport.isConnected).toBe('boolean');
        });

        it('should have postMessage method', () => {
            const transport = new HttpTransport('docs/readme.md');
            expect(typeof transport.postMessage).toBe('function');
        });

        it('should have onMessage method', () => {
            const transport = new HttpTransport('docs/readme.md');
            expect(typeof transport.onMessage).toBe('function');
        });

        it('should have onDidChangeConnection method', () => {
            const transport = new HttpTransport('docs/readme.md');
            expect(typeof transport.onDidChangeConnection).toBe('function');
        });
    });
});
