/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    save: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        canvases: {
            get: mocks.get,
            save: mocks.save,
        },
    }),
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
});
