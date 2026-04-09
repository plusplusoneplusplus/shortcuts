import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetContent = vi.fn();
const mockSaveContent = vi.fn();

vi.mock('../../../../src/server/spa/client/react/repos/notesApi', () => ({
    notesApi: {
        getContent: (...args: unknown[]) => mockGetContent(...args),
        saveContent: (...args: unknown[]) => mockSaveContent(...args),
    },
}));

vi.mock(
    '../../../../src/server/spa/client/react/repos/notes/noteMarkdown',
    () => ({
        markdownToHtml: (md: string) => `<p>${md}</p>`,
        htmlToMarkdown: (html: string) => html.replace(/<\/?[^>]+>/g, ''),
    }),
);

const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
let capturedOnUpdate: ((...args: unknown[]) => void) | null = null;

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

vi.mock('@tiptap/react', () => ({
    useEditor: (config: { onUpdate?: (...args: unknown[]) => void }) => {
        if (config?.onUpdate) capturedOnUpdate = config.onUpdate;
        return mockEditor;
    },
    EditorContent: ({ editor }: { editor: unknown }) =>
        editor ? <div data-testid="editor-content" /> : null,
}));

vi.mock('@tiptap/starter-kit', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-task-list', () => ({ default: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }));

import { NoteEditor } from '../../../../src/server/spa/client/react/repos/notes/NoteEditor';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditor', () => {
    beforeEach(() => {
        mockGetContent.mockReset();
        mockSaveContent.mockReset();
        mockSetContent.mockReset();
        mockClearContent.mockReset();
        mockGetHTML.mockReturnValue('<p>content</p>');
        capturedOnUpdate = null;
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    // ── Empty state ─────────────────────────────────────────────────────

    it('shows empty-state placeholder when notePath is null', () => {
        render(<NoteEditor workspaceId="ws1" notePath={null} />);
        expect(screen.getByTestId('note-editor-empty')).toBeDefined();
        expect(screen.getByText('Select a page to start editing')).toBeDefined();
        expect(mockGetContent).not.toHaveBeenCalled();
    });

    // ── Loading state ───────────────────────────────────────────────────

    it('shows loading spinner while content loads', () => {
        mockGetContent.mockReturnValue(new Promise(() => {}));
        render(<NoteEditor workspaceId="ws1" notePath="path/page.md" />);
        expect(screen.getByTestId('note-editor-loading')).toBeDefined();
        expect(screen.getByText('Loading…')).toBeDefined();
    });

    // ── Content load ────────────────────────────────────────────────────

    it('loads content and sets it on the editor', async () => {
        mockGetContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" />);
        });
        await waitFor(() => {
            expect(mockGetContent).toHaveBeenCalledWith('ws1', 'page.md');
            expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>');
        });
    });

    // ── Load error ──────────────────────────────────────────────────────

    it('shows error banner when load fails', async () => {
        mockGetContent.mockRejectedValue(new Error('Not found'));
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="page.md" />);
        });
        await waitFor(() => {
            expect(screen.getByTestId('note-editor-error')).toBeDefined();
            expect(screen.getByText('Not found')).toBeDefined();
        });
    });

    // ── Autosave fires after debounce ───────────────────────────────────

    it('autosaves after 1.5s debounce', async () => {
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        // Switch to fake timers after async load completes
        vi.useFakeTimers();

        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });
        expect(mockSaveContent).not.toHaveBeenCalled();

        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(mockSaveContent).toHaveBeenCalledWith('ws1', 'p.md', 'content');
    });

    // ── Debounce resets on rapid edits ──────────────────────────────────

    it('resets debounce on rapid edits — only one save', async () => {
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });
        vi.advanceTimersByTime(500);
        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });

        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(mockSaveContent).toHaveBeenCalledTimes(1);
    });

    // ── Save indicator: saving ──────────────────────────────────────────

    it('shows "Saving…" during save', async () => {
        let resolveSave!: (v: unknown) => void;
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockSaveContent.mockReturnValue(new Promise((r) => { resolveSave = r; }));

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });
        await act(async () => { vi.advanceTimersByTime(1600); });

        expect(screen.getByText('Saving…')).toBeDefined();

        await act(async () => { resolveSave({ path: 'p.md', updated: true }); });
    });

    // ── Save indicator: saved ───────────────────────────────────────────

    it('shows "Saved ✓" after save then clears after 3s', async () => {
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockSaveContent.mockResolvedValue({ path: 'p.md', updated: true });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });
        await act(async () => { vi.advanceTimersByTime(1600); });
        // Flush the save promise
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByText('Saved ✓')).toBeDefined();

        act(() => { vi.advanceTimersByTime(3100); });
        expect(screen.queryByText('Saved ✓')).toBeNull();
    });

    // ── Save indicator: error ───────────────────────────────────────────

    it('shows "Save failed" with retry button on error', async () => {
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockSaveContent.mockRejectedValue(new Error('Network'));

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        vi.useFakeTimers();

        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });
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
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
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

    // ── beforeunload ────────────────────────────────────────────────────

    it('registers beforeunload when dirty', async () => {
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        const addSpy = vi.spyOn(window, 'addEventListener');

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());

        act(() => { capturedOnUpdate?.({ editor: mockEditor }); });

        expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
        addSpy.mockRestore();
    });

    // ── EditorContent renders ───────────────────────────────────────────

    it('renders EditorContent when path is provided', async () => {
        mockGetContent.mockResolvedValue({ content: '# Hi', path: 'p.md' });

        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" />);
        });
        await waitFor(() => {
            expect(screen.getByTestId('editor-content')).toBeDefined();
        });
    });
});
