import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
let capturedOnUpdate: ((payload: { editor: unknown }) => void) | null = null;

const mockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
    state: { selection: { empty: true } },
    chain: () => ({
        focus: () => ({
            toggleBold: () => ({ run: vi.fn() }),
        }),
    }),
};

vi.mock('@tiptap/react', () => ({
    useEditor: (config: { onUpdate?: (payload: { editor: unknown }) => void }) => {
        if (config?.onUpdate) capturedOnUpdate = config.onUpdate;
        return mockEditor;
    },
    EditorContent: ({ editor }: { editor: unknown }) =>
        editor ? <div data-testid="rich-editor-content" /> : null,
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

import { RichEditorCore } from '../../../../src/server/spa/client/react/repos/notes/RichEditorCore';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RichEditorCore', () => {
    beforeEach(() => {
        mockSetContent.mockReset();
        mockClearContent.mockReset();
        capturedOnUpdate = null;
    });

    afterEach(() => {
        cleanup();
    });

    // ── Renders with empty content ──────────────────────────────────────

    it('renders EditorContent', () => {
        render(<RichEditorCore />);
        expect(screen.getByTestId('rich-editor-content')).toBeDefined();
    });

    // ── onChange fires when content changes ──────────────────────────────

    it('fires onChange when content changes', () => {
        const onChange = vi.fn();
        render(<RichEditorCore onChange={onChange} />);

        expect(capturedOnUpdate).not.toBeNull();
        act(() => {
            capturedOnUpdate?.({ editor: mockEditor });
        });
        expect(onChange).toHaveBeenCalledWith(mockEditor);
    });

    // ── onEditorReady fires with editor instance ────────────────────────

    it('calls onEditorReady with the editor instance', () => {
        const onEditorReady = vi.fn();
        render(<RichEditorCore onEditorReady={onEditorReady} />);
        expect(onEditorReady).toHaveBeenCalledWith(mockEditor);
    });

    // ── Has no notes REST dependency ────────────────────────────────────

    it('does not import or reference notesApi', async () => {
        // Verify RichEditorCore renders without any notes API mock
        const { unmount } = render(<RichEditorCore />);
        expect(screen.getByTestId('rich-editor-content')).toBeDefined();
        unmount();
    });

    // ── Editor instance stability across parent rerenders ───────────────

    it('editor instance stays stable across parent rerenders', () => {
        const editorReadyCalls: unknown[] = [];

        function Parent() {
            const [count, setCount] = useState(0);
            const mountedRef = useRef(false);

            useEffect(() => {
                if (!mountedRef.current) {
                    mountedRef.current = true;
                    // Trigger a rerender after mount
                    setCount(1);
                }
            }, []);

            return (
                <div>
                    <span data-testid="count">{count}</span>
                    <RichEditorCore
                        onEditorReady={(ed) => editorReadyCalls.push(ed)}
                    />
                </div>
            );
        }

        render(<Parent />);

        // onEditorReady should only fire once, not on every parent render
        expect(editorReadyCalls.length).toBe(1);
        expect(editorReadyCalls[0]).toBe(mockEditor);
    });

    // ── onChange callback updates without editor recreation ──────────────

    it('latest onChange is called even after parent updates the callback', () => {
        const onChange1 = vi.fn();
        const onChange2 = vi.fn();

        const { rerender } = render(<RichEditorCore onChange={onChange1} />);
        rerender(<RichEditorCore onChange={onChange2} />);

        act(() => {
            capturedOnUpdate?.({ editor: mockEditor });
        });

        // The latest callback (onChange2) should be called, not the stale one
        expect(onChange2).toHaveBeenCalledWith(mockEditor);
        expect(onChange1).not.toHaveBeenCalled();
    });
});
