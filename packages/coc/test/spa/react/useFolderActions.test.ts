/**
 * Tests for useFolderActions hook.
 * Mocks global.fetch to verify correct HTTP method, URL, and body for each action.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderActions } from '../../../src/server/spa/client/react/hooks/useFolderActions';

// Stub getApiBase to return a known prefix
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

function okResponse(): Partial<Response> {
    return { ok: true, status: 200, text: async () => '' };
}

function errorResponse(status: number, body: string): Partial<Response> {
    return { ok: false, status, text: async () => body };
}

describe('useFolderActions', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const wsId = 'ws-1';
    const actions = () => useFolderActions(wsId);

    // ─── renameFolder ────────────────────────────────────────────

    it('renameFolder — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().renameFolder('feature', 'feature-renamed');

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks');
        expect(opts.method).toBe('PATCH');
        expect(JSON.parse(opts.body)).toEqual({ path: 'feature', newName: 'feature-renamed' });
    });

    it('renameFolder — throws on error', async () => {
        fetchMock.mockResolvedValueOnce(errorResponse(409, 'conflict'));
        await expect(actions().renameFolder('feature', 'dup')).rejects.toThrow('409');
    });

    // ─── createSubfolder ─────────────────────────────────────────

    it('createSubfolder — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().createSubfolder('feature', 'sub');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ type: 'folder', name: 'sub', parent: 'feature' });
    });

    // ─── createTask ──────────────────────────────────────────────

    it('createTask — with docType', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().createTask('feature', 'my-task', 'plan');

        const [, opts] = fetchMock.mock.calls[0];
        expect(JSON.parse(opts.body)).toEqual({ name: 'my-task', folder: 'feature', docType: 'plan' });
    });

    it('createTask — without docType', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().createTask('feature', 'my-task');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).toEqual({ name: 'my-task', folder: 'feature' });
        expect(body).not.toHaveProperty('docType');
    });

    // ─── archiveFolder ───────────────────────────────────────────

    it('archiveFolder — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().archiveFolder('feature');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/archive');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ path: 'feature', action: 'archive' });
    });

    // ─── unarchiveFolder ─────────────────────────────────────────

    it('unarchiveFolder — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().unarchiveFolder('archive/feature');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/archive');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ path: 'archive/feature', action: 'unarchive' });
    });

    // ─── moveFolder ──────────────────────────────────────────────

    it('moveFolder — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().moveFolder('feature', 'other');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/move');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ sourcePath: 'feature', destinationFolder: 'other' });
    });

    // ─── moveFolderToWorkspace ────────────────────────────────────

    it('moveFolderToWorkspace — sends destinationWorkspaceId', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().moveFolderToWorkspace('feature', 'ws-2', 'target');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks/move');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({
            sourcePath: 'feature',
            destinationFolder: 'target',
            destinationWorkspaceId: 'ws-2',
        });
    });

    it('moveFolderToWorkspace — empty destination folder', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().moveFolderToWorkspace('feature', 'ws-2', '');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.destinationFolder).toBe('');
        expect(body.destinationWorkspaceId).toBe('ws-2');
    });

    // ─── deleteFolder ────────────────────────────────────────────

    it('deleteFolder — success', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        await actions().deleteFolder('feature');

        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/workspaces/ws-1/tasks');
        expect(opts.method).toBe('DELETE');
        expect(JSON.parse(opts.body)).toEqual({ path: 'feature' });
    });

    // ─── URL encoding ────────────────────────────────────────────

    it('URL encodes wsId with spaces', async () => {
        fetchMock.mockResolvedValueOnce(okResponse());
        const spaceActions = useFolderActions('ws with spaces');
        await spaceActions.renameFolder('f', 'g');

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain(encodeURIComponent('ws with spaces'));
        expect(url).not.toContain('ws with spaces');
    });
});
