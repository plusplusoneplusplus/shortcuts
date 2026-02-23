/**
 * Tests for useTaskComments hook.
 * Mocks fetch to verify CRUD methods update state correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTaskComments } from '../../../../src/server/spa/client/react/hooks/useTaskComments';

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
});
