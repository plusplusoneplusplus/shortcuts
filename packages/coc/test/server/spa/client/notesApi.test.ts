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
});
