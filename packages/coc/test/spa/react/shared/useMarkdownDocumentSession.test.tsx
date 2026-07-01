/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MarkdownDocumentIO } from '../../../../src/server/spa/client/react/shared/markdown-document/MarkdownDocumentIO';
import { useMarkdownDocumentSession } from '../../../../src/server/spa/client/react/shared/markdown-document/useMarkdownDocumentSession';
import { resolveMarkdownReviewSelection } from '../../../../src/server/spa/client/react/shared/markdown-document/markdownReviewSelection';

function createIo(content = '# Initial', mtime = 7): MarkdownDocumentIO {
    return {
        loadContent: vi.fn(async (_workspaceId: string, path: string) => ({ content, path, mtime })),
        saveContent: vi.fn(async (_workspaceId: string, path: string, _markdown: string) => ({
            path,
            updated: true,
            mtime: mtime + 1,
        })),
        uploadImage: vi.fn(async () => ({ path: '.attachments/image.png' })),
        imageApiUrl: vi.fn(() => '/image'),
        localImageApiUrl: vi.fn(() => '/local-image'),
    };
}

function Harness({
    io,
    autosaveDebounceMs,
}: {
    io: MarkdownDocumentIO;
    autosaveDebounceMs?: number;
}) {
    const session = useMarkdownDocumentSession({
        workspaceId: 'ws1',
        documentPath: 'doc.md',
        io,
        autosaveDebounceMs,
        confirmRefreshMessage: 'Discard edits?',
    });

    return (
        <div>
            <div data-testid="content">{session.content}</div>
            <div data-testid="save-state">{session.saveState}</div>
            <div data-testid="dirty">{String(session.dirty)}</div>
            <div data-testid="conflict">{session.conflictContent ?? ''}</div>
            <button onClick={() => session.queueSave('# Queued')}>Queue</button>
            <button onClick={() => session.flushSave()}>Flush</button>
            <button onClick={() => session.saveNow('# Manual')}>Save now</button>
            <button onClick={() => session.refresh()}>Refresh</button>
        </div>
    );
}

describe('useMarkdownDocumentSession', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('loads and manually saves through injected markdown document I/O', async () => {
        const io = createIo();
        render(<Harness io={io} />);

        await screen.findByText('# Initial');

        await act(async () => {
            fireEvent.click(screen.getByText('Save now'));
        });

        expect(io.saveContent).toHaveBeenCalledWith('ws1', 'doc.md', '# Manual', 7, undefined);
        expect(screen.getByTestId('content').textContent).toBe('# Manual');
        expect(screen.getByTestId('dirty').textContent).toBe('false');
    });

    it('autosaves queued content with the loaded mtime for future markdown surfaces', async () => {
        const io = createIo('# Initial', 11);
        render(<Harness io={io} autosaveDebounceMs={0} />);

        await screen.findByText('# Initial');

        act(() => {
            fireEvent.click(screen.getByText('Queue'));
        });
        expect(screen.getByTestId('dirty').textContent).toBe('true');

        await waitFor(() => {
            expect(io.saveContent).toHaveBeenCalledWith('ws1', 'doc.md', '# Queued', 11, undefined);
        });
        expect(screen.getByTestId('dirty').textContent).toBe('false');
    });

    it('guards refresh while dirty and reloads only after confirmation', async () => {
        const io = createIo('# Initial', 1);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<Harness io={io} />);

        await screen.findByText('# Initial');
        fireEvent.click(screen.getByText('Queue'));
        fireEvent.click(screen.getByText('Refresh'));

        expect(confirmSpy).toHaveBeenCalledWith('Discard edits?');
        expect(io.loadContent).toHaveBeenCalledTimes(1);

        confirmSpy.mockReturnValue(true);
        fireEvent.click(screen.getByText('Refresh'));

        await waitFor(() => expect(io.loadContent).toHaveBeenCalledTimes(2));
    });

    it('captures conflict content for queued saves without leaking a rejection', async () => {
        const io = createIo('# Initial', 1);
        vi.mocked(io.saveContent).mockRejectedValueOnce(
            Object.assign(new Error('mtime_mismatch'), {
                status: 409,
                currentContent: '# Disk',
            }),
        );
        render(<Harness io={io} autosaveDebounceMs={0} />);

        await screen.findByText('# Initial');
        fireEvent.click(screen.getByText('Queue'));

        await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('conflict'));
        expect(screen.getByTestId('conflict').textContent).toBe('# Disk');
    });
});

describe('markdown review selection helpers', () => {
    it('maps rendered text selections to fallback source coordinates', () => {
        const container = document.createElement('div');
        container.textContent = 'alpha\nbeta';
        document.body.appendChild(container);

        const textNode = container.firstChild;
        expect(textNode).toBeTruthy();
        const range = document.createRange();
        range.setStart(textNode!, 6);
        range.setEnd(textNode!, 10);

        const selection = resolveMarkdownReviewSelection('alpha\nbeta', container, range, 'beta');

        expect(selection).toMatchObject({
            text: 'beta',
            startLine: 2,
            startColumn: 1,
            endLine: 2,
            endColumn: 5,
        });
    });
});
