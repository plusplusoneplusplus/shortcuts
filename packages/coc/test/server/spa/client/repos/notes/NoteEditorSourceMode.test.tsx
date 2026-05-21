/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

let mockGetContentResult: { content: string; path: string } = { content: '# Hello\n', path: 'test.md' };
let mockSaveContentResult: { path: string; updated: boolean; mtime: number } = { path: 'test.md', updated: true, mtime: 1000 };

vi.mock('../../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getContent: vi.fn(async () => mockGetContentResult),
        saveContent: vi.fn(async () => mockSaveContentResult),
        uploadImage: vi.fn(async () => ({ path: '.attachments/img.png' })),
        getComments: vi.fn(async () => ({ noteId: 'test', threads: {} })),
        updateThread: vi.fn(async () => ({})),
        getGitStatus: vi.fn(async () => ({ initialized: false })),
    },
}));

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

// Stable mock editor object — must be the SAME reference across renders
// to prevent infinite useEffect re-fires.
const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockSetTextSelection = vi.fn();
const stableMockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent, setTextSelection: mockSetTextSelection },
    chain: () => ({ focus: () => ({ run: vi.fn() }) }),
    getHTML: () => '<p>hello</p>',
    state: { selection: { empty: true }, doc: { descendants: vi.fn() } },
    on: vi.fn(),
    off: vi.fn(),
    isActive: () => false,
    getAttributes: () => ({}),
};

vi.mock('@tiptap/react', () => ({
    useEditor: () => stableMockEditor,
    EditorContent: () => <div data-testid="tiptap-editor-content">WYSIWYG</div>,
}));

vi.mock('@tiptap/starter-kit', () => ({ StarterKit: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-task-list', () => ({ TaskList: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ TaskItem: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({ Link: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-placeholder', () => ({ Placeholder: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table', () => ({ Table: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table-row', () => ({ TableRow: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ TableCell: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ TableHeader: {} }));
vi.mock('@tiptap/extension-highlight', () => ({ Highlight: { configure: () => ({}) } }));
vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/extensions/resizableImage', () => ({
    ResizableImage: { configure: () => ({}) },
}));
vi.mock(
    '../../../../../../src/server/spa/client/react/features/notes/editor/extensions/commentExtension',
    () => ({ CommentExtension: { configure: () => ({}) } }),
);
vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/noteEditor.css', () => ({}));
vi.mock('../../../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    findAnchorInDoc: vi.fn(() => null),
    applyCommentMark: vi.fn(),
    buildAnchorFromMark: vi.fn(() => null),
}));

import { NoteEditor } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor';
import type { NoteViewMode } from '../../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor';
import { notesApi } from '../../../../../../src/server/spa/client/react/features/notes/notesApi';

// ── Helpers ────────────────────────────────────────────────────────────────

function defaultProps(overrides: Partial<React.ComponentProps<typeof NoteEditor>> = {}) {
    return {
        workspaceId: 'ws1',
        notePath: 'test.md',
        commentsEnabled: false,
        ...overrides,
    };
}

async function renderAndWaitForLoad(overrides: Partial<React.ComponentProps<typeof NoteEditor>> = {}) {
    await act(async () => {
        render(<NoteEditor {...defaultProps(overrides)} />);
    });
    await waitFor(() => expect(screen.getByTestId('note-mode-toggle')).toBeTruthy());
}

async function switchToSource() {
    await act(async () => {
        fireEvent.click(screen.getByTestId('note-mode-source'));
    });
    await waitFor(() => expect(screen.getByTestId('note-source-container')).toBeTruthy());
}

function getSourceTextarea(): HTMLTextAreaElement {
    return screen.getByTestId('note-source-container').querySelector('textarea')!;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NoteEditor — Source Mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetContentResult = { content: '# Hello\n\nWorld\n', path: 'test.md' };
        mockSaveContentResult = { path: 'test.md', updated: true, mtime: 1000 };
    });

    afterEach(() => {
        cleanup();
    });

    // ── Mode toggle UI ─────────────────────────────────────────────────────

    describe('mode toggle bar', () => {
        it('renders Rich and Source buttons', async () => {
            await renderAndWaitForLoad();

            expect(screen.getByTestId('note-mode-rich')).toBeTruthy();
            expect(screen.getByTestId('note-mode-source')).toBeTruthy();
        });

        it('Rich mode is active by default', async () => {
            await renderAndWaitForLoad();

            expect(screen.getByTestId('note-mode-rich').className).toContain('active');
            expect(screen.getByTestId('note-mode-source').className).not.toContain('active');
        });

        it('does not render when no note is selected', () => {
            render(<NoteEditor {...defaultProps({ notePath: null })} />);

            expect(screen.queryByTestId('note-mode-toggle')).toBeNull();
            expect(screen.getByTestId('note-editor-empty')).toBeTruthy();
        });
    });

    // ── Toggle to source mode ───────────────────────────────────────────────

    describe('switching to source mode', () => {
        it('places the Tiptap cursor at the start after loading a note', async () => {
            await renderAndWaitForLoad();

            await waitFor(() => {
                expect(mockSetTextSelection).toHaveBeenCalledWith(1);
            });
        });

        it('shows raw markdown in source editor', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            expect(screen.getByTestId('note-mode-source').className).toContain('active');
            expect(screen.getByTestId('note-mode-rich').className).not.toContain('active');

            const textarea = getSourceTextarea();
            expect(textarea.value).toBe('# Hello\n\nWorld\n');
        });

        it('re-fetches content from API when switching to source', async () => {
            await renderAndWaitForLoad();
            const callsBefore = (notesApi.getContent as any).mock.calls.length;

            await switchToSource();
            expect(notesApi.getContent).toHaveBeenCalledTimes(callsBefore + 1);
        });

        it('hides the formatting buttons but keeps toolbar visible', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            // Toolbar row remains (hosts mode toggle + comments)
            expect(screen.getByTestId('note-editor-toolbar')).toBeTruthy();
            // But formatting buttons are hidden
            expect(screen.queryByLabelText('Bold')).toBeNull();
        });

        it('hides WYSIWYG editor and shows SourceEditor', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            const wysiwyg = screen.getByTestId('tiptap-editor-content');
            const hiddenAncestor = wysiwyg.closest<HTMLElement>('[style*="display"]');
            expect(hiddenAncestor).not.toBeNull();
            expect(hiddenAncestor!.style.display).toBe('none');
            expect(screen.getByTestId('note-source-container')).toBeTruthy();
        });
    });

    // ── Toggle back to rich mode ────────────────────────────────────────────

    describe('switching back to rich mode', () => {
        it('shows WYSIWYG editor and hides source editor', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-mode-rich'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('tiptap-editor-content')).toBeTruthy();
            });
            expect(screen.queryByTestId('note-source-container')).toBeNull();
            expect(screen.getByTestId('note-mode-rich').className).toContain('active');
        });

        it('saves dirty content before switching', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            vi.mocked(notesApi.saveContent).mockClear();

            const textarea = getSourceTextarea();
            await act(async () => {
                fireEvent.change(textarea, { target: { value: '# Modified\n' } });
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-mode-rich'));
            });

            await waitFor(() => {
                expect(notesApi.saveContent).toHaveBeenCalledWith('ws1', 'test.md', '# Modified\n', undefined, undefined);
            });
        });

        it('sets content on the Tiptap editor', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            mockSetContent.mockClear();
            mockSetTextSelection.mockClear();

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-mode-rich'));
            });

            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalled();
            });
            expect(mockSetTextSelection).toHaveBeenCalledWith(1);
        });
    });

    describe('source mode paste', () => {
        it('inserts text pasted on the source container at the textarea cursor', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            const textarea = getSourceTextarea();
            textarea.focus();
            textarea.setSelectionRange(8, 8);

            await act(async () => {
                fireEvent.paste(screen.getByTestId('note-source-container'), {
                    clipboardData: {
                        items: [],
                        getData: (type: string) => type === 'text/plain' ? '[[note:Other.md]]' : '',
                    },
                });
            });

            await waitFor(() => {
                expect(textarea.value).toBe('# Hello\n[[note:Other.md]]\nWorld\n');
            });
        });
    });

    // ── Dirty tracking ─────────────────────────────────────────────────────

    describe('dirty tracking', () => {
        it('shows dirty indicator on Source button when content is modified', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            expect(screen.getByTestId('note-mode-source').textContent).toBe('MD');

            const textarea = getSourceTextarea();
            await act(async () => {
                fireEvent.change(textarea, { target: { value: '# Modified\n' } });
            });

            expect(screen.getByTestId('note-mode-source').textContent).toBe('MD ●');
        });

        it('shows Save button when source is dirty', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            expect(screen.queryByTestId('note-source-save-btn')).toBeNull();

            const textarea = getSourceTextarea();
            await act(async () => {
                fireEvent.change(textarea, { target: { value: '# Changed\n' } });
            });

            expect(screen.getByTestId('note-source-save-btn')).toBeTruthy();
        });

        it('hides Save button and dirty indicator after explicit save', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            const textarea = getSourceTextarea();
            await act(async () => {
                fireEvent.change(textarea, { target: { value: '# Changed\n' } });
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-source-save-btn'));
            });

            await waitFor(() => {
                expect(screen.queryByTestId('note-source-save-btn')).toBeNull();
            });
            expect(screen.getByTestId('note-mode-source').textContent).toBe('MD');
        });
    });

    // ── Source mode save ────────────────────────────────────────────────────

    describe('source mode save', () => {
        it('saves raw markdown directly (no HTML conversion)', async () => {
            await renderAndWaitForLoad();
            await switchToSource();

            const textarea = getSourceTextarea();
            await act(async () => {
                fireEvent.change(textarea, { target: { value: '# Raw markdown\n\n**bold**\n' } });
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-source-save-btn'));
            });

            await waitFor(() => {
                const calls = vi.mocked(notesApi.saveContent).mock.calls;
                const lastCall = calls[calls.length - 1];
                expect(lastCall[2]).toBe('# Raw markdown\n\n**bold**\n');
            });
        });

        it('shows save indicator during save', async () => {
            let resolveSave!: (v: any) => void;
            vi.mocked(notesApi.saveContent).mockImplementation(
                () => new Promise((r) => { resolveSave = r; }),
            );

            await renderAndWaitForLoad();
            await switchToSource();

            const textarea = getSourceTextarea();
            await act(async () => {
                fireEvent.change(textarea, { target: { value: '# Saving...\n' } });
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-source-save-btn'));
            });

            expect(screen.getByTestId('save-indicator').textContent).toContain('Saving');

            await act(async () => {
                resolveSave({ path: 'test.md', updated: true, mtime: 1000 });
            });

            await waitFor(() => {
                expect(screen.getByTestId('save-indicator').textContent).toContain('Saved');
            });
        });
    });

    // ── onViewModeChange callback ──────────────────────────────────────────

    describe('onViewModeChange', () => {
        it('notifies parent on mode switch to source', async () => {
            const onViewModeChange = vi.fn();
            await renderAndWaitForLoad({ onViewModeChange });

            await switchToSource();

            expect(onViewModeChange).toHaveBeenCalledWith('source');
        });

        it('notifies parent on mode switch back to rich', async () => {
            const onViewModeChange = vi.fn();
            await renderAndWaitForLoad({ onViewModeChange });

            await switchToSource();
            onViewModeChange.mockClear();

            await act(async () => {
                fireEvent.click(screen.getByTestId('note-mode-rich'));
            });

            await waitFor(() => {
                expect(onViewModeChange).toHaveBeenCalledWith('rich');
            });
        });
    });

    // ── Note switching resets mode ──────────────────────────────────────────

    describe('note path change', () => {
        it('resets to rich mode when switching notes', async () => {
            const { rerender } = await act(async () =>
                render(<NoteEditor {...defaultProps()} />),
            );
            await waitFor(() => expect(screen.getByTestId('note-mode-toggle')).toBeTruthy());

            await switchToSource();

            await act(async () => {
                rerender(<NoteEditor {...defaultProps({ notePath: 'other.md' })} />);
            });

            await waitFor(() => {
                expect(screen.getByTestId('tiptap-editor-content')).toBeTruthy();
            });
            expect(screen.queryByTestId('note-source-container')).toBeNull();
        });
    });

    // ── NoteViewMode type export ───────────────────────────────────────────

    it('exports NoteViewMode type', () => {
        const mode: NoteViewMode = 'source';
        expect(mode).toBe('source');
    });
});
