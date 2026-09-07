/**
 * NoteEditor host seams — the unsaved-edit contract a tab host relies on.
 *
 * The unified right panel keeps a note behind a tab: it has to show that a
 * hidden note holds unwritten text, and it has to be able to write that text
 * when the user closes the tab, without asking them to go back and find the
 * editor. `flushSave` swallows its own errors (autosave watches `saveState`
 * instead), so the seam reads success from the session's pending write — these
 * cases pin that a refused save is reported as a failure, not as a save.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

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

vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown',
    () => ({
        markdownToHtml: (md: string) => `<p>${md}</p>`,
        htmlToMarkdown: (html: string) => html.replace(/<\/?[^>]+>/g, ''),
        rewriteImageSrcToApi: (html: string) => html,
        rewriteImageSrcToRelative: (md: string) => md,
    }),
);

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));
const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
let selectionEmpty = true;

const mockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
    getAttributes: vi.fn(() => ({})),
    state: {
        get selection() {
            return { empty: selectionEmpty, from: 1, to: 5 };
        },
    },
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
        return mockEditor;
    },
    EditorContent: ({ editor }: { editor: unknown }) =>
        editor ? <div data-testid="editor-content" /> : null,
}));

vi.mock('@tiptap/starter-kit', () => ({ StarterKit: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-task-list', () => ({ TaskList: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ TaskItem: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({ Link: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-placeholder', () => ({ Placeholder: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table', () => ({ Table: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table-row', () => ({ TableRow: {} }));
// tableCellBackground.ts calls `.extend()` on both of these at import time, so
// the stubs need it or the whole module graph fails to load.
// `.extend()` returns the stub itself: the cell/header extensions are subclassed
// twice (tableCellBackground, then tableColumnWrap), so a one-shot stub runs out.
vi.mock('@tiptap/extension-table-cell', () => {
    const stub: any = {};
    stub.extend = () => stub;
    return { TableCell: stub };
});
vi.mock('@tiptap/extension-table-header', () => {
    const stub: any = {};
    stub.extend = () => stub;
    return { TableHeader: stub };
});
vi.mock('@tiptap/extension-highlight', () => ({ Highlight: { configure: () => ({}) } }));
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/extensions/resizableImage', () => ({
    ResizableImage: { configure: () => ({}) },
}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/commentExtension',
    () => ({ CommentExtension: { configure: () => ({}) } }),
);

import { NoteEditor } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditor';

/**
 * Mount the editor and switch it to source mode — the load resets the view mode
 * to rich, so the toggle is the way in. Source mode is used because it edits the
 * same session the rich editor does, with a plain textarea instead of TipTap.
 */
async function mountSourceEditor(props: Record<string, unknown> = {}) {
    await act(async () => {
        render(<NoteEditor workspaceId="ws1" notePath="p.md" {...props} />);
    });
    await waitFor(() => expect(screen.getByTestId('note-mode-source')).toBeDefined());
    await act(async () => { fireEvent.click(screen.getByTestId('note-mode-source')); });
    await waitFor(() => expect(screen.getByTestId('note-source-container')).toBeDefined());
    return screen.getByTestId('note-source-container').querySelector('textarea')!;
}

describe('NoteEditor — dirty reporting and the host save entry point', () => {
    beforeEach(() => {
        mockGetContent.mockResolvedValue({ content: 'hello', path: 'p.md', mtime: 1 });
        mockSaveContent.mockReset();
        mockSaveContent.mockResolvedValue({ path: 'p.md', updated: true, mtime: 2 });
        mockSetContent.mockReset();
        mockClearContent.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    it('reports an edit as dirty, and reports clean on unmount', async () => {
        const onDirtyChange = vi.fn();
        const textarea = await mountSourceEditor({ onDirtyChange });
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);

        fireEvent.change(textarea, { target: { value: 'hello + edit' } });
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

        onDirtyChange.mockClear();
        cleanup();
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('publishes a save that writes the pending edit without waiting for autosave', async () => {
        const onRegisterSave = vi.fn();
        const onDirtyChange = vi.fn();
        const textarea = await mountSourceEditor({ onRegisterSave, onDirtyChange });
        const save = onRegisterSave.mock.calls[0]?.[0] as (() => Promise<boolean>) | null;
        expect(typeof save).toBe('function');

        fireEvent.change(textarea, { target: { value: 'hello + edit' } });

        let saved: boolean | undefined;
        await act(async () => { saved = await save!(); });

        expect(saved).toBe(true);
        expect(mockSaveContent).toHaveBeenCalledTimes(1);
        expect(mockSaveContent.mock.calls[0]?.[2]).toBe('hello + edit');
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });

    it('reports a refused save as a failure and keeps the note dirty', async () => {
        mockSaveContent.mockRejectedValue(new Error('offline'));
        const onRegisterSave = vi.fn();
        const onDirtyChange = vi.fn();
        const textarea = await mountSourceEditor({ onRegisterSave, onDirtyChange });
        const save = onRegisterSave.mock.calls[0]?.[0] as () => Promise<boolean>;

        fireEvent.change(textarea, { target: { value: 'hello + edit' } });
        let saved: boolean | undefined;
        await act(async () => { saved = await save(); });

        expect(saved).toBe(false);
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('unpublishes the save entry point on unmount', async () => {
        const onRegisterSave = vi.fn();
        await mountSourceEditor({ onRegisterSave });

        cleanup();

        expect(onRegisterSave).toHaveBeenLastCalledWith(null);
    });
});
