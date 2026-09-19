/**
 * Tests for PreviewPane trusted-path (absolute path) support.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import { TRUSTED_PATH_PREFIX } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExactOpen';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));
const mockViewer = vi.hoisted(() => ({
    props: null as any,
    updateOptions: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/file-viewer/FileViewer', () => ({
    FileViewer: (props: any) => {
        mockViewer.props = props;
        return <div data-testid="mock-file-viewer" />;
    },
}));

describe('PreviewPane — trusted path support', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockViewer.props = null;
    });

    it('fetches from /api/fs/blob for trusted-prefixed paths', async () => {
        mockExplorerApi.readTrustedBlob.mockResolvedValue({
            content: '# Plan',
            encoding: 'utf-8',
            mimeType: 'text/markdown',
        });

        const trustedPath = `${TRUSTED_PATH_PREFIX}/home/user/.copilot/plan.md`;
        render(<PreviewPane repoId="r1" filePath={trustedPath} fileName="plan.md" />);

        await waitFor(() => expect(mockExplorerApi.readTrustedBlob).toHaveBeenCalled());

        expect(mockExplorerApi.readTrustedBlob).toHaveBeenCalledWith(
            '/home/user/.copilot/plan.md',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(mockExplorerApi.readBlob).not.toHaveBeenCalled();
    });

    it('keeps trusted paths read-only and omits their save route', async () => {
        mockExplorerApi.readTrustedBlob.mockResolvedValue({
            content: 'const x = 1;',
            encoding: 'utf-8',
            mimeType: 'application/typescript',
        });

        const trustedPath = `${TRUSTED_PATH_PREFIX}/home/user/.copilot/file.ts`;
        render(<PreviewPane repoId="r1" filePath={trustedPath} fileName="file.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-file-viewer')).toBeInTheDocument());
        expect(mockViewer.props.onSave).toBeUndefined();

        const cleanup = mockViewer.props.onModelMount({
            editor: { updateOptions: mockViewer.updateOptions },
        });
        expect(mockViewer.updateOptions).toHaveBeenCalledWith({ readOnly: true });

        cleanup();
        expect(mockViewer.updateOptions).toHaveBeenLastCalledWith({ readOnly: false });
    });

    it('fetches from /repos/:id/blob for non-trusted paths (no prefix)', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'hello',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/index.ts" fileName="index.ts" />);

        await waitFor(() => expect(mockExplorerApi.readBlob).toHaveBeenCalled());

        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(
            'r1',
            'src/index.ts',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(mockExplorerApi.readTrustedBlob).not.toHaveBeenCalled();
    });
});
