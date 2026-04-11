// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

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

vi.mock(
    '../../../../src/server/spa/client/react/repos/notes/noteMarkdown',
    () => ({
        markdownToHtml: (md: string) => `<p>${md}</p>`,
        htmlToMarkdown: (html: string) => html.replace(/<\/?[^>]+>/g, ''),
        rewriteImageSrcToApi: (html: string) => html,
        rewriteImageSrcToRelative: (md: string) => md,
    }),
);

// Track ContextMenu renders
let contextMenuProps: { position: { x: number; y: number }; items: { label: string; disabled?: boolean; onClick: () => void }[]; onClose: () => void } | null = null;

vi.mock(
    '../../../../src/server/spa/client/react/tasks/comments/ContextMenu',
    () => ({
        ContextMenu: (props: typeof contextMenuProps) => {
            contextMenuProps = props;
            return (
                <div data-testid="context-menu">
                    {props!.items.map((item, i) => (
                        <button
                            key={i}
                            data-testid={`context-menu-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                            disabled={item.disabled}
                            onClick={item.onClick}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            );
        },
    }),
);

const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
let selectionEmpty = true;

const mockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
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

vi.mock('@tiptap/starter-kit', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-task-list', () => ({ default: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table-row', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ default: {} }));
vi.mock('@tiptap/extension-highlight', () => ({ default: { configure: () => ({}) } }));
vi.mock('../../../../src/server/spa/client/react/repos/notes/extensions/resizableImage', () => ({
    ResizableImage: { configure: () => ({}) },
}));
vi.mock('@sereneinserenade/tiptap-comment-extension', () => ({
    CommentExtension: { configure: () => ({}) },
}));

import { NoteEditor } from '../../../../src/server/spa/client/react/repos/notes/NoteEditor';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditor — right-click context menu', () => {
    beforeEach(() => {
        mockGetContent.mockResolvedValue({ content: '', path: 'p.md' });
        mockSaveContent.mockReset();
        mockSetContent.mockReset();
        mockClearContent.mockReset();
        selectionEmpty = true;
        contextMenuProps = null;
    });

    afterEach(() => {
        cleanup();
    });

    it('shows context menu on right-click when text is selected', async () => {
        selectionEmpty = false;
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" onCommentCreate={() => {}} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        // Right-click on the editor area
        const editorWrapper = screen.getByTestId('editor-content').parentElement!;
        fireEvent.contextMenu(editorWrapper, { clientX: 100, clientY: 200 });

        expect(screen.getByTestId('context-menu')).toBeDefined();
        expect(screen.getByTestId('context-menu-item-add-comment')).toBeDefined();
    });

    it('does not show context menu on right-click without selection', async () => {
        selectionEmpty = true;
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" onCommentCreate={() => {}} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        const editorWrapper = screen.getByTestId('editor-content').parentElement!;
        fireEvent.contextMenu(editorWrapper, { clientX: 100, clientY: 200 });

        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('clicking "Add comment" calls onCommentCreate', async () => {
        selectionEmpty = false;
        const onCommentCreate = vi.fn();
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" onCommentCreate={onCommentCreate} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        const editorWrapper = screen.getByTestId('editor-content').parentElement!;
        fireEvent.contextMenu(editorWrapper, { clientX: 100, clientY: 200 });

        fireEvent.click(screen.getByTestId('context-menu-item-add-comment'));
        expect(onCommentCreate).toHaveBeenCalledTimes(1);
    });

    it('context menu closes after clicking "Add comment"', async () => {
        selectionEmpty = false;
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" onCommentCreate={() => {}} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        const editorWrapper = screen.getByTestId('editor-content').parentElement!;
        fireEvent.contextMenu(editorWrapper, { clientX: 100, clientY: 200 });
        expect(screen.getByTestId('context-menu')).toBeDefined();

        fireEvent.click(screen.getByTestId('context-menu-item-add-comment'));

        // After clicking, context menu should be closed
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('context menu receives correct position from right-click coordinates', async () => {
        selectionEmpty = false;
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" onCommentCreate={() => {}} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        const editorWrapper = screen.getByTestId('editor-content').parentElement!;
        fireEvent.contextMenu(editorWrapper, { clientX: 150, clientY: 300 });

        expect(contextMenuProps).not.toBeNull();
        expect(contextMenuProps!.position).toEqual({ x: 150, y: 300 });
    });

    it('context menu onClose callback clears the menu', async () => {
        selectionEmpty = false;
        await act(async () => {
            render(<NoteEditor workspaceId="ws1" notePath="p.md" onCommentCreate={() => {}} />);
        });
        await waitFor(() => expect(screen.getByTestId('note-editor')).toBeDefined());

        const editorWrapper = screen.getByTestId('editor-content').parentElement!;
        fireEvent.contextMenu(editorWrapper, { clientX: 100, clientY: 200 });
        expect(screen.getByTestId('context-menu')).toBeDefined();

        // Simulate closing via onClose callback (e.g., Escape or outside click)
        act(() => {
            contextMenuProps!.onClose();
        });

        expect(screen.queryByTestId('context-menu')).toBeNull();
    });
});
