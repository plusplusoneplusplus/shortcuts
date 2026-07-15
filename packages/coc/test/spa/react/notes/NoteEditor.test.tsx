import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent, within } from '@testing-library/react';
import { useEffect } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetContent = vi.fn();
const mockSaveContent = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getContent: (...args: unknown[]) => mockGetContent(...args),
        saveContent: (...args: unknown[]) => mockSaveContent(...args),
        getComments: vi.fn(() => Promise.resolve({ noteId: '', threads: {} })),
        updateThread: vi.fn(() => Promise.resolve()),
        uploadImage: vi.fn(() => Promise.resolve({ path: 'img/test.png' })),
        getGitStatus: vi.fn(() => Promise.resolve({ initialized: false })),
    },
}));

// Mock QueueContext — capture dispatched actions for assertions
const mockQueueDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
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
    '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown',
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
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/RichEditorCore', () => ({
    RichEditorCore: (props: { onChange?: (editor: unknown) => void; onEditorReady?: (editor: unknown) => void }) => {
        if (props.onChange) capturedOnChange = props.onChange;
        useEffect(() => {
            richEditorMountCount++;
            props.onEditorReady?.(mockEditor);
        }, []);
        return <div data-testid="editor-content" />;
    },
}));

// Mock config for isRalphEnabled
let mockRalphEnabled = true;
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => mockRalphEnabled,
}));

// Mock RalphLaunchDialog — renders a simple stub
const mockRalphLaunchDialogProps = vi.fn();
vi.mock('../../../../src/server/spa/client/react/shared/RalphLaunchDialog', () => ({
    RalphLaunchDialog: (props: Record<string, unknown>) => {
        mockRalphLaunchDialogProps(props);
        return props.open ? <div data-testid="ralph-launch-dialog-stub" /> : null;
    },
}));

import { NoteEditor } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditor';

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
        mockEditor.state.doc = {};
        capturedOnChange = null;
        richEditorMountCount = 0;
        mockQueueDispatch.mockReset();
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

    it('passes the selected root to comment backend load fallback', async () => {
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
                    commentsEnabled={true}
                    root="task:primary"
                />,
            );
        });

        await waitFor(() => {
            expect(mockBackend.loadThreads).toHaveBeenCalledWith('ws1', 'page.md', 'task:primary');
        });
    });

    it('passes the selected root when updating comment thread anchors after save', async () => {
        const fakeThread = {
            id: 'thread-1',
            anchor: { quotedText: 'old text', prefix: '', suffix: '' },
            status: 'open' as const,
            comments: [{ id: 'c1', body: 'Needs update', createdAt: '2025-01-01T00:00:00Z' }],
            createdAt: '2025-01-01T00:00:00Z',
        };
        const mockBackend = {
            loadThreads: vi.fn().mockResolvedValue([]),
            updateThreadAnchor: vi.fn().mockResolvedValue(undefined),
        };
        let flushSave: (() => Promise<void>) | null = null;

        mockLoadContent.mockResolvedValue({ content: 'new text', path: 'page.md' });
        mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true });
        mockEditor.state.doc = {
            textContent: 'new text',
            content: { size: 8 },
            textBetween: vi.fn(() => 'new text'),
            descendants: (callback: (node: unknown, pos: number) => void) => {
                callback({
                    isText: true,
                    type: { name: 'text' },
                    text: 'new text',
                    nodeSize: 8,
                    marks: [{ type: { name: 'comment' }, attrs: { commentId: 'thread-1' } }],
                }, 1);
            },
        };

        await act(async () => {
            render(
                <NoteEditor
                    workspaceId="ws1"
                    notePath="page.md"
                    io={mockIo}
                    commentBackend={mockBackend}
                    threads={[fakeThread]}
                    commentsEnabled={true}
                    root="task:primary"
                    onFlushSave={(flush) => { flushSave = flush; }}
                />,
            );
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
        await waitFor(() => expect(flushSave).not.toBeNull());

        act(() => { capturedOnChange?.(mockEditor); });
        await act(async () => { await flushSave?.(); });

        await waitFor(() => {
            expect(mockBackend.updateThreadAnchor).toHaveBeenCalledWith(
                'ws1',
                'page.md',
                'thread-1',
                'open',
                'task:primary',
            );
        });
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
            expect(mockLoadContent).toHaveBeenCalledWith('ws1', 'page.md', undefined);
            expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>', { emitUpdate: false });
        });
    });

    // ── Best-effort scroll to line (AC-04) ──────────────────────────────

    it('loads content without throwing when a scrollToLine is provided', async () => {
        mockLoadContent.mockResolvedValue({ content: '# Hello\n\nline two\nline three', path: 'page.md' });
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} scrollToLine={40} />);
        });
        // The best-effort scroll must not break the normal load path.
        await waitFor(() => {
            expect(mockLoadContent).toHaveBeenCalledTimes(1);
            expect(mockSetContent).toHaveBeenCalledTimes(1);
        });
    });

    it('loads content normally (opens at top) when no scrollToLine is provided', async () => {
        mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalledTimes(1));
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

        expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'p.md', 'content', undefined, undefined);
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
        expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'p.md', 'content', undefined, undefined);
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
            expect(mockGetContent).toHaveBeenCalledWith('ws1', 'd.md', undefined);
            expect(mockSetContent).toHaveBeenCalledWith('<p>default</p>', { emitUpdate: false });
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
            expect(customIo.loadContent).toHaveBeenCalledWith('ws1', 'c.md', undefined);
            expect(mockSetContent).toHaveBeenCalledWith('<p>custom</p>', { emitUpdate: false });
        });
        // notesApi should NOT have been called for content
        expect(mockGetContent).not.toHaveBeenCalled();

        vi.useFakeTimers();
        act(() => { capturedOnChange?.(mockEditor); });
        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(customIo.saveContent).toHaveBeenCalledWith('ws1', 'c.md', 'content', undefined, undefined);
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
            expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>', { emitUpdate: false });
        });

        it('switching notes does not remount editor — only one mount total', async () => {
            mockLoadContent.mockResolvedValue({ content: '# First', path: 'a.md' });

            const { rerender } = await act(async () => {
                return render(<NoteEditor workspaceId="ws1" notePath="a.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># First</p>', { emitUpdate: false }));
            expect(richEditorMountCount).toBe(1);

            // Switch to a different note
            mockLoadContent.mockResolvedValue({ content: '# Second', path: 'b.md' });
            await act(async () => {
                rerender(<NoteEditor workspaceId="ws1" notePath="b.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Second</p>', { emitUpdate: false }));

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
            expect(mockSetContent).not.toHaveBeenCalledWith('<p># Stale</p>', { emitUpdate: false });

            // Resolve second (current) — should be applied
            await act(async () => { resolveSecond({ content: '# Current', path: 'b.md' }); });
            expect(mockSetContent).toHaveBeenCalledWith('<p># Current</p>', { emitUpdate: false });
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
                expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>', { emitUpdate: false });
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

        it('editor stays mounted when switching to source mode and back', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledTimes(1));
            expect(richEditorMountCount).toBe(1);

            // Switch to source mode
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            await act(async () => {
                screen.getByTestId('note-mode-source').click();
            });
            await waitFor(() => expect(screen.getByTestId('note-source-container')).toBeDefined());

            // Editor-content should still be in the DOM (hidden, not unmounted)
            expect(screen.getByTestId('editor-content')).toBeDefined();
            expect(richEditorMountCount).toBe(1);

            // Switch back to rich mode
            await act(async () => {
                screen.getByTestId('note-mode-rich').click();
            });

            // Editor should have received setContent with the markdown→HTML conversion
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledTimes(2));
            expect(richEditorMountCount).toBe(1);
        });

        it('content is preserved after source→rich round-trip', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Original', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            // Switch to source — loads fresh markdown from server
            mockLoadContent.mockResolvedValue({ content: '# Edited in source', path: 'page.md' });
            await act(async () => {
                screen.getByTestId('note-mode-source').click();
            });
            await waitFor(() => expect(screen.getByTestId('note-source-container')).toBeDefined());

            // Switch back to rich — should convert the source markdown to HTML
            await act(async () => {
                screen.getByTestId('note-mode-rich').click();
            });

            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalledWith('<p># Edited in source</p>', { emitUpdate: false });
            });
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Auto-reload via notes-changed window event
    // ══════════════════════════════════════════════════════════════════════

    describe('auto-reload on notes-changed', () => {
        it('reloads content when notes-changed event matches current notePath', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Original', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            // Reset to track the reload
            mockLoadContent.mockClear();
            mockSetContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Updated by AI', path: 'page.md' });

            // Dispatch notes-changed event
            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });

            await waitFor(() => {
                expect(mockLoadContent).toHaveBeenCalledWith('ws1', 'page.md', undefined);
                expect(mockSetContent).toHaveBeenCalledWith('<p># Updated by AI</p>', { emitUpdate: false });
            });
        });

        it('uses the refreshed mtime when saving after a notes-changed reload', async () => {
            mockLoadContent.mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 100 });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            mockLoadContent.mockResolvedValueOnce({ content: '# Updated by AI', path: 'page.md', mtime: 200 });

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });
            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalledWith('<p># Updated by AI</p>', { emitUpdate: false });
            });

            mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true, mtime: 300 });

            vi.useFakeTimers();
            act(() => { capturedOnChange?.(mockEditor); });
            await act(async () => { vi.advanceTimersByTime(1600); });
            await act(async () => { await Promise.resolve(); });

            expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'page.md', 'content', 200, undefined);
        });

        it('advances the mtime baseline for identical-content notes-changed reloads', async () => {
            mockLoadContent.mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 100 });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            mockLoadContent.mockClear();
            mockSetContent.mockClear();
            mockLoadContent.mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 200 });

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledWith('ws1', 'page.md', undefined));
            expect(mockSetContent).not.toHaveBeenCalled();

            mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true, mtime: 300 });

            vi.useFakeTimers();
            act(() => { capturedOnChange?.(mockEditor); });
            await act(async () => { vi.advanceTimersByTime(1600); });
            await act(async () => { await Promise.resolve(); });

            expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'page.md', 'content', 200, undefined);
        });

        it('keeps conflict detection after a refreshed baseline when a later external write wins', async () => {
            mockLoadContent.mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 100 });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            mockLoadContent.mockResolvedValueOnce({ content: '# Updated by AI', path: 'page.md', mtime: 200 });

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });
            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalledWith('<p># Updated by AI</p>', { emitUpdate: false });
            });

            mockIOSaveContent.mockRejectedValue(
                Object.assign(new Error('mtime_mismatch'), { status: 409, currentContent: '# Later external write' }),
            );

            vi.useFakeTimers();
            act(() => { capturedOnChange?.(mockEditor); });
            await act(async () => { vi.advanceTimersByTime(1600); });
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(screen.getByTestId('note-conflict-banner')).toBeDefined();
            expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'page.md', 'content', 200, undefined);
        });

        it('ignores notes-changed event for different workspace', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            mockLoadContent.mockClear();
            mockSetContent.mockClear();

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws-other', changedPaths: ['page.md'] },
                }));
            });

            // Should not reload
            expect(mockLoadContent).not.toHaveBeenCalled();
        });

        it('ignores notes-changed event for different file', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            mockLoadContent.mockClear();
            mockSetContent.mockClear();

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['other.md'] },
                }));
            });

            expect(mockLoadContent).not.toHaveBeenCalled();
        });

        it('does not reload when editor has pending unsaved content', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            // Make an edit (sets pendingContentRef)
            act(() => { capturedOnChange?.(mockEditor); });

            mockLoadContent.mockClear();
            mockSetContent.mockClear();

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });

            // Should not reload because there are unsaved edits
            expect(mockLoadContent).not.toHaveBeenCalled();
        });

        it('does not overwrite pending source-mode edits on notes-changed', async () => {
            mockLoadContent
                .mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 90 })
                .mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 100 });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            await act(async () => {
                screen.getByTestId('note-mode-source').click();
            });
            await waitFor(() => expect(screen.getByTestId('note-source-container')).toBeDefined());

            mockLoadContent.mockClear();
            mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true, mtime: 150 });

            vi.useFakeTimers();
            const textarea = screen.getByTestId('note-source-container').querySelector('textarea')!;
            fireEvent.change(textarea, { target: { value: '# User draft' } });

            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });

            expect(mockLoadContent).not.toHaveBeenCalled();
            expect(textarea.value).toBe('# User draft');

            await act(async () => { vi.advanceTimersByTime(1600); });
            await act(async () => { await Promise.resolve(); });

            expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'page.md', '# User draft', 100, undefined);
        });

        it('does not listen when notePath is null', () => {
            const addSpy = vi.spyOn(window, 'addEventListener');

            render(<NoteEditor workspaceId="ws1" notePath={null} io={mockIo} />);

            const notesCalls = addSpy.mock.calls.filter(c => c[0] === 'notes-changed');
            // The effect should not have added a listener (it returns early)
            expect(notesCalls).toHaveLength(0);

            addSpy.mockRestore();
        });

        it('skips auto-reload when notes-changed arrives shortly after save', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            vi.useFakeTimers();

            // Trigger an edit + debounce save
            act(() => { capturedOnChange?.(mockEditor); });
            await act(async () => { vi.advanceTimersByTime(1600); });
            // Flush the save promise
            await act(async () => { await Promise.resolve(); });

            expect(mockIOSaveContent).toHaveBeenCalledTimes(1);

            // Reset tracking for the reload path
            mockLoadContent.mockClear();
            mockSetContent.mockClear();

            // Fire the echo notes-changed event right after save (within 1s)
            await act(async () => {
                window.dispatchEvent(new CustomEvent('notes-changed', {
                    detail: { wsId: 'ws1', changedPaths: ['page.md'] },
                }));
            });

            // Should NOT reload — the event is an echo of our own save
            expect(mockLoadContent).not.toHaveBeenCalled();
            expect(mockSetContent).not.toHaveBeenCalled();
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Conflict resolution (Keep mine / Load disk)
    // ══════════════════════════════════════════════════════════════════════

    describe('conflict resolution', () => {
        // Load a note, edit it, and reject the debounced save with a 409 so the
        // conflict banner is showing. Returns once the banner is in the DOM.
        async function renderInConflict() {
            mockLoadContent.mockResolvedValueOnce({ content: '# Original', path: 'page.md', mtime: 100 });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            mockIOSaveContent.mockRejectedValue(
                Object.assign(new Error('mtime_mismatch'), { status: 409, currentContent: '# Later external write' }),
            );

            vi.useFakeTimers();
            act(() => { capturedOnChange?.(mockEditor); });
            await act(async () => { vi.advanceTimersByTime(1600); });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });

            expect(screen.getByTestId('note-conflict-banner')).toBeDefined();
        }

        it('Keep my version re-saves with a forced overwrite (no mtime check)', async () => {
            await renderInConflict();

            // The retry should succeed.
            mockIOSaveContent.mockReset();
            mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true, mtime: 300 });

            await act(async () => {
                screen.getByTestId('conflict-keep-mine-btn').click();
            });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });

            // Forced overwrite → expectedMtime is undefined.
            expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'page.md', 'content', undefined, undefined);
            expect(screen.queryByTestId('note-conflict-banner')).toBeNull();
        });

        it('Load disk version loads the external content into the editor and refreshes mtime', async () => {
            await renderInConflict();

            mockSetContent.mockClear();
            mockLoadContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Later external write', path: 'page.md', mtime: 400 });

            await act(async () => {
                screen.getByTestId('conflict-load-disk-btn').click();
            });
            await act(async () => { await Promise.resolve(); await Promise.resolve(); });

            // Disk content is converted and applied to the rich editor.
            expect(mockSetContent).toHaveBeenCalledWith('<p># Later external write</p>', { emitUpdate: false });
            // The banner is dismissed and the mtime baseline is refreshed from disk.
            expect(screen.queryByTestId('note-conflict-banner')).toBeNull();
            expect(mockLoadContent).toHaveBeenCalledWith('ws1', 'page.md', undefined);
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // onNotFound callback
    // ══════════════════════════════════════════════════════════════════════

    describe('onNotFound', () => {
        it('calls onNotFound instead of showing error when load fails with 404', async () => {
            mockLoadContent.mockRejectedValue(new Error('API error: 404 Not Found'));
            const onNotFound = vi.fn();

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} onNotFound={onNotFound} />);
            });

            await waitFor(() => expect(onNotFound).toHaveBeenCalledOnce());
            expect(screen.queryByTestId('note-editor-error')).toBeNull();
        });

        it('does not call onNotFound for non-404 errors', async () => {
            mockLoadContent.mockRejectedValue(new Error('Network error'));
            const onNotFound = vi.fn();

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} onNotFound={onNotFound} />);
            });

            await waitFor(() => expect(screen.getByTestId('note-editor-error')).toBeDefined());
            expect(onNotFound).not.toHaveBeenCalled();
        });

        it('still shows error box for non-404 errors when onNotFound is provided', async () => {
            mockLoadContent.mockRejectedValue(new Error('API error: 500 Internal Server Error'));
            const onNotFound = vi.fn();

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} onNotFound={onNotFound} />);
            });

            await waitFor(() => expect(screen.getByTestId('note-editor-error')).toBeDefined());
            expect(onNotFound).not.toHaveBeenCalled();
        });

        it('calls onNotFound when onNotFound is undefined and load fails with 404 — shows error fallback', async () => {
            mockLoadContent.mockRejectedValue(new Error('API error: 404 Not Found'));

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            // No onNotFound callback: the 404 is silently swallowed (no error box, no crash)
            await waitFor(() => expect(screen.queryByTestId('note-editor-error')).toBeNull());
        });

        it('does not re-fetch content when onNotFound identity changes between renders (regression: scratchpad blink loop)', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            // First render with one onNotFound function
            const { rerender } = await act(async () => {
                return render(
                    <NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} onNotFound={() => {}} />,
                );
            });
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));

            // Re-render multiple times with a NEW onNotFound function each time —
            // simulates the parent re-rendering on every tick (e.g. WebSocket events).
            // Before the fix, this re-fired the load effect each render, causing a
            // visible blink/refresh loop in the scratchpad note editor.
            for (let i = 0; i < 5; i++) {
                await act(async () => {
                    rerender(
                        <NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} onNotFound={() => {}} />,
                    );
                });
            }

            // No additional fetches — the load effect must not depend on onNotFound's identity.
            expect(mockLoadContent).toHaveBeenCalledTimes(1);
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // onFlushSave callback
    // ══════════════════════════════════════════════════════════════════════

    describe('onFlushSave', () => {
        it('calls onFlushSave with the flushSave function', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            const onFlushSave = vi.fn();

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} onFlushSave={onFlushSave} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            expect(onFlushSave).toHaveBeenCalledWith(expect.any(Function));
        });

        it('exposed flushSave triggers save of pending content', async () => {
            mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
            mockIOSaveContent.mockResolvedValue({ path: 'p.md', updated: true });
            let capturedFlush: (() => Promise<void>) | null = null;
            const onFlushSave = vi.fn((fn: () => Promise<void>) => { capturedFlush = fn; });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} onFlushSave={onFlushSave} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            // Make an edit to create pending content
            act(() => { capturedOnChange?.(mockEditor); });

            expect(capturedFlush).not.toBeNull();
            await act(async () => { await capturedFlush!(); });

            expect(mockIOSaveContent).toHaveBeenCalledWith('ws1', 'p.md', 'content', undefined, undefined);
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Manual refresh
    // ══════════════════════════════════════════════════════════════════════

    describe('manual refresh', () => {
        it('toolbar renders the refresh button after note loads', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.getByTestId('note-editor-refresh-btn')).toBeDefined();
        });

        it('clicking refresh button reloads content from server', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Original', path: 'page.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Original</p>', { emitUpdate: false }));

            mockLoadContent.mockClear();
            mockSetContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Refreshed', path: 'page.md' });

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-editor-refresh-btn'));
            });

            await waitFor(() => {
                expect(mockLoadContent).toHaveBeenCalledTimes(1);
                expect(mockSetContent).toHaveBeenCalledWith('<p># Refreshed</p>', { emitUpdate: false });
            });
        });

        it('shows confirm dialog when dirty and user cancels — no reload', async () => {
            mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            // Make content dirty
            act(() => { capturedOnChange?.(mockEditor); });

            mockLoadContent.mockClear();
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-editor-refresh-btn'));
            });

            expect(confirmSpy).toHaveBeenCalledOnce();
            expect(mockLoadContent).not.toHaveBeenCalled();
            confirmSpy.mockRestore();
        });

        it('shows confirm dialog when dirty and user confirms — triggers reload', async () => {
            mockLoadContent.mockResolvedValue({ content: '', path: 'p.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="p.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            // Make content dirty
            act(() => { capturedOnChange?.(mockEditor); });

            mockLoadContent.mockClear();
            mockSetContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# After confirm', path: 'p.md' });
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-editor-refresh-btn'));
            });

            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));
            expect(confirmSpy).toHaveBeenCalledOnce();
            confirmSpy.mockRestore();
        });

        it('no confirm dialog shown when not dirty — reloads immediately', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            mockLoadContent.mockClear();
            mockSetContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Refreshed', path: 'page.md' });
            const confirmSpy = vi.spyOn(window, 'confirm');

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-editor-refresh-btn'));
            });

            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));
            expect(confirmSpy).not.toHaveBeenCalled();
            confirmSpy.mockRestore();
        });

        it('Ctrl+Shift+R keyboard shortcut triggers refresh', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            mockLoadContent.mockClear();
            mockSetContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Via keyboard', path: 'page.md' });

            const event = new KeyboardEvent('keydown', {
                key: 'R',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            });
            const preventSpy = vi.spyOn(event, 'preventDefault');

            await act(async () => { document.dispatchEvent(event); });

            expect(preventSpy).toHaveBeenCalled();
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));
        });

        it('Cmd+Shift+R (metaKey) also triggers refresh', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            mockLoadContent.mockClear();
            mockLoadContent.mockResolvedValue({ content: '# Via cmd', path: 'page.md' });

            const event = new KeyboardEvent('keydown', {
                key: 'R',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            });

            await act(async () => { document.dispatchEvent(event); });
            await waitFor(() => expect(mockLoadContent).toHaveBeenCalledTimes(1));
        });

        it('refresh button is disabled during loading', async () => {
            // First load resolves so toolbar appears
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            // Verify button is enabled when not loading
            expect(screen.getByTestId('note-editor-refresh-btn')).not.toBeDisabled();
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Generic YAML front matter display
    // ══════════════════════════════════════════════════════════════════════

    describe('front matter metadata', () => {
        const frontMatterContent = [
            '---',
            'title: Batch selection notes',
            'tags:',
            '  - pull-requests',
            '  - ui',
            'reviewed: true',
            'related:',
            '  issue: 123',
            '  area: notes',
            'empty:',
            '---',
            '',
            '# Body',
        ].join('\n');

        it('loads only the Markdown body into rich mode and displays metadata', async () => {
            mockLoadContent.mockResolvedValue({ content: frontMatterContent, path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalledWith('<p># Body</p>', { emitUpdate: false });
                expect(screen.getByTestId('note-metadata-panel')).toBeDefined();
            });
            expect(screen.getByText('Metadata')).toBeDefined();
            expect(screen.getByText('· 5 fields')).toBeDefined();
        });

        it('shows arbitrary metadata fields with generic value formatting when expanded', async () => {
            mockLoadContent.mockResolvedValue({ content: frontMatterContent, path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(screen.getByTestId('note-metadata-toggle')).toBeDefined());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-metadata-toggle'));
            });

            expect(screen.getByText('Title')).toBeDefined();
            expect(screen.getByTestId('note-metadata-value-title').textContent).toBe('Batch selection notes');
            expect(screen.getByText('Tags')).toBeDefined();
            expect(screen.getByTestId('note-metadata-value-tags').textContent).toBe('pull-requests, ui');
            expect(screen.getByText('Reviewed')).toBeDefined();
            expect(screen.getByTestId('note-metadata-value-reviewed').textContent).toBe('Yes');
            expect(screen.getByText('Related')).toBeDefined();
            expect(screen.getByTestId('note-metadata-value-related').textContent).toBe('{"issue":123,"area":"notes"}');
            expect(screen.getByTestId('note-metadata-value-empty').textContent).toBe('Empty');
        });

        it('keeps source mode raw Markdown unchanged', async () => {
            mockLoadContent.mockResolvedValue({ content: frontMatterContent, path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Body</p>', { emitUpdate: false }));

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-mode-source'));
            });
            await waitFor(() => expect(screen.getByTestId('note-source-container')).toBeDefined());

            const textarea = screen.getByTestId('note-source-container').querySelector('textarea')!;
            expect(textarea.value).toBe(frontMatterContent);
        });

        it('preserves original front matter when saving rich-mode body edits', async () => {
            mockLoadContent.mockResolvedValue({ content: frontMatterContent, path: 'page.md', mtime: 101 });
            mockIOSaveContent.mockResolvedValue({ path: 'page.md', updated: true, mtime: 102 });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Body</p>', { emitUpdate: false }));

            vi.useFakeTimers();
            act(() => { capturedOnChange?.(mockEditor); });
            await act(async () => { vi.advanceTimersByTime(1600); });
            await act(async () => { await Promise.resolve(); });

            expect(mockIOSaveContent).toHaveBeenCalledWith(
                'ws1',
                'page.md',
                [
                    '---',
                    'title: Batch selection notes',
                    'tags:',
                    '  - pull-requests',
                    '  - ui',
                    'reviewed: true',
                    'related:',
                    '  issue: 123',
                    '  area: notes',
                    'empty:',
                    '---',
                    '',
                    'content',
                ].join('\n'),
                101,
                undefined,
            );
        });

        it('warns and leaves invalid front matter visible in rich mode', async () => {
            const invalidContent = '---\ntitle: [broken\n---\n# Body';
            mockLoadContent.mockResolvedValue({ content: invalidContent, path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            await waitFor(() => {
                expect(screen.getByTestId('note-metadata-warning')).toBeDefined();
                expect(mockSetContent).toHaveBeenCalledWith(`<p>${invalidContent}</p>`, { emitUpdate: false });
            });
            expect(screen.getByText('Metadata could not be parsed. Open MD mode to fix YAML.')).toBeDefined();
            expect(screen.queryByTestId('note-metadata-panel')).toBeNull();
        });

        it('keeps notes without front matter on the existing rich-mode path', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plain', path: 'page.md' });

            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="page.md" io={mockIo} />);
            });

            await waitFor(() => expect(mockSetContent).toHaveBeenCalledWith('<p># Plain</p>', { emitUpdate: false }));
            expect(screen.queryByTestId('note-metadata-panel')).toBeNull();
            expect(screen.queryByTestId('note-metadata-warning')).toBeNull();
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Run Skill button
    // ══════════════════════════════════════════════════════════════════════

    describe('Run Skill button', () => {
        it('shows Run Skill button for a regular .md file', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'regular.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="regular.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.getByTestId('note-run-skills-btn')).toBeDefined();
        });

        it('shows Run Skill button for a .plan.md file', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'Plans/coc/my-feature.plan.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="Plans/coc/my-feature.plan.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.getByTestId('note-run-skills-btn')).toBeDefined();
        });

        it('shows Run Skill button for a file named exactly plan.md', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'tasks/plan.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="tasks/plan.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.getByTestId('note-run-skills-btn')).toBeDefined();
        });

        it('derives contextTaskName as "plan" for a file named plan.md', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'tasks/plan.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="tasks/plan.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith(
                expect.objectContaining({ contextTaskName: 'plan' }),
            );
        });

        it('clicking Run Skill button dispatches OPEN_DIALOG to QueueContext', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'Plans/coc/my-feature.plan.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="Plans/coc/my-feature.plan.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            expect(mockQueueDispatch).not.toHaveBeenCalled();

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'OPEN_DIALOG' }),
            );
        });

        it('dispatches workspaceId and relative notePath as contextFiles when notesRoot is absent', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'Plans/my.plan.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws42" notePath="Plans/my.plan.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'OPEN_DIALOG',
                workspaceId: 'ws42',
                contextFiles: ['Plans/my.plan.md'],
                contextTaskName: 'my',
            });
        });

        it('dispatches a regular note with a filename-derived contextTaskName', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Copilot SDK', path: 'Knowledge/copilot-sdk.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="Knowledge/copilot-sdk.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'OPEN_DIALOG',
                workspaceId: 'ws1',
                contextFiles: ['Knowledge/copilot-sdk.md'],
                contextTaskName: 'copilot-sdk',
            });
        });

        it('dispatches absolute path as contextFiles when notesRoot is provided (Unix)', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'Plans/coc/feat.plan.md' });
            await act(async () => {
                render(
                    <NoteEditor
                        workspaceId="ws1"
                        notePath="Plans/coc/feat.plan.md"
                        notesRoot="/home/user/.coc/repos/ws1/notes"
                        io={mockIo}
                    />,
                );
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OPEN_DIALOG',
                    contextFiles: ['/home/user/.coc/repos/ws1/notes/Plans/coc/feat.plan.md'],
                }),
            );
        });

        it('dispatches absolute path as contextFiles when notesRoot and notePath use Windows backslashes', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'Plans\\feat.plan.md' });
            await act(async () => {
                render(
                    <NoteEditor
                        workspaceId="ws1"
                        notePath={"Plans\\feat.plan.md"}
                        notesRoot={"C:\\Users\\user\\.coc\\repos\\ws1\\notes"}
                        io={mockIo}
                    />,
                );
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OPEN_DIALOG',
                    contextFiles: ['C:/Users/user/.coc/repos/ws1/notes/Plans/feat.plan.md'],
                }),
            );
        });

        it('derives contextTaskName by stripping .plan.md from the filename', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Plan', path: 'Plans/my-feature.plan.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="Plans/my-feature.plan.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-skills-btn'));
            });

            expect(mockQueueDispatch).toHaveBeenCalledWith(
                expect.objectContaining({ contextTaskName: 'my-feature' }),
            );
        });
    });

    // ══════════════════════════════════════════════════════════════════════
    // Run Ralph button
    // ══════════════════════════════════════════════════════════════════════

    describe('Run Ralph button', () => {
        beforeEach(() => {
            mockRalphEnabled = true;
            mockRalphLaunchDialogProps.mockClear();
        });

        it('shows Run Ralph button for goal.md files', async () => {
            mockLoadContent.mockResolvedValue({ content: '## Goal\nDo something', path: 'goal.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="goal.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.getByTestId('note-run-ralph-btn')).toBeDefined();
        });

        it('shows Run Ralph button for *.goal.md files', async () => {
            mockLoadContent.mockResolvedValue({ content: '## Goal\nRefactor auth', path: 'Plans/auth.goal.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="Plans/auth.goal.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.getByTestId('note-run-ralph-btn')).toBeDefined();
        });

        it('does not show Run Ralph button for regular .md files', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'regular.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="regular.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.queryByTestId('note-run-ralph-btn')).toBeNull();
        });

        it('does not show Run Ralph button when Ralph is disabled', async () => {
            mockRalphEnabled = false;
            mockLoadContent.mockResolvedValue({ content: '## Goal\nDo something', path: 'goal.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="goal.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
            expect(screen.queryByTestId('note-run-ralph-btn')).toBeNull();
        });

        it('clicking Run Ralph button opens the dialog', async () => {
            mockLoadContent.mockResolvedValue({ content: '## Goal\nBuild feature', path: 'feature.goal.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws1" notePath="feature.goal.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-ralph-btn'));
            });

            expect(screen.getByTestId('ralph-launch-dialog-stub')).toBeDefined();
        });

        it('onLaunched navigates to chats hash and closes dialog', async () => {
            mockLoadContent.mockResolvedValue({ content: '## Goal\nBuild feature', path: 'feature.goal.md' });
            await act(async () => {
                render(<NoteEditor workspaceId="ws-test" notePath="feature.goal.md" io={mockIo} />);
            });
            await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

            // Open the dialog
            await act(async () => {
                fireEvent.click(screen.getByTestId('note-run-ralph-btn'));
            });
            expect(screen.getByTestId('ralph-launch-dialog-stub')).toBeDefined();

            // Simulate the dialog calling onLaunched with a processId
            const dialogProps = mockRalphLaunchDialogProps.mock.calls[mockRalphLaunchDialogProps.mock.calls.length - 1][0] as Record<string, unknown>;
            await act(async () => {
                (dialogProps.onLaunched as (id: string) => void)('queue_proc-123');
            });

            // Dialog should be closed
            expect(screen.queryByTestId('ralph-launch-dialog-stub')).toBeNull();
            // Hash should navigate to chats view with the process id
            expect(location.hash).toBe('#repos/' + encodeURIComponent('ws-test') + '/chats/' + encodeURIComponent('queue_proc-123'));
        });
    });
});
