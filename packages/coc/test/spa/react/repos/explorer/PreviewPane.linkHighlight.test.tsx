/**
 * A file link that names one line highlights it as a one-line range, the same
 * range highlight a `:start-end` link gets. A line with no `endLine` — a search
 * hit or symbol jump — scrolls without highlighting.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));
const mockViewer = vi.hoisted(() => ({ props: null as any }));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/file-viewer/FileViewer', () => ({
    FileViewer: (props: any) => {
        mockViewer.props = props;
        return <div data-testid="mock-file-viewer" />;
    },
}));

const CONTENT = 'one\ntwo\nthree\nfour\nfive\n';

describe('PreviewPane — link line highlight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockViewer.props = null;
        mockExplorerApi.readBlob.mockResolvedValue({ content: CONTENT, encoding: 'utf-8', mimeType: 'text/plain' });
    });

    async function renderPane(props: { revealLine?: number; endLine?: number; revealNonce?: number }) {
        const view = render(<PreviewPane repoId="r1" filePath="src/a.txt" fileName="a.txt" {...props} />);
        await waitFor(() => expect(screen.getByTestId('mock-file-viewer')).toBeInTheDocument());
        return view;
    }

    it('highlights a single-line link as a one-line range', async () => {
        await renderPane({ revealLine: 3, endLine: 3, revealNonce: 1 });
        expect(mockViewer.props.revealLine).toBe(3);
        expect(mockViewer.props.highlightRange).toEqual({ start: 3, end: 3 });
    });

    it('keeps multi-line range highlights', async () => {
        await renderPane({ revealLine: 2, endLine: 4, revealNonce: 1 });
        expect(mockViewer.props.highlightRange).toEqual({ start: 2, end: 4 });
    });

    it('only scrolls for a line with no range (search or symbol navigation)', async () => {
        await renderPane({ revealLine: 3, revealNonce: 1 });
        expect(mockViewer.props.revealLine).toBe(3);
        expect(mockViewer.props.highlightRange).toBeNull();
    });

    it('re-highlights a repeated or new single-line link without reloading the buffer', async () => {
        const view = await renderPane({ revealLine: 3, endLine: 3, revealNonce: 1 });
        view.rerender(<PreviewPane repoId="r1" filePath="src/a.txt" fileName="a.txt" revealLine={3} endLine={3} revealNonce={2} />);
        expect(mockViewer.props.highlightRange).toEqual({ start: 3, end: 3 });
        expect(mockViewer.props.revealNonce).toBe(2);
        view.rerender(<PreviewPane repoId="r1" filePath="src/a.txt" fileName="a.txt" revealLine={5} endLine={5} revealNonce={3} />);
        expect(mockViewer.props.highlightRange).toEqual({ start: 5, end: 5 });
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);
    });
});
