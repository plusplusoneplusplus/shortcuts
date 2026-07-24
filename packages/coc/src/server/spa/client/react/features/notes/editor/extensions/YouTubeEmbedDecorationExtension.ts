/**
 * YouTubeEmbedDecorationExtension — view-only play buttons for YouTube links.
 *
 * Every link mark in a note whose href is a recognized YouTube URL gets two
 * small buttons appended right after the link text:
 *   - ▶ Play inline — expands a 16:9 `youtube-nocookie` player (no autoplay)
 *     below the link's paragraph; clicking again collapses it.
 *   - ⛶ Popup — asks the host (RichEditorCore) to open the video in a Dialog
 *     via the `onRequestPopup` option; the popup player autoplays.
 *
 * This is implemented purely with ProseMirror decorations — it never inserts
 * nodes into the document, so `turndown` save output is the original markdown
 * link, byte-for-byte. Non-YouTube links get no buttons. A link that resolves
 * inside a table cell only gets the Popup button (inline expansion is hidden).
 *
 * See {@link parseYouTubeVideoId} / {@link youTubeEmbedUrl} in forge for the
 * URL detection + privacy-mode embed-URL builder shared with the rest of the app.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { parseYouTubeVideoId, youTubeEmbedUrl } from '@plusplusoneplusplus/forge/editor/rendering';

// ── Options ──────────────────────────────────────────────────────────────────

export interface YouTubeEmbedOptions {
    /**
     * Called when the reader clicks the ⛶ Popup button. The host renders the
     * popup player (a Dialog with an autoplaying nocookie iframe). Omitted →
     * the Popup button is a no-op.
     */
    onRequestPopup?: (videoId: string) => void;
}

interface YouTubePluginState {
    /** `from` positions of link runs whose inline player is currently expanded. */
    expanded: Set<number>;
    decorations: DecorationSet;
}

// ── Plugin key ───────────────────────────────────────────────────────────────

export const youTubeEmbedPluginKey = new PluginKey<YouTubePluginState>('youTubeEmbedDecoration');

// ── Pure DOM builders (unit-testable, no editor host) ─────────────────────────

export interface YouTubeButtonsOptions {
    videoId: string;
    /** Hide the inline button (popup-only) when the link lives in a table cell. */
    insideTable: boolean;
    /** True when the inline player is currently expanded (flips the inline label). */
    expanded?: boolean;
    onInline: () => void;
    onPopup: () => void;
}

/**
 * Build the button group appended after a YouTube link. `contentEditable=false`
 * so it never interferes with typing/caret. Inside a table cell only the Popup
 * button is rendered.
 */
export function buildYouTubeButtons(opts: YouTubeButtonsOptions): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'yt-embed-buttons';
    wrap.setAttribute('contenteditable', 'false');
    wrap.setAttribute('data-yt-video-id', opts.videoId);

    if (!opts.insideTable) {
        const inlineBtn = document.createElement('button');
        inlineBtn.type = 'button';
        inlineBtn.className = 'yt-embed-btn yt-embed-btn-inline';
        inlineBtn.textContent = opts.expanded ? '▶ Hide inline' : '▶ Play inline';
        inlineBtn.setAttribute(
            'aria-label',
            opts.expanded ? 'Hide inline YouTube player' : 'Play YouTube video inline',
        );
        inlineBtn.setAttribute('aria-pressed', opts.expanded ? 'true' : 'false');
        // Keep the editor caret put — a button mousedown must not move selection.
        inlineBtn.addEventListener('mousedown', (event) => event.preventDefault());
        inlineBtn.addEventListener('click', (event) => {
            event.preventDefault();
            opts.onInline();
        });
        wrap.appendChild(inlineBtn);
    }

    const popupBtn = document.createElement('button');
    popupBtn.type = 'button';
    popupBtn.className = 'yt-embed-btn yt-embed-btn-popup';
    popupBtn.textContent = '⛶ Popup';
    popupBtn.setAttribute('aria-label', 'Play YouTube video in a popup');
    popupBtn.addEventListener('mousedown', (event) => event.preventDefault());
    popupBtn.addEventListener('click', (event) => {
        event.preventDefault();
        opts.onPopup();
    });
    wrap.appendChild(popupBtn);

    return wrap;
}

/**
 * Build the inline 16:9 player. Uses `youtube-nocookie.com` and never autoplays
 * (that distinguishes it from the popup player). Sandboxed like the map embed.
 */
export function buildInlinePlayer(videoId: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'yt-embed-inline';
    wrap.setAttribute('contenteditable', 'false');
    wrap.setAttribute('data-yt-video-id', videoId);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'yt-embed-inline-frame-wrap';

    const iframe = document.createElement('iframe');
    iframe.className = 'yt-embed-inline-frame';
    iframe.src = youTubeEmbedUrl(videoId); // no autoplay for the inline player
    iframe.title = 'YouTube video player';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
    iframe.setAttribute('allowfullscreen', 'true');

    frameWrap.appendChild(iframe);
    wrap.appendChild(frameWrap);
    return wrap;
}

// ── Doc scanning ──────────────────────────────────────────────────────────────

interface YouTubeLinkRun {
    videoId: string;
    /** Inclusive start position of the link-mark run. */
    from: number;
    /** Exclusive end position of the link-mark run (where the buttons attach). */
    to: number;
    /** True when the run resolves inside a `tableCell` / `tableHeader`. */
    insideTable: boolean;
    /** Position just after the run's block, where the inline player attaches. */
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

/** Position immediately after the block containing `$pos` (for the inline player). */
function blockAfter($pos: ResolvedPos): number {
    return $pos.depth >= 1 ? $pos.after($pos.depth) : $pos.pos;
}

/**
 * Find every contiguous YouTube link-mark run in the document. Adjacent text
 * nodes carrying the same href are merged into a single run so a split link
 * (e.g. partly bold) gets one button group, not one per text node.
 */
export function findYouTubeLinkRuns(doc: PMNode): YouTubeLinkRun[] {
    const runs: YouTubeLinkRun[] = [];
    let current: { href: string; videoId: string; from: number; to: number } | null = null;

    const flush = () => {
        if (!current) return;
        const $from = doc.resolve(current.from);
        runs.push({
            videoId: current.videoId,
            from: current.from,
            to: current.to,
            insideTable: isInsideTableCell($from),
            blockAfterPos: blockAfter($from),
        });
        current = null;
    };

    doc.descendants((node, pos) => {
        if (node.isText) {
            const linkMark = node.marks.find((m) => m.type.name === 'link');
            const href = typeof linkMark?.attrs?.href === 'string' ? linkMark.attrs.href : null;
            const videoId = href ? parseYouTubeVideoId(href) : null;
            if (href && videoId) {
                if (current && current.href === href && current.to === pos) {
                    current.to = pos + node.nodeSize;
                } else {
                    flush();
                    current = { href, videoId, from: pos, to: pos + node.nodeSize };
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
    options: YouTubeEmbedOptions,
): DecorationSet {
    const decorations: Decoration[] = [];

    for (const run of findYouTubeLinkRuns(doc)) {
        const isExpanded = expanded.has(run.from);

        decorations.push(
            Decoration.widget(
                run.to,
                (view: EditorView) =>
                    buildYouTubeButtons({
                        videoId: run.videoId,
                        insideTable: run.insideTable,
                        expanded: isExpanded,
                        onInline: () => {
                            const tr = view.state.tr.setMeta(youTubeEmbedPluginKey, {
                                type: 'toggleInline',
                                pos: run.from,
                            });
                            view.dispatch(tr);
                        },
                        onPopup: () => options.onRequestPopup?.(run.videoId),
                    }),
                {
                    side: 1,
                    ignoreSelection: true,
                    key: `yt-btn-${run.from}-${run.videoId}-${isExpanded ? 'x' : 'c'}-${run.insideTable ? 't' : 'f'}`,
                },
            ),
        );

        if (isExpanded && !run.insideTable) {
            decorations.push(
                Decoration.widget(run.blockAfterPos, () => buildInlinePlayer(run.videoId), {
                    side: 1,
                    key: `yt-inline-${run.from}-${run.videoId}`,
                }),
            );
        }
    }

    return DecorationSet.create(doc, decorations);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const YouTubeEmbedDecorationExtension = Extension.create<YouTubeEmbedOptions>({
    name: 'youTubeEmbedDecoration',

    addOptions() {
        return {
            onRequestPopup: undefined,
        };
    },

    addProseMirrorPlugins() {
        const options = this.options;

        return [
            new Plugin<YouTubePluginState>({
                key: youTubeEmbedPluginKey,

                state: {
                    init(_config, state): YouTubePluginState {
                        const expanded = new Set<number>();
                        return { expanded, decorations: buildDecorations(state.doc, expanded, options) };
                    },

                    apply(tr, pluginState, _oldState, newState): YouTubePluginState {
                        const meta = tr.getMeta(youTubeEmbedPluginKey);

                        if (meta?.type === 'toggleInline') {
                            const expanded = new Set(pluginState.expanded);
                            if (expanded.has(meta.pos)) expanded.delete(meta.pos);
                            else expanded.add(meta.pos);
                            return { expanded, decorations: buildDecorations(newState.doc, expanded, options) };
                        }

                        if (tr.docChanged) {
                            // Remap expanded anchors, then rescan the new doc (links may
                            // have been added/removed, so we can't just map decorations).
                            const expanded = new Set<number>();
                            for (const pos of pluginState.expanded) {
                                expanded.add(tr.mapping.map(pos, -1));
                            }
                            return { expanded, decorations: buildDecorations(newState.doc, expanded, options) };
                        }

                        return pluginState;
                    },
                },

                props: {
                    decorations(state) {
                        return youTubeEmbedPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },
                },
            }),
        ];
    },
});
