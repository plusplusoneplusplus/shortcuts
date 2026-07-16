/**
 * Integration tests for NoteEditor diff-on-reload — the notes-changed → diff → decoration path.
 *
 * Renders <NoteEditor> with a mocked RichEditorCore to test that external
 * file changes (via notes-changed WS event) trigger word-diff decorations:
 * disk reload, content comparison, AI edit region creation, and navigator
 * pill visibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { useEffect } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockLoadContent = vi.fn();
const mockIOSaveContent = vi.fn();
const mockUploadImage = vi.fn();
const mockImageApiUrl = vi.fn((_wsId: string, relPath: string) =>
    `/api/img?path=${encodeURIComponent(relPath)}`);

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

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getContent: vi.fn(() => Promise.resolve({ content: '', path: '' })),
        saveContent: vi.fn(() => Promise.resolve({ path: '', updated: true })),
        getComments: vi.fn(() => Promise.resolve({ noteId: '', threads: {} })),
        updateThread: vi.fn(() => Promise.resolve()),
        uploadImage: vi.fn(() => Promise.resolve({ path: 'img/test.png' })),
        getGitStatus: vi.fn(() => Promise.resolve({ initialized: false })),
    },
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

// ── Mock editor with ProseMirror-like doc structure ─────────────────────────

let currentDocText = '';

function makeDocWithText(text: string) {
    return {
        textContent: text,
        descendants(callback: (node: any, pos: number) => void) {
            // Simulate a single text node at position 1 (inside <p>)
            if (text.length > 0) {
                callback({ isText: true, text }, 1);
            }
        },
    };
}

const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
const mockSetAiEdits = vi.fn();
const mockClearAiEdits = vi.fn();
const mockSetTextSelection = vi.fn();
const mockScrollIntoView = vi.fn();
const mockRun = vi.fn();

const mockEditor = {
    commands: {
        setContent: (...args: any[]) => {
            mockSetContent(...args);
            // Update doc.textContent to reflect the new content
            // Our markdownToHtml mock wraps in <p>...</p>, so strip tags
            const html = args[0] as string;
            currentDocText = html.replace(/<\/?[^>]+>/g, '');
            mockEditor.state.doc = makeDocWithText(currentDocText);
        },
        clearContent: mockClearContent,
        setAiEdits: mockSetAiEdits,
        clearAiEdits: mockClearAiEdits,
        insertContentAt: vi.fn(),
    },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
    isDestroyed: false,
    state: {
        doc: makeDocWithText(''),
        selection: { empty: true },
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
        setTextSelection: (...a: any[]) => {
            mockSetTextSelection(...a);
            return {
                scrollIntoView: () => {
                    mockScrollIntoView();
                    return { run: mockRun };
                },
            };
        },
    }),
};

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/RichEditorCore', () => ({
    RichEditorCore: (props: { onChange?: (editor: unknown) => void; onEditorReady?: (editor: unknown) => void }) => {
        useEffect(() => {
            props.onEditorReady?.(mockEditor);
        }, []);
        return <div data-testid="editor-content" />;
    },
}));

import { NoteEditor } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditor';

// ── Helpers ────────────────────────────────────────────────────────────────

function fireNotesChanged(wsId: string, changedPaths: string[]) {
    window.dispatchEvent(new CustomEvent('notes-changed', {
        detail: { wsId, changedPaths },
    }));
}

async function renderEditor(
    notePath: string | null = 'test.md',
    extraProps: { chatLensOpen?: boolean } = {},
) {
    // Initial content load
    if (notePath) {
        mockLoadContent.mockResolvedValueOnce({ content: 'initial content', path: notePath });
    }
    await act(async () => {
        render(<NoteEditor workspaceId="ws1" notePath={notePath} io={mockIo} {...extraProps} />);
    });
    // Wait for initial content load + editor ready
    if (notePath) {
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
    }
}

async function tickAsync() {
    await act(async () => {
        await new Promise(r => setTimeout(r, 50));
    });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditor diff-on-reload', () => {
    beforeEach(() => {
        mockLoadContent.mockReset();
        mockIOSaveContent.mockReset();
        mockUploadImage.mockReset();
        mockImageApiUrl.mockClear();
        mockImageApiUrl.mockImplementation((_wsId: string, relPath: string) =>
            `/api/img?path=${encodeURIComponent(relPath)}`);
        mockSetContent.mockClear();
        mockClearContent.mockReset();
        mockGetHTML.mockReturnValue('<p>content</p>');
        mockSetAiEdits.mockClear();
        mockClearAiEdits.mockClear();
        mockSetTextSelection.mockClear();
        mockScrollIntoView.mockClear();
        mockRun.mockClear();
        mockEditor.isDestroyed = false;
        mockEditor.state.doc = makeDocWithText('');
        currentDocText = '';
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    // ── Happy path: notes-changed with different content shows decorations ──

    it('shows diff decorations when notes-changed delivers different content', async () => {
        await renderEditor('test.md');

        // Simulate external file change
        mockLoadContent.mockResolvedValueOnce({ content: 'updated content', path: 'test.md' });

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // setContent called: initial + reload
        expect(mockSetContent).toHaveBeenCalledTimes(2);

        // setAiEdits called with regions (content changed: "initial" → "updated")
        expect(mockSetAiEdits).toHaveBeenCalled();

        // Navigator pill should be visible
        await waitFor(() => {
            expect(screen.getByTestId('ai-edit-navigator')).toBeDefined();
        });
    });

    // ── Identical content skips reload and decorations ──

    it('skips setContent when notes-changed delivers identical content', async () => {
        await renderEditor('test.md');
        const callsAfterInit = mockSetContent.mock.calls.length;

        // Deliver same content as initial
        mockLoadContent.mockResolvedValueOnce({ content: 'initial content', path: 'test.md' });

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // setContent NOT called again
        expect(mockSetContent).toHaveBeenCalledTimes(callsAfterInit);
        // No decorations
        expect(mockSetAiEdits).not.toHaveBeenCalled();
    });

    // ── Large diff (>50% changed) skips decoration ──

    it('skips decoration when diff is too large (>50% changed)', async () => {
        await renderEditor('test.md');

        // Completely different content — should exceed 50% threshold
        mockLoadContent.mockResolvedValueOnce({ content: 'xyz abc 123', path: 'test.md' });

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // setContent called for reload
        expect(mockSetContent).toHaveBeenCalledTimes(2);
        // But no decorations — diff too large
        expect(mockSetAiEdits).not.toHaveBeenCalled();
        // No navigator
        expect(screen.queryByTestId('ai-edit-navigator')).toBeNull();
    });

    // ── User has unsaved edits — dedup prevents double reload ──

    it('dedup guard prevents redundant setContent when content matches', async () => {
        await renderEditor('test.md');
        const callsAfterInit = mockSetContent.mock.calls.length;

        // Deliver same content as initial — rawMarkdownRef should match
        mockLoadContent.mockResolvedValueOnce({ content: 'initial content', path: 'test.md' });

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // loadContent is called but dedup prevents setContent
        expect(mockSetContent).toHaveBeenCalledTimes(callsAfterInit);
    });

    // ── Editor destroyed — no crash ──

    it('updates rawMarkdown but skips decoration when editor is destroyed', async () => {
        await renderEditor('test.md');

        mockEditor.isDestroyed = true;
        mockLoadContent.mockResolvedValueOnce({ content: 'new content', path: 'test.md' });

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // setContent NOT called for the reload (editor destroyed)
        expect(mockSetContent).toHaveBeenCalledTimes(1); // only initial
        expect(mockSetAiEdits).not.toHaveBeenCalled();
    });

    // ── loadContent throws — no crash ──

    it('handles loadContent errors silently', async () => {
        await renderEditor('test.md');

        mockLoadContent.mockRejectedValueOnce(new Error('disk error'));

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // No crash, no extra setContent
        expect(mockSetContent).toHaveBeenCalledTimes(1);
        expect(mockSetAiEdits).not.toHaveBeenCalled();
    });

    // ── Wrong workspace ID — ignored ──

    it('ignores notes-changed for different workspace', async () => {
        await renderEditor('test.md');
        const callsAfterInit = mockLoadContent.mock.calls.length;

        await act(async () => {
            fireNotesChanged('other-ws', ['test.md']);
        });
        await tickAsync();

        // loadContent NOT called — wrong workspace
        expect(mockLoadContent).toHaveBeenCalledTimes(callsAfterInit);
    });

    // ── Different path — ignored ──

    it('ignores notes-changed for different file path', async () => {
        await renderEditor('test.md');
        const callsAfterInit = mockLoadContent.mock.calls.length;

        await act(async () => {
            fireNotesChanged('ws1', ['other.md']);
        });
        await tickAsync();

        expect(mockLoadContent).toHaveBeenCalledTimes(callsAfterInit);
    });

    // ── notePath is null — no handler registered ──

    it('does not register handler when notePath is null', async () => {
        await renderEditor(null);
        const callsAfterInit = mockLoadContent.mock.calls.length;

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        expect(mockLoadContent).toHaveBeenCalledTimes(callsAfterInit);
    });

    // ── Dismiss clears count and hides navigator ──

    it('dismiss button clears count and hides navigator', async () => {
        await renderEditor('test.md');

        mockLoadContent.mockResolvedValueOnce({ content: 'updated content', path: 'test.md' });

        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // Navigator visible
        await waitFor(() => {
            expect(screen.getByTestId('ai-edit-navigator')).toBeDefined();
        });

        // Click dismiss
        const dismissBtn = screen.getByTestId('ai-edit-navigator-dismiss');
        await act(async () => {
            dismissBtn.click();
        });

        // Navigator should be hidden
        await waitFor(() => {
            expect(screen.queryByTestId('ai-edit-navigator')).toBeNull();
        });
    });

    // ── Multiple events accumulate regions ──

    it('accumulates regions across multiple notes-changed events', async () => {
        await renderEditor('test.md');

        // First change: small word edit
        mockLoadContent.mockResolvedValueOnce({ content: 'updated content', path: 'test.md' });
        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // Second change: another small word edit
        mockLoadContent.mockResolvedValueOnce({ content: 'modified content', path: 'test.md' });
        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // Navigator should show with accumulated count
        await waitFor(() => {
            const nav = screen.getByTestId('ai-edit-navigator');
            expect(nav).toBeDefined();
        });

        // setAiEdits called for each change event
        expect(mockSetAiEdits).toHaveBeenCalledTimes(2);
    });

    // ── Regression: rapid identical events only trigger one reload ──

    it('deduplicates rapid identical content deliveries', async () => {
        await renderEditor('test.md');

        // First event: loads new content
        mockLoadContent.mockResolvedValueOnce({ content: 'new content', path: 'test.md' });
        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        const callsAfterFirst = mockSetContent.mock.calls.length;

        // Second event: delivers same content (already loaded by first event)
        mockLoadContent.mockResolvedValueOnce({ content: 'new content', path: 'test.md' });
        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // setContent NOT called again — content dedup
        expect(mockSetContent).toHaveBeenCalledTimes(callsAfterFirst);
    });

    // ── Partial word change produces decoration with correct region ──

    it('computes word diff and creates region for partial text change', async () => {
        await renderEditor('test.md');

        // Change one word: "initial content" → "initial update"
        mockLoadContent.mockResolvedValueOnce({ content: 'initial update', path: 'test.md' });
        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();

        // setAiEdits should be called with regions containing diff chunks
        expect(mockSetAiEdits).toHaveBeenCalledTimes(1);
        const regions = mockSetAiEdits.mock.calls[0][0];
        expect(regions.length).toBeGreaterThan(0);
        const region = regions[regions.length - 1];
        expect(region.chunks).toBeDefined();
        expect(region.chunks.length).toBeGreaterThan(0);
        // Should contain at least one 'add' or 'remove' chunk
        expect(region.chunks.some((c: any) => c.type === 'add' || c.type === 'remove')).toBe(true);
    });
});

// ── AI-edit pill placement vs the Notes Chat lens ───────────────────────────

describe('NoteEditor AI-edit pill placement', () => {
    beforeEach(() => {
        mockLoadContent.mockReset();
        mockSetContent.mockClear();
        mockSetAiEdits.mockClear();
        mockGetHTML.mockReturnValue('<p>content</p>');
        mockEditor.isDestroyed = false;
        mockEditor.state.doc = makeDocWithText('');
        currentDocText = '';
    });

    afterEach(() => {
        cleanup();
    });

    /** Render the editor, then drive a small external edit so the pill appears. */
    async function renderWithPendingEdits(extraProps: { chatLensOpen?: boolean } = {}) {
        await renderEditor('test.md', extraProps);
        mockLoadContent.mockResolvedValueOnce({ content: 'updated content', path: 'test.md' });
        await act(async () => {
            fireNotesChanged('ws1', ['test.md']);
        });
        await tickAsync();
        return await screen.findByTestId('ai-edit-navigator');
    }

    it('anchors bottom-right with the full label when the chat is not a lens', async () => {
        const nav = await renderWithPendingEdits({ chatLensOpen: false });

        expect(nav.className).toContain('bottom-8 right-3');
        expect(nav.className).not.toContain('top-2');
        expect(nav.textContent).toContain('AI edit');
    });

    it('defaults to the bottom-right anchor when chatLensOpen is omitted', async () => {
        const nav = await renderWithPendingEdits();

        expect(nav.className).toContain('bottom-8 right-3');
        expect(nav.textContent).toContain('AI edit');
    });

    it('relocates to the top-right in its narrow form when the chat is a lens', async () => {
        const nav = await renderWithPendingEdits({ chatLensOpen: true });

        expect(nav.className).toContain('top-2 right-3');
        expect(nav.className).not.toContain('bottom-8');
        // Narrow form drops the "AI edits" wording but keeps the count.
        expect(nav.textContent).not.toContain('AI edit');
        expect(nav.textContent).toContain('1');
    });

    it('keeps Keep reachable and working while the lens is open', async () => {
        await renderWithPendingEdits({ chatLensOpen: true });

        const dismissBtn = screen.getByTestId('ai-edit-navigator-dismiss');
        expect(dismissBtn.textContent).toContain('Keep');

        await act(async () => {
            dismissBtn.click();
        });

        await waitFor(() => {
            expect(screen.queryByTestId('ai-edit-navigator')).toBeNull();
        });
    });

    // Regression: the lens fix relocates the pill, it never hides it. Hiding the
    // pill in lens mode is a different design (Keep moves into the chat footer).
    it('still renders the pill when the lens is open', async () => {
        const nav = await renderWithPendingEdits({ chatLensOpen: true });

        expect(nav).toBeDefined();
        expect(screen.getByTestId('ai-edit-navigator-next')).toBeDefined();
        expect(screen.getByTestId('ai-edit-navigator-dismiss')).toBeDefined();
    });

    // The pill must live inside the content column, not the editor root: the
    // toolbar wraps to extra rows, so a root-anchored top offset would collide.
    it('anchors the pill to the content column rather than the editor root', async () => {
        const nav = await renderWithPendingEdits({ chatLensOpen: true });

        const positionedParent = nav.parentElement;
        expect(positionedParent?.className).toContain('relative');
        expect(positionedParent?.className).toContain('flex-1');
        expect(positionedParent?.classList.contains('note-editor')).toBe(false);
    });
});

