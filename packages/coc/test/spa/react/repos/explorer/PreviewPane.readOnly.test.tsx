/**
 * Tests for PreviewPane readOnly mode.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
    MonacoFileEditor: ({ value, language, onChange, onSave, readOnly }: any) => (
        <div data-testid="mock-monaco-editor" data-language={language} data-value={value} data-read-only={String(!!readOnly)}>
            <textarea
                data-testid="mock-monaco-textarea"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            {onSave && <button data-testid="mock-monaco-save" onClick={onSave}>Save</button>}
        </div>
    ),
    getMonacoLanguage: (name: string) => {
        const ext = name?.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown' };
        return map[ext ?? ''] ?? 'plaintext';
    },
}));

describe('PreviewPane — readOnly mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes readOnly to MonacoFileEditor when readOnly is true', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'const x = 1;',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" readOnly />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-read-only')).toBe('true');
    });

    it('does not pass onSave to MonacoFileEditor when readOnly is true', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'const x = 1;',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" readOnly />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        // Our mock only renders the save button if onSave is provided
        expect(screen.queryByTestId('mock-monaco-save')).not.toBeInTheDocument();
    });

    it('suppresses dirty indicator and save button in readOnly mode even after edit attempt', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'original',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" readOnly />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());

        // Simulate edit attempt
        await act(async () => {
            const textarea = screen.getByTestId('mock-monaco-textarea');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
            setter.call(textarea, 'modified');
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Should NOT show dirty indicator or save button
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
        expect(screen.queryByTestId('save-btn')).not.toBeInTheDocument();
    });

    it('readOnly=false (default) keeps editor editable and shows save button', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'original',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-read-only')).toBe('false');
        // onSave is provided so the mock renders a save button
        expect(screen.getByTestId('mock-monaco-save')).toBeInTheDocument();
    });

    it('renders image content normally in readOnly mode', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'iVBORw0KGgo=',
            encoding: 'base64',
            mimeType: 'image/png',
        });

        render(<PreviewPane repoId="r1" filePath="logo.png" fileName="logo.png" readOnly />);

        await waitFor(() => expect(screen.getByTestId('preview-image')).toBeInTheDocument());
    });

    it('renders binary fallback normally in readOnly mode', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'AAAA',
            encoding: 'base64',
            mimeType: 'application/octet-stream',
        });

        render(<PreviewPane repoId="r1" filePath="file.bin" fileName="file.bin" readOnly />);

        await waitFor(() => expect(screen.getByTestId('preview-binary')).toBeInTheDocument());
    });

    it('still shows close button in readOnly mode when onClose is provided', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'hello',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        const onClose = vi.fn();
        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" readOnly onClose={onClose} />);

        await waitFor(() => expect(screen.getByTestId('preview-close-btn')).toBeInTheDocument());
    });
});
