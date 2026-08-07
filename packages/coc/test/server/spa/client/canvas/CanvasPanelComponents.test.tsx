/**
 * @vitest-environment jsdom
 *
 * The canvas panel's presentational pieces, driven directly by props: banners,
 * selection toolbar, comments panel, and the body renderer's branch precedence.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    getMonacoLanguage: () => 'plaintext',
    MonacoFileEditor: ({ value }: { value: string }) => <textarea data-testid="mock-monaco" defaultValue={value} />,
}));

vi.mock('../../../../../src/server/spa/client/react/features/canvas/ExtensionCanvasView', () => ({
    ExtensionCanvasView: () => <div data-testid="mock-extension-view" />,
}));

vi.mock('../../../../../src/server/spa/client/react/features/canvas/KustoView', () => ({
    KustoView: ({ readOnly, canvas }: { readOnly: boolean; canvas: { revision: number } }) => (
        <div data-testid="mock-kusto-view" data-readonly={String(readOnly)} data-revision={canvas.revision} />
    ),
}));

import { CanvasPanelBanners } from '../../../../../src/server/spa/client/react/features/canvas/components/CanvasPanelBanners';
import { CanvasSelectionToolbar } from '../../../../../src/server/spa/client/react/features/canvas/components/CanvasSelectionToolbar';
import { CanvasCommentsPanel } from '../../../../../src/server/spa/client/react/features/canvas/components/CanvasCommentsPanel';
import { CanvasBodyRenderer } from '../../../../../src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer';
import { canvasKind } from '../../../../../src/server/spa/client/react/features/canvas/canvas-panel-model';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123', workspaceId: 'ws-1', title: 'My Plan', type: 'markdown', revision: 3,
        createdAt: '2026-06-12T00:00:00.000Z', updatedAt: '2026-06-12T00:00:00.000Z',
        lastEditor: 'ai', content: '# Plan body', ...overrides,
    } as any;
}

const NO_BANNERS = {
    canvas: makeCanvas(), viewingVersion: null, dirty: false, restoring: false,
    onRestore: () => {}, onBackToLatest: () => {},
    saveState: 'idle' as const, remoteUpdatePending: false, onLoadLatest: () => {},
};

describe('CanvasPanelBanners', () => {
    it('renders nothing in the resting state', () => {
        const { container } = render(<CanvasPanelBanners {...NO_BANNERS} />);
        expect(container.textContent).toBe('');
    });

    it('names the browsed revision, its editor, and offers restore', () => {
        const onRestore = vi.fn();
        render(<CanvasPanelBanners
            {...NO_BANNERS}
            viewingVersion={{ revision: 1, editor: 'ai', content: 'old' } as any}
            onRestore={onRestore}
        />);

        expect(screen.getByTestId('canvas-panel-history-banner').textContent).toContain('Viewing rev 1 of 3 (AI, read-only)');
        fireEvent.click(screen.getByTestId('canvas-panel-restore'));
        expect(onRestore).toHaveBeenCalled();
    });

    it('blocks restore while there are unsaved edits, and explains why', () => {
        render(<CanvasPanelBanners
            {...NO_BANNERS}
            viewingVersion={{ revision: 1, editor: 'user', content: 'old' } as any}
            dirty
        />);

        const restore = screen.getByTestId('canvas-panel-restore') as HTMLButtonElement;
        expect(restore.disabled).toBe(true);
        expect(restore.title).toContain('unsaved edits');
    });

    it('shows the conflict banner alone, never alongside the remote-update banner', () => {
        render(<CanvasPanelBanners {...NO_BANNERS} saveState="conflict" remoteUpdatePending />);

        expect(screen.getByTestId('canvas-panel-conflict-banner')).toBeTruthy();
        expect(screen.queryByTestId('canvas-panel-remote-update-banner')).toBeNull();
    });

    it('offers "load latest" from the remote-update banner', () => {
        const onLoadLatest = vi.fn();
        render(<CanvasPanelBanners {...NO_BANNERS} remoteUpdatePending onLoadLatest={onLoadLatest} />);

        fireEvent.click(screen.getByTestId('canvas-panel-remote-update-banner').querySelector('button')!);
        expect(onLoadLatest).toHaveBeenCalled();
    });
});

const NO_SELECTION = {
    selection: null, visible: true, onStartComment: () => {},
    commentAnchor: null, commentDraft: '', onCommentDraftChange: () => {},
    onSubmitComment: () => {}, onCancelComment: () => {},
};

describe('CanvasSelectionToolbar', () => {
    it('stays hidden while browsing history, even with a live selection', () => {
        render(<CanvasSelectionToolbar {...NO_SELECTION} selection="some text" visible={false} />);
        expect(screen.queryByTestId('canvas-panel-selection-bar')).toBeNull();
    });

    it('hides Ask AI when the host has no composer to prefill', () => {
        render(<CanvasSelectionToolbar {...NO_SELECTION} selection="some text" />);
        expect(screen.queryByTestId('canvas-panel-ask-ai')).toBeNull();
        expect(screen.getByTestId('canvas-panel-add-comment')).toBeTruthy();
    });

    it('floats both overlays absolutely so toggling them never shifts the text underneath', () => {
        render(<CanvasSelectionToolbar {...NO_SELECTION} selection="some text" commentAnchor="anchor" />);
        expect(screen.getByTestId('canvas-panel-selection-bar').className).toContain('absolute');
        expect(screen.getByTestId('canvas-panel-comment-compose').className).toContain('absolute');
    });

    it('submits the comment on Enter and disables Add for a blank draft', () => {
        const onSubmitComment = vi.fn();
        const { rerender } = render(<CanvasSelectionToolbar
            {...NO_SELECTION} commentAnchor="anchor" commentDraft="   " onSubmitComment={onSubmitComment}
        />);
        expect((screen.getByTestId('canvas-panel-comment-submit') as HTMLButtonElement).disabled).toBe(true);

        rerender(<CanvasSelectionToolbar
            {...NO_SELECTION} commentAnchor="anchor" commentDraft="do this" onSubmitComment={onSubmitComment}
        />);
        fireEvent.keyDown(screen.getByTestId('canvas-panel-comment-input'), { key: 'Enter' });
        expect(onSubmitComment).toHaveBeenCalled();
    });
});

function comment(id: string, overrides: Record<string, unknown> = {}) {
    return { id, anchorText: `anchor-${id}`, body: `body-${id}`, status: 'open', ...overrides } as any;
}

describe('CanvasCommentsPanel', () => {
    it('renders nothing when there are no comments', () => {
        const { container } = render(<CanvasCommentsPanel comments={[]} openComments={[]} sending={false} onDelete={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it('counts all comments but offers to send only the open ones', () => {
        render(<CanvasCommentsPanel
            comments={[comment('c1'), comment('c2', { status: 'sent' })]}
            openComments={[comment('c1')]}
            sending={false}
            onSend={() => {}}
            onDelete={() => {}}
        />);

        expect(screen.getByTestId('canvas-panel-comments').textContent).toContain('Comments (2)');
        expect(screen.getByTestId('canvas-panel-send-comments').textContent).toBe('Send 1 to AI');
    });

    it('hides the send action with no follow-up path or no open comments', () => {
        const { rerender } = render(<CanvasCommentsPanel
            comments={[comment('c1')]} openComments={[comment('c1')]} sending={false} onDelete={() => {}}
        />);
        expect(screen.queryByTestId('canvas-panel-send-comments')).toBeNull();

        rerender(<CanvasCommentsPanel
            comments={[comment('c1', { status: 'sent' })]} openComments={[]} sending={false} onSend={() => {}} onDelete={() => {}}
        />);
        expect(screen.queryByTestId('canvas-panel-send-comments')).toBeNull();
    });

    it('disables the send action while a batch is in flight', () => {
        render(<CanvasCommentsPanel
            comments={[comment('c1')]} openComments={[comment('c1')]} sending onSend={() => {}} onDelete={() => {}}
        />);
        const button = screen.getByTestId('canvas-panel-send-comments') as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.textContent).toBe('Sending…');
    });

    it('deletes by id', () => {
        const onDelete = vi.fn();
        render(<CanvasCommentsPanel comments={[comment('c1')]} openComments={[comment('c1')]} sending={false} onDelete={onDelete} />);
        fireEvent.click(screen.getByTestId('canvas-comment-delete-c1'));
        expect(onDelete).toHaveBeenCalledWith('c1');
    });
});

describe('CanvasBodyRenderer', () => {
    function renderBody(overrides: Record<string, unknown> = {}) {
        const canvas = (overrides.canvas as any) ?? makeCanvas();
        const displayedContent = (overrides.displayedContent as string) ?? canvas?.content ?? '';
        return render(<CanvasBodyRenderer
            workspaceId="ws-1"
            canvasId="doc-abc123"
            loading={false}
            loadError={null}
            canvas={canvas}
            kind={canvasKind(canvas, displayedContent)}
            viewingVersion={null}
            viewingRevision={3}
            displayedContent={displayedContent}
            mode="preview"
            draft={displayedContent}
            onDraftChange={() => {}}
            onCanvasSaved={() => {}}
            onSelectionChange={() => {}}
            onImageMenu={() => {}}
            notify={() => {}}
            {...overrides as any}
        />);
    }

    it('shows the loading and error states ahead of every render branch', () => {
        const { unmount } = renderBody({ loading: true });
        expect(screen.getByText('Loading canvas…')).toBeTruthy();
        unmount();

        renderBody({ loadError: 'Failed to load canvas' });
        expect(screen.getByTestId('canvas-panel-error').textContent).toBe('Failed to load canvas');
    });

    it('renders an empty markdown canvas with a placeholder instead of a blank pane', () => {
        renderBody({ canvas: makeCanvas({ content: '   ' }) });
        expect(screen.getByTestId('canvas-panel-preview').textContent).toBe('Empty canvas.');
    });

    it('keeps a kusto canvas on its own view — and read-only in a history revision', () => {
        const canvas = makeCanvas({ type: 'kusto', content: '{}' });
        const { unmount } = renderBody({ canvas });
        expect(screen.getByTestId('mock-kusto-view').getAttribute('data-readonly')).toBe('false');
        unmount();

        renderBody({
            canvas,
            viewingVersion: { revision: 1, editor: 'ai', content: '{"old":true}' },
            displayedContent: '{"old":true}',
            // Even asking for edit mode must not escape the kusto view.
            mode: 'edit',
        });
        const view = screen.getByTestId('mock-kusto-view');
        expect(view.getAttribute('data-readonly')).toBe('true');
        expect(view.getAttribute('data-revision')).toBe('1');
    });

    it('never reaches an editor while browsing history', () => {
        renderBody({
            canvas: makeCanvas({ type: 'code', language: 'python', content: 'x = 2' }),
            viewingVersion: { revision: 1, editor: 'user', content: 'x = 1' },
            displayedContent: 'x = 1',
            mode: 'edit',
        });

        expect(screen.queryByTestId('mock-monaco')).toBeNull();
        expect(screen.queryByTestId('canvas-panel-editor')).toBeNull();
        expect(screen.getByTestId('canvas-panel-preview').textContent).toContain('x = 1');
    });

    it('routes an extension canvas to its iframe view in preview and to the raw JSON in edit', () => {
        const canvas = makeCanvas({ type: 'extension', content: '{"n":1}' });
        const { unmount } = renderBody({ canvas });
        expect(screen.getByTestId('mock-extension-view')).toBeTruthy();
        unmount();

        renderBody({ canvas, mode: 'edit' });
        expect(screen.queryByTestId('mock-extension-view')).toBeNull();
        expect((screen.getByTestId('canvas-panel-editor') as HTMLTextAreaElement).value).toBe('{"n":1}');
    });

    it('reports the edited text through onDraftChange for both editors', () => {
        const onDraftChange = vi.fn();
        renderBody({ mode: 'edit', onDraftChange });

        fireEvent.change(screen.getByTestId('canvas-panel-editor'), { target: { value: '# Typed' } });
        expect(onDraftChange).toHaveBeenCalledWith('# Typed');
    });

    it('reports a textarea selection, and clears it when the selection collapses', () => {
        const onSelectionChange = vi.fn();
        renderBody({ mode: 'edit', onSelectionChange, canvas: makeCanvas({ content: 'hello world' }), displayedContent: 'hello world' });

        const editor = screen.getByTestId('canvas-panel-editor') as HTMLTextAreaElement;
        editor.setSelectionRange(0, 5);
        fireEvent.select(editor);
        expect(onSelectionChange).toHaveBeenLastCalledWith('hello');

        editor.setSelectionRange(5, 5);
        fireEvent.select(editor);
        expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    });
});
