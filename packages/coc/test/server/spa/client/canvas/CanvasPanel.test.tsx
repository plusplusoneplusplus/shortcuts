/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn(),
    listVersions: vi.fn(),
    getVersion: vi.fn(),
    listComments: vi.fn(),
    addComment: vi.fn(),
    setCommentStatus: vi.fn(),
    deleteComment: vi.fn(),
    notesSaveContent: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        canvases: {
            get: mocks.get,
            save: mocks.save,
            listVersions: mocks.listVersions,
            getVersion: mocks.getVersion,
            listComments: mocks.listComments,
            addComment: mocks.addComment,
            setCommentStatus: mocks.setCommentStatus,
            deleteComment: mocks.deleteComment,
        },
        notes: {
            saveContent: mocks.notesSaveContent,
        },
    }),
}));

// Monaco pulls a real editor bundle — substitute a plain textarea.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    getMonacoLanguage: (fileName: string) => fileName.endsWith('.ts') ? 'typescript' : 'plaintext',
    MonacoFileEditor: ({ value, onChange, language }: { value: string; onChange: (v: string) => void; language: string | null }) => (
        <textarea data-testid="mock-monaco" data-language={language ?? ''} value={value} onChange={e => onChange(e.target.value)} />
    ),
}));

// The markdown pipeline pulls hljs/mermaid — render plain content instead.
vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({ html: content }),
}));

import { CanvasPanel } from '../../../../../src/server/spa/client/react/features/canvas/CanvasPanel';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123',
        workspaceId: 'ws-1',
        title: 'My Plan',
        type: 'markdown',
        revision: 1,
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        processId: 'proc-1',
        lastEditor: 'ai',
        content: '# Plan body',
        ...overrides,
    };
}

function conflictError() {
    return new CocApiError({
        status: 409,
        statusText: 'Conflict',
        url: '/api/workspaces/ws-1/canvases/doc-abc123',
        message: 'revision-conflict',
    });
}

describe('CanvasPanel', () => {
    beforeEach(() => {
        mocks.get.mockReset();
        mocks.save.mockReset();
        mocks.listVersions.mockReset().mockResolvedValue([]);
        mocks.getVersion.mockReset();
        mocks.listComments.mockReset().mockResolvedValue([]);
        mocks.addComment.mockReset();
        mocks.setCommentStatus.mockReset();
        mocks.deleteComment.mockReset();
        mocks.notesSaveContent.mockReset();
    });

    it('loads and renders the canvas title, revision, and preview', async () => {
        mocks.get.mockResolvedValue(makeCanvas());

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        await waitFor(() => {
            expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan');
        });
        expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 1');
        expect(screen.getByTestId('canvas-panel-preview').innerHTML).toContain('# Plan body');
        expect(mocks.get).toHaveBeenCalledWith('ws-1', 'doc-abc123');
    });

    it('autosaves user edits with the expected revision', async () => {
        vi.useFakeTimers();
        try {
            mocks.get.mockResolvedValue(makeCanvas());
            mocks.save.mockResolvedValue(makeCanvas({ revision: 2, content: 'edited', lastEditor: 'user' }));

            render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
            await act(async () => { await vi.runOnlyPendingTimersAsync(); });

            fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
            fireEvent.change(screen.getByTestId('canvas-panel-editor'), { target: { value: 'edited' } });

            await act(async () => { await vi.advanceTimersByTimeAsync(900); });

            expect(mocks.save).toHaveBeenCalledWith('ws-1', 'doc-abc123', {
                content: 'edited',
                expectedRevision: 1,
            });
            expect(screen.getByTestId('canvas-panel-save-state').textContent).toBe('Saved');
            expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2');
        } finally {
            vi.useRealTimers();
        }
    });

    it('shows a conflict banner on a 409 save and reloads on request', async () => {
        vi.useFakeTimers();
        try {
            mocks.get.mockResolvedValue(makeCanvas());
            mocks.save.mockRejectedValue(conflictError());

            render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
            await act(async () => { await vi.runOnlyPendingTimersAsync(); });

            fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
            fireEvent.change(screen.getByTestId('canvas-panel-editor'), { target: { value: 'stale edit' } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });

            expect(screen.getByTestId('canvas-panel-conflict-banner')).toBeTruthy();

            mocks.get.mockResolvedValue(makeCanvas({ revision: 3, content: 'server copy' }));
            fireEvent.click(screen.getByText('Load latest (discards your edits)'));
            await act(async () => { await vi.runOnlyPendingTimersAsync(); });

            expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 3');
            expect(screen.queryByTestId('canvas-panel-conflict-banner')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('refetches on a newer live AI update when there are no local edits', async () => {
        mocks.get.mockResolvedValue(makeCanvas());

        const { rerender } = render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 1'));

        mocks.get.mockResolvedValue(makeCanvas({ revision: 2, content: 'ai update' }));
        rerender(
            <CanvasPanel
                workspaceId="ws-1"
                canvasId="doc-abc123"
                liveEvent={{ canvasId: 'doc-abc123', title: 'My Plan', revision: 2, editor: 'ai' }}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2'));
        expect(screen.getByTestId('canvas-panel-preview').innerHTML).toContain('ai update');
    });

    it('flags a pending remote update instead of clobbering dirty local edits', async () => {
        vi.useFakeTimers();
        try {
            mocks.get.mockResolvedValue(makeCanvas());
            mocks.save.mockImplementation(() => new Promise(() => { /* keep save pending */ }));

            const { rerender } = render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
            await act(async () => { await vi.runOnlyPendingTimersAsync(); });

            fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
            fireEvent.change(screen.getByTestId('canvas-panel-editor'), { target: { value: 'local draft' } });

            rerender(
                <CanvasPanel
                    workspaceId="ws-1"
                    canvasId="doc-abc123"
                    liveEvent={{ canvasId: 'doc-abc123', title: 'My Plan', revision: 5, editor: 'ai' }}
                />,
            );
            await act(async () => { await vi.advanceTimersByTimeAsync(10); });

            expect(screen.getByTestId('canvas-panel-remote-update-banner')).toBeTruthy();
            expect((screen.getByTestId('canvas-panel-editor') as HTMLTextAreaElement).value).toBe('local draft');
        } finally {
            vi.useRealTimers();
        }
    });

    it('steps to an older version read-only and restores it as a new revision', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ revision: 2, content: 'v2' }));
        mocks.listVersions.mockResolvedValue([
            { revision: 2, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:01:00.000Z' },
            { revision: 1, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:00:00.000Z' },
        ]);
        mocks.getVersion.mockResolvedValue({
            revision: 1, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:00:00.000Z', content: 'v1',
        });
        mocks.save.mockResolvedValue(makeCanvas({ revision: 3, content: 'v1', lastEditor: 'user' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2'));

        fireEvent.click(screen.getByTestId('canvas-panel-version-older'));
        await waitFor(() => expect(screen.getByTestId('canvas-panel-history-banner')).toBeTruthy());
        expect(mocks.getVersion).toHaveBeenCalledWith('ws-1', 'doc-abc123', 1);
        expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 1');
        expect(screen.getByTestId('canvas-panel-preview').innerHTML).toContain('v1');
        // Read-only: no edit mode toggle while viewing history
        expect(screen.queryByTestId('canvas-panel-mode-edit')).toBeNull();

        fireEvent.click(screen.getByTestId('canvas-panel-restore'));
        await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('ws-1', 'doc-abc123', {
            content: 'v1',
            expectedRevision: 2,
        }));
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 3'));
        expect(screen.queryByTestId('canvas-panel-history-banner')).toBeNull();
    });

    it('returns from history to the latest revision without restoring', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ revision: 2, content: 'v2' }));
        mocks.listVersions.mockResolvedValue([
            { revision: 2, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:01:00.000Z' },
            { revision: 1, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:00:00.000Z' },
        ]);
        mocks.getVersion.mockResolvedValue({
            revision: 1, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:00:00.000Z', content: 'v1',
        });

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2'));

        fireEvent.click(screen.getByTestId('canvas-panel-version-older'));
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 1'));

        fireEvent.click(screen.getByTestId('canvas-panel-back-to-latest'));
        expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2');
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it('offers Ask AI for a textarea selection and prefills the composer prompt', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: 'alpha beta gamma' }));
        const onAskAi = vi.fn();

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onAskAi={onAskAi} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));

        fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
        const editor = screen.getByTestId('canvas-panel-editor') as HTMLTextAreaElement;
        editor.setSelectionRange(6, 10); // "beta"
        fireEvent.select(editor);

        fireEvent.click(screen.getByTestId('canvas-panel-ask-ai'));
        expect(onAskAi).toHaveBeenCalledTimes(1);
        const prompt = onAskAi.mock.calls[0][0] as string;
        expect(prompt).toContain('beta');
        expect(prompt).toContain('canvasId: doc-abc123');
        expect(prompt).toContain('revision 1');
        expect(screen.queryByTestId('canvas-panel-selection-bar')).toBeNull();
    });

    it('adds an anchored comment from a selection', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: 'alpha beta gamma' }));
        mocks.addComment.mockResolvedValue({
            id: 'c1', anchorText: 'beta', body: 'tighten this', status: 'open',
            createdAt: '2026-06-12T00:00:00.000Z', updatedAt: '2026-06-12T00:00:00.000Z',
        });

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));

        fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
        const editor = screen.getByTestId('canvas-panel-editor') as HTMLTextAreaElement;
        editor.setSelectionRange(6, 10);
        fireEvent.select(editor);

        fireEvent.click(screen.getByTestId('canvas-panel-add-comment'));
        fireEvent.change(screen.getByTestId('canvas-panel-comment-input'), { target: { value: 'tighten this' } });
        fireEvent.click(screen.getByTestId('canvas-panel-comment-submit'));

        await waitFor(() => expect(screen.getByTestId('canvas-comment-c1')).toBeTruthy());
        expect(mocks.addComment).toHaveBeenCalledWith('ws-1', 'doc-abc123', {
            anchorText: 'beta',
            body: 'tighten this',
        });
    });

    it('sends open comments to the AI and marks them sent', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const openComment = {
            id: 'c1', anchorText: 'Plan body', body: 'expand step 2', status: 'open',
            createdAt: '2026-06-12T00:00:00.000Z', updatedAt: '2026-06-12T00:00:00.000Z',
        };
        mocks.listComments.mockResolvedValue([openComment]);
        mocks.setCommentStatus.mockResolvedValue({ ...openComment, status: 'sent' });
        const onSendToAi = vi.fn().mockResolvedValue(undefined);

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onSendToAi={onSendToAi} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-send-comments')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-send-comments'));

        await waitFor(() => expect(mocks.setCommentStatus).toHaveBeenCalledWith('ws-1', 'doc-abc123', 'c1', 'sent'));
        const message = onSendToAi.mock.calls[0][0] as string;
        expect(message).toContain('expand step 2');
        expect(message).toContain('update_canvas');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-send-comments')).toBeNull());
        expect(screen.getByTestId('canvas-comment-c1').textContent).toContain('sent');
    });

    it('renders code canvases with a language chip, fenced preview, and Monaco editing', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'typescript', content: 'const x = 1;' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-language').textContent).toBe('typescript'));

        // Preview content is wrapped in a fenced block for highlighting
        const preview = screen.getByTestId('canvas-panel-preview');
        expect(preview.innerHTML).toContain('````typescript');
        expect(preview.innerHTML).toContain('const x = 1;');

        fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
        const monaco = screen.getByTestId('mock-monaco') as HTMLTextAreaElement;
        expect(monaco.value).toBe('const x = 1;');
        expect(screen.queryByTestId('canvas-panel-editor')).toBeNull();
    });

    it('autosaves Monaco edits on code canvases', async () => {
        vi.useFakeTimers();
        try {
            mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'typescript', content: 'const x = 1;' }));
            mocks.save.mockResolvedValue(makeCanvas({ type: 'code', language: 'typescript', revision: 2, content: 'const x = 2;' }));

            render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
            await act(async () => { await vi.runOnlyPendingTimersAsync(); });

            fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
            fireEvent.change(screen.getByTestId('mock-monaco'), { target: { value: 'const x = 2;' } });
            await act(async () => { await vi.advanceTimersByTimeAsync(900); });

            expect(mocks.save).toHaveBeenCalledWith('ws-1', 'doc-abc123', {
                content: 'const x = 2;',
                expectedRevision: 1,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('copies canvas content from the export menu', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-copy'));

        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Copied'));
        expect(writeText).toHaveBeenCalledWith('# Plan body');
    });

    it('saves markdown canvases to Notes and hides the option for code canvases', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        mocks.notesSaveContent.mockResolvedValue({});

        const { unmount } = render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-notes'));

        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Saved to Notes'));
        expect(mocks.notesSaveContent).toHaveBeenCalledWith('ws-1', 'canvases/doc.md', '# Plan body');

        unmount();
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'typescript', content: 'const x = 1;' }));
        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        expect(screen.queryByTestId('canvas-panel-export-notes')).toBeNull();
        expect(screen.getByTestId('canvas-panel-export-download')).toBeTruthy();
    });
});
