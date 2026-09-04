// @vitest-environment jsdom
/**
 * AC-05: PreviewPane reports its own load/error state to its owner, so the tab
 * strip can show a spinner or a warning for a buffer that is not on screen.
 * Pins the whole contract: loading on mount, ready once the blob lands, error on
 * a failed read, back to loading then ready on a successful retry, and ready on
 * unmount (a closed buffer is neither loading nor errored).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onChange }: any) => (
        <textarea data-testid="mock-monaco-textarea" value={value} onChange={e => onChange(e.target.value)} />
    ),
    getMonacoLanguage: () => 'plaintext',
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PreviewPane — onStatusChange (AC-05)', () => {
    it('reports loading then ready for a buffer that loads', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' });
        const onStatusChange = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onStatusChange={onStatusChange} />);
        expect(onStatusChange).toHaveBeenCalledWith('loading');

        await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('ready'));
        expect(screen.getByTestId('mock-monaco-textarea')).toBeInTheDocument();
    });

    it('reports error when the read fails, then loading and ready on a successful retry', async () => {
        mockExplorerApi.readBlob.mockRejectedValueOnce(new Error('ENOENT: no such file'));
        const onStatusChange = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="gone.ts" fileName="gone.ts" onStatusChange={onStatusChange} />);
        await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('error'));
        // The tab stays usable: the existing error presentation with a retry.
        expect(screen.getByTestId('preview-error')).toHaveTextContent('ENOENT: no such file');

        mockExplorerApi.readBlob.mockResolvedValue({ content: 'back', encoding: 'utf-8', mimeType: 'text/plain' });
        onStatusChange.mockClear();
        fireEvent.click(screen.getByTestId('preview-retry-btn'));
        expect(onStatusChange).toHaveBeenCalledWith('loading');
        await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('ready'));
        expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();
    });

    it('reports ready on unmount so a closed tab keeps no stale marker', async () => {
        mockExplorerApi.readBlob.mockRejectedValue(new Error('ENOENT'));
        const onStatusChange = vi.fn();

        const { unmount } = render(
            <PreviewPane repoId="ws-1" filePath="gone.ts" fileName="gone.ts" onStatusChange={onStatusChange} />,
        );
        await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('error'));
        unmount();
        expect(onStatusChange).toHaveBeenLastCalledWith('ready');
    });
});
