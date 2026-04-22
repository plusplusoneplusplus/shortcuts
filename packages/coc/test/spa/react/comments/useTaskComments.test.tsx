/**
 * Tests for useTaskComments hook.
 * Mocks fetch to verify CRUD methods update state correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTaskComments } from '../../../../src/server/spa/client/react/tasks/hooks/useTaskComments';

// Mock config
vi.mock('../../../../src/server/spa/client/config', () => ({
    getApiBase: () => '/api',
}));

function makeComment(overrides: Record<string, any> = {}) {
    return {
        id: 'c1',
        taskId: 'task1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment: 'test comment',
        status: 'open',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}


describe('useTaskComments', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches comments on mount', async () => {
        const comment = makeComment();
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.comments).toHaveLength(1);
        expect(result.current.comments[0].id).toBe('c1');
        expect(result.current.error).toBeNull();
    });

    it('sets error on fetch failure', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            return Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeTruthy();
        expect(result.current.comments).toHaveLength(0);
    });

    it('addComment appends to state', async () => {
        const existing = makeComment({ id: 'c1' });
        const created = makeComment({ id: 'c2', comment: 'new' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comment: created }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [existing] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.addComment({
                filePath: 'task1.md',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
                selectedText: 'test',
                comment: 'new',
            });
        });

        expect(result.current.comments).toHaveLength(2);
        expect(result.current.comments[1].id).toBe('c2');
    });

    it('deleteComment removes from state', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'DELETE') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.comments).toHaveLength(1);

        await act(async () => {
            await result.current.deleteComment('c1');
        });

        expect(result.current.comments).toHaveLength(0);
    });

    it('resolveComment updates status in state', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });
        const resolved = makeComment({ id: 'c1', status: 'resolved' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'PATCH') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comment: resolved }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resolveComment('c1');
        });

        expect(result.current.comments[0].status).toBe('resolved');
    });

    it('unresolveComment updates status in state', async () => {
        const comment = makeComment({ id: 'c1', status: 'resolved' });
        const reopened = makeComment({ id: 'c1', status: 'open' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'PATCH') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comment: reopened }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.unresolveComment('c1');
        });

        expect(result.current.comments[0].status).toBe('open');
    });

    it('askAI updates aiResponse in state', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiResponse: 'AI says hello' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1');
        });

        expect(result.current.comments[0].aiResponse).toBe('AI says hello');
    });

    // ======================================================================
    // askAI: extended signature, loading/error states
    // ======================================================================

    it('askAI forwards commandId in POST body', async () => {
        const comment = makeComment({ id: 'c1' });
        let capturedBody: any;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                capturedBody = JSON.parse(opts.body);
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiResponse: 'ok' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1', { commandId: 'clarify' });
        });

        expect(capturedBody.commandId).toBe('clarify');
        expect(capturedBody.customQuestion).toBeUndefined();
    });

    it('askAI forwards customQuestion in POST body', async () => {
        const comment = makeComment({ id: 'c1' });
        let capturedBody: any;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                capturedBody = JSON.parse(opts.body);
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiResponse: 'ok' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1', { customQuestion: 'Why?' });
        });

        expect(capturedBody.customQuestion).toBe('Why?');
        expect(capturedBody.commandId).toBeUndefined();
    });

    it('askAI forwards documentContext in POST body', async () => {
        const comment = makeComment({ id: 'c1' });
        let capturedBody: any;
        const ctx = { filePath: 'foo.md', nearestHeading: '## Intro' };

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                capturedBody = JSON.parse(opts.body);
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiResponse: 'ok' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1', { documentContext: ctx });
        });

        expect(capturedBody.documentContext).toEqual(ctx);
    });

    it('askAI sets aiLoadingIds during fetch', async () => {
        const comment = makeComment({ id: 'c1' });
        let resolveFetch!: (v: any) => void;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return new Promise(r => { resolveFetch = r; });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // Start the request but don't resolve it
        let askPromise: Promise<void>;
        act(() => {
            askPromise = result.current.askAI('c1', { commandId: 'clarify' });
        });

        // Loading should be true while pending
        await waitFor(() => expect(result.current.aiLoadingIds.has('c1')).toBe(true));

        // Resolve the fetch
        await act(async () => {
            resolveFetch({ ok: true, json: () => Promise.resolve({ aiResponse: 'done' }) });
            await askPromise!;
        });

        expect(result.current.aiLoadingIds.has('c1')).toBe(false);
    });

    it('askAI clears aiLoadingIds after failure', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.reject(new Error('Network error'));
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1');
        });

        expect(result.current.aiLoadingIds.has('c1')).toBe(false);
    });

    it('askAI sets aiErrors on fetch rejection', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.reject(new Error('Network error'));
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1');
        });

        expect(result.current.aiErrors.get('c1')).toBe('Network error');
    });

    it('askAI sets aiErrors on non-ok response', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.resolve({ ok: false, status: 500 });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1');
        });

        expect(result.current.aiErrors.has('c1')).toBe(true);
    });

    it('askAI clears previous error on retry', async () => {
        const comment = makeComment({ id: 'c1' });
        let callCount = 0;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                callCount++;
                if (callCount === 1) {
                    return Promise.reject(new Error('first failure'));
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiResponse: 'ok' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // First call: fails
        await act(async () => {
            await result.current.askAI('c1');
        });
        expect(result.current.aiErrors.has('c1')).toBe(true);

        // Retry: succeeds, error should be gone
        await act(async () => {
            await result.current.askAI('c1');
        });
        expect(result.current.aiErrors.has('c1')).toBe(false);
    });

    it('clearAiError removes the entry from aiErrors', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.reject(new Error('oops'));
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1');
        });
        expect(result.current.aiErrors.has('c1')).toBe(true);

        act(() => {
            result.current.clearAiError('c1');
        });
        expect(result.current.aiErrors.has('c1')).toBe(false);
    });

    it('askAI with no options does not throw (backward compat)', async () => {
        const comment = makeComment({ id: 'c1' });
        let capturedBody: any;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                capturedBody = JSON.parse(opts.body);
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiResponse: 'ok' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('c1');
        });

        expect(capturedBody).toBeDefined();
        expect(capturedBody.commandId).toBeUndefined();
        expect(capturedBody.customQuestion).toBeUndefined();
        expect(capturedBody.documentContext).toBeUndefined();
    });

    it('fetches comment counts', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: { 'task1.md': 3 } }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.commentCounts['task1.md']).toBe(3);
    });

    // ======================================================================
    // resolveWithAI (fire-and-forget)
    // ======================================================================

    it('resolveWithAI — happy path: POSTs to batch-resolve and returns totalCount', async () => {
        const c1 = makeComment({ id: 'c1', status: 'open' });
        const c2 = makeComment({ id: 'c2', status: 'open', comment: 'second' });
        let capturedBody: any;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('batch-resolve')) {
                capturedBody = JSON.parse(opts.body);
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ taskId: 'resolve-task-1' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [c1, c2] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let resolveResult: any;
        await act(async () => {
            resolveResult = await result.current.resolveWithAI('original content', 'task1.md');
        });

        expect(resolveResult.totalCount).toBe(2);
        expect(capturedBody.documentContent).toBe('original content');
    });

    it('resolveWithAI — throws when batch endpoint fails', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('batch-resolve')) {
                return Promise.resolve({ ok: false, status: 500 });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(result.current.resolveWithAI('doc', 'task1.md')).rejects.toThrow('Batch resolve failed');
        });
    });

    it('resolveWithAI — does not call PATCH or poll queue', async () => {
        const c1 = makeComment({ id: 'c1', status: 'open' });
        let patchCalled = false;
        let queuePolled = false;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('batch-resolve')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ taskId: 'resolve-task-1' }),
                });
            }
            if (url.includes('/queue/')) {
                queuePolled = true;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ task: { status: 'completed', result: {} } }) });
            }
            if (opts?.method === 'PATCH') {
                patchCalled = true;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [c1] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resolveWithAI('doc', 'task1.md');
        });

        expect(patchCalled).toBe(false);
        expect(queuePolled).toBe(false);
    });

    // ======================================================================
    // fixWithAI (fire-and-forget)
    // ======================================================================

    it('fixWithAI — happy path: POSTs to ask-ai with commandId resolve', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });
        let capturedBody: any;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                capturedBody = JSON.parse(opts.body);
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ taskId: 'fix-task-1' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let fixResult: any;
        await act(async () => {
            fixResult = await result.current.fixWithAI('c1', 'original content', 'task1.md');
        });

        expect(fixResult).toEqual({});
        expect(capturedBody.commandId).toBe('resolve');
        expect(capturedBody.documentContent).toBe('original content');
    });

    it('fixWithAI — throws when AI endpoint fails', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.resolve({ ok: false, status: 500 });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(result.current.fixWithAI('c1', 'doc', 'task1.md')).rejects.toThrow('AI resolve failed');
        });
    });

    it('fixWithAI — does not call PATCH or poll queue', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });
        let patchCalled = false;
        let queuePolled = false;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'POST' && url.includes('ask-ai')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ taskId: 'fix-task-1' }),
                });
            }
            if (url.includes('/queue/')) {
                queuePolled = true;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ task: { status: 'completed', result: {} } }) });
            }
            if (opts?.method === 'PATCH') {
                patchCalled = true;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.fixWithAI('c1', 'doc', 'task1.md');
        });

        expect(patchCalled).toBe(false);
        expect(queuePolled).toBe(false);
    });

    // ======================================================================
    // copyResolvePrompt
    // ======================================================================

    it('copyResolvePrompt — builds prompt and writes to clipboard', async () => {
        const c1 = makeComment({ id: 'c1', status: 'open', comment: 'fix typo', selectedText: 'teh' });
        const c2 = makeComment({ id: 'c2', status: 'open', comment: 'unclear', selectedText: 'ambiguous text' });
        const resolved = makeComment({ id: 'c3', status: 'resolved', comment: 'done' });

        const writeTextSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextSpy },
            writable: true,
            configurable: true,
        });

        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [c1, c2, resolved] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.copyResolvePrompt('# My doc', 'task1.md');
        });

        expect(writeTextSpy).toHaveBeenCalledTimes(1);
        const prompt = writeTextSpy.mock.calls[0][0] as string;
        expect(prompt).toContain('fix typo');
        expect(prompt).toContain('unclear');
        expect(prompt).toContain('teh');
        expect(prompt).toContain('ambiguous text');
        expect(prompt).toContain('# My doc');
        expect(prompt).toContain('task1.md');
        // Should NOT include resolved comment
        expect(prompt).not.toContain('done');
        // Should include only 2 open comments
        expect(prompt).toContain('2 comment(s)');
    });

    it('copyResolvePrompt — no-op when no open comments', async () => {
        const resolved = makeComment({ id: 'c1', status: 'resolved' });

        const writeTextSpy = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: writeTextSpy },
            writable: true,
            configurable: true,
        });

        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [resolved] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.copyResolvePrompt('# My doc', 'task1.md');
        });

        expect(writeTextSpy).not.toHaveBeenCalled();
    });

    // ======================================================================
    // In-flight guards: resolvingIds / deletingIds
    // ======================================================================

    it('resolveComment sets resolvingIds during request and clears after', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });
        const resolved = makeComment({ id: 'c1', status: 'resolved' });
        let resolvePatch!: (v: any) => void;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'PATCH') {
                return new Promise(r => { resolvePatch = r; });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let resolvePromise: Promise<any>;
        act(() => {
            resolvePromise = result.current.resolveComment('c1');
        });

        await waitFor(() => expect(result.current.resolvingIds.has('c1')).toBe(true));

        await act(async () => {
            resolvePatch({ ok: true, json: () => Promise.resolve({ comment: resolved }) });
            await resolvePromise!;
        });

        expect(result.current.resolvingIds.has('c1')).toBe(false);
    });

    it('resolveComment double-call is a no-op while in-flight', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });
        const resolved = makeComment({ id: 'c1', status: 'resolved' });
        let patchCallCount = 0;
        let resolvePatch!: (v: any) => void;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'PATCH') {
                patchCallCount++;
                return new Promise(r => { resolvePatch = r; });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstPromise: Promise<any>;
        act(() => {
            firstPromise = result.current.resolveComment('c1');
        });

        await waitFor(() => expect(result.current.resolvingIds.has('c1')).toBe(true));

        // Second call while first is in-flight — should be a no-op
        await act(async () => {
            await result.current.resolveComment('c1');
        });

        expect(patchCallCount).toBe(1);

        // Clean up first call
        await act(async () => {
            resolvePatch({ ok: true, json: () => Promise.resolve({ comment: resolved }) });
            await firstPromise!;
        });
    });

    it('resolvingIds cleared after server error (button re-enabled)', async () => {
        const comment = makeComment({ id: 'c1', status: 'open' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'PATCH') {
                return Promise.resolve({ ok: false, status: 500 });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            try { await result.current.resolveComment('c1'); } catch { /* expected */ }
        });

        expect(result.current.resolvingIds.has('c1')).toBe(false);
    });

    it('deleteComment sets deletingIds during request and clears after', async () => {
        const comment = makeComment({ id: 'c1' });
        let resolveDelete!: (v: any) => void;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'DELETE') {
                return new Promise(r => { resolveDelete = r; });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let deletePromise: Promise<any>;
        act(() => {
            deletePromise = result.current.deleteComment('c1');
        });

        await waitFor(() => expect(result.current.deletingIds.has('c1')).toBe(true));

        await act(async () => {
            resolveDelete({ ok: true, json: () => Promise.resolve({}) });
            await deletePromise!;
        });

        expect(result.current.deletingIds.has('c1')).toBe(false);
    });

    it('deleteComment double-call is a no-op while in-flight', async () => {
        const comment = makeComment({ id: 'c1' });
        let deleteCallCount = 0;
        let resolveDelete!: (v: any) => void;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'DELETE') {
                deleteCallCount++;
                return new Promise(r => { resolveDelete = r; });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let firstPromise: Promise<any>;
        act(() => {
            firstPromise = result.current.deleteComment('c1');
        });

        await waitFor(() => expect(result.current.deletingIds.has('c1')).toBe(true));

        // Second call while first is in-flight — should be a no-op
        await act(async () => {
            await result.current.deleteComment('c1');
        });

        expect(deleteCallCount).toBe(1);

        await act(async () => {
            resolveDelete({ ok: true, json: () => Promise.resolve({}) });
            await firstPromise!;
        });
    });

    it('deletingIds cleared after server error (button re-enabled)', async () => {
        const comment = makeComment({ id: 'c1' });

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: {} }) });
            }
            if (opts?.method === 'DELETE') {
                return Promise.resolve({ ok: false, status: 500 });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [comment] }) });
        });

        const { result } = renderHook(() => useTaskComments('ws1', 'task1.md'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            try { await result.current.deleteComment('c1'); } catch { /* expected */ }
        });

        expect(result.current.deletingIds.has('c1')).toBe(false);
    });
});
