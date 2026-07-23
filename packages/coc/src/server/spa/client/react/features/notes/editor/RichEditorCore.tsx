/**
 * RichEditorCore — reusable Tiptap editor shell.
 *
 * Owns the editor instance, extension wiring, and `EditorContent` rendering.
 * Does NOT depend on notes REST APIs, comments hooks, or workspace routing.
 * The parent component (e.g. NoteEditor) orchestrates load/save/mode switching.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor, EditorEvents } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { IndentExtension } from './extensions/indentExtension';
import { ResizableImage } from './extensions/resizableImage';
import { MermaidBlock } from './extensions/mermaidBlock';
import { MathInline, MathDisplay } from './extensions/mathNode';
import { MapBlock } from './extensions/mapBlock';
import { PdfBlock } from './extensions/pdfBlock';
import { CommentExtension } from './extensions/commentExtension';
import { AiEditDecorationExtension } from './extensions/AiEditDecorationExtension';
import { NoteLinkExtension } from './noteLinkExtension';
import { FilePathNodeExtension } from './filePathNodeExtension';
import { useLinkHandlers } from '../../../hooks/useLinkHandlers';
import { openLink } from '../../../utils/link-handler';

// ── Props ───────────────────────────────────────────────────────────────────

export interface RichEditorCoreProps {
    /** Placeholder text shown when the editor is empty. */
    placeholder?: string;
    /** Enable inline comment marks via CommentExtension. Default: false. */
    commentsEnabled?: boolean;
    /** Called when the inline-comment extension activates/deactivates a comment. */
    onCommentActivated?: (commentId: string | null) => void;
    /** Called on every content change (debounce is the parent's responsibility). */
    onChange?: (editor: Editor) => void;
    /** Called once the editor instance is ready. */
    onEditorReady?: (editor: Editor) => void;
    /** ProseMirror `handlePaste` override — lets the parent intercept paste events. */
    handlePaste?: (view: any, event: ClipboardEvent) => boolean;
    /** ProseMirror `handleDrop` override — lets the parent intercept file drops. */
    handleDrop?: (view: any, event: DragEvent) => boolean;
}

export function getLinkOpenTitle(platform = globalThis.navigator?.platform ?? '') {
    return /Mac|iPhone|iPad|iPod/i.test(platform)
        ? '⌘+Click to open link'
        : 'Ctrl+Click to open link';
}

export function getLinkHoverTitle(href: string, platform = globalThis.navigator?.platform ?? '') {
    return `${href}\n${getLinkOpenTitle(platform)}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export function RichEditorCore({
    placeholder = 'Start writing…',
    commentsEnabled = false,
    onCommentActivated,
    onChange,
    onEditorReady,
    handlePaste,
    handleDrop,
}: RichEditorCoreProps) {
    // Stable callback refs — avoids editor recreation when parent re-renders
    const onCommentActivatedRef = useRef(onCommentActivated);
    onCommentActivatedRef.current = onCommentActivated;

    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const onEditorReadyRef = useRef(onEditorReady);
    onEditorReadyRef.current = onEditorReady;

    const handlePasteRef = useRef(handlePaste);
    handlePasteRef.current = handlePaste;

    const handleDropRef = useRef(handleDrop);
    handleDropRef.current = handleDrop;

    const [linkHandlerConfig] = useLinkHandlers();
    const linkHandlerConfigRef = useRef(linkHandlerConfig);
    linkHandlerConfigRef.current = linkHandlerConfig;

    const onUpdate = useCallback(({ editor: ed }: EditorEvents['update']) => {
        onChangeRef.current?.(ed as Editor);
    }, []);

    const editor = useEditor({
        shouldRerenderOnTransaction: true,
        extensions: [
            MapBlock,
            PdfBlock,               // must precede StarterKit so its parseHTML rule wins
            MermaidBlock,           // must precede StarterKit so its parseHTML rule wins
            MathInline,
            MathDisplay,
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                link: false,
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    rel: 'noopener noreferrer',
                    target: '_blank',
                },
            }),
            Placeholder.configure({ placeholder }),
            Table.configure({ resizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            Highlight.configure({ multicolor: true }),
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            IndentExtension,
            ResizableImage.configure({ inline: false, allowBase64: false }),
            NoteLinkExtension,
            FilePathNodeExtension,
            AiEditDecorationExtension,
            ...(commentsEnabled
                ? [
                    CommentExtension.configure({
                        onCommentActivated: (commentId: string | null) => {
                            onCommentActivatedRef.current?.(commentId);
                        },
                    }),
                ]
                : []),
        ],
        editorProps: {
            handleClick: (view, pos, event) => {
                if (!(event.ctrlKey || event.metaKey)) return false;
                const { state } = view;
                const $pos = state.doc.resolve(pos);
                const linkMark = $pos.marks().find((m: any) => m.type.name === 'link');
                if (linkMark?.attrs.href) {
                    openLink(linkMark.attrs.href, linkHandlerConfigRef.current);
                    return true;
                }
                // Fallback: check if the DOM target is an <a> element
                const anchor = (event.target as HTMLElement).closest?.('a');
                if (anchor?.href) {
                    openLink(anchor.href, linkHandlerConfigRef.current);
                    return true;
                }
                return false;
            },
            handleDOMEvents: {
                keydown: (view, event) => {
                    if (event.key === 'Control' || event.key === 'Meta') {
                        view.dom.classList.add('ctrl-held');
                    }
                    return false;
                },
                keyup: (view, event) => {
                    if (event.key === 'Control' || event.key === 'Meta') {
                        view.dom.classList.remove('ctrl-held');
                    }
                    return false;
                },
                blur: (view) => {
                    view.dom.classList.remove('ctrl-held');
                    return false;
                },
                mouseover: (_view, event) => {
                    const target = event.target;
                    if (!(target instanceof Element)) return false;

                    const anchor = target.closest('a[href]');
                    const href = anchor?.getAttribute('href');
                    if (anchor && href) {
                        anchor.setAttribute('title', getLinkHoverTitle(href));
                    }
                    return false;
                },
                // Mark the editor as a valid drop target for external file drags
                // (a dragover that never calls preventDefault would forbid the drop).
                dragover: (_view, event) => {
                    if ((event as DragEvent).dataTransfer?.types.includes('Files')) {
                        event.preventDefault();
                    }
                    return false;
                },
            },
            handlePaste: (view, event) => {
                if (handlePasteRef.current) {
                    return handlePasteRef.current(view, event as ClipboardEvent);
                }
                return false;
            },
            handleDrop: (view, event) => {
                if (handleDropRef.current) {
                    return handleDropRef.current(view, event as DragEvent);
                }
                return false;
            },
        },
        onUpdate,
    });

    // Notify parent when editor becomes available
    useEffect(() => {
        if (editor) onEditorReadyRef.current?.(editor);
    }, [editor]);

    return <EditorContent editor={editor} />;
}
