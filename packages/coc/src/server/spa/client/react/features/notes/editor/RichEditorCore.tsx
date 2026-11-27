/**
 * RichEditorCore — the CoC editor: tiptap-react's `RichEditor` shell plus the
 * CoC nodes (PDF, map, paper/YouTube embeds, note links, sidenotes, file
 * paths, AI-edit marks, comments), CoC link opening (`canvas://` panel tabs,
 * link-handler settings) and the embed dialogs.
 *
 * Does NOT depend on notes REST APIs, comments hooks, or workspace routing.
 * The parent component (e.g. NoteEditor) orchestrates load/save/mode switching.
 */

import { useRef, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { RichEditor } from '@plusplusoneplusplus/tiptap-react/editor';
import { NotesCodeBlock } from './extensions/notesCodeBlock';
import { notesLowlight } from './extensions/notesLowlight';
import { ResizableImage } from './extensions/resizableImage';
import { MermaidBlock } from '@plusplusoneplusplus/tiptap-react/mermaid';
import { MathInline, MathDisplay } from '@plusplusoneplusplus/tiptap-react/math';
import { MapBlock } from '@plusplusoneplusplus/tiptap-embeds/map';
import { PdfBlock } from './extensions/pdfBlock';
import type { PdfFullWindowRequest } from './extensions/pdfBlock';
import { PdfPopupDialog } from './extensions/PdfPopupDialog';
import { CommentExtension } from '@plusplusoneplusplus/tiptap-kit/comment-mark';
import { AiEditDecorationExtension } from './extensions/AiEditDecorationExtension';
import { YouTubeEmbedDecorationExtension } from '@plusplusoneplusplus/tiptap-embeds/youtube';
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
import { parseCanvasLink } from '../../../shared/canvasLink';
import { useUnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openCanvasLink } from '../../repo-detail/unified-right-panel/openCanvasLink';
// Every rule in this stylesheet is scoped to `.note-editor .ProseMirror`, so it
// belongs to the editor, not to the note page that happens to host it. Imported
// here (rather than only from NoteEditor) so a mount outside Notes — the
// markdown review dialog's rich view, for one — still gets the styles even if
// the bundler ever code-splits the two apart.
import '@plusplusoneplusplus/tiptap-react/styles.css';
import '@plusplusoneplusplus/tiptap-embeds/styles.css';
import './noteEditor.css';

// ── Props ───────────────────────────────────────────────────────────────────

export interface RichEditorCoreProps {
    /** Render a selectable document without editing. Default: false. */
    readOnly?: boolean;
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
    handlePaste?: (view: EditorView, event: ClipboardEvent) => boolean;
    /** ProseMirror `handleDrop` override — lets the parent intercept file drops. */
    handleDrop?: (view: EditorView, event: DragEvent) => boolean;
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
    /**
     * The scrolling element wrapping this editor, used to pin a heading to the
     * top after a same-note `#anchor` click. Optional: a bare mount (the
     * markdown review dialog) passes nothing and the caret move alone stands in.
     */
    scrollContainerRef?: { current: HTMLElement | null };
}

export { getLinkHoverTitle, getLinkOpenTitle } from '@plusplusoneplusplus/tiptap-react/editor';

// ── Component ───────────────────────────────────────────────────────────────

export function RichEditorCore({
    readOnly = false,
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
    scrollContainerRef,
}: RichEditorCoreProps) {
    // The extension config is captured once by `useEditor`, but the note
    // path/root, callbacks and link context change on navigation and
    // re-render — so extensions read them through refs at call time.
    const notePathRef = useRef(notePath);
    notePathRef.current = notePath;
    const noteRootRef = useRef(noteRoot);
    noteRootRef.current = noteRoot;
    const onChatAboutPaperRef = useRef(onChatAboutPaper);
    onChatAboutPaperRef.current = onChatAboutPaper;
    const resolvePaperSourceRef = useRef(resolvePaperSource);
    resolvePaperSourceRef.current = resolvePaperSource;
    const onCommentActivatedRef = useRef(onCommentActivated);
    onCommentActivatedRef.current = onCommentActivated;

    const [linkHandlerConfig] = useLinkHandlers();
    // Read at click time by `canvas://` links, which open a panel canvas tab.
    const linkContext = { host: useUnifiedPanelHost(), workspaceId, linkHandlerConfig };
    const linkContextRef = useRef(linkContext);
    linkContextRef.current = linkContext;

    // Embed buttons ask for a dialog. `useState` setters are stable, so they
    // are safe inside the once-captured extension config. One of each at a time.
    const [popupVideoId, setPopupVideoId] = useState<string | null>(null);
    const [popupPdf, setPopupPdf] = useState<PdfFullWindowRequest | null>(null);
    const [popupPaper, setPopupPaper] = useState<PaperLinkInfo | null>(null);

    // Stable (so the dialogs' resolve effects do not refire) yet always calls
    // the latest `resolvePaperSource` prop.
    const stableResolvePaper = useCallback((info: PaperLinkInfo): Promise<PdfPopupTarget> => {
        const fn = resolvePaperSourceRef.current;
        if (!fn) return Promise.reject(new Error('paper resolver unavailable'));
        return fn(info);
    }, []);

    // A `canvas://<id>` link opens the canvas as a panel tab; with no panel or
    // owning workspace it is a no-op, never a window.open. Anything else goes
    // through the user's link-handler settings.
    const openNoteLink = useCallback((href: string): boolean => {
        const { host, workspaceId: ownerWorkspaceId, linkHandlerConfig: config } = linkContextRef.current;
        const canvasLink = parseCanvasLink(href);
        if (canvasLink) {
            if (ownerWorkspaceId) {
                openCanvasLink({ canvasId: canvasLink.canvasId, ownerWorkspaceId, host });
            }
            return true;
        }
        openLink(href, config);
        return true;
    }, []);

    return (
        <RichEditor
            readOnly={readOnly}
            placeholder={placeholder}
            leadingExtensions={[
                // Must precede StarterKit so their parseHTML rules win.
                MapBlock,
                PdfBlock.configure({
                    onRequestFullWindow: (request: PdfFullWindowRequest) => setPopupPdf(request),
                    workspaceId,
                    getNotePath: () => notePathRef.current,
                    getNoteRoot: () => noteRootRef.current,
                    onChatAboutPaper: (paperTextRelPath: string) =>
                        onChatAboutPaperRef.current?.(paperTextRelPath),
                }),
                MermaidBlock,
                MathInline,
                MathDisplay,
            ]}
            // CodeBlockLowlight with a per-block language picker. A block with
            // an explicit language is highlighted live; one without stays plain
            // (notesLowlight disables auto-detection).
            codeBlock={NotesCodeBlock.configure({ lowlight: notesLowlight })}
            extensions={[
                ResizableImage.configure({ inline: false, allowBase64: false }),
                NoteLinkExtension,
                SidenoteRefExtension,
                FilePathNodeExtension,
                AiEditDecorationExtension,
                YouTubeEmbedDecorationExtension.configure({
                    onRequestPopup: (videoId: string) => setPopupVideoId(videoId),
                }),
                // Paper/PDF links get Open inline / Popout / New tab actions.
                PaperLinkEmbedDecorationExtension.configure({
                    onRequestPopout: (info: PaperLinkInfo) => setPopupPaper(info),
                    // Mount the inline pdf.js viewer into the widget container.
                    // The unmount is deferred so it never runs during a React render.
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
            ]}
            // Keep `canvas://<id>` hrefs through parse, render and save.
            linkProtocols={['canvas']}
            onOpenLink={openNoteLink}
            onChange={onChange}
            onEditorReady={onEditorReady}
            handlePaste={handlePaste}
            handleDrop={handleDrop}
            scrollContainerRef={scrollContainerRef}
            // Carry shared and CoC styles even when mounted without NoteEditor.
            className="rich-editor note-editor"
        >
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
        </RichEditor>
    );
}
