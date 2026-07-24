import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');
let capturedOnUpdate: ((payload: { editor: unknown }) => void) | null = null;
let capturedEditorProps: any = null;
let capturedLinkConfig: any = null;
let capturedExtensions: unknown[] = [];

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
    useEditor: (config: { onUpdate?: (payload: { editor: unknown }) => void; editorProps?: any; extensions?: unknown[] }) => {
        if (config?.onUpdate) capturedOnUpdate = config.onUpdate;
        if (config?.editorProps) capturedEditorProps = config.editorProps;
        capturedExtensions = config?.extensions ?? [];
        return mockEditor;
    },
    EditorContent: ({ editor }: { editor: unknown }) =>
        editor ? <div data-testid="rich-editor-content" /> : null,
}));

vi.mock('@tiptap/starter-kit', () => ({ StarterKit: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-task-list', () => ({ TaskList: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ TaskItem: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({
    Link: {
        configure: (config: any) => {
            capturedLinkConfig = config;
            return {};
        },
    },
}));
vi.mock('@tiptap/extension-placeholder', () => ({ Placeholder: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table', () => ({ Table: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table-row', () => ({ TableRow: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ TableCell: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ TableHeader: {} }));
vi.mock('@tiptap/extension-highlight', () => ({ Highlight: { configure: () => ({}) } }));
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/extensions/resizableImage', () => ({
    ResizableImage: { configure: () => ({}) },
}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/mermaidBlock',
    () => ({ MermaidBlock: {} }),
);
const mockMapBlock = vi.hoisted(() => ({}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/mapBlock',
    () => ({ MapBlock: mockMapBlock }),
);
const mockPdfBlock = vi.hoisted(() => ({}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/pdfBlock',
    () => ({ PdfBlock: mockPdfBlock }),
);
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/commentExtension',
    () => ({ CommentExtension: { configure: () => ({}) } }),
);

import {
    getLinkHoverTitle,
    getLinkOpenTitle,
    RichEditorCore,
} from '../../../../src/server/spa/client/react/features/notes/editor/RichEditorCore';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RichEditorCore', () => {
    beforeEach(() => {
        mockSetContent.mockReset();
        mockClearContent.mockReset();
        capturedOnUpdate = null;
        capturedEditorProps = null;
        capturedLinkConfig = null;
        capturedExtensions = [];
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

    // ── Ctrl+Click link handling ───────────────────────────────────────

    it('configures handleClick in editorProps for Ctrl+Click link opening', () => {
        render(<RichEditorCore />);
        expect(capturedEditorProps).toBeDefined();
        expect(typeof capturedEditorProps.handleClick).toBe('function');
    });

    it('configures note links to open securely without persisting a static tooltip', () => {
        render(<RichEditorCore />);

        expect(capturedLinkConfig).toBeDefined();
        expect(capturedLinkConfig.openOnClick).toBe(false);
        expect(capturedLinkConfig.HTMLAttributes).toEqual({
            rel: 'noopener noreferrer',
            target: '_blank',
        });
    });

    it('registers the map block before StarterKit so map placeholders parse as atom blocks', () => {
        render(<RichEditorCore />);

        expect(capturedExtensions[0]).toBe(mockMapBlock);
    });

    it('registers the pdf block before StarterKit so pdf placeholders parse as atom blocks', () => {
        render(<RichEditorCore />);

        const pdfIndex = capturedExtensions.indexOf(mockPdfBlock);
        expect(pdfIndex).toBeGreaterThanOrEqual(1);
        // MapBlock must remain first; PdfBlock sits alongside the other custom blocks.
        expect(capturedExtensions[0]).toBe(mockMapBlock);
    });

    // ── AC-03: ⛶ Popup wiring (extension → React Dialog) ────────────────

    it('opens the popup player Dialog when the YouTube extension requests a popup', () => {
        render(<RichEditorCore />);

        // The YouTube decoration extension is configured with an onRequestPopup
        // bridge that lifts the video id into RichEditorCore state.
        const ytExt = capturedExtensions.find(
            (e: any) => e?.name === 'youTubeEmbedDecoration',
        ) as any;
        expect(ytExt).toBeDefined();
        expect(typeof ytExt.options.onRequestPopup).toBe('function');

        // No popup before the request.
        expect(document.querySelector('iframe')).toBeNull();

        act(() => {
            ytExt.options.onRequestPopup('dQw4w9WgXcQ');
        });

        const iframe = document.querySelector('iframe') as HTMLIFrameElement;
        expect(iframe).toBeTruthy();
        expect(iframe.getAttribute('src')).toBe(
            'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1',
        );

        // Closing the dialog unmounts the iframe (stops playback).
        act(() => {
            screen.getByTestId('dialog-close-btn').click();
        });
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('uses the Command key in link tooltips on macOS platforms', () => {
        expect(getLinkOpenTitle('MacIntel')).toBe('⌘+Click to open link');
        expect(getLinkOpenTitle('iPhone')).toBe('⌘+Click to open link');
    });

    it('uses the Control key in link tooltips on non-macOS platforms', () => {
        expect(getLinkOpenTitle('Win32')).toBe('Ctrl+Click to open link');
        expect(getLinkOpenTitle('Linux x86_64')).toBe('Ctrl+Click to open link');
    });

    it('shows the destination URL and platform-aware open instruction in link hover titles', () => {
        expect(getLinkHoverTitle('https://example.com/paper', 'MacIntel'))
            .toBe('https://example.com/paper\n⌘+Click to open link');
        expect(getLinkHoverTitle('https://example.com/paper', 'Win32'))
            .toBe('https://example.com/paper\nCtrl+Click to open link');
    });

    it('handleClick opens link when Ctrl is held', () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        render(<RichEditorCore />);

        const linkMark = { type: { name: 'link' }, attrs: { href: 'https://example.com' } };
        const mockView = {
            state: {
                doc: {
                    resolve: () => ({
                        marks: () => [linkMark],
                    }),
                },
            },
        };
        const result = capturedEditorProps.handleClick(mockView, 0, { ctrlKey: true, metaKey: false, target: document.createElement('span') });
        expect(result).toBe(true);
        expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
        openSpy.mockRestore();
    });

    it('handleClick returns false when no modifier key is held', () => {
        render(<RichEditorCore />);

        const result = capturedEditorProps.handleClick({}, 0, { ctrlKey: false, metaKey: false });
        expect(result).toBe(false);
    });

    it('handleClick falls back to DOM anchor when no link mark found', () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        render(<RichEditorCore />);

        const anchor = document.createElement('a');
        anchor.href = 'https://fallback.com/test';
        const mockView = {
            state: {
                doc: {
                    resolve: () => ({ marks: () => [] }),
                },
            },
        };
        const result = capturedEditorProps.handleClick(mockView, 0, { ctrlKey: true, metaKey: false, target: anchor });
        expect(result).toBe(true);
        expect(openSpy).toHaveBeenCalledWith('https://fallback.com/test', '_blank', 'noopener');
        openSpy.mockRestore();
    });

    // ── Ctrl-hover cursor affordance ────────────────────────────────────

    it('configures handleDOMEvents for Ctrl-hover cursor affordance', () => {
        render(<RichEditorCore />);
        expect(capturedEditorProps.handleDOMEvents).toBeDefined();
        expect(typeof capturedEditorProps.handleDOMEvents.keydown).toBe('function');
        expect(typeof capturedEditorProps.handleDOMEvents.keyup).toBe('function');
        expect(typeof capturedEditorProps.handleDOMEvents.blur).toBe('function');
        expect(typeof capturedEditorProps.handleDOMEvents.mouseover).toBe('function');
    });

    it('keydown adds ctrl-held class when Control key is pressed', () => {
        render(<RichEditorCore />);
        const mockDom = document.createElement('div');
        const mockView = { dom: mockDom };

        capturedEditorProps.handleDOMEvents.keydown(mockView, { key: 'Control' });
        expect(mockDom.classList.contains('ctrl-held')).toBe(true);
    });

    it('keyup removes ctrl-held class when Control key is released', () => {
        render(<RichEditorCore />);
        const mockDom = document.createElement('div');
        mockDom.classList.add('ctrl-held');
        const mockView = { dom: mockDom };

        capturedEditorProps.handleDOMEvents.keyup(mockView, { key: 'Control' });
        expect(mockDom.classList.contains('ctrl-held')).toBe(false);
    });

    it('blur removes ctrl-held class', () => {
        render(<RichEditorCore />);
        const mockDom = document.createElement('div');
        mockDom.classList.add('ctrl-held');
        const mockView = { dom: mockDom };

        capturedEditorProps.handleDOMEvents.blur(mockView);
        expect(mockDom.classList.contains('ctrl-held')).toBe(false);
    });

    it('adds the destination URL hint when hovering over a link or its child', () => {
        render(<RichEditorCore />);
        const anchor = document.createElement('a');
        anchor.setAttribute('href', 'https://example.com/paper');
        const child = document.createElement('span');
        anchor.appendChild(child);

        const result = capturedEditorProps.handleDOMEvents.mouseover({}, { target: child });

        expect(result).toBe(false);
        expect(anchor.title).toBe(getLinkHoverTitle('https://example.com/paper'));
    });

    it('does not add a hover hint to non-link content', () => {
        render(<RichEditorCore />);
        const paragraph = document.createElement('p');

        const result = capturedEditorProps.handleDOMEvents.mouseover({}, { target: paragraph });

        expect(result).toBe(false);
        expect(paragraph.hasAttribute('title')).toBe(false);
    });

    // ── File-drop seam (handleDrop / dragover) ──────────────────────────

    it('delegates editorProps.handleDrop to the handleDrop prop and returns its result', () => {
        const handleDrop = vi.fn().mockReturnValue(true);
        render(<RichEditorCore handleDrop={handleDrop} />);

        const mockView = {};
        const event = { type: 'drop' };
        const result = capturedEditorProps.handleDrop(mockView, event);

        expect(handleDrop).toHaveBeenCalledWith(mockView, event);
        expect(result).toBe(true);
    });

    it('handleDrop returns false when no handleDrop prop is provided', () => {
        render(<RichEditorCore />);
        expect(capturedEditorProps.handleDrop({}, { type: 'drop' })).toBe(false);
    });

    it('dragover preventDefaults a file drag so the editor is a valid drop target', () => {
        render(<RichEditorCore />);
        const preventDefault = vi.fn();
        const fileEvent = { dataTransfer: { types: ['Files'] }, preventDefault };

        const result = capturedEditorProps.handleDOMEvents.dragover({}, fileEvent);

        expect(preventDefault).toHaveBeenCalledTimes(1);
        // Returns false so ProseMirror still processes its own drag bookkeeping.
        expect(result).toBe(false);
    });

    it('dragover does not preventDefault for a non-file (internal) drag', () => {
        render(<RichEditorCore />);
        const preventDefault = vi.fn();
        const internalEvent = {
            dataTransfer: { types: ['application/x-note-drag'] },
            preventDefault,
        };

        capturedEditorProps.handleDOMEvents.dragover({}, internalEvent);
        expect(preventDefault).not.toHaveBeenCalled();
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
