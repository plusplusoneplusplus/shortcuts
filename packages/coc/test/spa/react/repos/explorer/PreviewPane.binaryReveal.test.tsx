/**
 * "Open in Explorer" under the binary placeholder (`features.binaryFileReveal`):
 * only the binary branch shows it, it reveals the exact owner/path through
 * `explorerApi.reveal`, and failures and unaddressable paths never look like a
 * success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import {
    registerCloneBaseUrls, resetCloneRegistryForTests,
} from '../../../../../src/server/spa/client/react/repos/cloneRegistry';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
    reveal: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: () => ({
        view: null, status: 'detached', snapshot: null, diagnostics: [], markers: [], ready: false,
        handleChange: vi.fn(), markSaved: vi.fn(), restart: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value }: any) => <div data-testid="mock-monaco-editor" data-value={value} />,
    getMonacoLanguage: () => 'plaintext',
}));

const BINARY = { content: 'AAAA', encoding: 'base64', mimeType: 'application/octet-stream' };

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

describe('PreviewPane binary Open in Explorer', () => {
    beforeEach(() => {
        mockExplorerApi.readBlob.mockResolvedValue(BINARY);
        mockExplorerApi.reveal.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
        resetCloneRegistryForTests();
    });

    it('keeps the binary message and adds no action unless the host opts in', async () => {
        render(<PreviewPane repoId="r1" filePath="assets/blob.bin" fileName="blob.bin" />);
        expect(await screen.findByTestId('preview-binary')).toHaveTextContent('Binary file — 4 bytes');
        expect(screen.getByTestId('preview-binary')).not.toHaveTextContent('bytes bytes');
        expect(screen.queryByTestId('preview-binary-reveal-btn')).not.toBeInTheDocument();
    });

    it('reveals the exact local workspace path and reports it without opening the file', async () => {
        render(<PreviewPane repoId="r1" filePath="assets/blob.bin" fileName="blob.bin" revealBinary />);
        const button = await screen.findByRole('button', { name: 'Open in Explorer' });
        expect(screen.getByTestId('preview-binary')).toHaveTextContent('Binary file');

        fireEvent.click(button);

        expect(await screen.findByRole('status')).toHaveTextContent('Shown in the system file manager.');
        expect(mockExplorerApi.reveal).toHaveBeenCalledTimes(1);
        expect(mockExplorerApi.reveal).toHaveBeenCalledWith('r1', 'assets/blob.bin');
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('routes a remote clone tab to its owning server and says where it was shown', async () => {
        registerCloneBaseUrls([{ workspaceId: 'r1', serverId: 'server-a', baseUrl: 'https://alpha.example' }]);
        render(<PreviewPane repoId="r1" routingRef="remote:server-a:r1" filePath="bin/tool.exe" fileName="tool.exe" revealBinary />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open in Explorer' }));

        expect(await screen.findByRole('status')).toHaveTextContent('on the remote server');
        expect(mockExplorerApi.reveal).toHaveBeenCalledWith('r1', 'bin/tool.exe', 'remote:server-a:r1');
    });

    it('surfaces a failed reveal as an alert, never as success, and allows a retry', async () => {
        mockExplorerApi.reveal.mockRejectedValueOnce(Object.assign(new Error('Repository not found'), { status: 404 }));
        render(<PreviewPane repoId="r1" filePath="assets/blob.bin" fileName="blob.bin" revealBinary />);
        const button = await screen.findByRole('button', { name: 'Open in Explorer' });
        fireEvent.click(button);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not open in Explorer: Repository not found');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(await screen.findByRole('status')).toHaveTextContent('Shown in the system file manager.');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('sends one request while a reveal is in flight', async () => {
        const pending = deferred();
        mockExplorerApi.reveal.mockReturnValueOnce(pending.promise);
        render(<PreviewPane repoId="r1" filePath="assets/blob.bin" fileName="blob.bin" revealBinary />);
        const button = await screen.findByRole('button', { name: 'Open in Explorer' });
        fireEvent.click(button);
        expect(await screen.findByRole('button', { name: 'Opening…' })).toBeDisabled();
        fireEvent.click(button);
        expect(mockExplorerApi.reveal).toHaveBeenCalledTimes(1);
        pending.resolve();
        expect(await screen.findByRole('status')).toBeInTheDocument();
    });

    it('disables the action with a visible reason for a trusted absolute path', async () => {
        mockExplorerApi.readTrustedBlob.mockResolvedValue(BINARY);
        render(<PreviewPane repoId="r1" filePath="__trusted__:/tmp/out/blob.bin" fileName="blob.bin" revealBinary />);
        const button = await screen.findByRole('button', { name: 'Open in Explorer' });
        expect(button).toBeDisabled();
        expect(button).toHaveAccessibleDescription('Only files inside the workspace can be opened in Explorer.');
        fireEvent.click(button);
        expect(mockExplorerApi.reveal).not.toHaveBeenCalled();
    });

    it('clears the previous result when the tab shows another file', async () => {
        const { rerender } = render(<PreviewPane repoId="r1" filePath="a.bin" fileName="a.bin" revealBinary />);
        fireEvent.click(await screen.findByRole('button', { name: 'Open in Explorer' }));
        expect(await screen.findByRole('status')).toBeInTheDocument();

        rerender(<PreviewPane repoId="r1" filePath="b.bin" fileName="b.bin" revealBinary />);
        await waitFor(() => expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(2));
        await screen.findByRole('button', { name: 'Open in Explorer' });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Open in Explorer' }));
        await waitFor(() => expect(mockExplorerApi.reveal).toHaveBeenLastCalledWith('r1', 'b.bin'));
    });

    it.each([
        ['text', { content: 'hello', encoding: 'utf-8', mimeType: 'text/plain' }, 'mock-monaco-editor'],
        ['image', { content: 'iVBORw0KGgo=', encoding: 'base64', mimeType: 'image/png' }, 'preview-image'],
    ])('leaves the supported %s preview unchanged', async (_kind, blob, testId) => {
        mockExplorerApi.readBlob.mockResolvedValue(blob);
        render(<PreviewPane repoId="r1" filePath="file" fileName="file" revealBinary />);
        expect(await screen.findByTestId(testId)).toBeInTheDocument();
        expect(screen.queryByTestId('preview-binary')).not.toBeInTheDocument();
        expect(screen.queryByTestId('preview-binary-reveal-btn')).not.toBeInTheDocument();
    });
});
