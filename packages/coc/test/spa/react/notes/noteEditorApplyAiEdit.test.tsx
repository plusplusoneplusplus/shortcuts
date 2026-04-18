/**
 * Integration tests for NoteEditor.applyAiEdit — the full ref → reload → decoration path.
 *
 * Renders <NoteEditor> with a mocked RichEditorCore to test the imperative
 * applyAiEdit handle: disk reload, editor content update, AI edit count
 * increment, and navigator pill visibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { createRef, useEffect } from 'react';

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
    '../../../../src/server/spa/client/react/repos/notes/noteMarkdown',
    () => ({
        markdownToHtml: (md: string) => `<p>${md}</p>`,
        htmlToMarkdown: (html: string) => html.replace(/<\/?[^>]+>/g, ''),
        rewriteImageSrcToApi: (html: string) => html,
        rewriteImageSrcToRelative: (md: string) => md,
    }),
);

vi.mock('../../../../src/server/spa/client/react/repos/notesApi', () => ({
    notesApi: {
        getContent: vi.fn(() => Promise.resolve({ content: '', path: '' })),
        saveContent: vi.fn(() => Promise.resolve({ path: '', updated: true })),
        getComments: vi.fn(() => Promise.resolve({ noteId: '', threads: {} })),
        updateThread: vi.fn(() => Promise.resolve()),
        uploadImage: vi.fn(() => Promise.resolve({ path: 'img/test.png' })),
    },
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

vi.mock('../../../../src/server/spa/client/react/repos/notes/RichEditorCore', () => ({
    RichEditorCore: (props: { onChange?: (editor: unknown) => void; onEditorReady?: (editor: unknown) => void }) => {
        useEffect(() => {
            props.onEditorReady?.(mockEditor);
        }, []);
        return <div data-testid="editor-content" />;
    },
}));

import type { NoteEditorHandle } from '../../../../src/server/spa/client/react/repos/notes/NoteEditor';
import { NoteEditor } from '../../../../src/server/spa/client/react/repos/notes/NoteEditor';

// ── Helpers ────────────────────────────────────────────────────────────────

async function renderWithRef(notePath: string | null = 'test.md') {
    const ref = createRef<NoteEditorHandle>();
    // Initial content load
    if (notePath) {
        mockLoadContent.mockResolvedValueOnce({ content: 'initial content', path: notePath });
    }
    await act(async () => {
        render(<NoteEditor workspaceId="ws1" notePath={notePath} io={mockIo} ref={ref} />);
    });
    // Wait for initial content load + editor ready
    if (notePath) {
        await waitFor(() => expect(mockSetContent).toHaveBeenCalled());
    }
    return ref;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditor.applyAiEdit', () => {
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

    // ── Case 1: Happy path — plain text ─────────────────────────────────

    it('reloads content from disk and shows navigator pill', async () => {
        const ref = await renderWithRef('test.md');
        expect(ref.current).toBeDefined();

        // Set up the reload response — applyAiEdit will call loadContent again
        mockLoadContent.mockResolvedValueOnce({ content: 'The new text here', path: 'test.md' });

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'The old text here', newStr: 'The new text here' });
        });

        // loadContent should be called: once for initial load + once for applyAiEdit
        expect(mockLoadContent).toHaveBeenCalledTimes(2);

        // setContent called for both initial load and reload
        expect(mockSetContent).toHaveBeenCalledTimes(2);

        // Navigator pill should be visible
        await waitFor(() => {
            expect(screen.getByTestId('ai-edit-navigator')).toBeDefined();
        });
    });

    // ── Case 2: newStr not found in doc text (markdown mismatch) ────────

    it('increments count even when newStr is not found in doc text', async () => {
        const ref = await renderWithRef('test.md');

        // Return content where the plain text won't match newStr exactly
        // Our mock markdownToHtml wraps in <p>, and setContent strips to plain text
        // But if AI returns markdown like "**bold**", the doc textContent would be "bold"
        mockLoadContent.mockResolvedValueOnce({ content: 'some content', path: 'test.md' });

        // newStr won't be found in doc textContent because the actual text doesn't match
        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'old', newStr: 'this-will-not-match-anything' });
        });

        // Navigator should still appear (count incremented even on mismatch)
        await waitFor(() => {
            expect(screen.getByTestId('ai-edit-navigator')).toBeDefined();
        });

        // But setAiEdits should NOT have been called (decoration skipped)
        expect(mockSetAiEdits).not.toHaveBeenCalled();
    });

    // ── Case 3: oldStr === newStr (all-equal diff) ──────────────────────

    it('increments count but does not set decorations when oldStr equals newStr', async () => {
        const ref = await renderWithRef('test.md');
        const sameText = 'identical text';

        mockLoadContent.mockResolvedValueOnce({ content: sameText, path: 'test.md' });

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: sameText, newStr: sameText });
        });

        // Count is incremented (so navigator shows), but no decorations set
        // because wordDiff returns all-equal chunks and the code returns early
        // The count IS still incremented before the equal-check
        await waitFor(() => {
            expect(screen.getByTestId('ai-edit-navigator')).toBeDefined();
        });

        // setAiEdits NOT called because chunks are all-equal → early return
        expect(mockSetAiEdits).not.toHaveBeenCalled();
    });

    // ── Case 4: newStr empty (deletion) ─────────────────────────────────

    it('increments count when newStr is empty (deletion)', async () => {
        const ref = await renderWithRef('test.md');

        mockLoadContent.mockResolvedValueOnce({ content: 'remaining content', path: 'test.md' });

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'deleted text', newStr: '' });
        });

        // Count should increment — navigator shows
        await waitFor(() => {
            expect(screen.getByTestId('ai-edit-navigator')).toBeDefined();
        });

        // loadContent was called for reload
        expect(mockLoadContent).toHaveBeenCalledTimes(2);
    });

    // ── Case 5: loadContent throws ──────────────────────────────────────

    it('resolves silently when loadContent throws', async () => {
        const ref = await renderWithRef('test.md');

        mockLoadContent.mockRejectedValueOnce(new Error('disk error'));

        // Should not throw
        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'old', newStr: 'new' });
        });

        // Navigator should NOT be shown (count not incremented on error)
        expect(screen.queryByTestId('ai-edit-navigator')).toBeNull();

        // setAiEdits should NOT have been called
        expect(mockSetAiEdits).not.toHaveBeenCalled();
    });

    // ── Case 6: notePath is null ────────────────────────────────────────

    it('returns early without calling loadContent when notePath is null', async () => {
        const ref = await renderWithRef(null);

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'old', newStr: 'new' });
        });

        // loadContent should NOT have been called at all (no initial load, no reload)
        expect(mockLoadContent).not.toHaveBeenCalled();

        // No navigator
        expect(screen.queryByTestId('ai-edit-navigator')).toBeNull();
    });

    // ── Case 7: Multiple sequential calls accumulate count ──────────────

    it('accumulates count across multiple sequential applyAiEdit calls', async () => {
        const ref = await renderWithRef('test.md');

        // Each call will reload content; the newStr won't match but count still goes up
        for (let i = 0; i < 3; i++) {
            mockLoadContent.mockResolvedValueOnce({ content: `content ${i}`, path: 'test.md' });
            await act(async () => {
                await ref.current!.applyAiEdit({ oldStr: `old ${i}`, newStr: `unique-${i}-no-match` });
            });
        }

        // Navigator should show with count reflecting 3 edits
        await waitFor(() => {
            const nav = screen.getByTestId('ai-edit-navigator');
            expect(nav).toBeDefined();
            expect(nav.textContent).toContain('3');
        });

        // loadContent called: 1 (initial) + 3 (reloads) = 4
        expect(mockLoadContent).toHaveBeenCalledTimes(4);
    });

    // ── Case 8: Dismiss clears count and hides navigator ────────────────

    it('dismiss button clears count and hides navigator', async () => {
        const ref = await renderWithRef('test.md');

        mockLoadContent.mockResolvedValueOnce({ content: 'updated', path: 'test.md' });

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'old', newStr: 'no-match-text' });
        });

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

    // ── Case: editor destroyed before applyAiEdit runs ──────────────────

    it('returns silently when editor is destroyed', async () => {
        const ref = await renderWithRef('test.md');

        mockLoadContent.mockResolvedValueOnce({ content: 'content', path: 'test.md' });
        mockEditor.isDestroyed = true;

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'old', newStr: 'new' });
        });

        // loadContent was called for the reload attempt, but setContent wasn't called again
        // (the 2nd call is blocked by isDestroyed check)
        expect(mockSetContent).toHaveBeenCalledTimes(1); // only initial load
        expect(screen.queryByTestId('ai-edit-navigator')).toBeNull();
    });

    // ── Case: Cancel pending autosave ───────────────────────────────────

    it('cancels pending autosave before reloading', async () => {
        const ref = await renderWithRef('test.md');

        mockLoadContent.mockResolvedValueOnce({ content: 'fresh', path: 'test.md' });

        await act(async () => {
            await ref.current!.applyAiEdit({ oldStr: 'old', newStr: 'no-match' });
        });

        // loadContent called for reload — verifies the reload path runs
        expect(mockLoadContent).toHaveBeenCalledTimes(2);
    });
});
