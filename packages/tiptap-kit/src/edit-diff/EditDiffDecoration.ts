/**
 * EditDiffDecoration — Tiptap extension for ephemeral word-diff decorations.
 *
 * Renders word-level git-style diff decorations for programmatic edits (for
 * example, edits an assistant applied):
 * - Added words: inline decoration with class `edit-diff-added`
 * - Removed words: ghost widgets with class `edit-diff-removed`; long removals
 *   become a collapsible `edit-diff-deleted-block`
 *
 * The package ships no CSS for these classes; the host styles them.
 * Decorations auto-clear after `expiresAt` or on the next document change.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { DiffChunk } from './wordDiff.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EditDiffRegion {
    id: string;
    /** Start position of the region in the editor document. */
    from: number;
    /** End position of the region in the editor document (exclusive). */
    to: number;
    /** Word diff chunks covering the `from..to` range. */
    chunks: DiffChunk[];
    /** Optional epoch ms at which decorations should auto-clear. Omit for persistent decorations. */
    expiresAt?: number;
}

interface EditDiffPluginState {
    regions: EditDiffRegion[];
    decorations: DecorationSet;
}

// ── Plugin key ───────────────────────────────────────────────────────────────

export const editDiffPluginKey = new PluginKey<EditDiffPluginState>('editDiffDecoration');

// ── Collapsible deleted block widget ──────────────────────────────────────────

const INLINE_DELETE_THRESHOLD = 80;

function buildDeletedBlock(text: string, key: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'edit-diff-deleted-block';
    wrapper.setAttribute('data-key', key);

    const header = document.createElement('div');
    header.className = 'edit-diff-deleted-header';
    header.textContent = '⊘ Deleted content ▼';

    const body = document.createElement('div');
    body.className = 'edit-diff-deleted-body';
    const inner = document.createElement('span');
    inner.className = 'edit-diff-removed';
    inner.textContent = text;
    body.appendChild(inner);

    header.addEventListener('click', () => {
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? 'block' : 'none';
        header.textContent = collapsed ? '⊘ Deleted content ▼' : '⊘ Deleted content ▶';
    });

    wrapper.appendChild(header);
    wrapper.appendChild(body);
    return wrapper;
}

// ── Decoration builder ───────────────────────────────────────────────────────

function buildDecorations(regions: EditDiffRegion[], doc: any): DecorationSet {
    const decorations: Decoration[] = [];

    for (const region of regions) {
        let cursor = region.from;

        for (const chunk of region.chunks) {
            const len = chunk.text.length;

            if (chunk.type === 'equal') {
                cursor += len;
            } else if (chunk.type === 'add') {
                const chunkEnd = Math.min(cursor + len, region.to);
                if (cursor < chunkEnd) {
                    decorations.push(
                        Decoration.inline(cursor, chunkEnd, {
                            class: 'edit-diff-added',
                        }),
                    );
                }
                cursor += len;
            } else if (chunk.type === 'remove') {
                const pos = Math.min(cursor, region.to);
                if (chunk.text.length > INLINE_DELETE_THRESHOLD) {
                    const widget = buildDeletedBlock(chunk.text, `removed-block-${region.id}-${cursor}`);
                    decorations.push(
                        Decoration.widget(pos, widget, {
                            side: -1,
                            key: `removed-block-${region.id}-${cursor}`,
                        }),
                    );
                } else {
                    const ghost = document.createElement('span');
                    ghost.className = 'edit-diff-removed';
                    ghost.textContent = chunk.text;
                    decorations.push(
                        Decoration.widget(pos, ghost, {
                            side: -1,
                            key: `removed-${region.id}-${cursor}`,
                        }),
                    );
                }
                // Removed text is not in the new doc — don't advance cursor
            }
        }
    }

    return DecorationSet.create(doc, decorations);
}

// ── Extension ────────────────────────────────────────────────────────────────

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        editDiffDecoration: {
            /** Apply edit-diff decorations. Replaces any existing decorations. */
            setEditDiffs: (regions: EditDiffRegion[]) => ReturnType;
            /** Clear all edit-diff decorations immediately. */
            clearEditDiffs: () => ReturnType;
        };
    }
}

export const EditDiffDecoration = Extension.create({
    name: 'editDiffDecoration',

    addCommands() {
        return {
            setEditDiffs:
                (regions: EditDiffRegion[]) =>
                    ({ tr, dispatch, state }) => {
                        if (dispatch) {
                            tr.setMeta(editDiffPluginKey, { action: 'set', regions });
                            dispatch(tr);
                        }
                        return true;
                    },
            clearEditDiffs:
                () =>
                    ({ tr, dispatch }) => {
                        if (dispatch) {
                            tr.setMeta(editDiffPluginKey, { action: 'clear' });
                            dispatch(tr);
                        }
                        return true;
                    },
        };
    },

    addProseMirrorPlugins() {
        const rafIds = new Map<string, number>();

        return [
            new Plugin<EditDiffPluginState>({
                key: editDiffPluginKey,

                state: {
                    init(): EditDiffPluginState {
                        return { regions: [], decorations: DecorationSet.empty };
                    },

                    apply(tr, pluginState, _oldState, newState): EditDiffPluginState {
                        const meta = tr.getMeta(editDiffPluginKey);

                        if (meta?.action === 'set') {
                            const regions: EditDiffRegion[] = meta.regions;
                            return {
                                regions,
                                decorations: buildDecorations(regions, newState.doc),
                            };
                        }

                        if (meta?.action === 'clear' || tr.docChanged) {
                            // User typed or explicit clear
                            return { regions: [], decorations: DecorationSet.empty };
                        }

                        // Map decorations through document changes
                        return {
                            regions: pluginState.regions,
                            decorations: pluginState.decorations.map(tr.mapping, newState.doc),
                        };
                    },
                },

                props: {
                    decorations(state) {
                        return editDiffPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },
                },

                view() {
                    return {
                        update(view) {
                            const pluginState = editDiffPluginKey.getState(view.state);
                            if (!pluginState || pluginState.regions.length === 0) return;

                            // Schedule auto-expiry RAF for each region
                            for (const region of pluginState.regions) {
                                if (region.expiresAt === undefined) continue;
                                if (rafIds.has(region.id)) continue;
                                const delay = region.expiresAt - Date.now();
                                if (delay <= 0) {
                                    // Already expired — clear immediately
                                    const tr = view.state.tr.setMeta(editDiffPluginKey, { action: 'clear' });
                                    view.dispatch(tr);
                                    return;
                                }
                                const id = setTimeout(() => {
                                    rafIds.delete(region.id);
                                    if (!view.isDestroyed) {
                                        const clearTr = view.state.tr.setMeta(editDiffPluginKey, { action: 'clear' });
                                        view.dispatch(clearTr);
                                    }
                                }, delay) as unknown as number;
                                rafIds.set(region.id, id);
                            }
                        },
                        destroy() {
                            for (const id of rafIds.values()) clearTimeout(id);
                            rafIds.clear();
                        },
                    };
                },
            }),
        ];
    },
});
