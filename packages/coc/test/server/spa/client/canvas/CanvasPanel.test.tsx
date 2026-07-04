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

vi.mock('../../../../../src/server/spa/client/react/features/canvas/ExtensionCanvasView', () => ({
    ExtensionCanvasView: ({ canvas }: { canvas: { id: string } }) => (
        <div data-testid="mock-extension-view" data-canvas-id={canvas.id}>extension</div>
    ),
}));

// @excalidraw/excalidraw can't load in Node; the global setup stubs it to
// render nothing. Override locally so the excalidraw render branch is
// observable: surface the element count handed to the viewer so the test can
// assert the canvas scene actually reached <Excalidraw>. The companion
// normalizers are identity passthroughs, mirroring the global setup mock.
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: ({ initialData }: { initialData: { elements?: unknown[] } }) => (
        <div
            data-testid="mock-excalidraw"
            data-element-count={Array.isArray(initialData?.elements) ? initialData.elements.length : 0}
        />
    ),
    restoreElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
    convertToExcalidrawElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
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

function makeCanvasSummary(overrides: Record<string, unknown> = {}) {
    const summary = makeCanvas(overrides);
    delete (summary as Record<string, unknown>).content;
    return summary;
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
        // Clean render: the `#` heading marker is gone; the heading is semantic HTML.
        const preview = screen.getByTestId('canvas-panel-preview');
        expect(preview.querySelector('h1')?.textContent).toBe('Plan body');
        expect(preview.innerHTML).not.toContain('# Plan body');
        expect(mocks.get).toHaveBeenCalledWith('ws-1', 'doc-abc123');
    });

    it('keeps a single-canvas title as plain text with no switcher affordance', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const onSelectCanvas = vi.fn();

        render(
            <CanvasPanel
                workspaceId="ws-1"
                canvasId="doc-abc123"
                liveEvent={null}
                availableCanvases={[makeCanvasSummary()] as any}
                onSelectCanvas={onSelectCanvas}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));
        expect(screen.queryByTestId('canvas-panel-title-chevron')).toBeNull();

        fireEvent.click(screen.getByTestId('canvas-panel-title'));
        expect(screen.queryByTestId('canvas-panel-title-menu')).toBeNull();
        expect(onSelectCanvas).not.toHaveBeenCalled();
    });

    it('opens a title dropdown for multiple canvases and switches the active canvas', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const onSelectCanvas = vi.fn();
        const availableCanvases = [
            makeCanvasSummary({ id: 'doc-abc123', title: 'My Plan', type: 'markdown' }),
            makeCanvasSummary({ id: 'code-abc123', title: 'Helper Script', type: 'code', language: 'typescript' }),
            makeCanvasSummary({ id: 'diagram-abc123', title: 'Flow Diagram', type: 'excalidraw' }),
        ];

        render(
            <CanvasPanel
                workspaceId="ws-1"
                canvasId="doc-abc123"
                liveEvent={null}
                availableCanvases={availableCanvases as any}
                onSelectCanvas={onSelectCanvas}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));
        expect(screen.getByTestId('canvas-panel-title-chevron')).toBeTruthy();

        fireEvent.click(screen.getByTestId('canvas-panel-title'));

        const options = screen.getAllByTestId('canvas-panel-title-option');
        expect(options.map(option => option.textContent)).toEqual(['My Plan', 'Helper Script', 'Flow Diagram']);
        expect(options[0].getAttribute('aria-current')).toBe('true');
        expect(options[1].getAttribute('aria-current')).toBeNull();

        fireEvent.click(options[1]);

        expect(onSelectCanvas).toHaveBeenCalledWith('code-abc123');
        expect(screen.queryByTestId('canvas-panel-title-menu')).toBeNull();
    });

    it('gives the single-canvas title an explicit foreground so it stays readable in dark mode', async () => {
        mocks.get.mockResolvedValue(makeCanvas());

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));
        // Header sets only a dark background (dark:bg-[#1e1e1e]); without an explicit
        // dark-mode color the title inherits a near-black default and vanishes.
        const title = screen.getByTestId('canvas-panel-title');
        expect(title.className).toContain('text-[#1e1e1e]');
        expect(title.className).toContain('dark:text-[#cccccc]');
    });

    it('gives the multi-canvas switcher title an explicit dark-mode foreground', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const availableCanvases = [
            makeCanvasSummary({ id: 'doc-abc123', title: 'My Plan', type: 'markdown' }),
            makeCanvasSummary({ id: 'code-abc123', title: 'Helper Script', type: 'code', language: 'typescript' }),
        ];

        render(
            <CanvasPanel
                workspaceId="ws-1"
                canvasId="doc-abc123"
                liveEvent={null}
                availableCanvases={availableCanvases as any}
                onSelectCanvas={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));
        const title = screen.getByTestId('canvas-panel-title');
        expect(title.className).toContain('text-[#1e1e1e]');
        expect(title.className).toContain('dark:text-[#cccccc]');
    });

    it('renders the preview as clean markdown with no source markers (AC-01)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: '### Heading\n\nsome **bold** text' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        // Headings and bold render as semantic HTML…
        expect(preview.querySelector('h3')?.textContent).toBe('Heading');
        expect(preview.querySelector('strong')?.textContent).toBe('bold');
        // …with none of the raw markdown source characters left visible.
        expect(preview.innerHTML).not.toContain('###');
        expect(preview.innerHTML).not.toContain('**bold**');
    });

    it('marks the preview for canvas-specific Mermaid sizing', async () => {
        mocks.get.mockResolvedValue(makeCanvas({
            content: '```mermaid\nflowchart TD\n  A --> B\n```',
        }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));
        expect(screen.getByTestId('canvas-panel-preview').className).toContain('canvas-mermaid-preview');
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

    it('renders the selection bar and comment compose box as absolute overlays so toggling them never shifts the preview text (regression)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: 'alpha beta gamma' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onAskAi={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        // Nothing selected yet: the action bar is absent.
        expect(screen.queryByTestId('canvas-panel-selection-bar')).toBeNull();

        // Double-clicking a word in the preview selects it and surfaces the bar.
        const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
            toString: () => 'beta',
        } as unknown as Selection);
        try {
            fireEvent.mouseUp(screen.getByTestId('canvas-panel-preview'));

            const bar = await screen.findByTestId('canvas-panel-selection-bar');
            // Out of normal flow (overlay) so it floats over the text instead of pushing it down.
            expect(bar.className).toContain('absolute');
            expect(bar.className).toContain('top-0');
            // The bar must not wrap the preview — the text stays in its own sibling scroll container.
            const preview = screen.getByTestId('canvas-panel-preview');
            expect(bar.contains(preview)).toBe(false);
            // Its offset parent is the relative body wrapper, which also holds the preview.
            const wrapper = bar.parentElement as HTMLElement;
            expect(wrapper.className).toContain('relative');
            expect(wrapper.contains(preview)).toBe(true);

            // The comment compose box replaces the bar and is likewise an overlay.
            fireEvent.click(screen.getByTestId('canvas-panel-add-comment'));
            const compose = await screen.findByTestId('canvas-panel-comment-compose');
            expect(compose.className).toContain('absolute');
            expect(compose.className).toContain('top-0');
            expect(compose.contains(preview)).toBe(false);
        } finally {
            getSelectionSpy.mockRestore();
        }
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
        expect(message).toContain('write_canvas');
        await waitFor(() => expect(screen.queryByTestId('canvas-panel-send-comments')).toBeNull());
        expect(screen.getByTestId('canvas-comment-c1').textContent).toContain('sent');
    });

    it('renders code canvases with a language chip, fenced preview, and Monaco editing', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'typescript', content: 'const x = 1;' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-language').textContent).toBe('typescript'));

        // Code canvas content renders as a clean fenced code block (no literal
        // backtick fence markers), still tagged with its language for highlighting.
        const preview = screen.getByTestId('canvas-panel-preview');
        const code = preview.querySelector('code');
        expect(code?.className).toContain('language-typescript');
        expect(code?.textContent).toContain('const x = 1;');
        expect(preview.innerHTML).not.toContain('````');

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

    it('shows a pop-out button only when onPopOut is provided and invokes it', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const onPopOut = vi.fn();

        const { rerender, unmount } = render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));
        expect(screen.queryByTestId('canvas-panel-popout')).toBeNull();

        rerender(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onPopOut={onPopOut} />);
        fireEvent.click(screen.getByTestId('canvas-panel-popout'));
        expect(onPopOut).toHaveBeenCalledTimes(1);
        unmount();
    });

    it('reloads from the server when reloadNonce changes', async () => {
        mocks.get.mockResolvedValue(makeCanvas());

        const { rerender } = render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} reloadNonce={0} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 1'));
        expect(mocks.get).toHaveBeenCalledTimes(1);

        mocks.get.mockResolvedValue(makeCanvas({ revision: 4, content: 'refetched' }));
        rerender(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} reloadNonce={1} />);

        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 4'));
        expect(mocks.get).toHaveBeenCalledTimes(2);
    });

    it('toggles fullscreen and exits on Escape', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        const onFullscreenChange = vi.fn();

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onFullscreenChange={onFullscreenChange} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-title').textContent).toBe('My Plan'));

        const panel = screen.getByTestId('canvas-panel');
        expect(panel.getAttribute('data-fullscreen')).toBe('false');

        fireEvent.click(screen.getByTestId('canvas-panel-fullscreen'));
        expect(panel.getAttribute('data-fullscreen')).toBe('true');
        expect(panel.className).toContain('fixed');
        expect(onFullscreenChange).toHaveBeenLastCalledWith(true);

        act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
        expect(screen.getByTestId('canvas-panel').getAttribute('data-fullscreen')).toBe('false');
        expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
    });

    it('renders extension canvases through the sandboxed iframe view with an extension badge', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'extension', content: '{"cards":[]}' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        await waitFor(() => expect(screen.getByTestId('canvas-panel-extension-badge')).toBeTruthy());
        expect(screen.getByTestId('mock-extension-view')).toBeTruthy();
        // Extension canvases do not show the markdown preview pane
        expect(screen.queryByTestId('canvas-panel-preview')).toBeNull();
    });

    it('renders excalidraw canvases through the view-only Excalidraw viewer with a diagram badge', async () => {
        const scene = JSON.stringify({
            type: 'excalidraw',
            elements: [
                { id: 'r1', type: 'rectangle', x: 10, y: 10, width: 100, height: 60 },
                { id: 't1', type: 'text', x: 20, y: 30, width: 80, height: 20, text: 'Hi' },
            ],
            appState: {},
        });
        mocks.get.mockResolvedValue(makeCanvas({ type: 'excalidraw', content: scene }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        await waitFor(() => expect(screen.getByTestId('canvas-panel-excalidraw-badge')).toBeTruthy());
        // The Excalidraw viewer mounts and receives the parsed scene elements.
        const viewer = screen.getByTestId('canvas-panel-excalidraw');
        expect(viewer).toBeTruthy();
        expect(screen.getByTestId('mock-excalidraw').getAttribute('data-element-count')).toBe('2');
        // Diagrams never go through the markdown preview pane.
        expect(screen.queryByTestId('canvas-panel-preview')).toBeNull();
    });

    it('exposes no edit affordance for excalidraw canvases (view-only)', async () => {
        const scene = JSON.stringify({ type: 'excalidraw', elements: [], appState: {} });
        mocks.get.mockResolvedValue(makeCanvas({ type: 'excalidraw', content: scene }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-excalidraw-badge')).toBeTruthy());

        // No Preview/Edit toggle and no editor surfaces for a view-only diagram.
        expect(screen.queryByTestId('canvas-panel-mode-edit')).toBeNull();
        expect(screen.queryByTestId('canvas-panel-mode-preview')).toBeNull();
        expect(screen.queryByTestId('canvas-panel-editor')).toBeNull();
        expect(screen.queryByTestId('mock-monaco')).toBeNull();
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
