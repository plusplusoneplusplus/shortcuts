import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notesApi } from '../../../../src/server/spa/client/react/repos/notesApi';

// Mock getApiBase used by fetchApi
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

describe('notesApi', () => {
    const mockFetch = vi.fn();
    beforeEach(() => { globalThis.fetch = mockFetch; });
    afterEach(() => { vi.resetAllMocks(); });

    function mockOk(data: any) {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => data });
    }
    function mock204() {
        mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined });
    }

    describe('getTree', () => {
        it('calls GET /workspaces/:id/notes/tree', async () => {
            const tree = [{ name: 'root', path: '/', type: 'notebook', children: [] }];
            mockOk(tree);
            const result = await notesApi.getTree('ws-1');
            expect(result).toEqual(tree);
            expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/ws-1/notes/tree', {});
        });

        it('encodes workspaceId', async () => {
            mockOk([]);
            await notesApi.getTree('ws/special chars');
            expect(mockFetch).toHaveBeenCalledWith('/api/workspaces/ws%2Fspecial%20chars/notes/tree', {});
        });
    });

    describe('getContent', () => {
        it('calls GET with path query parameter', async () => {
            const data = { content: '# Hello', path: 'notes/hello.md' };
            mockOk(data);
            const result = await notesApi.getContent('ws-1', 'notes/hello.md');
            expect(result).toEqual(data);
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/content?path=notes%2Fhello.md',
                {},
            );
        });
    });

    describe('saveContent', () => {
        it('calls PUT with JSON body', async () => {
            const data = { path: 'notes/hello.md', updated: true };
            mockOk(data);
            const result = await notesApi.saveContent('ws-1', 'notes/hello.md', '# Updated');
            expect(result).toEqual(data);
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/content',
                expect.objectContaining({
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: 'notes/hello.md', content: '# Updated' }),
                }),
            );
        });
    });

    describe('createNode', () => {
        it('calls POST with path and type', async () => {
            const data = { path: 'notes/new-page.md', type: 'page' };
            mockOk(data);
            const result = await notesApi.createNode('ws-1', 'notes/new-page.md', 'page');
            expect(result).toEqual(data);
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/page',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: 'notes/new-page.md', type: 'page' }),
                }),
            );
        });
    });

    describe('renameNode', () => {
        it('calls PATCH with oldPath and newPath', async () => {
            const data = { oldPath: 'notes/old.md', newPath: 'notes/new.md' };
            mockOk(data);
            const result = await notesApi.renameNode('ws-1', 'notes/old.md', 'notes/new.md');
            expect(result).toEqual(data);
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/path',
                expect.objectContaining({
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath: 'notes/old.md', newPath: 'notes/new.md' }),
                }),
            );
        });
    });

    describe('deleteNode', () => {
        it('calls DELETE with path query parameter', async () => {
            mock204();
            await notesApi.deleteNode('ws-1', 'notes/old.md');
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/path?path=notes%2Fold.md',
                expect.objectContaining({ method: 'DELETE' }),
            );
        });
    });

    describe('search', () => {
        it('calls GET with query parameter', async () => {
            const data = { results: [{ path: 'notes/hello.md', matches: [{ line: 1, text: 'hello world' }] }], truncated: false };
            mockOk(data);
            const result = await notesApi.search('ws-1', 'hello world');
            expect(result).toEqual(data);
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/search?q=hello%20world',
                {},
            );
        });
    });

    describe('comment endpoints', () => {
        it('getComments — calls GET with path query param', async () => {
            const sidecar = { noteId: 'notes/hello.md', threads: {} };
            mockOk(sidecar);
            const result = await notesApi.getComments('ws-1', 'notes/hello.md');
            expect(result).toEqual(sidecar);
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments?path=notes%2Fhello.md',
                {},
            );
        });

        it('saveComments — calls PUT with threads body', async () => {
            mock204();
            await notesApi.saveComments('ws-1', 'notes/hello.md', {});
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments',
                expect.objectContaining({
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: 'notes/hello.md', threads: {} }),
                }),
            );
        });

        it('createThread — calls POST with thread payload', async () => {
            const thread = { id: 't1', anchor: { quotedText: 'x', prefix: '', suffix: '' }, status: 'open', comments: [], createdAt: '2025-01-01T00:00:00Z' };
            mockOk({ thread });
            const result = await notesApi.createThread('ws-1', 'notes/hello.md', thread as any);
            expect(result).toEqual({ thread });
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments/thread',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ path: 'notes/hello.md', thread }),
                }),
            );
        });

        it('updateThread — calls PATCH with threadId and status', async () => {
            const thread = { id: 't1', status: 'resolved' };
            mockOk({ thread });
            const result = await notesApi.updateThread('ws-1', 'notes/hello.md', 't1', 'resolved');
            expect(result).toEqual({ thread });
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments/thread',
                expect.objectContaining({
                    method: 'PATCH',
                    body: JSON.stringify({ path: 'notes/hello.md', threadId: 't1', status: 'resolved' }),
                }),
            );
        });

        it('deleteThread — calls DELETE with path and threadId query params', async () => {
            mock204();
            await notesApi.deleteThread('ws-1', 'notes/hello.md', 't1');
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments/thread?path=notes%2Fhello.md&threadId=t1',
                expect.objectContaining({ method: 'DELETE' }),
            );
        });

        it('addComment — calls POST with threadId and content', async () => {
            const comment = { id: 'c1', body: 'Hello', createdAt: '2025-01-01T00:00:00Z' };
            mockOk({ comment });
            const result = await notesApi.addComment('ws-1', 'notes/hello.md', 't1', 'Hello');
            expect(result).toEqual({ comment });
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments/comment',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ path: 'notes/hello.md', threadId: 't1', content: 'Hello' }),
                }),
            );
        });

        it('editComment — calls PATCH with commentId and content', async () => {
            const comment = { id: 'c1', body: 'Updated', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z' };
            mockOk({ comment });
            const result = await notesApi.editComment('ws-1', 'notes/hello.md', 't1', 'c1', 'Updated');
            expect(result).toEqual({ comment });
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments/comment',
                expect.objectContaining({
                    method: 'PATCH',
                    body: JSON.stringify({ path: 'notes/hello.md', threadId: 't1', commentId: 'c1', content: 'Updated' }),
                }),
            );
        });

        it('deleteComment — calls DELETE with path, threadId, and commentId query params', async () => {
            mock204();
            await notesApi.deleteComment('ws-1', 'notes/hello.md', 't1', 'c1');
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/workspaces/ws-1/notes/comments/comment?path=notes%2Fhello.md&threadId=t1&commentId=c1',
                expect.objectContaining({ method: 'DELETE' }),
            );
        });
    });
});
