/**
 * @vitest-environment jsdom
 *
 * Clone routing (AC-07): for a REMOTE workspace every canvas call the panel
 * makes must go to the workspace-owning server, not the local SPA client.
 *
 * The extraction into kernels is exactly where this can silently regress — a
 * hook that reached for the default client would still pass every same-origin
 * test — so each kernel's surface (load, autosave, versions, comments,
 * save-to-Notes, Kusto creation) is asserted against the remote client here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => {
    const remote = {
        get: vi.fn(), save: vi.fn(), list: vi.fn(), create: vi.fn(),
        listVersions: vi.fn(), getVersion: vi.fn(),
        listComments: vi.fn(), addComment: vi.fn(), setCommentStatus: vi.fn(), deleteComment: vi.fn(),
        notesSaveContent: vi.fn(),
    };
    // Every local method throws: touching the default client is a test failure,
    // not a silent fallback.
    const localFail = (name: string) => vi.fn(() => { throw new Error(`local client used for ${name}`); });
    return {
        remote,
        local: {
            get: localFail('get'), save: localFail('save'), list: localFail('list'), create: localFail('create'),
            listVersions: localFail('listVersions'), getVersion: localFail('getVersion'),
            listComments: localFail('listComments'), addComment: localFail('addComment'),
            setCommentStatus: localFail('setCommentStatus'), deleteComment: localFail('deleteComment'),
            notesSaveContent: localFail('notes.saveContent'),
        },
    };
});

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        canvases: { ...mocks.local, getExtension: vi.fn() },
        notes: { saveContent: mocks.local.notesSaveContent },
    }),
    getCocClientFor: () => ({
        canvases: { ...mocks.remote, getExtension: vi.fn() },
        notes: { saveContent: mocks.remote.notesSaveContent },
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    getMonacoLanguage: () => 'plaintext',
    MonacoFileEditor: () => <textarea data-testid="mock-monaco" />,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', async (importOriginal) => ({
    ...(await importOriginal() as Record<string, unknown>),
    isKustoEnabled: () => true,
}));

import { CanvasPanel } from '../../../../../src/server/spa/client/react/features/canvas/CanvasPanel';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123', workspaceId: 'ws-remote', title: 'Remote Plan', type: 'markdown', revision: 2,
        createdAt: '2026-06-12T00:00:00.000Z', updatedAt: '2026-06-12T00:00:00.000Z',
        processId: 'proc-1', lastEditor: 'ai', content: '# Remote body', ...overrides,
    } as any;
}

describe('CanvasPanel on a remote workspace', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        registerCloneBaseUrls([{ workspaceId: 'ws-remote', baseUrl: 'http://remote.example' }]);
        mocks.remote.get.mockReset().mockResolvedValue(makeCanvas());
        mocks.remote.save.mockReset().mockResolvedValue(makeCanvas({ revision: 3 }));
        mocks.remote.list.mockReset().mockResolvedValue([]);
        mocks.remote.create.mockReset().mockResolvedValue(makeCanvas({ id: 'doc-new', type: 'kusto' }));
        mocks.remote.listVersions.mockReset().mockResolvedValue([
            { revision: 2, editor: 'ai', createdAt: '2026-06-12T02:00:00.000Z' },
            { revision: 1, editor: 'user', createdAt: '2026-06-12T01:00:00.000Z' },
        ]);
        mocks.remote.getVersion.mockReset().mockResolvedValue({ revision: 1, editor: 'user', content: '# rev1' });
        mocks.remote.listComments.mockReset().mockResolvedValue([]);
        mocks.remote.addComment.mockReset().mockImplementation((_ws: string, _id: string, body: any) =>
            Promise.resolve({ id: 'c-new', status: 'open', ...body }));
        mocks.remote.setCommentStatus.mockReset();
        mocks.remote.deleteComment.mockReset().mockResolvedValue(undefined);
        mocks.remote.notesSaveContent.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        resetCloneRegistryForTests();
    });

    async function renderPanel(extra: Record<string, unknown> = {}) {
        render(<CanvasPanel workspaceId="ws-remote" canvasId="doc-abc123" liveEvent={null} {...extra as any} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2'));
    }

    it('loads the canvas, its history, and its comments from the remote server', async () => {
        await renderPanel();

        expect(mocks.remote.get).toHaveBeenCalledWith('ws-remote', 'doc-abc123');
        await waitFor(() => expect(mocks.remote.listVersions).toHaveBeenCalledWith('ws-remote', 'doc-abc123'));
        expect(mocks.remote.listComments).toHaveBeenCalledWith('ws-remote', 'doc-abc123');
    });

    it('autosaves an edit to the remote server against the remote revision', async () => {
        await renderPanel();

        fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
        fireEvent.change(screen.getByTestId('canvas-panel-editor'), { target: { value: '# Edited remotely' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });

        expect(mocks.remote.save).toHaveBeenCalledWith('ws-remote', 'doc-abc123', {
            content: '# Edited remotely', expectedRevision: 2,
        });
    });

    it('fetches an older revision from the remote server', async () => {
        await renderPanel();
        await waitFor(() => expect(screen.getByTestId('canvas-panel-version-older')).not.toHaveProperty('disabled', true));

        fireEvent.click(screen.getByTestId('canvas-panel-version-older'));

        await waitFor(() => expect(mocks.remote.getVersion).toHaveBeenCalledWith('ws-remote', 'doc-abc123', 1));
    });

    it('writes an anchored comment to the remote server', async () => {
        await renderPanel();

        fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
        const editor = screen.getByTestId('canvas-panel-editor') as HTMLTextAreaElement;
        editor.setSelectionRange(0, 6);
        fireEvent.select(editor);
        fireEvent.click(await screen.findByTestId('canvas-panel-add-comment'));
        fireEvent.change(screen.getByTestId('canvas-panel-comment-input'), { target: { value: 'tighten this' } });
        fireEvent.click(screen.getByTestId('canvas-panel-comment-submit'));

        await waitFor(() => expect(mocks.remote.addComment).toHaveBeenCalledWith(
            'ws-remote', 'doc-abc123', { anchorText: '# Remo', body: 'tighten this' },
        ));
    });

    it('saves to the remote workspace Notes tree', async () => {
        await renderPanel();

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-notes'));

        await waitFor(() => expect(mocks.remote.notesSaveContent).toHaveBeenCalledWith(
            'ws-remote', 'canvases/doc.md', '# Remote body',
        ));
    });

    it('creates a Kusto canvas on the remote server', async () => {
        await renderPanel({ onSelectCanvas: vi.fn(), onCanvasCreated: vi.fn() });

        fireEvent.click(screen.getByTestId('canvas-panel-new-kusto'));

        await waitFor(() => expect(mocks.remote.list).toHaveBeenCalledWith('ws-remote'));
        await waitFor(() => expect(mocks.remote.create).toHaveBeenCalledWith('ws-remote', expect.objectContaining({
            type: 'kusto', title: 'Kusto Query', processId: 'proc-1',
        })));
    });
});
