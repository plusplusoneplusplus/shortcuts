import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import { PreviewPane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

const mockMonaco = vi.hoisted(() => ({
    onSave: undefined as (() => void) | undefined,
    saveAction: undefined as (() => void) | undefined,
}));

const mockLanguageDocument = vi.hoisted(() => ({
    handleChange: vi.fn(),
    markSaved: vi.fn(),
    restart: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: () => ({
        view: null,
        status: 'detached',
        snapshot: null,
        diagnostics: [],
        markers: [],
        ready: false,
        ...mockLanguageDocument,
    }),
}));

// Mock MonacoFileEditor since Monaco requires a real DOM/worker environment
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, language, selectionContext, onChange, onSave, revealLine, revealColumn, revealNonce }: any) => {
        mockMonaco.onSave = onSave;
        mockMonaco.saveAction ??= () => mockMonaco.onSave?.();
        return (
            <div data-testid="mock-monaco-editor" data-language={language} data-value={value} data-selection-context={JSON.stringify(selectionContext)}
                data-reveal-line={revealLine} data-reveal-column={revealColumn} data-reveal-nonce={revealNonce}>
                <textarea
                    data-testid="mock-monaco-textarea"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                {onSave && <button data-testid="mock-monaco-save" onClick={onSave}>Save</button>}
            </div>
        );
    },
    getMonacoLanguage: (name: string) => {
        const ext = name?.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown', markdown: 'markdown' };
        return map[ext ?? ''] ?? 'plaintext';
    },
}));

describe('PreviewPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMonaco.onSave = undefined;
        mockMonaco.saveAction = undefined;
    });

    it('root container has w-full so it fills the preview area', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'hello',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-pane')).toBeInTheDocument());
        const pane = screen.getByTestId('preview-pane');
        expect(pane.className).toContain('w-full');
    });

    it('renders loading spinner while fetch is pending', () => {
        mockExplorerApi.readBlob.mockReturnValue(new Promise(() => {})); // never resolves
        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);
        expect(screen.getByTestId('preview-loading')).toBeInTheDocument();
        expect(screen.getByText(/Loading app\.ts/)).toBeInTheDocument();
    });

    it('renders Monaco editor for text files', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'const a = 1;\nconst b = 2;',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-language')).toBe('typescript');
        expect(JSON.parse(screen.getByTestId('mock-monaco-editor').getAttribute('data-selection-context')!)).toEqual({ workspaceId: 'r1', filePath: 'src/app.ts', destinationId: 'r1' });
    });

    it('keeps attachment destinations separate for file panes sharing a server workspace id', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
        const owners = ['r1', 'remote:server-a:r1', 'remote:server-b:r1'];
        render(<>{owners.map(owner => <section key={owner} data-testid={owner}>
            <PreviewPane repoId="r1" routingRef={owner} filePath="src/app.ts" fileName="app.ts" />
        </section>)}</>);
        for (const owner of owners) {
            const editor = await within(screen.getByTestId(owner)).findByTestId('mock-monaco-editor');
            expect(JSON.parse(editor.getAttribute('data-selection-context')!)).toEqual({
                workspaceId: 'r1', filePath: 'src/app.ts', destinationId: owner,
            });
        }
    });

    it('renders markdown files in Monaco editor (not as rendered HTML)', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
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

    it('opens opted-in Markdown rendered with an accessible switch and leaves the buffer untouched', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: '# Heading\n**emphasis**\n<script>alert(1)</script>',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });
        render(<PreviewPane repoId="r1" filePath="README.md" fileName="README.md" markdownPreview />);

        const rendered = await screen.findByTestId('preview-markdown');
        expect(rendered.querySelector('.md-h1')).not.toBeNull();
        expect(rendered.querySelector('script')).toBeNull();
        expect(screen.queryByTestId('mock-monaco-editor')).not.toBeInTheDocument();
        const controls = screen.getByRole('group', { name: 'Markdown view' });
        expect(within(controls).getByRole('button', { name: 'Rendered' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(controls).getByRole('button', { name: 'Raw' })).toHaveAttribute('aria-pressed', 'false');
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('shares the unsaved edit buffer across modes and saves to its concrete owner', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: '# First', encoding: 'utf-8', mimeType: 'text/plain',
        });
        mockExplorerApi.writeBlob.mockResolvedValue({ success: true });
        const onDirtyChange = vi.fn();
        let save: (() => Promise<boolean>) | null = null;
        render(<PreviewPane repoId="r1" routingRef="remote:clone-a" filePath="doc.markdown"
            fileName="doc.markdown" markdownPreview onDirtyChange={onDirtyChange}
            onRegisterSave={value => { save = value; }} />);

        expect(await screen.findByTestId('preview-markdown')).toBeInTheDocument();
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith('r1', 'doc.markdown',
            expect.objectContaining({ signal: expect.any(AbortSignal) }), 'remote:clone-a');
        fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
        expect(screen.getByTestId('mock-monaco-editor')).toHaveAttribute('data-language', 'markdown');
        fireEvent.change(screen.getByTestId('mock-monaco-textarea'), { target: { value: '# Updated' } });
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
        expect(screen.getByTestId('preview-markdown')).toHaveTextContent('Updated');
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
        expect(screen.getByTestId('mock-monaco-textarea')).toHaveValue('# Updated');
        await act(async () => { expect(await save?.()).toBe(true); });
        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('r1', 'doc.markdown', '# Updated', 'remote:clone-a');
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('opens a line-targeted Markdown tab in Raw and switches an existing rendered tab on a new jump', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: '# Header\nline two\nline three', encoding: 'utf-8', mimeType: 'text/plain',
        });
        const { rerender } = render(<PreviewPane repoId="r1" filePath="README.md"
            fileName="README.md" markdownPreview />);
        expect(await screen.findByTestId('preview-markdown')).toBeInTheDocument();
        rerender(<PreviewPane repoId="r1" filePath="README.md" fileName="README.md"
            markdownPreview revealLine={3} revealColumn={6} revealNonce={1} />);
        expect(await screen.findByTestId('mock-monaco-editor')).toHaveAttribute('data-reveal-line', '3');
        expect(screen.getByTestId('mock-monaco-editor')).toHaveAttribute('data-reveal-column', '6');
        fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
        expect(screen.getByTestId('preview-markdown')).toBeInTheDocument();
        rerender(<PreviewPane repoId="r1" filePath="README.md" fileName="README.md"
            markdownPreview revealLine={3} revealColumn={6} revealNonce={2} />);
        expect(await screen.findByTestId('mock-monaco-editor')).toHaveAttribute('data-reveal-nonce', '2');
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);
    });

    it('opens line-targeted Markdown in Raw on first load', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: '# Header\nline two', encoding: 'utf-8', mimeType: 'text/plain',
        });
        render(<PreviewPane repoId="r1" filePath="README.md" fileName="README.md"
            markdownPreview revealLine={2} revealColumn={4} />);
        const editor = await screen.findByTestId('mock-monaco-editor');
        expect(editor).toHaveAttribute('data-reveal-line', '2');
        expect(editor).toHaveAttribute('data-reveal-column', '4');
        expect(screen.queryByTestId('preview-markdown')).not.toBeInTheDocument();
    });

    it('keeps view choices and edits isolated in two mounted clone-owned tabs', async () => {
        mockExplorerApi.readBlob.mockImplementation(async (_repo: string, _path: string, _options: unknown, route: string) => ({
            content: route === 'remote:a' ? '# Alpha' : '# Beta',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        }));
        const { rerender } = render(
            <>
                <section data-testid="tab-a"><PreviewPane repoId="ws-1" routingRef="remote:a"
                    filePath="README.md" fileName="README.md" markdownPreview /></section>
                <section data-testid="tab-b"><PreviewPane repoId="ws-1" routingRef="remote:b"
                    filePath="README.md" fileName="README.md" markdownPreview /></section>
            </>,
        );
        const a = within(screen.getByTestId('tab-a'));
        const b = within(screen.getByTestId('tab-b'));
        expect(await a.findByTestId('preview-markdown')).toHaveTextContent('Alpha');
        expect(await b.findByTestId('preview-markdown')).toHaveTextContent('Beta');
        fireEvent.click(a.getByRole('button', { name: 'Raw' }));
        fireEvent.change(a.getByTestId('mock-monaco-textarea'), { target: { value: '# Unsaved Alpha' } });
        rerender(
            <>
                <section data-testid="tab-a" style={{ display: 'none' }}><PreviewPane repoId="ws-1" routingRef="remote:a"
                    filePath="README.md" fileName="README.md" markdownPreview /></section>
                <section data-testid="tab-b"><PreviewPane repoId="ws-1" routingRef="remote:b"
                    filePath="README.md" fileName="README.md" markdownPreview /></section>
            </>,
        );
        expect(b.getByTestId('preview-markdown')).toHaveTextContent('Beta');
        expect(b.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
        expect(a.getByTestId('mock-monaco-textarea')).toHaveValue('# Unsaved Alpha');
        expect(a.getByTestId('dirty-indicator')).toBeInTheDocument();
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(2);
        expect(mockExplorerApi.readBlob.mock.calls.map(call => call[3])).toEqual(['remote:a', 'remote:b']);
    });

    it('does not preview MDX, ordinary text, trusted, oversized, or binary files', async () => {
        const text = { content: '# Heading', encoding: 'utf-8' as const, mimeType: 'text/plain' };
        mockExplorerApi.readBlob.mockResolvedValue(text);
        const { rerender } = render(<PreviewPane repoId="r1" filePath="a.mdx" fileName="a.mdx" markdownPreview />);
        expect(await screen.findByTestId('mock-monaco-editor')).toBeInTheDocument();
        rerender(<PreviewPane repoId="r1" filePath="a.txt" fileName="a.txt" markdownPreview />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toHaveAttribute('data-value', '# Heading'));
        expect(screen.queryByRole('group', { name: 'Markdown view' })).not.toBeInTheDocument();
        mockExplorerApi.readTrustedBlob.mockResolvedValue(text);
        rerender(<PreviewPane repoId="r1" filePath="__trusted__:readme.md" fileName="readme.md" markdownPreview />);
        await waitFor(() => expect(mockExplorerApi.readTrustedBlob).toHaveBeenCalled());
        expect(screen.queryByRole('group', { name: 'Markdown view' })).not.toBeInTheDocument();
        mockExplorerApi.readBlob.mockResolvedValueOnce({ ...text, content: 'x'.repeat(600 * 1024) });
        rerender(<PreviewPane repoId="r1" filePath="large.md" fileName="large.md" markdownPreview />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-value')).toHaveLength(512 * 1024));
        expect(screen.queryByRole('group', { name: 'Markdown view' })).not.toBeInTheDocument();
        mockExplorerApi.readBlob.mockResolvedValueOnce({ content: 'AAAA', encoding: 'base64', mimeType: 'application/octet-stream' });
        rerender(<PreviewPane repoId="r1" filePath="binary.md" fileName="binary.md" markdownPreview />);
        expect(await screen.findByTestId('preview-binary')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Markdown view' })).not.toBeInTheDocument();
    });

    it('renders image for image/* MIME with base64 encoding', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
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
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'AAAA',
            encoding: 'base64',
            mimeType: 'application/octet-stream',
        });

        render(<PreviewPane repoId="r1" filePath="file.bin" fileName="file.bin" />);

        await waitFor(() => expect(screen.getByTestId('preview-binary')).toBeInTheDocument());
        expect(screen.getByText(/Binary file/)).toBeInTheDocument();
    });

    it('renders Monaco editor for empty text files', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: '',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="empty.txt" fileName="empty.txt" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.getByTestId('mock-monaco-editor').getAttribute('data-value')).toBe('');
    });

    it('truncates content exceeding 512 KB and still renders Monaco', async () => {
        const largeContent = 'x'.repeat(600 * 1024); // 600 KB
        mockExplorerApi.readBlob.mockResolvedValue({
            content: largeContent,
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="large.txt" fileName="large.txt" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        // Content is truncated to 512 KB
        const editorValue = screen.getByTestId('mock-monaco-editor').getAttribute('data-value');
        expect(editorValue!.length).toBe(512 * 1024);
    });

    it('shows error state with Retry button on fetch failure', async () => {
        mockExplorerApi.readBlob.mockRejectedValue(new Error('Network error'));

        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-error')).toBeInTheDocument());
        expect(screen.getByText('Network error')).toBeInTheDocument();
        expect(screen.getByTestId('preview-retry-btn')).toBeInTheDocument();
    });

    it('Retry button re-triggers fetch', async () => {
        mockExplorerApi.readBlob.mockRejectedValueOnce(new Error('Network error'));

        render(<PreviewPane repoId="r1" filePath="src/app.ts" fileName="app.ts" />);

        await waitFor(() => expect(screen.getByTestId('preview-retry-btn')).toBeInTheDocument());
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(1);

        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'ok',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        await act(async () => {
            screen.getByTestId('preview-retry-btn').click();
        });

        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(2);
    });

    it('cancels in-flight request when filePath changes', async () => {
        let resolveFirst: (v: unknown) => void;
        mockExplorerApi.readBlob.mockImplementationOnce((_repoId: string, _path: string, opts?: RequestInit) => {
            return new Promise((resolve, reject) => {
                resolveFirst = resolve;
                opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        });

        const { rerender } = render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);
        expect(screen.getByTestId('preview-loading')).toBeInTheDocument();

        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'second file',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        rerender(<PreviewPane repoId="r1" filePath="b.ts" fileName="b.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        // The first fetch was cancelled (signal aborted), second one resolved
        expect(mockExplorerApi.readBlob).toHaveBeenCalledTimes(2);
    });

    it('fetches from the correct API URL', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/main.ts" fileName="main.ts" />);

        await waitFor(() => expect(mockExplorerApi.readBlob).toHaveBeenCalled());
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(
            'r1',
            'src/main.ts',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('does not render a path header — Monaco is the only content', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="src/components/App.tsx" fileName="App.tsx" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.queryByTestId('preview-header')).not.toBeInTheDocument();
    });

    it('close button calls onClose via floating toolbar', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
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
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'test',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);

        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.queryByTestId('preview-close-btn')).not.toBeInTheDocument();
    });

    it('shows dirty indicator and save button when content changes', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
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

        // Should now show dirty indicator and save button in floating toolbar
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
        expect(screen.getByTestId('save-btn')).toBeInTheDocument();
    });

    it('saves content via PUT API call', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
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

        mockExplorerApi.writeBlob.mockResolvedValueOnce({ success: true });

        await act(async () => {
            screen.getByTestId('save-btn').click();
        });

        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('r1', 'a.ts', 'modified');
    });

    it('saves the latest editor text through the mounted save action', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'original',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });
        mockExplorerApi.writeBlob.mockResolvedValue({ success: true });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());

        await act(async () => {
            const textarea = screen.getByTestId('mock-monaco-textarea');
            const setValue = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value',
            )!.set!;
            setValue.call(textarea, 'edited through shortcut');
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await act(async () => { mockMonaco.saveAction?.(); });

        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('r1', 'a.ts', 'edited through shortcut');
        expect(mockLanguageDocument.markSaved).toHaveBeenCalledWith('edited through shortcut');
    });

    function typeInEditor(text: string) {
        const textarea = screen.getByTestId('mock-monaco-textarea');
        const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
        setValue.call(textarea, text);
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    it('discard restores the loaded text, clears dirty state, and syncs the language document', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'original', encoding: 'utf-8', mimeType: 'text/plain' });
        const onDirtyChange = vi.fn();

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" onDirtyChange={onDirtyChange} />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        expect(screen.queryByTestId('discard-btn')).not.toBeInTheDocument();

        await act(async () => { typeInEditor('modified'); });
        expect(screen.getByTestId('discard-btn')).toBeInTheDocument();

        await act(async () => { screen.getByTestId('discard-btn').click(); });

        expect(screen.getByTestId('mock-monaco-editor')).toHaveAttribute('data-value', 'original');
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
        expect(screen.queryByTestId('discard-btn')).not.toBeInTheDocument();
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(mockLanguageDocument.handleChange).toHaveBeenLastCalledWith('original', undefined);
        expect(mockExplorerApi.writeBlob).not.toHaveBeenCalled();
    });

    it('discard after a save restores the saved text, not the original read', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({ content: 'original', encoding: 'utf-8', mimeType: 'text/plain' });
        mockExplorerApi.writeBlob.mockResolvedValue({ success: true });

        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());

        await act(async () => { typeInEditor('saved'); });
        await act(async () => { screen.getByTestId('save-btn').click(); });
        await act(async () => { typeInEditor('saved plus more'); });
        await act(async () => { screen.getByTestId('discard-btn').click(); });

        expect(screen.getByTestId('mock-monaco-editor')).toHaveAttribute('data-value', 'saved');
        expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
    });

    it('does not offer discard for read-only trusted files', async () => {
        mockExplorerApi.readTrustedBlob.mockResolvedValue({ content: 'x', encoding: 'utf-8', mimeType: 'text/plain' });

        render(<PreviewPane repoId="r1" filePath="__trusted__:/tmp/x.ts" fileName="x.ts" />);
        await waitFor(() => expect(screen.getByTestId('mock-monaco-editor')).toBeInTheDocument());
        await act(async () => { typeInEditor('changed'); });

        expect(screen.queryByTestId('discard-btn')).not.toBeInTheDocument();
    });

    it('floating toolbar is present when content is loaded', async () => {
        mockExplorerApi.readBlob.mockResolvedValue({
            content: 'hello',
            encoding: 'utf-8',
            mimeType: 'text/plain',
        });

        const onClose = vi.fn();
        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" onClose={onClose} />);

        await waitFor(() => expect(screen.getByTestId('preview-toolbar')).toBeInTheDocument());
    });

    it('no floating toolbar during loading state', () => {
        mockExplorerApi.readBlob.mockReturnValue(new Promise(() => {}));
        render(<PreviewPane repoId="r1" filePath="a.ts" fileName="a.ts" onClose={() => {}} />);
        expect(screen.queryByTestId('preview-toolbar')).not.toBeInTheDocument();
    });
});
