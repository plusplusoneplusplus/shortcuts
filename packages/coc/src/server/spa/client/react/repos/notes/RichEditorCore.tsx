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
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import { ResizableImage } from './extensions/resizableImage';
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';

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
}

// ── Component ───────────────────────────────────────────────────────────────

export function RichEditorCore({
    placeholder = 'Start writing…',
    commentsEnabled = false,
    onCommentActivated,
    onChange,
    onEditorReady,
    handlePaste,
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

    const onUpdate = useCallback(({ editor: ed }: EditorEvents['update']) => {
        onChangeRef.current?.(ed as Editor);
    }, []);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
            }),
            Placeholder.configure({ placeholder }),
            Table.configure({ resizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            Highlight.configure({ multicolor: true }),
            ResizableImage.configure({ inline: false, allowBase64: false }),
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
            handlePaste: (view, event) => {
                if (handlePasteRef.current) {
                    return handlePasteRef.current(view, event as ClipboardEvent);
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
