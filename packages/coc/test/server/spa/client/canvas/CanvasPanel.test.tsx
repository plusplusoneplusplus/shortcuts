/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    getExtension: vi.fn(),
    getExtensionRemote: vi.fn(),
    listVersions: vi.fn(),
    getVersion: vi.fn(),
    listComments: vi.fn(),
    addComment: vi.fn(),
    setCommentStatus: vi.fn(),
    deleteComment: vi.fn(),
    notesSaveContent: vi.fn(),
    copyImageToClipboard: vi.fn(),
    exportCanvasAsHtml: vi.fn(),
}));

// Partial mock: keep the real markdown/format helpers (chatMarkdownToHtml
// depends on them) but stub the clipboard image write so we can assert the
// exact src handed to it without touching the real Clipboard API.
vi.mock('../../../../../src/server/spa/client/react/utils/format', async (importOriginal) => ({
    ...(await importOriginal() as Record<string, unknown>),
    copyImageToClipboard: mocks.copyImageToClipboard,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => {
    const localCanvases = {
        get: mocks.get,
        save: mocks.save,
        list: mocks.list,
        create: mocks.create,
        getExtension: mocks.getExtension,
        listVersions: mocks.listVersions,
        getVersion: mocks.getVersion,
        listComments: mocks.listComments,
        addComment: mocks.addComment,
        setCommentStatus: mocks.setCommentStatus,
        deleteComment: mocks.deleteComment,
    };
    const notes = { saveContent: mocks.notesSaveContent };
    return {
        getSpaCocClient: () => ({ canvases: localCanvases, notes }),
        // A REMOTE clone (registered via the cloneRegistry) routes here. It shares
        // the load surface but has a DISTINCT getExtension so a clone-routed export
        // test can prove the workspace-owning server — not the local client —
        // served the extension document.
        getCocClientFor: () => ({ canvases: { ...localCanvases, getExtension: mocks.getExtensionRemote }, notes }),
    };
});

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

// Layer F wires the "Export as HTML" menu item to the Layer E orchestrator.
// Partial-mock it: keep the real `browserDownload` (which `htmlExportDeps`
// imports) but stub the orchestrator so the UI test asserts dispatch/result
// handling without running the real render pipeline (mermaid/excalidraw, which
// cannot load under Node ≥ 24).
vi.mock('../../../../../src/server/spa/client/react/features/canvas/html-export/exportCanvasAsHtml', async (importOriginal) => ({
    ...(await importOriginal() as Record<string, unknown>),
    exportCanvasAsHtml: mocks.exportCanvasAsHtml,
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
import { ToastContext, type ToastContextValue } from '../../../../../src/server/spa/client/react/contexts/ToastContext';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

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
        mocks.getExtension.mockReset();
        mocks.getExtensionRemote.mockReset();
        mocks.listVersions.mockReset().mockResolvedValue([]);
        mocks.getVersion.mockReset();
        mocks.listComments.mockReset().mockResolvedValue([]);
        mocks.addComment.mockReset();
        mocks.setCommentStatus.mockReset();
        mocks.deleteComment.mockReset();
        mocks.notesSaveContent.mockReset();
        mocks.list.mockReset().mockResolvedValue([]);
        mocks.create.mockReset();
        mocks.copyImageToClipboard.mockReset().mockResolvedValue(undefined);
        mocks.exportCanvasAsHtml.mockReset().mockResolvedValue({ ok: true, warnings: [] });
    });

    const originalFetch = globalThis.fetch;
    const originalClipboardItem = (globalThis as any).ClipboardItem;
    const originalClipboard = navigator.clipboard;
    afterEach(() => {
        // Selection-copy tests overwrite these globals directly; restore them
        // so the mutations don't leak into sibling tests in the worker.
        globalThis.fetch = originalFetch;
        (globalThis as any).ClipboardItem = originalClipboardItem;
        Object.assign(navigator, { clipboard: originalClipboard });
        // The clone-routed test registers a remote workspace in the module-level
        // registry — clear it so sibling tests resolve to the local client.
        resetCloneRegistryForTests();
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

    it('renders an svg fence inside a markdown canvas as an inline sanitized image (AC-04)', async () => {
        const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="red"/></svg>';
        const content = '```svg\n' + svgSource + '\n```';
        mocks.get.mockResolvedValue(makeCanvas({ type: 'markdown', content }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        const fence = preview.querySelector('.md-svg-fence');
        expect(fence).toBeTruthy();
        expect(fence?.getAttribute('data-svg-ready')).toBe('1');
        const host = fence?.querySelector('.md-svg-fence-host') as HTMLElement | null;
        expect(host?.shadowRoot?.querySelector('svg')).toBeTruthy();
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

    it('renders an older kusto revision through the table (read-only), not the markdown pipeline', async () => {
        const kustoState = (rows: (string | number)[][]) => JSON.stringify({
            query: 'StormEvents | take 2',
            clusterUrl: 'https://help.kusto.windows.net',
            database: 'Samples',
            columns: [{ name: 'State', type: 'string' }, { name: 'Count', type: 'long' }],
            rows,
            truncated: false,
            lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: rows.length },
        });
        mocks.get.mockResolvedValue(makeCanvas({
            id: 'kql-abc123', type: 'kusto', revision: 2, content: kustoState([['Texas', 200]]),
        }));
        mocks.listVersions.mockResolvedValue([
            { revision: 2, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:01:00.000Z' },
            { revision: 1, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:00:00.000Z' },
        ]);
        mocks.getVersion.mockResolvedValue({
            revision: 1, title: 'My Plan', editor: 'ai', updatedAt: '2026-06-12T00:00:00.000Z',
            content: kustoState([['Kansas', 55]]),
        });

        render(<CanvasPanel workspaceId="ws-1" canvasId="kql-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-revision').textContent).toBe('rev 2'));
        // Latest kusto view already renders rows via InteractiveTable, keyed by revision.
        expect(screen.getByTestId('interactive-table-kusto-kql-abc123-2')).toBeTruthy();
        expect(screen.getByText('Texas')).toBeTruthy();

        fireEvent.click(screen.getByTestId('canvas-panel-version-older'));
        await waitFor(() => expect(screen.getByTestId('canvas-panel-history-banner')).toBeTruthy());
        expect(mocks.getVersion).toHaveBeenCalledWith('ws-1', 'kql-abc123', 1);

        // Historical rows render through the table keyed by the HISTORICAL revision…
        await waitFor(() => expect(screen.getByTestId('interactive-table-kusto-kql-abc123-1')).toBeTruthy());
        expect(screen.getByText('Kansas')).toBeTruthy();
        // …never through the markdown preview pipeline (the costly path we removed).
        expect(screen.queryByTestId('canvas-panel-preview')).toBeNull();
        // Read-only: no Run button and no Ask-AI affordance while viewing history.
        expect(screen.queryByTestId('kusto-run')).toBeNull();
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
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

    it('gives the selection-bar and comment actions an explicit theme-aware text color so they stay readable in dark mode (regression)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: 'alpha beta gamma' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onAskAi={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
            toString: () => 'beta',
        } as unknown as Selection);
        try {
            fireEvent.mouseUp(screen.getByTestId('canvas-panel-preview'));
            await screen.findByTestId('canvas-panel-selection-bar');

            // Without an explicit color these buttons inherit a dark tone that is
            // unreadable on the dark selection bar. They must set both variants.
            for (const testId of ['canvas-panel-ask-ai', 'canvas-panel-add-comment']) {
                const button = screen.getByTestId(testId);
                expect(button.className).toContain('text-[#1e1e1e]');
                expect(button.className).toContain('dark:text-[#cccccc]');
            }

            // The comment compose "Add" button shares the same overlay and defect.
            fireEvent.click(screen.getByTestId('canvas-panel-add-comment'));
            const submit = await screen.findByTestId('canvas-panel-comment-submit');
            expect(submit.className).toContain('text-[#1e1e1e]');
            expect(submit.className).toContain('dark:text-[#cccccc]');
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

    it('renders SVG code canvases by default and toggles to highlighted source', async () => {
        const source = '<svg viewBox="0 0 100 50"><rect width="100" height="50" fill="red"/></svg>';
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'svg', content: source }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        const host = await screen.findByTestId('svg-canvas-shadow-host');
        expect(host.shadowRoot?.querySelector('svg')).toBeTruthy();
        expect(host.shadowRoot?.querySelector('rect')?.getAttribute('fill')).toBe('red');
        expect(screen.getByTestId('svg-canvas-viewport').className).toContain('block');

        fireEvent.click(screen.getByTestId('svg-canvas-source'));

        expect(screen.getByTestId('svg-canvas-source-view').className).toContain('block');
        const highlighted = screen.getByTestId('svg-canvas-source-view').querySelector('code');
        expect(highlighted?.className).toContain('language-svg');
        expect(highlighted?.textContent).toContain('<svg');

        fireEvent.click(screen.getByTestId('canvas-panel-mode-edit'));
        expect((screen.getByTestId('mock-monaco') as HTMLTextAreaElement).value).toBe(source);
    });

    it.each([
        ['xml', ' \n<svg viewBox="0 0 10 10"><circle r="4"/></svg>'],
        [undefined, '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>'],
    ])('renders %s code canvases as SVG when the content starts with an SVG root', async (language, content) => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language, content }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        const host = await screen.findByTestId('svg-canvas-shadow-host');
        expect(host.shadowRoot?.querySelector('svg')).toBeTruthy();
    });

    it('shows an inline error and escaped source when SVG is malformed', async () => {
        const source = '<svg><rect></svg>';
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'svg', content: source }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        const error = await screen.findByTestId('svg-canvas-error');
        expect(error.textContent).toContain('Invalid SVG');
        expect(error.querySelector('pre')?.textContent).toBe(source);
        expect(error.querySelector('svg')).toBeNull();
    });

    it('mounts only sanitized SVG inside the isolated render surface', async () => {
        mocks.get.mockResolvedValue(makeCanvas({
            type: 'code',
            language: 'svg',
            content: '<svg onload="steal()"><script>steal()</script><rect onclick="steal()" width="10" height="10"/></svg>',
        }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);

        const shadowRoot = (await screen.findByTestId('svg-canvas-shadow-host')).shadowRoot;
        expect(shadowRoot?.querySelector('script')).toBeNull();
        expect(shadowRoot?.querySelector('svg')?.hasAttribute('onload')).toBe(false);
        expect(shadowRoot?.querySelector('rect')?.hasAttribute('onclick')).toBe(false);
    });

    it('zooms and pans the rendered SVG viewport', async () => {
        mocks.get.mockResolvedValue(makeCanvas({
            type: 'code',
            language: 'svg',
            content: '<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
        }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        const viewport = await screen.findByTestId('svg-canvas-viewport');
        vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300,
            toJSON: () => ({}),
        });

        fireEvent.wheel(viewport, { deltaY: -100, clientX: 50, clientY: 50 });
        await waitFor(() => expect(viewport.getAttribute('data-scale')).toBe('1.15'));

        fireEvent.mouseDown(viewport, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseMove(document, { clientX: 30, clientY: 40 });
        fireEvent.mouseUp(document);
        await waitFor(() => {
            expect(Number(viewport.getAttribute('data-translate-x'))).not.toBe(0);
            expect(Number(viewport.getAttribute('data-translate-y'))).not.toBe(0);
        });
    });

    it('downloads raw SVG source with the SVG MIME type and extension', async () => {
        const source = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'svg', content: source }));
        const createObjectURL = vi.fn().mockReturnValue('blob:svg');
        const revokeObjectURL = vi.fn();
        Object.assign(URL, { createObjectURL, revokeObjectURL });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        try {
            render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
            await screen.findByTestId('svg-canvas-shadow-host');

            fireEvent.click(screen.getByTestId('canvas-panel-export'));
            fireEvent.click(screen.getByTestId('canvas-panel-export-download'));

            const blob = createObjectURL.mock.calls[0][0] as Blob;
            expect(blob.type).toBe('image/svg+xml');
            expect(await readBlobText(blob)).toBe(source);
            expect(click.mock.instances[0].download).toBe('doc.svg');
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:svg');
        } finally {
            click.mockRestore();
        }
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

    it('gives the export menu items an explicit dark-mode foreground so they stay readable', async () => {
        mocks.get.mockResolvedValue(makeCanvas());

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));

        // The dropdown paints a dark background (dark:bg-[#252526]); without an explicit
        // dark-mode color these items inherit a near-black default and disappear.
        for (const testId of ['canvas-panel-export-copy', 'canvas-panel-export-download', 'canvas-panel-export-notes']) {
            const item = screen.getByTestId(testId);
            expect(item.className).toContain('text-[#1e1e1e]');
            expect(item.className).toContain('dark:text-[#cccccc]');
        }
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

    // --- Export as HTML (Layer F) -----------------------------------------

    it('exports a markdown canvas as HTML via the orchestrator with the current canvas + deps', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: '# Plan body', language: undefined }));
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: true, html: '<!doctype html>', filename: 'my-plan.html', warnings: [] });

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-html'));

        await waitFor(() => expect(mocks.exportCanvasAsHtml).toHaveBeenCalledTimes(1));
        const [exportable, deps] = mocks.exportCanvasAsHtml.mock.calls[0];
        expect(exportable).toMatchObject({
            title: 'My Plan',
            type: 'markdown',
            content: '# Plan body',
            workspaceId: 'ws-1',
        });
        // The production browser deps are wired in and passed through.
        expect(typeof deps.renderMarkdown).toBe('function');
        expect(typeof deps.fetch).toBe('function');
        expect(typeof deps.triggerDownload).toBe('function');
        expect(typeof deps.exportToSvg).toBe('function');
        expect(deps.mermaidApi && typeof deps.mermaidApi.render).toBe('function');

        // Success feedback + menu closes.
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Exported HTML'));
        expect(screen.queryByTestId('canvas-panel-export-menu')).toBeNull();
    });

    it('offers Export as HTML for code and excalidraw canvases', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'code', language: 'typescript', content: 'const x = 1;' }));
        const { unmount } = render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());
        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        expect(screen.getByTestId('canvas-panel-export-html')).toBeTruthy();
        expect(screen.queryByTestId('canvas-panel-export-html-disabled')).toBeNull();
        unmount();

        const scene = JSON.stringify({ type: 'excalidraw', elements: [], appState: {} });
        mocks.get.mockResolvedValue(makeCanvas({ type: 'excalidraw', content: scene }));
        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());
        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        expect(screen.getByTestId('canvas-panel-export-html')).toBeTruthy();
    });

    it('offers an enabled Export as HTML action for extension canvases (no "soon" disabled item)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'extension', content: '{"cards":[]}' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));

        // The stale disabled "coming soon" item is gone; the real action is enabled.
        expect(screen.queryByTestId('canvas-panel-export-html-disabled')).toBeNull();
        const item = screen.getByTestId('canvas-panel-export-html');
        expect(item.hasAttribute('disabled')).toBe(false);
        expect(item.getAttribute('title')).toContain('view-only');
    });

    it('exports an extension canvas as HTML: fetches the UI doc (clone-routed) and passes { uiHtml, revision } + state to the orchestrator', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'extension', revision: 4, content: '{"cards":[1,2]}' }));
        mocks.getExtension.mockResolvedValue({
            manifest: { description: 'demo', capabilities: [] },
            uiHtml: '<div id="app">hi</div>',
            capabilitiesJs: 'capabilities = {}',
        });
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: true, html: '<!doctype html>', filename: 'my-plan.html', warnings: [] });

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-html'));

        // The extension UI document is retrieved via the workspace-routed client.
        await waitFor(() => expect(mocks.getExtension).toHaveBeenCalledWith('ws-1', 'doc-abc123'));

        await waitFor(() => expect(mocks.exportCanvasAsHtml).toHaveBeenCalledTimes(1));
        const [exportable] = mocks.exportCanvasAsHtml.mock.calls[0];
        expect(exportable).toMatchObject({
            title: 'My Plan',
            type: 'extension',
            content: '{"cards":[1,2]}',
            workspaceId: 'ws-1',
            // uiHtml comes from the fetched doc; the frozen revision rides along.
            // capabilitiesJs is deliberately NOT forwarded — capability code must
            // never ship in a view-only snapshot.
            extension: { uiHtml: '<div id="app">hi</div>', revision: 4 },
        });
        expect(exportable.extension).not.toHaveProperty('capabilitiesJs');

        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Exported HTML'));
    });

    it('routes the extension export through the workspace-owning (remote) client for a remote workspace', async () => {
        // A registered remote workspace resolves useCocClient() to the remote-routed
        // client — the same clone-aware path the panel uses for get/save.
        registerCloneBaseUrls([{ workspaceId: 'ws-remote', baseUrl: 'http://remote.example' }]);
        mocks.get.mockResolvedValue(makeCanvas({ workspaceId: 'ws-remote', type: 'extension', revision: 7, content: '{"cards":[]}' }));
        mocks.getExtensionRemote.mockResolvedValue({
            manifest: { description: 'demo', capabilities: [] },
            uiHtml: '<div>remote ui</div>',
            capabilitiesJs: 'capabilities = {}',
        });
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: true, html: '<!doctype html>', filename: 'my-plan.html', warnings: [] });

        render(<CanvasPanel workspaceId="ws-remote" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-html'));

        // The extension document is served by the remote client; the local one is never touched.
        await waitFor(() => expect(mocks.getExtensionRemote).toHaveBeenCalledWith('ws-remote', 'doc-abc123'));
        expect(mocks.getExtension).not.toHaveBeenCalled();

        await waitFor(() => expect(mocks.exportCanvasAsHtml).toHaveBeenCalledTimes(1));
        const [exportable] = mocks.exportCanvasAsHtml.mock.calls[0];
        expect(exportable).toMatchObject({
            type: 'extension',
            workspaceId: 'ws-remote',
            extension: { uiHtml: '<div>remote ui</div>', revision: 7 },
        });
    });

    it('surfaces a toast and skips the export when the extension UI document cannot be fetched', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ type: 'extension', content: '{"cards":[]}' }));
        mocks.getExtension.mockRejectedValue(new Error('extension gone'));
        const addToast = vi.fn();
        const toastValue: ToastContextValue = { addToast, removeToast: vi.fn(), toasts: [] };

        render(
            <ToastContext.Provider value={toastValue}>
                <CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />
            </ToastContext.Provider>,
        );
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-html'));

        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not load the extension to export as HTML', 'error'));
        // No broken/partial export: the orchestrator is never reached.
        expect(mocks.exportCanvasAsHtml).not.toHaveBeenCalled();
        // Panel stays mounted and reports the failure.
        expect(screen.getByTestId('canvas-panel')).toBeTruthy();
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Export failed'));
    });

    it('surfaces a toast and keeps the panel mounted when the HTML export fails', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        mocks.exportCanvasAsHtml.mockResolvedValue({ ok: false, warnings: [], error: 'render blew up' });
        const addToast = vi.fn();
        const toastValue: ToastContextValue = { addToast, removeToast: vi.fn(), toasts: [] };

        render(
            <ToastContext.Provider value={toastValue}>
                <CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />
            </ToastContext.Provider>,
        );
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-html'));

        await waitFor(() => expect(addToast).toHaveBeenCalledWith('render blew up', 'error'));
        // Panel never crashes on a failed export.
        expect(screen.getByTestId('canvas-panel')).toBeTruthy();
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Export failed'));
    });

    it('reports export warnings as an info toast on a successful HTML export', async () => {
        mocks.get.mockResolvedValue(makeCanvas());
        mocks.exportCanvasAsHtml.mockResolvedValue({
            ok: true, html: '<!doctype html>', filename: 'my-plan.html', warnings: ['image a failed', 'image b failed'],
        });
        const addToast = vi.fn();
        const toastValue: ToastContextValue = { addToast, removeToast: vi.fn(), toasts: [] };

        render(
            <ToastContext.Provider value={toastValue}>
                <CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />
            </ToastContext.Provider>,
        );
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export')).toBeTruthy());

        fireEvent.click(screen.getByTestId('canvas-panel-export'));
        fireEvent.click(screen.getByTestId('canvas-panel-export-html'));

        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Exported HTML with 2 warnings', 'info'));
        await waitFor(() => expect(screen.getByTestId('canvas-panel-export-status').textContent).toBe('Exported HTML'));
    });

    it('opens a custom "Copy image" menu on an inline image right-click and copies its src (AC-01, AC-02)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: '![diagram](assets/diagram.png)' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        const img = preview.querySelector('img.chat-inline-image') as HTMLImageElement | null;
        expect(img).toBeTruthy();

        // Right-clicking the inline image suppresses the native menu (returns
        // false = default prevented) and opens the custom context menu.
        const notPrevented = fireEvent.contextMenu(img!);
        expect(notPrevented).toBe(false);
        expect(screen.getByTestId('context-menu')).toBeTruthy();

        // The menu carries exactly one "Copy image" item.
        const item = screen.getByTestId('context-menu-item-0');
        expect(item.textContent).toContain('Copy image');
        expect(screen.queryByTestId('context-menu-item-1')).toBeNull();

        const expectedSrc = img!.currentSrc || img!.src;
        fireEvent.click(item);

        await waitFor(() => expect(mocks.copyImageToClipboard).toHaveBeenCalledWith(expectedSrc));
        // Menu closes after the action.
        await waitFor(() => expect(screen.queryByTestId('context-menu')).toBeNull());
    });

    it('leaves the native menu untouched when right-clicking off an inline image (AC-01)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: 'plain text, no image' }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        // Right-click on non-image content: no preventDefault (returns true) and
        // no custom menu.
        const notPrevented = fireEvent.contextMenu(preview);
        expect(notPrevented).toBe(true);
        expect(screen.queryByTestId('context-menu')).toBeNull();
        expect(mocks.copyImageToClipboard).not.toHaveBeenCalled();
    });

    it('surfaces an error toast when the inline-image copy fails (AC-03)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: '![remote](https://example.com/pic.png)' }));
        mocks.copyImageToClipboard.mockRejectedValue(new Error('tainted canvas'));
        const addToast = vi.fn();
        const toastValue: ToastContextValue = { addToast, removeToast: vi.fn(), toasts: [] };

        render(
            <ToastContext.Provider value={toastValue}>
                <CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />
            </ToastContext.Provider>,
        );
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const img = screen.getByTestId('canvas-panel-preview').querySelector('img.chat-inline-image') as HTMLImageElement;
        expect(img).toBeTruthy();
        fireEvent.contextMenu(img);
        fireEvent.click(screen.getByTestId('context-menu-item-0'));

        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Failed to copy image', 'error'));
    });

    // --- Native Ctrl+C selection copy with inline images -------------------

    function readBlobText(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
    }

    /** Stub window.getSelection with a range whose clone contains `img`. */
    function stubSelectionSpanning(img: Element, text: string) {
        const frag = document.createDocumentFragment();
        const wrap = document.createElement('p');
        wrap.appendChild(document.createTextNode(text + ' '));
        wrap.appendChild(img.cloneNode(true));
        frag.appendChild(wrap);
        return vi.spyOn(window, 'getSelection').mockReturnValue({
            rangeCount: 1,
            isCollapsed: false,
            getRangeAt: () => ({ cloneContents: () => frag.cloneNode(true) }),
            toString: () => text,
        } as unknown as Selection);
    }

    it('copies a text+image selection with the image inlined as a data-URI (native Ctrl+C)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: '![diagram](assets/diagram.png)' }));
        const write = vi.fn().mockResolvedValue(undefined);
        const captured: Array<{ payload: Record<string, Blob> }> = [];
        (globalThis as any).ClipboardItem = vi.fn(function (this: any, payload: Record<string, Blob>) {
            this.payload = payload;
            captured.push(this);
        });
        Object.assign(navigator, { clipboard: { write } });
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['P'], { type: 'image/png' }) }) as any;

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        const img = preview.querySelector('img.chat-inline-image');
        expect(img).toBeTruthy();
        const selSpy = stubSelectionSpanning(img!, 'diagram');
        try {
            const setData = vi.fn();
            fireEvent.copy(preview, { clipboardData: { setData } });

            // Synchronous fallback: original proxy-URL HTML is written immediately.
            const htmlCall = setData.mock.calls.find(c => c[0] === 'text/html');
            expect(htmlCall?.[1]).toContain('/api/workspaces/ws-1/files/image');
            expect(setData).toHaveBeenCalledWith('text/plain', 'diagram');

            // Async upgrade: clipboard.write receives inlined data-URI HTML.
            await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
            const upgraded = await readBlobText(captured[0].payload['text/html']);
            expect(upgraded).toContain('data:image/png;base64,');
            expect(upgraded).not.toContain('/api/workspaces');
        } finally {
            selSpy.mockRestore();
        }
    });

    it('leaves a text-only selection to the browser native copy (no preventDefault, no clipboard.write)', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: 'plain text, no image' }));
        const write = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { write } });

        render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        const frag = document.createDocumentFragment();
        const p = document.createElement('p');
        p.textContent = 'plain text';
        frag.appendChild(p);
        const selSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
            rangeCount: 1,
            isCollapsed: false,
            getRangeAt: () => ({ cloneContents: () => frag.cloneNode(true) }),
            toString: () => 'plain text',
        } as unknown as Selection);
        try {
            const setData = vi.fn();
            // Not prevented (returns true) → browser keeps its native copy.
            const notPrevented = fireEvent.copy(preview, { clipboardData: { setData } });
            expect(notPrevented).toBe(true);
            expect(setData).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
        } finally {
            selSpy.mockRestore();
        }
    });

    it('surfaces a toast when the async inline-image clipboard upgrade fails', async () => {
        mocks.get.mockResolvedValue(makeCanvas({ content: '![diagram](assets/diagram.png)' }));
        (globalThis as any).ClipboardItem = vi.fn();
        Object.assign(navigator, { clipboard: { write: vi.fn().mockRejectedValue(new Error('denied')) } });
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['P'], { type: 'image/png' }) }) as any;
        const addToast = vi.fn();
        const toastValue: ToastContextValue = { addToast, removeToast: vi.fn(), toasts: [] };

        render(
            <ToastContext.Provider value={toastValue}>
                <CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />
            </ToastContext.Provider>,
        );
        await waitFor(() => expect(screen.getByTestId('canvas-panel-preview')).toBeTruthy());

        const preview = screen.getByTestId('canvas-panel-preview');
        const img = preview.querySelector('img.chat-inline-image');
        const selSpy = stubSelectionSpanning(img!, 'diagram');
        try {
            fireEvent.copy(preview, { clipboardData: { setData: vi.fn() } });
            await waitFor(() => expect(addToast).toHaveBeenCalledWith('Failed to copy image with formatting', 'error'));
        } finally {
            selSpy.mockRestore();
        }
    });

    it('renders a Kusto canvas with the Kusto view and no markdown edit toggle', async () => {
        mocks.get.mockResolvedValue(makeCanvas({
            id: 'expl-abc123',
            title: 'Storm Kusto',
            type: 'kusto',
            content: JSON.stringify({
                query: 'StormEvents | take 3',
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
                columns: [{ name: 'State', type: 'string' }],
                rows: [['Texas']],
                truncated: false,
                lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 1 },
            }),
        }));

        render(<CanvasPanel workspaceId="ws-1" canvasId="expl-abc123" liveEvent={null} />);

        await waitFor(() => expect(screen.getByTestId('kusto-view')).toBeTruthy());
        expect(screen.getByTestId('canvas-panel-kusto-badge')).toBeInTheDocument();
        // Kusto canvases own their editing surface — no markdown Preview/Edit toggle.
        expect(screen.queryByTestId('canvas-panel-mode-edit')).toBeNull();
        expect(screen.getByTestId('kusto-query')).toHaveValue('StormEvents | take 3');
        expect(screen.getByText('Texas')).toBeInTheDocument();
    });

    // AC-07 — the "New Kusto query" affordance is gated on the Kusto flag.
    describe('New Kusto query button (AC-07)', () => {
        afterEach(() => {
            delete (window as any).__DASHBOARD_CONFIG__;
        });

        it('is hidden when the Kusto feature is disabled', async () => {
            delete (window as any).__DASHBOARD_CONFIG__;
            mocks.get.mockResolvedValue(makeCanvas());
            render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} />);
            await waitFor(() => expect(screen.getByTestId('canvas-panel-title')).toBeTruthy());
            expect(screen.queryByTestId('canvas-panel-new-kusto')).toBeNull();
        });

        it('creates a blank Kusto canvas prefilled from the most recent one and selects it', async () => {
            (window as any).__DASHBOARD_CONFIG__ = { kustoEnabled: true };
            mocks.get.mockImplementation(async (_ws: string, id: string) => {
                if (id === 'expl-prev01') {
                    return makeCanvas({
                        id: 'expl-prev01',
                        type: 'kusto',
                        content: JSON.stringify({
                            query: 'T | take 1',
                            clusterUrl: 'https://help.kusto.windows.net',
                            database: 'Samples',
                            columns: [], rows: [], truncated: false,
                        }),
                    });
                }
                return makeCanvas();
            });
            mocks.list.mockResolvedValue([
                makeCanvasSummary({ id: 'expl-prev01', type: 'kusto', updatedAt: '2026-07-18T05:00:00.000Z' }),
                makeCanvasSummary({ id: 'doc-abc123', type: 'markdown', updatedAt: '2026-07-18T06:00:00.000Z' }),
            ]);
            mocks.create.mockResolvedValue(makeCanvas({ id: 'expl-new001', type: 'kusto' }));
            const onSelectCanvas = vi.fn();
            const onCanvasCreated = vi.fn();

            render(
                <CanvasPanel
                    workspaceId="ws-1"
                    canvasId="doc-abc123"
                    liveEvent={null}
                    onSelectCanvas={onSelectCanvas}
                    onCanvasCreated={onCanvasCreated}
                />,
            );

            await waitFor(() => expect(screen.getByTestId('canvas-panel-new-kusto')).toBeTruthy());
            fireEvent.click(screen.getByTestId('canvas-panel-new-kusto'));

            await waitFor(() => expect(mocks.create).toHaveBeenCalled());
            const [ws, request] = mocks.create.mock.calls[0];
            expect(ws).toBe('ws-1');
            expect(request.type).toBe('kusto');
            expect(request.processId).toBe('proc-1');
            const seeded = JSON.parse(request.content);
            expect(seeded.clusterUrl).toBe('https://help.kusto.windows.net');
            expect(seeded.database).toBe('Samples');
            expect(seeded.query).toBe('');
            await waitFor(() => expect(onSelectCanvas).toHaveBeenCalledWith('expl-new001'));
            expect(onCanvasCreated).toHaveBeenCalledWith('expl-new001');
        });

        it('creates with an empty seed when the workspace has no prior Kusto canvas', async () => {
            (window as any).__DASHBOARD_CONFIG__ = { kustoEnabled: true };
            mocks.get.mockResolvedValue(makeCanvas());
            mocks.list.mockResolvedValue([makeCanvasSummary({ id: 'doc-abc123', type: 'markdown' })]);
            mocks.create.mockResolvedValue(makeCanvas({ id: 'expl-new001', type: 'kusto' }));

            render(<CanvasPanel workspaceId="ws-1" canvasId="doc-abc123" liveEvent={null} onSelectCanvas={vi.fn()} />);

            await waitFor(() => expect(screen.getByTestId('canvas-panel-new-kusto')).toBeTruthy());
            fireEvent.click(screen.getByTestId('canvas-panel-new-kusto'));

            await waitFor(() => expect(mocks.create).toHaveBeenCalled());
            const seeded = JSON.parse(mocks.create.mock.calls[0][1].content);
            expect(seeded.clusterUrl).toBe('');
            expect(seeded.database).toBe('');
        });
    });
});
