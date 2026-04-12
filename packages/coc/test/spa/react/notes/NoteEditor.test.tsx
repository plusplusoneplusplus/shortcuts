import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { useEffect } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetContent = vi.fn();
const mockSaveContent = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/notesApi', () => ({
    notesApi: {
        getContent: (...args: unknown[]) => mockGetContent(...args),
        saveContent: (...args: unknown[]) => mockSaveContent(...args),
        getComments: vi.fn(() => Promise.resolve({ noteId: '', threads: {} })),
        updateThread: vi.fn(() => Promise.resolve()),
        uploadImage: vi.fn(() => Promise.resolve({ path: 'img/test.png' })),
    },
}));

// Mock NoteEditorIO — the default export delegates to notesApi under the hood,
// but we override it here so tests can intercept all IO calls via mockIo.
const mockLoadContent = vi.fn();
const mockIOSaveContent = vi.fn();
const mockUploadImage = vi.fn();
const mockImageApiUrl = vi.fn((wsId: string, relPath: string) =>
    `/api/workspaces/${encodeURIComponent(wsId)}/notes/image?path=${encodeURIComponent(relPath)}`);

const mockIo = {
    loadContent: (...args: unknown[]) => mockLoadContent(...(args as [string, string])),
    saveContent: (...args: unknown[]) => mockIOSaveContent(...(args as [string, string, string])),
    uploadImage: (...args: unknown[]) => mockUploadImage(...(args as [string, string, string])),
    imageApiUrl: (...args: unknown[]) => mockImageApiUrl(...(args as [string, string])),
};

vi.mock(
    '../../../../src/server/spa/client/react/repos/notes/noteMarkdown',
    () => ({
        markdownToHtml: (md: string) => `<p>${md}</p>`,
        htmlToMarkdown: (html: string) => html.replace(/<\/?[^>]+>/g, ''),
        rewriteImageSrcToApi: (html: string) => html,
        rewriteImageSrcToRelative: (md: string) => md,
    }),
);

const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
let capturedOnChange: ((editor: unknown) => void) | null = null;

const mockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
    chain: () => ({
        focus: () => ({
            toggleBold: () => ({ run: vi.fn() }),
            toggleItalic: () => ({ run: vi.fn() }),
            toggleStrike: () => ({ run: vi.fn() }),
            toggleHeading: () => ({ run: vi.fn() }),
            toggleBulletList: () => ({ run: vi.fn() }),
            toggleOrderedList: () => ({ run: vi.fn() }),
            toggleTaskList: () => ({ run: vi.fn() }),
            toggleBlockquote: () => ({ run: vi.fn() }),
            toggleCode: () => ({ run: vi.fn() }),
            toggleCodeBlock: () => ({ run: vi.fn() }),
            setLink: () => ({ run: vi.fn() }),
            unsetLink: () => ({ run: vi.fn() }),
            setHorizontalRule: () => ({ run: vi.fn() }),
        }),
    }),
};

// Mock RichEditorCore — replaces the real Tiptap shell.
// Captures the onChange callback and calls onEditorReady with mockEditor.
vi.mock('../../../../src/server/spa/client/react/repos/notes/RichEditorCore', () => ({
    RichEditorCore: (props: { onChange?: (editor: unknown) => void; onEditorReady?: (editor: unknown) => void }) => {
        if (props.onChange) capturedOnChange = props.onChange;
        // Notify parent of editor readiness via useEffect
        useEffect(() => {
            props.onEditorReady?.(mockEditor);
        }, []);
        return <div data-testid="editor-content" />;
    },
}));

import { NoteEditor } from '../../../../src/server/spa/client/react/repos/notes/NoteEditor';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditor', () => {
    beforeEach(() => {
        mockGetContent.mockReset();
        mockSaveContent.mockReset();
        mockLoadContent.mockReset();
        mockIOSaveContent.mockReset();
        mockUploadImage.mockReset();
        mockImageApiUrl.mockClear();
        mockImageApiUrl.mockImplementation((wsId: string, relPath: string) =>
            `/api/workspaces/${encodeURIComponent(wsId)}/notes/image?path=${encodeURIComponent(relPath)}`);
        mockSetContent.mockReset();
        mockClearContent.mockReset();
        mockGetHTML.mockReturnValue('<p>content</p>');
        capturedOnChange = null;
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    // ── Content loads exactly once (Fix 1: waits for editor) ──────────

    it('loads content exactly once (does not double-fetch before editor is ready)', async () => {
        mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
        });
        await waitFor(() => {
            expect(mockLoadContent).toHaveBeenCalledTimes(1);
            expect(mockSetContent).toHaveBeenCalledTimes(1);
        });
    });

    // ── No spurious autosave after load (Fix 3) ─────────────────────────

    it('does not trigger spurious autosave after loading content', async () => {
        mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        // Advance past the 1500ms debounce window
        await act(async () => { vi.advanceTimersByTime(2000); });

        expect(mockIOSaveContent).not.toHaveBeenCalled();
    });

    // ── Threads prop skips loadThreads (Fix 2) ──────────────────────────

    it('uses threads prop for marks instead of calling loadThreads', async () => {
        const fakeThreads = [{
            id: 'thread-1',
            anchor: { quotedText: 'Hello', prefix: '', suffix: '' },
            status: 'open' as const,
            comments: [{ id: 'c1', body: 'Nice!', createdAt: '2025-01-01T00:00:00Z' }],
            createdAt: '2025-01-01T00:00:00Z',
        }];

        const mockBackend = {
            loadThreads: vi.fn().mockResolvedValue([]),
            updateThreadAnchor: vi.fn(),
        };

        mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

        await act(async () => {
            render(
                <NoteEditor
                    workspaceId="ws1"
                    notePath="page.md"
                    io={mockIo}
                    commentBackend={mockBackend}
                    threads={fakeThreads}
                    commentsEnabled={true}
                />,
            );
        });

        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        // Backend's loadThreads should NOT have been called when threads prop is provided
        expect(mockBackend.loadThreads).not.toHaveBeenCalled();
    });

    // ── Empty state ─────────────────────────────────────────────────────

    it('shows empty-state placeholder when notePath is null', () => {
        render(<NoteEditor workspaceId="ws1" notePath={null} io={mockIo} />);
        expect(screen.getByTestId('note-editor-empty')).toBeDefined();
        expect(screen.getByText('Select a page to start editing')).toBeDefined();
        expect(mockLoadContent).not.toHaveBeenCalled();
    });

    // ── Loading state ───────────────────────────────────────────────────

    it('shows loading spinner while content loads', () => {
        mockLoadContent.mockReturnValue(new Promise(() => {}));
        render(<NoteEditor workspaceId="ws1" notePath="path/page.md" io={mockIo} />);
        expect(screen.getByTestId('note-editor-loading')).toBeDefined();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    // ── Content load ────────────────────────────────────────────────────

    it('loads content and sets it on the editor', async () => {
        mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
        });
        await waitFor(() => {
            expect(mockLoadContent).toHaveBeenCalledWith('ws1', 'page.md');
            expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>');
        });
    });

    // ── Load error ──────────────────────────────────────────────────────

    it('shows error banner when load fails', async () => {
        mockLoadContent.mockRejectedValue(new Error('Not found'));
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
        });
        await waitFor(() => {
            expect(screen.getByTestId('note-editor-error')).toBeDefined();
            expect(screen.getByText('Not found')).toBeDefined();
        });
    });

    // ── Autosave fires after debounce ───────────────────────────────────

    it('autosaves after 1.5s debounce', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        // Switch to fake timers after async load completes
        vi.useFakeTimers();

        act(() => { capturedOnChange?.(mockEditor); });
        expect(mockIOSaveContent).not.toHaveBeenCalled();

        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'p.md', 'content');
    });

    // ── Debounce resets on rapid edits ──────────────────────────────────

    it('resets debounce on rapid edits — only one save', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnChange?.(mockEditor); });
        vi.advanceTimersByTime(500);
        act(() => { capturedOnChange?.(mockEditor); });

        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(mockIOSaveContent).toHaveBeenCalledTimes(1);
    });

    // ── Save indicator: saving ──────────────────────────────────────────

    it('shows "Saving…" during save', async () => {
        let resolveSave!: (v: unknown) => void;
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockReturnValue(new Promise((r) => { resolveSave = r; }));

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnChange?.(mockEditor); });
        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(screen.getByText('Saving…')).toBeDefined();

        await act(async () => { resolveSave({ path: 'p.md', updated: true }); });
    });

    // ── Save indicator: saved ───────────────────────────────────────────

    it('shows "Saved ✓" after save then clears after 3s', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnChange?.(mockEditor); });
        await act(async () => { vi.advanceTimersByTime(1600); });
        // Flush the save promise
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('Saved ✓')).toBeDefined();

        act(() => { vi.advanceTimersByTime(3100); });
        expect(screen.queryByText('Saved ✓')).toBeNull();
    });

    // ── Save indicator: error ───────────────────────────────────────────

    it('shows "Save failed" with retry button on error', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockRejectedValue(new Error('Network'));

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnChange?.(mockEditor); });
        await act(async () => { vi.advanceTimersByTime(1600); });
        // Flush the rejected promise
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByText('Save failed')).toBeDefined();
        expect(screen.getByText('Retry')).toBeDefined();
    });

    // ── Toolbar renders ─────────────────────────────────────────────────

    it('renders toolbar buttons', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        expect(screen.getByTestId('note-editor-toolbar')).toBeDefined();
        expect(screen.getByLabelText('Bold')).toBeDefined();
        expect(screen.getByLabelText('Italic')).toBeDefined();
        expect(screen.getByLabelText('Heading 1')).toBeDefined();
        expect(screen.getByLabelText('Bullet list')).toBeDefined();
        expect(screen.getByLabelText('Code block')).toBeDefined();
        expect(screen.getByLabelText('Link')).toBeDefined();
    });

    // ── Ctrl+S suppresses browser dialog and flushes save ─────────────

    it('Ctrl+S calls preventDefault and triggers save', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        // Make content dirty so flushSave has something to persist
        act(() => { capturedOnChange?.(mockEditor); });

        const event = new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        await act(async () => { document.dispatchEvent(event); });

        expect(preventSpy).toHaveBeenCalled();
        expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'p.md', 'content');
    });

    it('Cmd+S (metaKey) also suppresses dialog and saves', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockIOSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        act(() => { capturedOnChange?.(mockEditor); });

        const event = new KeyboardEvent('keydown', {
            key: 's',
            metaKey: true,
            bubbles: true,
            cancelable: true,
        });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        await act(async () => { document.dispatchEvent(event); });

        expect(preventSpy).toHaveBeenCalled();
        expect(mockIOSaveContent).toHaveBeenCalled();
    });

    it('Ctrl+S with no note selected does not error', () => {
        render(<NoteEditor workspaceId="ws1" notePath={null} io={mockIo} />);

        const event = new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        const preventSpy = vi.spyOn(event, 'preventDefault');

        document.dispatchEvent(event);

        expect(preventSpy).toHaveBeenCalled();
        expect(mockIOSaveContent).not.toHaveBeenCalled();
    });

    // ── beforeunload ────────────────────────────────────────────────────

    it('registers beforeunload when dirty', async () => {
        mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
        const addSpy = vi.spyOn(window, 'addEventListener');

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        act(() => { capturedOnChange?.(mockEditor); });

        expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
        addSpy.mockRestore();
    });

    // ── EditorContent renders ───────────────────────────────────────────

    it('renders EditorContent when path is provided', async () => {
        mockLoadContent.mockResolvedValue({ content: '# Hi', path: 'p.md' });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
        });
        await waitFor(() => {
            expect(screen.getByTestId('editor-content')).toBeDefined();
        });
    });

    // ── NoteEditorIO adapter ────────────────────────────────────────────

    it('works unchanged when no io prop is passed (uses default)', async () => {
        // The default IO delegates to notesApi — verify via the notesApi mock
        mockGetContent.mockResolvedValue({ content: 'default', path: 'd.md' });
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="d.md" />);
        });
        await waitFor(() => {
            expect(mockGetContent).toHaveBeenCalledWith('ws1', 'd.md');
            expect(mockSetContent).toHaveBeenCalledWith('<p>default</p>');
        });
    });

    it('uses custom io adapter for load and save', async () => {
        const customIo = {
            loadContent: vi.fn().mockResolvedValue({ content: 'custom', path: 'c.md' }),
            saveContent: vi.fn().mockResolvedValue({ path: 'c.md', updated: true }),
            uploadImage: vi.fn().mockResolvedValue({ path: 'img.png' }),
            imageApiUrl: vi.fn((_ws: string, p: string) => `/custom/${p}`),
        };

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="c.md" io={customIo} />);
        });
        await waitFor(() => {
            expect(customIo.loadContent).toHaveBeenCalledWith('ws1', 'c.md');
            expect(mockSetContent).toHaveBeenCalledWith('<p>custom</p>');
        });
        // notesApi should NOT have been called for content
        expect(mockGetContent).not.toHaveBeenCalled();

        vi.useFakeTimers();
        act(() => { capturedOnChange?.(mockEditor); });
        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(customIo.saveContent).toHaveBeenCalledWith('ws1', 'c.md', 'content');
        expect(mockSaveContent).not.toHaveBeenCalled();
    });
});
