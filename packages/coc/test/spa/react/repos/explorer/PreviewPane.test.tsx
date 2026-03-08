/**
 * Tests for PreviewPane component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/repos/explorer/PreviewPane';

const mockFetchApi = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

// Mock MonacoFileEditor since Monaco requires a real DOM/worker environment
vi.mock('../../../../../src/server/spa/client/react/repos/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, language, onChange, onSave }: any) => (
        <div data-testid="mock-monaco-editor" data-language={language} data-value={value}>
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

describe('PreviewPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders loading spinner while fetch is pending', () => {
        mockFetchApi.mockReturnValue(new Promise(() => {})); // never resolves
        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);
        expect(screen.getByTestId('preview-loading')).toBeInTheDocument();
        expect(screen.getByText(/Loading app\.ts/)).toBeInTheDocument();
    });

    it('renders Monaco editor for text files', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'const a = 1;\nconst b = 2;',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-language')).toBe('typescript');
    });

    it('renders markdown files in Monaco editor (not as rendered HTML)', async () => {
        mockFetchApi.mockResolvedValue({
            content: '# Heading\nSome text',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="README.md" fileName="README.md" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-language')).toBe('markdown');
        // No markdown rendering — just Monaco
        expect(screen.queryByTestId('preview-markdown')).not.toBeInTheDocument();
    });

    it('renders image for image/* MIME with base64 encoding', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'iVBORw0KGgo=',
            encoding: 'base64',
            mimeType: 'image/png',
        });

        render(<PreviewPane repoId="r1" filePath="logo.png" fileName="logo.png" />);

        await waitFor(() => expect(screen.getByTestId('preview-image')).toBeInTheDocument());
        const img = screen.getByRole('img');
        expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(img.getAttribute('alt')).toBe('logo.png');
    });

    it('shows binary placeholder for non-image base64 content', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'AAAA',
            encoding: 'base64',
            mimeType: 'application/octet-stream',
        });

        render(<PreviewPane repoId="r1" filePath="file.bin" fileName="file.bin" />);

        await waitFor(() => expect(screen.getByTestId('preview-binary')).toBeInTheDocument());
        expect(screen.getByText(/Binary file/)).toBeInTheDocument();
    });

    it('shows "(empty file)" for empty content', async () => {
        mockFetchApi.mockResolvedValue({
            content: '',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="empty.txt" fileName="empty.txt" />);

        await waitFor(() => expect(screen.getByTestId('preview-empty')).toBeInTheDocument());
        expect(screen.getByText('(empty file)')).toBeInTheDocument();
    });

    it('truncates content exceeding 512 KB and shows banner', async () => {
        const largeContent = 'x'.repeat(600 * 1024); // 600 KB
        mockFetchApi.mockResolvedValue({
            content: largeContent,
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="large.txt" fileName="large.txt" />);

        await waitFor(() => expect(screen.getByTestId('preview-truncated-banner')).toBeInTheDocument());
        expect(screen.getByText(/File too large to preview/)).toBeInTheDocument();
    });

    it('shows error state with Retry button on fetch failure', async () => {
        mockFetchApi.mockRejectedValue(new Error('Network error'));

        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-error')).toBeInTheDocument());
        expect(screen.getByText('Network error')).toBeInTheDocument();
        expect(screen.getByTestId('preview-retry-btn')).toBeInTheDocument();
    });

    it('Retry button re-triggers fetch', async () => {
        mockFetchApi.mockRejectedValueOnce(new Error('Network error'));

        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-retry-btn')).toBeInTheDocument());
        expect(mockFetchApi).toHaveBeenCalledTimes(1);

        mockFetchApi.mockResolvedValue({
            content: 'ok',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        await act(async () => {
            screen.getByTestId('preview-retry-btn').click();
        });

        expect(mockFetchApi).toHaveBeenCalledTimes(2);
    });

    it('cancels in-flight request when filePath changes', async () => {
        let resolveFirst: (v: unknown) => void;
        mockFetchApi.mockImplementationOnce((_url: string, opts?: RequestInit) => {
            return new Promise((resolve, reject) => {
                resolveFirst = resolve;
                opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        });

        const { rerender } = render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);
        expect(screen.getByTestId('preview-loading')).toBeInTheDocument();

        mockFetchApi.mockResolvedValue({
            content: 'second file',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        rerender(<PreviewPane repoId="r1" filePath="b.ts" fileName="b.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        // The first fetch was cancelled (signal aborted), second one resolved
        expect(mockFetchApi).toHaveBeenCalledTimes(2);
    });

    it('fetches from the correct API URL', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/main.ts" fileName="main.ts" />);

        await waitFor(() => expect(mockFetchApi).toHaveBeenCalled());
        expect(mockFetchApi).toHaveBeenCalledWith(
            '/repos/r1/blob?path=src%2Fmain.ts',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('renders path header with breadcrumb segments', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/components/App.tsx" fileName="App.tsx" />);

        await waitFor(() => expect(screen.getByTestId('preview-header')).toBeInTheDocument());
        const header = screen.getByTestId('preview-header');
        expect(header.textContent).toContain('src');
        expect(header.textContent).toContain('components');
        expect(header.textContent).toContain('App.tsx');
    });

    it('close button calls onClose', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        const onClose = vi.fn();
        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" onClose={onClose} />);

        await waitFor(() => expect(screen.getByTestId('preview-close-btn')).toBeInTheDocument());

        await act(async () => {
            screen.getByTestId('preview-close-btn').click();
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not render close button when onClose is not provided', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-header')).toBeInTheDocument());
        expect(screen.queryByTestId('preview-close-btn')).not.toBeInTheDocument();
    });

    it('shows dirty indicator and save button when content changes', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'original',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());

        // Initially no dirty indicator
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
        expect(screen.queryByTestId('save-btn')).not.toBeInTheDocument();

        // Simulate edit by changing the textarea
        await act(async () => {
            const textarea = screen.getByTestId('mock-monaco-textarea');
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
            nativeInputValueSetter.call(textarea, 'modified');
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Should now show dirty indicator and save button
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
        expect(screen.getByTestId('save-btn')).toBeInTheDocument();
    });

    it('saves content via PUT API call', async () => {
        mockFetchApi.mockResolvedValue({
            content: 'original',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());

        // Simulate edit
        await act(async () => {
            const textarea = screen.getByTestId('mock-monaco-textarea');
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
            nativeInputValueSetter.call(textarea, 'modified');
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Mock save response
        mockFetchApi.mockResolvedValueOnce({ success: true });

        // Click save
        await act(async () => {
            screen.getByTestId('save-btn').click();
        });

        // Verify PUT was called
        const saveCalls = mockFetchApi.mock.calls.filter(
            (call: any[]) => typeof call[1] === 'object' && call[1]?.method === 'PUT'
        );
        expect(saveCalls.length).toBe(1);
        expect(saveCalls[0][0]).toBe('/repos/r1/blob?path=a.ts');
    });
});
