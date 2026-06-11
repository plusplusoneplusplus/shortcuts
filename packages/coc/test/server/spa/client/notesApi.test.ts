import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesApi } from '../../../../src/server/spa/client/react/features/notes/notesApi';
import { resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
    isCommitChatLensEnabled: vi.fn(() => false),
}));

import { isCommitChatLensEnabled } from '../../../../src/server/spa/client/react/utils/config';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
}

describe('notesApi', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        resetSpaCocClientForTests();
        globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        vi.resetAllMocks();
    });

    it('uses the typed client for note CRUD routes with encoded workspace and query paths', async () => {
        mockFetch
            .mockResolvedValueOnce(jsonResponse({ tree: [], notesRoot: 'notes' }))
            .mockResolvedValueOnce(jsonResponse({ content: '# Hello', path: 'Notebook/Page One.md', mtime: 1 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));

        await expect(notesApi.getTree('ws/special chars')).resolves.toEqual({ tree: [], notesRoot: 'notes' });
        await expect(notesApi.getContent('ws/special chars', 'Notebook/Page One.md')).resolves.toMatchObject({ content: '# Hello' });
        await expect(notesApi.deleteNode('ws/special chars', 'Notebook/Old Page.md')).resolves.toBeUndefined();

        expect(mockFetch.mock.calls.map(call => call[0])).toEqual([
            '/api/workspaces/ws%2Fspecial%20chars/notes/tree',
            '/api/workspaces/ws%2Fspecial%20chars/notes/content?path=Notebook%2FPage+One.md',
            '/api/workspaces/ws%2Fspecial%20chars/notes/path?path=Notebook%2FOld+Page.md',
        ]);
        expect(mockFetch.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
    });

    it('preserves enriched 409 conflict errors for saveContent', async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse(
            { reason: 'mtime-mismatch', currentMtime: 20 },
            { status: 409, statusText: 'Conflict' },
        ));

        await expect(notesApi.saveContent('ws-1', 'Page.md', '# Updated', 10)).rejects.toMatchObject({
            message: 'conflict',
            status: 409,
            reason: 'mtime-mismatch',
            currentMtime: 20,
        });
    });

    it('uses typed note comment routes with encoded thread and comment IDs', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

        await notesApi.deleteComment('ws-1', 'Notebook/Page.md', 'thread/1', 'comment/2');

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/workspaces/ws-1/notes/comments/thread/thread%2F1/comment/comment%2F2?path=Notebook%2FPage.md',
            expect.objectContaining({ method: 'DELETE' }),
        );
    });

    it('uses typed notes git and AI helper routes', async () => {
        mockFetch
            .mockResolvedValueOnce(jsonResponse({ initialized: true, branch: 'main', clean: true, staged: [], unstaged: [], untracked: [], totalChanges: 0 }))
            .mockResolvedValueOnce(jsonResponse({ taskId: 'task-1' }))
            .mockResolvedValueOnce(jsonResponse({ enabled: true, intervalMs: 900_000 }));

        await notesApi.getGitStatus('repo/a');
        await notesApi.createWithAI('repo/a', 'Create note');
        await notesApi.enableAutoCommit('repo/a', 900_000);

        expect(mockFetch.mock.calls.map(call => call[0])).toEqual([
            '/api/workspaces/repo%2Fa/notes/git/status',
            '/api/workspaces/repo%2Fa/notes/ai-create',
            '/api/workspaces/repo%2Fa/notes/git/auto-commit',
        ]);
        expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
        expect(mockFetch.mock.calls[2][1]?.body).toBe(JSON.stringify({ intervalMs: 900_000 }));
    });

    it('includes inherited Lens Chat mode when creating notes with Lens enabled', async () => {
        vi.mocked(isCommitChatLensEnabled).mockReturnValue(true);
        mockFetch.mockResolvedValueOnce(jsonResponse({ taskId: 'task-1' }));

        await notesApi.createWithAI('repo/a', 'Create note');

        expect(mockFetch.mock.calls[0][1]?.body).toBe(JSON.stringify({
            prompt: 'Create note',
            lensChat: { inherited: true, source: 'features.commitChatLens' },
        }));
    });

    it('omits inherited Lens Chat mode when creating notes with Lens disabled', async () => {
        vi.mocked(isCommitChatLensEnabled).mockReturnValue(false);
        mockFetch.mockResolvedValueOnce(jsonResponse({ taskId: 'task-1' }));

        await notesApi.createWithAI('repo/a', 'Create note');

        expect(mockFetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ prompt: 'Create note' }));
    });
});
