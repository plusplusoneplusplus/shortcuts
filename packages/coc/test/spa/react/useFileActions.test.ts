/**
 * Tests for useFileActions hook.
 * Verifies correct HTTP method, URL, and body for each action,
 * with focus on the new moveFileToWorkspace cross-workspace move.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileActions } from '../../../src/server/spa/client/react/hooks/useFileActions';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

function okResponse(): Partial<Response> {
    return { ok: true, status: 200, text: async () => '' };
}

function errorResponse(status: number, body: string): Partial<Response> {
    return { ok: false, status, text: async () => body };
}

describe('useFileActions', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const wsId = 'ws-1';
    const actions = () => useFileActions(wsId);

    // ─── moveFile ────────────────────────────────────────────────

    it('moveFile — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().moveFile('task.md', 'target');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/move');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ sourcePath: 'task.md', destinationFolder: 'target' });
    });

    // ─── moveFileToWorkspace ─────────────────────────────────────

    it('moveFileToWorkspace — sends destinationWorkspaceId', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().moveFileToWorkspace('task.md', 'ws-2', 'target');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/move');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({
            sourcePath: 'task.md',
            destinationFolder: 'target',
            destinationWorkspaceId: 'ws-2',
        });
    });

    it('moveFileToWorkspace — empty destination folder', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().moveFileToWorkspace('task.md', 'ws-2', '');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.destinationFolder).toBe('');
        expect(body.destinationWorkspaceId).toBe('ws-2');
    });

    it('moveFileToWorkspace — throws on error', async () => {
        fetchMock.mockResolvedValueOnce(errorResponse(404, 'not found'));
        await expect(actions().moveFileToWorkspace('task.md', 'ws-bad', '')).rejects.toThrow('404');
    });

    // ─── renameFile ──────────────────────────────────────────────

    it('renameFile — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().renameFile('task.md', 'renamed.md');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks');
        expect(opts.method).toBe('PATCH');
        expect(JSON.parse(opts.body)).toEqual({ path: 'task.md', newName: 'renamed.md' });
    });

    // ─── updateStatus ────────────────────────────────────────────

    it('updateStatus — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().updateStatus('task.md', 'done');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks');
        expect(opts.method).toBe('PATCH');
        expect(JSON.parse(opts.body)).toEqual({ path: 'task.md', status: 'done' });
    });

    // ─── archiveFile ─────────────────────────────────────────────

    it('archiveFile — calls POST /workspaces/{wsId}/tasks/archive with action:archive', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().archiveFile('task.md');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/archive');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ path: 'task.md', action: 'archive' });
    });

    it('archiveFile — throws on server error (500)', async () => {
        fetchMock.mockResolvedValueOnce(errorResponse(500, 'internal'));
        await expect(actions().archiveFile('task.md')).rejects.toThrow('500');
    });

    // ─── unarchiveFile ───────────────────────────────────────────

    it('unarchiveFile — calls POST /workspaces/{wsId}/tasks/archive with action:unarchive', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().unarchiveFile('task.md');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/archive');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ path: 'task.md', action: 'unarchive' });
    });

    it('unarchiveFile — throws on server error (500)', async () => {
        fetchMock.mockResolvedValueOnce(errorResponse(500, 'internal'));
        await expect(actions().unarchiveFile('task.md')).rejects.toThrow('500');
    });

    // ─── deleteFile ──────────────────────────────────────────────

    it('deleteFile — calls DELETE /workspaces/{wsId}/tasks with { path }', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().deleteFile('task.md');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks');
        expect(opts.method).toBe('DELETE');
        expect(JSON.parse(opts.body)).toEqual({ path: 'task.md' });
    });

    it('deleteFile — throws on server error (404)', async () => {
        fetchMock.mockResolvedValueOnce(errorResponse(404, 'not found'));
        await expect(actions().deleteFile('missing.md')).rejects.toThrow('404');
    });

    // ─── Content-Type header ─────────────────────────────────────

    it('all actions — include Content-Type: application/json header', async () => {
        fetchMock.mockResolvedValue(okResponse());
        const a = actions();
        await a.renameFile('f.md', 'g.md');
        await a.archiveFile('f.md');
        await a.deleteFile('f.md');

        for (const call of fetchMock.mock.calls) {
            expect(call[1].headers).toEqual({ 'Content-Type': 'application/json' });
        }
    });

    // ─── URL encoding ────────────────────────────────────────────

    it('URL encodes wsId with special characters', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        const spaceActions = useFileActions('ws with spaces');
        await spaceActions.renameFile('f.md', 'g.md');

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain(encodeURIComponent('ws with spaces'));
        expect(url).not.toContain('ws with spaces');
    });
});
