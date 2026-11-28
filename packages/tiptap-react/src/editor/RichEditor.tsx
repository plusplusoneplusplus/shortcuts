/**
 * RichEditor — a React Tiptap editor shell with a Markdown-friendly extension
 * set: headings, lists, task lists, links, tables (resizable columns, cell
 * fills, column wrap, row/column moves), highlight, sup/sub, text color, font
 * family and size, alignment, indentation and find/replace.
 *
 * The host adds its own nodes through `leadingExtensions` / `codeBlock` /
 * `extensions` and decides how a Ctrl/Cmd-clicked link opens via `onOpenLink`.
 * Same-document `#anchor` links are handled here: they move the caret to the
 * matching heading and never open a window.
 *
 * `useEditor` reads its config once, so extension props are read on mount
 * only; callbacks are read through refs and may change freely.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { AnyExtension, Editor, EditorEvents, Extensions } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { Highlight } from '@tiptap/extension-highlight';
import { Superscript } from '@tiptap/extension-superscript';
import { Subscript } from '@tiptap/extension-subscript';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { FindAndReplace } from '@tiptap/extension-find-and-replace';
import { TextAlign } from '@tiptap/extension-text-align';
import { TableCellWithWrap, TableHeaderWithWrap, TableReorder } from '@plusplusoneplusplus/tiptap-kit/table';
import { IndentExtension } from '@plusplusoneplusplus/tiptap-kit/indent';
import { jumpToHeadingAnchor } from '@plusplusoneplusplus/tiptap-kit/toc';

export interface RichEditorProps {
    /** Render a selectable document without editing. Default: false. */
    readOnly?: boolean;
    /** Placeholder text shown when the editor is empty. */
    placeholder?: string;
    /**
     * Nodes registered before StarterKit so their parse rules win over the
     * built-in paragraph/code-block rules (custom `<div>` / `<pre>` blocks).
     */
    leadingExtensions?: Extensions;
    /** Replaces StarterKit's plain code block; registered right after StarterKit. */
    codeBlock?: AnyExtension;
    /** Host extensions, registered after the built-ins and before find/replace. */
    extensions?: Extensions;
    /** Extra link protocols kept through parse, render and save (e.g. `['canvas']`). */
    linkProtocols?: string[];
    /**
     * Open a Ctrl/Cmd-clicked link. Return true when handled; otherwise the
     * link opens in a new window. `#anchor` links never reach this.
     */
    onOpenLink?: (href: string) => boolean | void;
    /** Called on every content change (debounce is the host's job). */
    onChange?: (editor: Editor) => void;
    /** Called once the editor instance is ready. */
    onEditorReady?: (editor: Editor) => void;
    /** ProseMirror `handlePaste` override. Ignored while read-only. */
    handlePaste?: (view: EditorView, event: ClipboardEvent) => boolean;
    /** ProseMirror `handleDrop` override. Ignored while read-only. */
    handleDrop?: (view: EditorView, event: DragEvent) => boolean;
    /** Scrolling element around the editor, used to pin a heading after an `#anchor` jump. */
    scrollContainerRef?: { current: HTMLElement | null };
    /** Class on the editor root; the CSS scope for editor styles. Default: `rich-editor`. */
    className?: string;
    /** Rendered after the editor, e.g. host dialogs opened from node views. */
    children?: ReactNode;
}

export function getLinkOpenTitle(platform = globalThis.navigator?.platform ?? '') {
    return /Mac|iPhone|iPad|iPod/i.test(platform)
        ? '⌘+Click to open link'
        : 'Ctrl+Click to open link';
}

export function getLinkHoverTitle(href: string, platform = globalThis.navigator?.platform ?? '') {
    return `${href}\n${getLinkOpenTitle(platform)}`;
}

function openInNewWindow(href: string): void {
    window.open(href, '_blank', 'noopener,noreferrer');
}

/** Ordered extension list for a RichEditor. Exported for hosts that build their own `useEditor`. */
export function createRichEditorExtensions({
    placeholder = 'Start writing…',
    leadingExtensions = [],
    codeBlock,
    extensions = [],
    linkProtocols = [],
}: Pick<RichEditorProps, 'placeholder' | 'leadingExtensions' | 'codeBlock' | 'extensions' | 'linkProtocols'> = {}): Extensions {
    return [
        ...leadingExtensions,
        StarterKit.configure({
            heading: { levels: [1, 2, 3, 4, 5, 6] },
            link: false,
            ...(codeBlock ? { codeBlock: false } : {}),
        }),
        ...(codeBlock ? [codeBlock] : []),
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({
            openOnClick: false,
            protocols: linkProtocols,
            HTMLAttributes: {
                rel: 'noopener noreferrer',
                target: '_blank',
            },
        }),
        Placeholder.configure({ placeholder }),
        // `resizable: true` installs ProseMirror's `columnResizing` plugin: it
        // draws the `.column-resize-handle`, sets `.resize-cursor` while
        // dragging and writes each cell's `colwidth` on mouseup. Its TableView
        // wraps the table in `div.tableWrapper` for horizontal scroll.
        // `renderWrapper` stays off so `getHTML()` emits a bare `<table>`.
        // `cellMinWidth` 60 (not 25) keeps a usable content box with
        // border-box cells.
        Table.configure({
            resizable: true,
            handleWidth: 5,
            cellMinWidth: 60,
            lastColumnResizable: true,
        }),
        TableRow,
        // Stock cells plus `backgroundColor` and per-column `wrap` attributes.
        TableCellWithWrap,
        TableHeaderWithWrap,
        // Row/column move commands that @tiptap/extension-table does not expose.
        TableReorder,
        Highlight.configure({ multicolor: true }),
        // Upstream declares no `excludes`, so a run could carry both marks and
        // render as neither. Each now clears the other on apply.
        Superscript.extend({ excludes: 'superscript subscript' }),
        Subscript.extend({ excludes: 'superscript subscript' }),
        // Color, font family and font size are attributes on one TextStyle span,
        // so a run can carry all three without one clobbering another.
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        IndentExtension,
        ...extensions,
        // Last, so match decorations paint above host decorations. It binds no
        // shortcut, so Ctrl+F stays native browser find. The bundled yellow
        // fill matches the first highlight color, so styles are left to the host.
        FindAndReplace.configure({ injectCSS: false }),
    ];
}

export function RichEditor({
    readOnly = false,
    placeholder,
    leadingExtensions,
    codeBlock,
    extensions,
    linkProtocols,
    onOpenLink,
    onChange,
    onEditorReady,
    handlePaste,
    handleDrop,
    scrollContainerRef,
    className = 'rich-editor',
    children,
}: RichEditorProps) {
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onEditorReadyRef = useRef(onEditorReady);
    onEditorReadyRef.current = onEditorReady;
    const onOpenLinkRef = useRef(onOpenLink);
    onOpenLinkRef.current = onOpenLink;
    const handlePasteRef = useRef(handlePaste);
    handlePasteRef.current = handlePaste;
    const handleDropRef = useRef(handleDrop);
    handleDropRef.current = handleDrop;
    const scrollContainerPropRef = useRef(scrollContainerRef);
    scrollContainerPropRef.current = scrollContainerRef;
    // The click handler is captured before `editor` exists; read it at click time.
    const editorInstanceRef = useRef<Editor | null>(null);

    const onUpdate = useCallback(({ editor: ed }: EditorEvents['update']) => {
        if (!readOnlyRef.current) onChangeRef.current?.(ed as Editor);
    }, []);

    const editor = useEditor({
        editable: !readOnly,
        shouldRerenderOnTransaction: true,
        extensions: createRichEditorExtensions({ placeholder, leadingExtensions, codeBlock, extensions, linkProtocols }),
        editorProps: {
            handleClick: (view, pos, event) => {
                if (!(event.ctrlKey || event.metaKey)) return false;
                // A bare `#fragment` is a same-document heading anchor. Handing it
                // to window.open would open a stray window, so it is resolved
                // against the live headings and swallowed even when stale.
                const jumpIfAnchor = (href: string | null | undefined): boolean => {
                    if (!href?.startsWith('#')) return false;
                    const ed = editorInstanceRef.current;
                    if (ed) {
                        jumpToHeadingAnchor(ed, scrollContainerPropRef.current?.current ?? null, href);
                    }
                    return true;
                };
                const open = (href: string): true => {
                    if (!onOpenLinkRef.current?.(href)) openInNewWindow(href);
                    return true;
                };
                const $pos = view.state.doc.resolve(pos);
                const linkMark = $pos.marks().find((m) => m.type.name === 'link');
                const markHref = linkMark?.attrs.href as string | undefined;
                if (markHref) {
                    return jumpIfAnchor(markHref) || open(markHref);
                }
                // Fallback: the DOM target is an <a>. Test the raw attribute for
                // the anchor case — `.href` resolves a fragment against the page.
                const anchor = (event.target as HTMLElement).closest?.('a');
                if (anchor && jumpIfAnchor(anchor.getAttribute('href'))) return true;
                if (anchor?.href) return open(anchor.href);
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
                        // Idempotent write: ProseMirror redraws a link whose
                        // attribute changes, and when the hovered child is an
                        // inline atom the redraw re-fires mouseover. An
                        // unconditional write would loop every frame.
                        const title = getLinkHoverTitle(href);
                        if (anchor.getAttribute('title') !== title) {
                            anchor.setAttribute('title', title);
                        }
                    }
                    return false;
                },
                // A dragover that never calls preventDefault forbids the drop,
                // so mark the editor as a target for external file drags.
                dragover: (_view, event) => {
                    if ((event as DragEvent).dataTransfer?.types.includes('Files')) {
                        event.preventDefault();
                    }
                    return false;
                },
            },
            handlePaste: (view, event) => {
                if (readOnlyRef.current) return true;
                return handlePasteRef.current?.(view, event as ClipboardEvent) ?? false;
            },
            handleDrop: (view, event) => {
                if (readOnlyRef.current) return true;
                return handleDropRef.current?.(view, event as DragEvent) ?? false;
            },
        },
        onUpdate,
    });

    useEffect(() => {
        editor?.setEditable?.(!readOnly, false);
    }, [editor, readOnly]);

    useEffect(() => {
        editorInstanceRef.current = editor ?? null;
        if (editor) onEditorReadyRef.current?.(editor);
    }, [editor]);

    return (
        <>
            <EditorContent editor={editor} className={className} />
            {children}
        </>
    );
}
