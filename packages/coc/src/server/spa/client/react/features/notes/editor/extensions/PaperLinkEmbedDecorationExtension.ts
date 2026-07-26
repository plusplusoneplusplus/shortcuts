/**
 * PaperLinkEmbedDecorationExtension — view-only paper affordances for links.
 *
 * Every link mark in a note whose href qualifies as a paper/PDF link (see
 * {@link classifyPaperLink}, AC-01) gets three small actions appended right
 * after the link text — modelled on the YouTube decoration extension:
 *   - ▸ Open inline — expands an in-place PDF viewer (ingest → pdf.js) below the
 *     link's paragraph; clicking again collapses it. Ephemeral: the expand state
 *     lives only in the plugin, so a reload returns to a plain link (AC-03).
 *   - ⛶ Popout — asks the host (RichEditorCore) to open the paper in a maximized
 *     modal via the `onRequestPopout` option (AC-04).
 *   - New tab — opens the original human-friendly source URL in a new tab/window
 *     via `window.open(href, '_blank', 'noopener,noreferrer')`. The label flips
 *     to "Open in new window" inside the desktop shell (AC-05).
 *
 * This is implemented purely with ProseMirror decorations — it never inserts
 * nodes into the document, so `turndown` save output is the original markdown
 * link, byte-for-byte. Non-paper links get no buttons. Links that live inside an
 * existing `pdfBlock` embed are never decorated (no double-decoration). A link
 * inside a table cell only gets Popout + New tab (inline expansion is hidden).
 *
 * The inline pdf.js viewer itself is provided by the host through the
 * `renderInlineViewer` seam so this extension stays free of React/pdf.js imports
 * and remains unit-testable as plain DOM.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { classifyPaperLink, type PaperLinkInfo } from './paperLink';
import { isDesktopShell } from '../../../../hooks/ui/useDesktopShell';

// ── Options ──────────────────────────────────────────────────────────────────

export interface PaperLinkEmbedOptions {
    /**
     * AC-04: called when the reader clicks ⛶ Popout. The host (RichEditorCore)
     * renders the maximized modal (PdfPopupDialog). Omitted → Popout is a no-op.
     */
    onRequestPopout?: (info: PaperLinkInfo) => void;
    /**
     * AC-03: mount the ephemeral inline pdf.js viewer into `container` for the
     * given paper. Called once when a link's inline view expands; the returned
     * function (if any) is invoked when the view collapses/unmounts so the host
     * can tear down its React root. Omitted → Open inline toggles but renders
     * nothing (wired by AC-03).
     */
    renderInlineViewer?: (
        container: HTMLElement,
        info: PaperLinkInfo,
        onClose: () => void,
    ) => (() => void) | void;
}

interface PaperLinkPluginState {
    /** `from` positions of link runs whose inline viewer is currently expanded. */
    expanded: Set<number>;
    decorations: DecorationSet;
}

// ── Plugin key ───────────────────────────────────────────────────────────────

export const paperLinkEmbedPluginKey = new PluginKey<PaperLinkPluginState>(
    'paperLinkEmbedDecoration',
);

// ── Pure DOM builders (unit-testable, no editor host) ─────────────────────────

export interface PaperLinkButtonsOptions {
    info: PaperLinkInfo;
    /** Hide the inline button (Popout + New tab only) when inside a table cell. */
    insideTable: boolean;
    /** True when the inline viewer is currently expanded (flips the inline label). */
    expanded?: boolean;
    /** True inside the Electron desktop shell — flips the New tab label (AC-05). */
    desktopShell?: boolean;
    onInline: () => void;
    onPopout: () => void;
    onNewTab: () => void;
}

/**
 * Build the action group appended after a paper link. `contentEditable=false` so
 * it never interferes with typing/caret. Inside a table cell the inline button is
 * omitted (Popout + New tab only).
 */
export function buildPaperLinkButtons(opts: PaperLinkButtonsOptions): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'paper-embed-buttons';
    wrap.setAttribute('contenteditable', 'false');
    wrap.setAttribute('data-paper-href', opts.info.href);

    // Keep the editor caret put — a button mousedown must not move selection.
    const noSelect = (btn: HTMLButtonElement) =>
        btn.addEventListener('mousedown', (event) => event.preventDefault());

    if (!opts.insideTable) {
        const inlineBtn = document.createElement('button');
        inlineBtn.type = 'button';
        inlineBtn.className = 'paper-embed-btn paper-embed-btn-inline';
        inlineBtn.textContent = opts.expanded ? '▾ Hide inline' : '▸ Open inline';
        inlineBtn.setAttribute(
            'aria-label',
            opts.expanded ? 'Hide inline paper viewer' : 'Open paper inline',
        );
        inlineBtn.setAttribute('aria-pressed', opts.expanded ? 'true' : 'false');
        noSelect(inlineBtn);
        inlineBtn.addEventListener('click', (event) => {
            event.preventDefault();
            opts.onInline();
        });
        wrap.appendChild(inlineBtn);
    }

    const popoutBtn = document.createElement('button');
    popoutBtn.type = 'button';
    popoutBtn.className = 'paper-embed-btn paper-embed-btn-popout';
    popoutBtn.textContent = '⛶ Popout';
    popoutBtn.setAttribute('aria-label', 'Open paper in a maximized popout');
    noSelect(popoutBtn);
    popoutBtn.addEventListener('click', (event) => {
        event.preventDefault();
        opts.onPopout();
    });
    wrap.appendChild(popoutBtn);

    const newTabBtn = document.createElement('button');
    newTabBtn.type = 'button';
    newTabBtn.className = 'paper-embed-btn paper-embed-btn-newtab';
    newTabBtn.textContent = opts.desktopShell ? 'Open in new window' : 'New tab';
    newTabBtn.setAttribute(
        'aria-label',
        opts.desktopShell ? 'Open paper in a new window' : 'Open paper in a new tab',
    );
    noSelect(newTabBtn);
    newTabBtn.addEventListener('click', (event) => {
        event.preventDefault();
        opts.onNewTab();
    });
    wrap.appendChild(newTabBtn);

    return wrap;
}

// ── Doc scanning ──────────────────────────────────────────────────────────────

export interface PaperLinkRun {
    info: PaperLinkInfo;
    /** Inclusive start position of the link-mark run. */
    from: number;
    /** Exclusive end position of the link-mark run (where the buttons attach). */
    to: number;
    /** True when the run resolves inside a `tableCell` / `tableHeader`. */
    insideTable: boolean;
    /** Position just after the run's block, where the inline viewer attaches. */
    blockAfterPos: number;
}

/** Walk `$pos` ancestors looking for a table cell/header. */
function isInsideTableCell($pos: ResolvedPos): boolean {
    for (let depth = $pos.depth; depth > 0; depth--) {
        const name = $pos.node(depth).type.name;
        if (name === 'tableCell' || name === 'tableHeader') return true;
    }
    return false;
}

/**
 * Walk `$pos` ancestors looking for a `pdfBlock` node. A link that lives inside
 * an existing PDF embed must never be paper-decorated (no double-decoration).
 * `pdfBlock` is an atom node today, so this is belt-and-suspenders, but it keeps
 * the guard robust if the embed ever gains link-bearing content.
 */
function isInsidePdfBlock($pos: ResolvedPos): boolean {
    for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === 'pdfBlock') return true;
    }
    return false;
}

/** Position immediately after the block containing `$pos` (for the inline viewer). */
function blockAfter($pos: ResolvedPos): number {
    return $pos.depth >= 1 ? $pos.after($pos.depth) : $pos.pos;
}

/**
 * Find every contiguous paper link-mark run in the document. Adjacent text nodes
 * carrying the same href are merged into a single run so a split link (e.g. partly
 * bold) gets one button group, not one per text node. Runs inside a `pdfBlock`
 * are skipped.
 */
export function findPaperLinkRuns(doc: PMNode): PaperLinkRun[] {
    const runs: PaperLinkRun[] = [];
    let current: { href: string; info: PaperLinkInfo; from: number; to: number } | null = null;

    const flush = () => {
        if (!current) return;
        const $from = doc.resolve(current.from);
        if (!isInsidePdfBlock($from)) {
            runs.push({
                info: current.info,
                from: current.from,
                to: current.to,
                insideTable: isInsideTableCell($from),
                blockAfterPos: blockAfter($from),
            });
        }
        current = null;
    };

    doc.descendants((node, pos) => {
        if (node.isText) {
            const linkMark = node.marks.find((m) => m.type.name === 'link');
            const href = typeof linkMark?.attrs?.href === 'string' ? linkMark.attrs.href : null;
            const info = href ? classifyPaperLink(href) : null;
            if (href && info) {
                if (current && current.href === href && current.to === pos) {
                    current.to = pos + node.nodeSize;
                } else {
                    flush();
                    current = { href, info, from: pos, to: pos + node.nodeSize };
                }
            } else {
                flush();
            }
            return false; // text nodes have no block children to descend into
        }
        // Any non-text node breaks a link run (links never span block boundaries).
        flush();
        return true;
    });
    flush();

    return runs;
}

// ── Decoration building ───────────────────────────────────────────────────────

function buildDecorations(
    doc: PMNode,
    expanded: Set<number>,
    options: PaperLinkEmbedOptions,
): DecorationSet {
    const decorations: Decoration[] = [];
    const desktopShell = isDesktopShell();

    for (const run of findPaperLinkRuns(doc)) {
        const isExpanded = expanded.has(run.from);

        decorations.push(
            Decoration.widget(
                run.to,
                (view: EditorView) =>
                    buildPaperLinkButtons({
                        info: run.info,
                        insideTable: run.insideTable,
                        expanded: isExpanded,
                        desktopShell,
                        onInline: () => {
                            const tr = view.state.tr.setMeta(paperLinkEmbedPluginKey, {
                                type: 'toggleInline',
                                pos: run.from,
                            });
                            view.dispatch(tr);
                        },
                        onPopout: () => options.onRequestPopout?.(run.info),
                        onNewTab: () =>
                            window.open(run.info.href, '_blank', 'noopener,noreferrer'),
                    }),
                {
                    side: 1,
                    ignoreSelection: true,
                    key: `paper-btn-${run.from}-${isExpanded ? 'x' : 'c'}-${run.insideTable ? 't' : 'f'}`,
                },
            ),
        );

        if (isExpanded && !run.insideTable && options.renderInlineViewer) {
            const info = run.info;
            const fromPos = run.from;
            decorations.push(
                Decoration.widget(
                    run.blockAfterPos,
                    (view: EditorView) => {
                        const container = document.createElement('div');
                        container.className = 'paper-embed-inline';
                        container.setAttribute('contenteditable', 'false');
                        const collapse = () => {
                            const tr = view.state.tr.setMeta(paperLinkEmbedPluginKey, {
                                type: 'toggleInline',
                                pos: fromPos,
                            });
                            view.dispatch(tr);
                        };
                        const cleanup = options.renderInlineViewer?.(container, info, collapse);
                        if (cleanup) (container as any).__paperInlineCleanup = cleanup;
                        return container;
                    },
                    {
                        side: 1,
                        key: `paper-inline-${run.from}`,
                        destroy: (node) => {
                            const cleanup = (node as any)?.__paperInlineCleanup;
                            if (typeof cleanup === 'function') cleanup();
                        },
                    },
                ),
            );
        }
    }

    return DecorationSet.create(doc, decorations);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const PaperLinkEmbedDecorationExtension = Extension.create<PaperLinkEmbedOptions>({
    name: 'paperLinkEmbedDecoration',

    addOptions() {
        return {
            onRequestPopout: undefined,
            renderInlineViewer: undefined,
        };
    },

    addProseMirrorPlugins() {
        const options = this.options;

        return [
            new Plugin<PaperLinkPluginState>({
                key: paperLinkEmbedPluginKey,

                state: {
                    init(_config, state): PaperLinkPluginState {
                        const expanded = new Set<number>();
                        return {
                            expanded,
                            decorations: buildDecorations(state.doc, expanded, options),
                        };
                    },

                    apply(tr, pluginState, _oldState, newState): PaperLinkPluginState {
                        const meta = tr.getMeta(paperLinkEmbedPluginKey);

                        if (meta?.type === 'toggleInline') {
                            const expanded = new Set(pluginState.expanded);
                            if (expanded.has(meta.pos)) expanded.delete(meta.pos);
                            else expanded.add(meta.pos);
                            return {
                                expanded,
                                decorations: buildDecorations(newState.doc, expanded, options),
                            };
                        }

                        if (tr.docChanged) {
                            // Remap expanded anchors, then rescan the new doc (links may
                            // have been added/removed, so we can't just map decorations).
                            const expanded = new Set<number>();
                            for (const pos of pluginState.expanded) {
                                expanded.add(tr.mapping.map(pos, -1));
                            }
                            return {
                                expanded,
                                decorations: buildDecorations(newState.doc, expanded, options),
                            };
                        }

                        return pluginState;
                    },
                },

                props: {
                    decorations(state) {
                        return (
                            paperLinkEmbedPluginKey.getState(state)?.decorations ??
                            DecorationSet.empty
                        );
                    },
                },
            }),
        ];
    },
});
