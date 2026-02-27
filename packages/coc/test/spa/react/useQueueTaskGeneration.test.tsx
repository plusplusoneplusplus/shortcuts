/**
 * Tests for useQueueTaskGeneration hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
    useQueueTaskGeneration,
    type QueueTaskGenerationParams,
} from '../../../src/server/spa/client/react/hooks/useQueueTaskGeneration';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

describe('useQueueTaskGeneration', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // 1. Initial state
    it('has correct initial state', () => {
        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));
        expect(result.current.status).toBe('idle');
        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBeNull();
    });

    // 2. enqueue() transitions to 'submitting'
    it('enqueue() transitions status to submitting', async () => {
        fetchMock.mockReturnValueOnce(new Promise(() => {}));

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        act(() => {
            result.current.enqueue({ prompt: 'test' });
        });

        await waitFor(() => {
            expect(result.current.status).toBe('submitting');
        });
    });

    // 3. Successful enqueue returns taskId and status 'queued'
    it('successful enqueue sets status to queued with taskId', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 'task-abc-123', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        expect(result.current.status).toBe('queued');
        expect(result.current.taskId).toBe('task-abc-123');
        expect(result.current.error).toBeNull();
    });

    // 4. Non-ok HTTP response sets error
    it('non-ok HTTP response sets error', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: () => Promise.resolve({ error: 'Missing required field: prompt' }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: '' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toContain('Missing required field');
    });

    // 5. Network failure sets error
    it('network failure sets error', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network unreachable'));

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('Network unreachable');
    });

    // 6. reset() clears all state
    it('reset() clears all state', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 'task-123', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        expect(result.current.status).toBe('queued');

        act(() => {
            result.current.reset();
        });

        expect(result.current.status).toBe('idle');
        expect(result.current.taskId).toBeNull();
        expect(result.current.error).toBeNull();
    });

    // 7. Request body contains all params when provided
    it('request body contains all params when provided', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        const params: QueueTaskGenerationParams = {
            prompt: 'create a task',
            targetFolder: 'features',
            name: 'my-task',
            model: 'gpt-4',
            mode: 'from-feature',
            depth: 'deep',
            priority: 'high',
        };

        await act(async () => {
            await result.current.enqueue(params);
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body).toEqual({
            prompt: 'create a task',
            targetFolder: 'features',
            name: 'my-task',
            model: 'gpt-4',
            mode: 'from-feature',
            depth: 'deep',
            priority: 'high',
        });
    });

    // 8. Request body omits undefined optional params
    it('request body omits undefined optional params', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'only prompt' });
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body).toEqual({ prompt: 'only prompt' });
        expect(body).not.toHaveProperty('targetFolder');
        expect(body).not.toHaveProperty('name');
        expect(body).not.toHaveProperty('model');
        expect(body).not.toHaveProperty('priority');
    });

    // 9. URL encodes wsId
    it('URL encodes wsId with special characters', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws/special chars'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain(encodeURIComponent('ws/special chars'));
        expect(url).not.toContain('ws/special chars');
    });

    // 10. POSTs to /api/workspaces/:id/queue/generate
    it('POSTs to correct queue endpoint', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/queue/generate');
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
    });

    // 11. No state update after unmount
    it('no state update after unmount', async () => {
        let resolveReq: (v: any) => void;
        const reqPromise = new Promise(r => { resolveReq = r; });

        fetchMock.mockReturnValueOnce(reqPromise);

        const { result, unmount } = renderHook(() => useQueueTaskGeneration('ws-1'));

        let enqueuePromise: Promise<void>;
        act(() => {
            enqueuePromise = result.current.enqueue({ prompt: 'test' });
        });

        unmount();

        resolveReq!({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        await act(async () => {
            await enqueuePromise!;
        });

        // If we get here without warnings, the mountedRef guard works
    });

    // 12. HTTP error with non-JSON body
    it('handles non-JSON error body gracefully', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: () => Promise.reject(new Error('not json')),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('Request failed');
    });

    // 13. Successful response with no taskId
    it('handles missing taskId in response', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        expect(result.current.status).toBe('queued');
        expect(result.current.taskId).toBeNull();
    });

    // 14. HTTP error status in error message
    it('shows HTTP status in error when no error field', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 503,
            json: () => Promise.resolve({}),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('HTTP 503');
    });

    // 15. Images included in request body when provided
    it('includes images in request body when provided', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));
        const images = ['data:image/png;base64,abc', 'data:image/jpeg;base64,def'];

        await act(async () => {
            await result.current.enqueue({ prompt: 'test', images });
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.images).toEqual(images);
    });

    // 16. Images omitted from request body when empty
    it('omits images from request body when array is empty', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test', images: [] });
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body).not.toHaveProperty('images');
    });

    // 17. Images omitted from request body when undefined
    it('omits images from request body when undefined', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ taskId: 't1', queuedAt: Date.now() }),
        });

        const { result } = renderHook(() => useQueueTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.enqueue({ prompt: 'test' });
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body).not.toHaveProperty('images');
    });
});
