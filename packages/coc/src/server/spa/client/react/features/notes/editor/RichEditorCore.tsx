/**
 * RichEditorCore — reusable Tiptap editor shell.
 *
 * Owns the editor instance, extension wiring, and `EditorContent` rendering.
 * Does NOT depend on notes REST APIs, comments hooks, or workspace routing.
 * The parent component (e.g. NoteEditor) orchestrates load/save/mode switching.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor, EditorEvents } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { NotesCodeBlock } from './extensions/notesCodeBlock';
import { notesLowlight } from './extensions/notesLowlight';
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
import type { PdfFullWindowRequest } from './extensions/pdfBlock';
import { PdfPopupDialog } from './extensions/PdfPopupDialog';
import { CommentExtension } from './extensions/commentExtension';
import { AiEditDecorationExtension } from './extensions/AiEditDecorationExtension';
import { YouTubeEmbedDecorationExtension } from './extensions/YouTubeEmbedDecorationExtension';
import { YouTubePopupDialog } from './extensions/YouTubePopupDialog';
import { PaperLinkEmbedDecorationExtension } from './extensions/PaperLinkEmbedDecorationExtension';
import { PaperPopupDialog } from './extensions/PaperPopupDialog';
import { PaperInlineViewer } from './extensions/PaperInlineViewer';
import type { PdfPopupTarget } from './extensions/PdfPopupDialog';
import type { PaperLinkInfo } from './extensions/paperLink';
import { NoteLinkExtension } from './noteLinkExtension';
import { SidenoteRefExtension } from './extensions/sidenoteRefExtension';
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
    /**
     * Goal 1: workspace the PDF Quick Ask answer endpoint runs against. Threaded
     * into the PdfBlock + full-window overlay so a paper text-layer selection can
     * be asked→answered. Undefined disables the Quick Ask layer.
     */
    workspaceId?: string;
    /**
     * Goal 2: current note path — persistence target for answered paper
     * annotations. Passed live (this editor instance survives note switches).
     */
    notePath?: string | null;
    /** Goal 2: current notes root id, if any. */
    noteRoot?: string;
    /**
     * Goal 3 (AC-03): open the Notes chat grounded on an embedded paper's full
     * extracted text. Invoked from a PDF embed's "💬 Chat about this paper" button
     * with the `.papers/<id>.txt` sidecar relpath. Undefined hides the button.
     */
    onChatAboutPaper?: (paperTextRelPath: string) => void;
    /**
     * paper-link-embed (AC-03/AC-04): resolve a decorated paper link to a
     * pdf.js-loadable target ({url,label}). For arXiv the host ingests + caches
     * the PDF (`.papers/<id>.pdf`); for a direct `.pdf` it echoes the href. Wires
     * the Open inline (ephemeral) and Popout (maximized modal) actions. Undefined
     * → those two actions are inert (New tab still works standalone).
     */
    resolvePaperSource?: (info: PaperLinkInfo) => Promise<PdfPopupTarget>;
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
    workspaceId,
    notePath,
    noteRoot,
    onChatAboutPaper,
    resolvePaperSource,
}: RichEditorCoreProps) {
    // Live persistence context for the PdfBlock's Quick Ask layer. The editor is
    // captured once by `useEditor`, but the note path/root change on navigation —
    // so read them through refs at write time, not at editor-creation time.
    const notePathRef = useRef(notePath);
    notePathRef.current = notePath;
    const noteRootRef = useRef(noteRoot);
    noteRootRef.current = noteRoot;
    // Goal 3 (AC-03): the "chat about this paper" handler is read through a ref so
    // the extension config (captured once by `useEditor`) always calls the latest
    // callback even as the parent re-renders / the note changes.
    const onChatAboutPaperRef = useRef(onChatAboutPaper);
    onChatAboutPaperRef.current = onChatAboutPaper;
    // paper-link-embed (AC-03): the inline viewer seam is baked into the extension
    // config once by `useEditor`, so it reaches the latest resolver through a ref
    // (the note — and thus the ingest target root — changes on navigation).
    const resolvePaperSourceRef = useRef(resolvePaperSource);
    resolvePaperSourceRef.current = resolvePaperSource;
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

    // AC-03: the ⛶ Popup button on a decorated YouTube link asks us to open the
    // video in a Dialog. A `useState` setter is referentially stable, so wiring
    // it straight into the extension config (captured once by `useEditor`) is safe.
    const [popupVideoId, setPopupVideoId] = useState<string | null>(null);

    // AC-05: the ⛶ full-window button on a PDF embed asks us to open the PDF in
    // an in-app overlay. Mirrors the `popupVideoId` pattern — a stable setter is
    // safe to wire straight into the extension config captured once by `useEditor`.
    // Only one PDF overlay is open at a time; a new request replaces the prior one.
    const [popupPdf, setPopupPdf] = useState<PdfFullWindowRequest | null>(null);

    // paper-link-embed (AC-04): the ⛶ Popout button on a decorated paper link asks
    // us to open the paper in a maximized modal. Mirrors `popupPdf` — a stable
    // setter is safe to wire into the extension config captured once by `useEditor`.
    const [popupPaper, setPopupPaper] = useState<PaperLinkInfo | null>(null);

    const onUpdate = useCallback(({ editor: ed }: EditorEvents['update']) => {
        onChangeRef.current?.(ed as Editor);
    }, []);

    // Stable resolver handed to the popout dialog + inline viewer. Referentially
    // stable (so their resolve effects do not refire) yet always calls the latest
    // `resolvePaperSource` prop through the ref.
    const stableResolvePaper = useCallback((info: PaperLinkInfo): Promise<PdfPopupTarget> => {
        const fn = resolvePaperSourceRef.current;
        if (!fn) return Promise.reject(new Error('paper resolver unavailable'));
        return fn(info);
    }, []);

    const editor = useEditor({
        shouldRerenderOnTransaction: true,
        extensions: [
            MapBlock,
            PdfBlock.configure({
                onRequestFullWindow: (request: PdfFullWindowRequest) => setPopupPdf(request),
                workspaceId,
                getNotePath: () => notePathRef.current,
                getNoteRoot: () => noteRootRef.current,
                onChatAboutPaper: (paperTextRelPath: string) =>
                    onChatAboutPaperRef.current?.(paperTextRelPath),
            }),                     // must precede StarterKit so its parseHTML rule wins
            MermaidBlock,           // must precede StarterKit so its parseHTML rule wins
            MathInline,
            MathDisplay,
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                link: false,
                // Disable StarterKit's plain CodeBlock so CodeBlockLowlight is the
                // single `codeBlock` node type — its lowlight decorations color
                // fenced-block tokens live while editing. A block with an explicit
                // language (set via the per-block picker or a ```lang fence on
                // import) is highlighted; one with no language stays plain
                // (notesLowlight disables auto-detection).
                codeBlock: false,
            }),
            // CodeBlockLowlight extended with a per-block language picker NodeView
            // (AC-02). The lowlight instance colors tokens; the picker sets the
            // node's `language` attribute.
            NotesCodeBlock.configure({ lowlight: notesLowlight }),
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
            SidenoteRefExtension,
            FilePathNodeExtension,
            AiEditDecorationExtension,
            YouTubeEmbedDecorationExtension.configure({
                onRequestPopup: (videoId: string) => setPopupVideoId(videoId),
            }),
            // AC-02: paper/PDF links get view-only Open inline / Popout / New tab
            // affordances. New tab works standalone; Popout (AC-04) and the inline
            // pdf.js viewer (AC-03) are wired to host seams below.
            PaperLinkEmbedDecorationExtension.configure({
                // AC-04: open the paper in a maximized modal.
                onRequestPopout: (info: PaperLinkInfo) => setPopupPaper(info),
                // AC-03: mount the ephemeral inline pdf.js viewer into the widget
                // container. A React root is torn down on collapse/destroy — the
                // unmount is deferred so it never runs during a React render pass.
                renderInlineViewer: (container, info, onClose) => {
                    const root = createRoot(container);
                    root.render(
                        <PaperInlineViewer
                            info={info}
                            resolveSource={stableResolvePaper}
                            onClose={onClose}
                        />,
                    );
                    return () => {
                        setTimeout(() => root.unmount(), 0);
                    };
                },
            }),
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

    return (
        <>
            <EditorContent editor={editor} />
            <YouTubePopupDialog videoId={popupVideoId} onClose={() => setPopupVideoId(null)} />
            <PdfPopupDialog
                pdf={popupPdf}
                onClose={() => setPopupPdf(null)}
                workspaceId={workspaceId}
                notePath={notePath}
                noteRoot={noteRoot}
            />
            {resolvePaperSource && (
                <PaperPopupDialog
                    paper={popupPaper}
                    resolveSource={stableResolvePaper}
                    onClose={() => setPopupPaper(null)}
                    workspaceId={workspaceId}
                    notePath={notePath}
                    noteRoot={noteRoot}
                />
            )}
        </>
    );
}
