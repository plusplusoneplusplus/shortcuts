// @vitest-environment jsdom
/**
 * PreviewPane — onNotFound contract.
 *
 * A 404 on the blob read means the file no longer exists on disk. Owners whose
 * file list may be stale (the working-tree panel) use this to refresh instead
 * of leaving the user in a dead Retry loop. Any other failure must NOT fire it.
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
    MonacoFileEditor: ({ value }: any) => <textarea data-testid="mock-monaco-textarea" defaultValue={value} />,
    getMonacoLanguage: () => 'plaintext',
}));

function notFoundError(message = 'File not found: gone.ts'): Error {
    const err = new Error(message);
    (err as any).status = 404;
    return err;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PreviewPane — onNotFound', () => {
    it('fires onNotFound when the blob read 404s, alongside the error state', async () => {
        mockExplorerApi.readBlob.mockRejectedValue(notFoundError());
        const onNotFound = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="gone.ts" fileName="gone.ts" onNotFound={onNotFound} />);

        await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(1));
        // The regular error presentation still renders for owners that ignore it.
        expect(screen.getByTestId('preview-error')).toHaveTextContent('File not found: gone.ts');
    });

    it('does not fire onNotFound for a non-404 failure', async () => {
        const err = new Error('boom');
        (err as any).status = 500;
        mockExplorerApi.readBlob.mockRejectedValue(err);
        const onNotFound = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onNotFound={onNotFound} />);

        await waitFor(() => expect(screen.getByTestId('preview-error')).toBeInTheDocument());
        expect(onNotFound).not.toHaveBeenCalled();
    });

    it('does not fire onNotFound for a status-less failure (network error)', async () => {
        mockExplorerApi.readBlob.mockRejectedValue(new Error('network down'));
        const onNotFound = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="a.ts" fileName="a.ts" onNotFound={onNotFound} />);

        await waitFor(() => expect(screen.getByTestId('preview-error')).toBeInTheDocument());
        expect(onNotFound).not.toHaveBeenCalled();
    });

    it('fires onNotFound again when a Retry 404s again', async () => {
        mockExplorerApi.readBlob.mockRejectedValue(notFoundError());
        const onNotFound = vi.fn();

        render(<PreviewPane repoId="ws-1" filePath="gone.ts" fileName="gone.ts" onNotFound={onNotFound} />);
        await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByTestId('preview-retry-btn'));
        await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(2));
    });

    it('a 404 without an onNotFound handler keeps the plain error behavior', async () => {
        mockExplorerApi.readBlob.mockRejectedValue(notFoundError());

        render(<PreviewPane repoId="ws-1" filePath="gone.ts" fileName="gone.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-error')).toBeInTheDocument());
        expect(screen.getByTestId('preview-retry-btn')).toBeInTheDocument();
    });
});
