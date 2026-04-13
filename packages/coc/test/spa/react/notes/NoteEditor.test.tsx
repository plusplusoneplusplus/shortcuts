import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, within } from '@testing-library/react';
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

let richEditorMountCount = 0;

const mockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
    isDestroyed: false,
    state: { doc: {}, selection: { empty: true } },
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
// Tracks mount/unmount count for regression tests.
vi.mock('../../../../src/server/spa/client/react/repos/notes/RichEditorCore', () => ({
    RichEditorCore: (props: { onChange?: (editor: unknown) => void; onEditorReady?: (editor: unknown) => void }) => {
        if (props.onChange) capturedOnChange = props.onChange;
        useEffect(() => {
            richEditorMountCount++;
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
        mockEditor.isDestroyed = false;
        capturedOnChange = null;
        richEditorMountCount = 0;
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

    // ══════════════════════════════════════════════════════════════════════
    // Regression: editor always-mounted (no infinite fetch / empty content)
    // ══════════════════════════════════════════════════════════════════════

    describe('editor always-mounted (regression)', () => {

        it('RichEditorCore stays mounted during loading — never unmounted and remounted', async () => {
            let resolveLoad!: (v: { content: string; path: string }) => void;
            mockLoadContent.mockReturnValue(new Promise((r) => { resolveLoad = r; }));

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            // Loading state: editor-content should still be in the DOM (hidden)
            expect(screen.getByTestId('note-editor-loading')).toBeDefined();
            expect(screen.getByTestId('editor-content')).toBeDefined();

            // Editor was mounted exactly once
            expect(richEditorMountCount).toBe(1);

            // Resolve the load
            await act(async () => { resolveLoad({ content: '# Hello', path: 'page.md' }); });

            // Loading gone, editor still there, still only mounted once
            expect(screen.queryByTestId('note-editor-loading')).toBeNull();
            expect(screen.getByTestId('editor-content')).toBeDefined();
            expect(richEditorMountCount).toBe(1);
        });

        it('content is applied to editor even when fetch resolves during loading state', async () => {
            let resolveLoad!: (v: { content: string; path: string }) => void;
            mockLoadContent.mockReturnValue(new Promise((r) => { resolveLoad = r; }));

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            // Still loading
            expect(screen.getByTestId('note-editor-loading')).toBeDefined();
            expect(mockSetContent).not.toHaveBeenCalled();

            // Resolve fetch — content should be applied to the (hidden but mounted) editor
            await act(async () => { resolveLoad({ content: '# Hello', path: 'page.md' }); });

            expect(mockSetContent).toHaveBeenCalledTimes(1);
            expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>');
        });

        it('switching notes does not remount editor — only one mount total', async () => {
            mockLoadContent.mockResolvedValue({ content: '# First', path: 'a.md' });

            const { rerender } = await act(async () => {
                return render(<NoteEditor workspaceId="ws1" notePath="a.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># First</p>'));
            expect(richEditorMountCount).toBe(1);

            // Switch to a different note
            mockLoadContent.mockResolvedValue({ content: '# Second', path: 'b.md' });
            await act(async () => {
                rerender(<NoteEditor workspaceId="ws1" notePath="b.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Second</p>'));

            // Editor was still only mounted once — never unmounted/remounted
            expect(richEditorMountCount).toBe(1);
        });

        it('switching notes fetches exactly once per note (no infinite loop)', async () => {
            mockLoadContent.mockResolvedValue({ content: '# First', path: 'a.md' });

            const { rerender } = await act(async () => {
                return render(<NoteEditor workspaceId="ws1" notePath="a.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));

            mockLoadContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Second', path: 'b.md' });

            await act(async () => {
                rerender(<NoteEditor workspaceId="ws1" notePath="b.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));

            // Switch back
            mockLoadContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# First again', path: 'a.md' });

            await act(async () => {
                rerender(<NoteEditor workspaceId="ws1" notePath="a.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));

            // Each switch fetched exactly once — no double or infinite fetches
            expect(mockSetContent).toHaveBeenCalledTimes(3);
        });

        it('rapid note switching cancels stale fetches — only last note content is applied', async () => {
            let resolveFirst!: (v: { content: string; path: string }) => void;
            let resolveSecond!: (v: { content: string; path: string }) => void;

            mockLoadContent
                .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
                .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));

            const { rerender } = await act(async () => {
                return render(<NoteEditor workspaceId="ws1" notePath="a.md" io={mockIo} />);
            });

            // Quickly switch to b.md before a.md finishes loading
            await act(async () => {
                rerender(<NoteEditor workspaceId="ws1" notePath="b.md" io={mockIo} />);
            });

            // Resolve first (stale) — should be ignored
            await act(async () => { resolveFirst({ content: '# Stale', path: 'a.md' }); });
            expect(mockSetContent).not.toHaveBeenCalledWith('<p># Stale</p>');

            // Resolve second (current) — should be applied
            await act(async () => { resolveSecond({ content: '# Current', path: 'b.md' }); });
            expect(mockSetContent).toHaveBeenCalledWith('<p># Current</p>');
        });

        it('editor-content is in DOM but visually hidden during loading', async () => {
            mockLoadContent.mockReturnValue(new Promise(() => {}));

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            const editorContent = screen.getByTestId('editor-content');
            expect(editorContent).toBeDefined();

            // The editor's parent div should have visibility:hidden
            const hiddenWrapper = editorContent.closest('div[style]');
            expect(hiddenWrapper).toBeDefined();
            expect((hiddenWrapper as HTMLElement).style.visibility).toBe('hidden');
        });

        it('editor-content is in DOM but visually hidden in empty state', () => {
            render(<NoteEditor workspaceId="ws1" notePath={null} io={mockIo} />);

            const editorContent = screen.getByTestId('editor-content');
            expect(editorContent).toBeDefined();

            const hiddenWrapper = editorContent.closest('div[style]');
            expect(hiddenWrapper).toBeDefined();
            expect((hiddenWrapper as HTMLElement).style.visibility).toBe('hidden');
        });

        it('editor-content is in DOM but visually hidden on load error', async () => {
            mockLoadContent.mockRejectedValue(new Error('fail'));

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            await waitFor(() => expect(screen.getByTestId('note-editor-error')).toBeDefined());

            const editorContent = screen.getByTestId('editor-content');
            expect(editorContent).toBeDefined();

            const hiddenWrapper = editorContent.closest('div[style]');
            expect(hiddenWrapper).toBeDefined();
            expect((hiddenWrapper as HTMLElement).style.visibility).toBe('hidden');
        });

        it('transitioning from empty to selected note loads content without remount', async () => {
            const { rerender } = render(
                <NoteEditor workspaceId="ws1" notePath={null} io={mockIo} />,
            );

            expect(richEditorMountCount).toBe(1);
            expect(mockLoadContent).not.toHaveBeenCalled();

            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            await act(async () => {
                rerender(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>');
            });

            // Still only one mount — the editor instance survived the transition
            expect(richEditorMountCount).toBe(1);
        });

        it('toolbar is hidden during loading and visible after', async () => {
            let resolveLoad!: (v: { content: string; path: string }) => void;
            mockLoadContent.mockReturnValue(new Promise((r) => { resolveLoad = r; }));

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            // Toolbar should not be visible during loading
            expect(screen.queryByTestId('note-editor-toolbar')).toBeNull();
            expect(screen.queryByTestId('note-mode-toggle')).toBeNull();

            await act(async () => { resolveLoad({ content: '# Hello', path: 'page.md' }); });

            // Toolbar should be visible after loading
            expect(screen.getByTestId('note-editor-toolbar')).toBeDefined();
            expect(screen.getByTestId('note-mode-toggle')).toBeDefined();
        });
    });
});
