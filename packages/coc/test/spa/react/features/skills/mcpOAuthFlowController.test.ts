/**
 * Unit tests for the MCP OAuth poller registry — completion, failure, timeout,
 * transient-error resilience, the stale guard, replacement, and stopAll.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpOAuthFlowController } from '../../../../../src/server/spa/client/react/features/skills/mcpOAuthFlowController';

const API_BASE = 'http://localhost/api';
const INTERVAL = 100;
const TIMEOUT = 1_000;

let fetchMock: ReturnType<typeof vi.fn>;

function pendingResponse(body: unknown) {
    return { ok: true, json: async () => body };
}

function start(
    controller: McpOAuthFlowController,
    handlers: { onCompleted?: () => void; onFailed?: (e: string) => void } = {},
    opts: { isStale?: () => boolean } = {},
) {
    controller.startPolling(
        { key: 'srv', requestId: 'req-1', apiBase: API_BASE, intervalMs: INTERVAL, timeoutMs: TIMEOUT, isStale: opts.isStale },
        { onCompleted: handlers.onCompleted ?? (() => {}), onFailed: handlers.onFailed ?? (() => {}) },
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('McpOAuthFlowController', () => {
    it('fires onCompleted once and stops when the server reports completed', async () => {
        fetchMock.mockResolvedValue(pendingResponse({ status: 'completed' }));
        const controller = new McpOAuthFlowController();
        const onCompleted = vi.fn();
        start(controller, { onCompleted });

        expect(controller.isPolling('srv')).toBe(true);
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(onCompleted).toHaveBeenCalledTimes(1);
        expect(controller.isPolling('srv')).toBe(false);

        // No further ticks after completion.
        await vi.advanceTimersByTimeAsync(INTERVAL * 5);
        expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    it('fires onFailed with the server error and stops', async () => {
        fetchMock.mockResolvedValue(pendingResponse({ status: 'failed', error: 'user denied' }));
        const controller = new McpOAuthFlowController();
        const onFailed = vi.fn();
        start(controller, { onFailed });

        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(onFailed).toHaveBeenCalledWith('user denied');
        expect(controller.isPolling('srv')).toBe(false);
    });

    it('times out when the flow never settles', async () => {
        fetchMock.mockResolvedValue(pendingResponse({ status: 'pending' }));
        const controller = new McpOAuthFlowController();
        const onFailed = vi.fn();
        start(controller, { onFailed });

        await vi.advanceTimersByTimeAsync(TIMEOUT + INTERVAL);
        expect(onFailed).toHaveBeenCalledWith('Authorization timed out');
        expect(controller.isPolling('srv')).toBe(false);
    });

    it('keeps polling through a transient network error', async () => {
        fetchMock
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValue(pendingResponse({ status: 'completed' }));
        const controller = new McpOAuthFlowController();
        const onCompleted = vi.fn();
        start(controller, { onCompleted });

        await vi.advanceTimersByTimeAsync(INTERVAL); // transient error tick
        expect(onCompleted).not.toHaveBeenCalled();
        expect(controller.isPolling('srv')).toBe(true);

        await vi.advanceTimersByTimeAsync(INTERVAL); // success tick
        expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    it('drops the poll and stops silently when the flow is stale', async () => {
        fetchMock.mockResolvedValue(pendingResponse({ status: 'completed' }));
        const controller = new McpOAuthFlowController();
        const onCompleted = vi.fn();
        const onFailed = vi.fn();
        start(controller, { onCompleted, onFailed }, { isStale: () => true });

        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(onCompleted).not.toHaveBeenCalled();
        expect(onFailed).not.toHaveBeenCalled();
        expect(controller.isPolling('srv')).toBe(false);
    });

    it('replaces an existing poller for the same key', async () => {
        fetchMock.mockResolvedValue(pendingResponse({ status: 'pending' }));
        const controller = new McpOAuthFlowController();
        const firstCompleted = vi.fn();
        const secondCompleted = vi.fn();
        start(controller, { onCompleted: firstCompleted });
        start(controller, { onCompleted: secondCompleted });

        expect(controller.activeKeys()).toEqual(['srv']);

        fetchMock.mockResolvedValue(pendingResponse({ status: 'completed' }));
        await vi.advanceTimersByTimeAsync(INTERVAL);
        expect(firstCompleted).not.toHaveBeenCalled();
        expect(secondCompleted).toHaveBeenCalledTimes(1);
    });

    it('stopAll cancels every active poller', async () => {
        fetchMock.mockResolvedValue(pendingResponse({ status: 'pending' }));
        const controller = new McpOAuthFlowController();
        const onCompleted = vi.fn();
        controller.startPolling(
            { key: 'a', requestId: 'r-a', apiBase: API_BASE, intervalMs: INTERVAL, timeoutMs: TIMEOUT },
            { onCompleted, onFailed: () => {} },
        );
        controller.startPolling(
            { key: 'b', requestId: 'r-b', apiBase: API_BASE, intervalMs: INTERVAL, timeoutMs: TIMEOUT },
            { onCompleted, onFailed: () => {} },
        );
        expect(controller.activeKeys().sort()).toEqual(['a', 'b']);

        controller.stopAll();
        expect(controller.activeKeys()).toEqual([]);

        fetchMock.mockResolvedValue(pendingResponse({ status: 'completed' }));
        await vi.advanceTimersByTimeAsync(INTERVAL * 3);
        expect(onCompleted).not.toHaveBeenCalled();
    });
});
