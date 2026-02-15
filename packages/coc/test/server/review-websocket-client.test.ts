/**
 * Review WebSocket Client Tests
 *
 * Tests for the client-side review WebSocket module:
 * - subscribe-file sent on connect
 * - Handler dispatch
 * - Reconnect re-subscribes
 * - Disconnect cleanup
 *
 * Uses a mock WebSocket to avoid needing a real server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// WebSocket Mock
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

    send(data: string): void {
        this.sentMessages.push(data);
    }

    close(): void {
        this.closed = true;
        this.readyState = MockWebSocket.CLOSED;
    }

    // Test helpers
    simulateOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
    }

    simulateMessage(data: any): void {
        this.onmessage?.({ data: JSON.stringify(data) });
    }

    simulateClose(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.();
    }

    static instances: MockWebSocket[] = [];
    static reset(): void {
        MockWebSocket.instances = [];
    }
}

// ============================================================================
// Test setup
// ============================================================================

// We need to mock the global WebSocket before importing the module
let connectReviewWebSocket: typeof import('../../src/server/spa/client/review-websocket').connectReviewWebSocket;
let disconnectReviewWebSocket: typeof import('../../src/server/spa/client/review-websocket').disconnectReviewWebSocket;
let onReviewMessage: typeof import('../../src/server/spa/client/review-websocket').onReviewMessage;

describe('review-websocket client', () => {
    let originalWebSocket: any;
    let originalLocation: any;
    let originalSetTimeout: typeof globalThis.setTimeout;
    let originalClearTimeout: typeof globalThis.clearTimeout;
    let originalSetInterval: typeof globalThis.setInterval;
    let originalClearInterval: typeof globalThis.clearInterval;

    beforeEach(async () => {
        MockWebSocket.reset();

        // Save originals
        originalWebSocket = (globalThis as any).WebSocket;
        originalLocation = (globalThis as any).location;
        originalSetTimeout = globalThis.setTimeout;
        originalClearTimeout = globalThis.clearTimeout;
        originalSetInterval = globalThis.setInterval;
        originalClearInterval = globalThis.clearInterval;

        // Mock globals
        (globalThis as any).WebSocket = MockWebSocket;
        (globalThis as any).location = {
            protocol: 'http:',
            host: 'localhost:4000',
        };

        // Use fake timers
        vi.useFakeTimers();

        // Re-import the module fresh (clears module state)
        vi.resetModules();
        const mod = await import('../../src/server/spa/client/review-websocket');
        connectReviewWebSocket = mod.connectReviewWebSocket;
        disconnectReviewWebSocket = mod.disconnectReviewWebSocket;
        onReviewMessage = mod.onReviewMessage;
    });

    afterEach(() => {
        disconnectReviewWebSocket();
        vi.useRealTimers();
        (globalThis as any).WebSocket = originalWebSocket;
        (globalThis as any).location = originalLocation;
    });

    it('should create WebSocket with correct URL', () => {
        connectReviewWebSocket('docs/readme.md');

        expect(MockWebSocket.instances).toHaveLength(1);
        expect(MockWebSocket.instances[0].url).toBe('ws://localhost:4000/ws');
    });

    it('should send subscribe-file on connect', () => {
        connectReviewWebSocket('docs/readme.md');
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();

        expect(ws.sentMessages).toHaveLength(1);
        const msg = JSON.parse(ws.sentMessages[0]);
        expect(msg).toEqual({ type: 'subscribe-file', filePath: 'docs/readme.md' });
    });

    it('should dispatch messages to registered handlers', () => {
        const handler = vi.fn();
        onReviewMessage(handler);

        connectReviewWebSocket('docs/readme.md');
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();
        ws.simulateMessage({ type: 'comment-added', filePath: 'docs/readme.md', comment: { id: 'c1' } });

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].type).toBe('comment-added');
    });

    it('should allow unsubscribing handlers', () => {
        const handler = vi.fn();
        const unsub = onReviewMessage(handler);

        connectReviewWebSocket('docs/readme.md');
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();

        unsub();
        ws.simulateMessage({ type: 'comment-added', filePath: 'docs/readme.md', comment: {} });

        expect(handler).not.toHaveBeenCalled();
    });

    it('should reconnect with exponential backoff on close', () => {
        connectReviewWebSocket('docs/readme.md');
        const ws1 = MockWebSocket.instances[0];
        ws1.simulateOpen();
        ws1.simulateClose();

        // After 1000ms, should reconnect
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);

        // Reconnect should re-subscribe
        const ws2 = MockWebSocket.instances[1];
        ws2.simulateOpen();
        const msg = JSON.parse(ws2.sentMessages[0]);
        expect(msg).toEqual({ type: 'subscribe-file', filePath: 'docs/readme.md' });
    });

    it('should increase reconnect delay exponentially', () => {
        connectReviewWebSocket('docs/readme.md');

        // First close → 1s
        MockWebSocket.instances[0].simulateOpen();
        MockWebSocket.instances[0].simulateClose();
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);

        // Second close → 2s
        MockWebSocket.instances[1].simulateClose();
        vi.advanceTimersByTime(1500); // Not enough
        expect(MockWebSocket.instances).toHaveLength(2);
        vi.advanceTimersByTime(500); // Now 2s total
        expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('should reset reconnect delay on successful connect', () => {
        connectReviewWebSocket('docs/readme.md');
        MockWebSocket.instances[0].simulateOpen();
        MockWebSocket.instances[0].simulateClose();

        // First reconnect at 1s
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);

        // Successful connect resets delay
        MockWebSocket.instances[1].simulateOpen();
        MockWebSocket.instances[1].simulateClose();

        // Next reconnect should be at 1s again (reset)
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('should stop reconnecting after disconnect', () => {
        connectReviewWebSocket('docs/readme.md');
        MockWebSocket.instances[0].simulateOpen();

        disconnectReviewWebSocket();

        // Should not reconnect
        vi.advanceTimersByTime(5000);
        expect(MockWebSocket.instances).toHaveLength(1);
        expect(MockWebSocket.instances[0].closed).toBe(true);
    });

    it('should start ping interval on connect', () => {
        connectReviewWebSocket('docs/readme.md');
        const ws = MockWebSocket.instances[0];
        ws.simulateOpen();

        // After 30s, should send a ping
        vi.advanceTimersByTime(30_000);
        // First message is subscribe-file, second should be ping
        expect(ws.sentMessages.length).toBeGreaterThanOrEqual(2);
        const pingMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
        expect(pingMsg).toEqual({ type: 'ping' });
    });

    it('should use wss: protocol when on https', async () => {
        (globalThis as any).location = {
            protocol: 'https:',
            host: 'secure.example.com',
        };

        // Re-import to pick up new location
        vi.resetModules();
        const mod = await import('../../src/server/spa/client/review-websocket');
        MockWebSocket.reset();
        mod.connectReviewWebSocket('test.md');

        expect(MockWebSocket.instances[0].url).toBe('wss://secure.example.com/ws');
        mod.disconnectReviewWebSocket();
    });
});
