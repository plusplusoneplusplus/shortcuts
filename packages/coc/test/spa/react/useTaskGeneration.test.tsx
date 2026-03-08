/**
 * Tests for useTaskGeneration hook.
 * Uses renderHook/act/waitFor from @testing-library/react and vi.stubGlobal for fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
    useTaskGeneration,
    type TaskGenerationParams,
} from '../../../src/server/spa/client/react/hooks/useTaskGeneration';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

// ── SSE stream helper ────────────────────────────────────────────────────

/**
 * Builds a ReadableStream whose chunks are the provided raw SSE text strings.
 * Each string is enqueued as a separate Uint8Array chunk.
 */
function makeSseStream(events: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const e of events) {
                controller.enqueue(encoder.encode(e));
            }
            controller.close();
        },
    });
}

function sseResponse(events: string[]): Partial<Response> {
    return {
        ok: true,
        status: 200,
        body: makeSseStream(events) as any,
        json: () => Promise.reject(new Error('not json')),
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('useTaskGeneration', () => {
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
        const { result } = renderHook(() => useTaskGeneration('ws-1'));
        expect(result.current.status).toBe('idle');
        expect(result.current.chunks).toEqual([]);
        expect(result.current.progressMessage).toBeNull();
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
    });

    // 2. generate() transitions to 'generating'
    it('generate() transitions status to generating', async () => {
        // Never-resolving fetch to keep status at 'generating'
        fetchMock.mockReturnValueOnce(new Promise(() => {}));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        act(() => {
            result.current.generate({ prompt: 'test' });
        });

        await waitFor(() => {
            expect(result.current.status).toBe('generating');
            expect(result.current.chunks).toEqual([]);
        });
    });

    // 3. progress event updates progressMessage
    it('progress event updates progressMessage', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: progress\ndata: {"phase":"generating","message":"AI is generating task..."}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.progressMessage).toBe('AI is generating task...');
    });

    // 4. chunk events accumulate in chunks array
    it('chunk events accumulate in chunks array', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: chunk\ndata: {"content":"first part"}\n\n',
            'event: chunk\ndata: {"content":" second part"}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.chunks).toEqual(['first part', ' second part']);
    });

    // 5. done success populates result
    it('done success populates result', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: done\ndata: {"success":true,"filePath":"/data/repos/abc/tasks/foo.md","content":"# Foo"}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.status).toBe('complete');
        expect(result.current.result).toEqual({
            filePath: '/data/repos/abc/tasks/foo.md',
            content: '# Foo',
        });
    });

    // 6. done success with null filePath
    it('done success with null filePath', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: done\ndata: {"success":true,"filePath":null,"content":"content"}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.status).toBe('complete');
        expect(result.current.result!.filePath).toBeNull();
    });

    // 7. done failure sets error
    it('done failure sets error', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: done\ndata: {"success":false}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBeTruthy();
    });

    // 8. error event sets status and message
    it('error event sets status and message', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: error\ndata: {"message":"AI service unavailable"}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('AI service unavailable');
    });

    // 9. non-ok HTTP response (400) sets error
    it('non-ok HTTP response sets error', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: () => Promise.resolve({ error: 'Missing required field: prompt' }),
        });

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: '' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toContain('Missing required field');
    });

    // 10. network failure sets error
    it('network failure sets error', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network unreachable'));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBeTruthy();
    });

    // 11. cancel() aborts stream
    it('cancel() aborts stream and sets cancelled status', async () => {
        // Simulate a fetch that rejects with AbortError when aborted
        fetchMock.mockImplementationOnce((_url: string, opts: RequestInit) => {
            return new Promise((_resolve, reject) => {
                opts.signal!.addEventListener('abort', () => {
                    const err = new DOMException('The operation was aborted.', 'AbortError');
                    reject(err);
                });
            });
        });

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            const generatePromise = result.current.generate({ prompt: 'test' });
            result.current.cancel();
            await generatePromise;
        });

        expect(result.current.status).toBe('cancelled');
        expect(result.current.error).toBeNull();
    });

    // 12. cancel() is no-op when idle
    it('cancel() is no-op when idle', () => {
        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        act(() => {
            result.current.cancel();
        });

        expect(result.current.status).toBe('idle');
    });

    // 13. reset() clears all state
    it('reset() clears all state', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: done\ndata: {"success":true,"filePath":"f.md","content":"c"}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        expect(result.current.status).toBe('complete');

        act(() => {
            result.current.reset();
        });

        expect(result.current.status).toBe('idle');
        expect(result.current.chunks).toEqual([]);
        expect(result.current.progressMessage).toBeNull();
        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
    });

    // 14. re-entrant generate() aborts previous
    it('re-entrant generate() aborts previous request', async () => {
        // First call: hangs until aborted, then second call succeeds
        fetchMock.mockImplementationOnce((_url: string, opts: RequestInit) => {
            return new Promise((_resolve, reject) => {
                opts.signal!.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });
        fetchMock.mockResolvedValueOnce(sseResponse([
            'event: done\ndata: {"success":true,"filePath":"second.md","content":"second"}\n\n',
        ]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            // Start first generate (will hang)
            const first = result.current.generate({ prompt: 'first' });
            // Start second generate (aborts first)
            const second = result.current.generate({ prompt: 'second' });
            await Promise.all([first, second]);
        });

        expect(result.current.status).toBe('complete');
        expect(result.current.result?.filePath).toBe('second.md');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // 15. request body contains all params
    it('request body contains all params when provided', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        const params: TaskGenerationParams = {
            prompt: 'create a task',
            targetFolder: 'features',
            name: 'my-task',
            model: 'gpt-4',
            mode: 'from-feature',
            depth: 'deep',
        };

        await act(async () => {
            await result.current.generate(params);
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
        });
    });

    // 16. request body omits undefined optional params
    it('request body omits undefined optional params', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([]));

        const { result } = renderHook(() => useTaskGeneration('ws-1'));

        await act(async () => {
            await result.current.generate({ prompt: 'only prompt' });
        });

        const [, opts] = fetchMock.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body).toEqual({ prompt: 'only prompt' });
        expect(body).not.toHaveProperty('targetFolder');
        expect(body).not.toHaveProperty('name');
        expect(body).not.toHaveProperty('model');
        expect(body).not.toHaveProperty('mode');
        expect(body).not.toHaveProperty('depth');
    });

    // 17. URL encodes wsId
    it('URL encodes wsId with special characters', async () => {
        fetchMock.mockResolvedValueOnce(sseResponse([]));

        const { result } = renderHook(() => useTaskGeneration('ws/special chars'));

        await act(async () => {
            await result.current.generate({ prompt: 'test' });
        });

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain(encodeURIComponent('ws/special chars'));
        expect(url).not.toContain('ws/special chars');
    });

    // 18. no state update after unmount
    it('no state update after unmount', async () => {
        // Slow stream that emits after a delay
        let resolveChunk: () => void;
        const chunkPromise = new Promise<void>(r => { resolveChunk = r; });

        fetchMock.mockImplementationOnce(() => {
            return Promise.resolve({
                ok: true,
                status: 200,
                body: new ReadableStream({
                    async start(controller) {
                        await chunkPromise;
                        const encoder = new TextEncoder();
                        controller.enqueue(encoder.encode('event: done\ndata: {"success":true,"filePath":"f","content":"c"}\n\n'));
                        controller.close();
                    },
                }),
            });
        });

        const { result, unmount } = renderHook(() => useTaskGeneration('ws-1'));

        let generatePromise: Promise<void>;
        act(() => {
            generatePromise = result.current.generate({ prompt: 'test' });
        });

        // Unmount before the stream completes
        unmount();

        // Let the stream complete — should not throw
        resolveChunk!();
        await act(async () => {
            await generatePromise!;
        });

        // If we get here without warnings, the mountedRef guard works
    });
});
