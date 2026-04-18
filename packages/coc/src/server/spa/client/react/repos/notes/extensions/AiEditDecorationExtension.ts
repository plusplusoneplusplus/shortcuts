/**
 * AiEditDecorationExtension — Tiptap extension for ephemeral AI edit decorations.
 *
 * Renders word-level git-style diff decorations for AI-applied edits:
 * - Added words: green highlight (class `ai-edit-added`)
 * - Removed words: ghost widgets with red strikethrough (class `ai-edit-removed`)
 *
 * Decorations auto-clear after `expiresAt` or on the next user keypress.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { DiffChunk } from './noteEditDiff';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AiEditRegion {
    id: string;
    /** Start position of the region in the editor document. */
    from: number;
    /** End position of the region in the editor document (exclusive). */
    to: number;
    /** Word diff chunks covering the `from..to` range. */
    chunks: DiffChunk[];
    /** Epoch ms at which decorations should auto-clear. */
    expiresAt: number;
}

interface AiEditPluginState {
    regions: AiEditRegion[];
    decorations: DecorationSet;
}

// ── Plugin key ───────────────────────────────────────────────────────────────

export const aiEditPluginKey = new PluginKey<AiEditPluginState>('aiEditDecoration');

// ── Decoration builder ───────────────────────────────────────────────────────

function buildDecorations(regions: AiEditRegion[], doc: any): DecorationSet {
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
                            class: 'ai-edit-added',
                        }),
                    );
                }
                cursor += len;
            } else if (chunk.type === 'remove') {
                // Ghost widget: inserted at the current cursor position (before add/equal text)
                const ghost = document.createElement('span');
                ghost.className = 'ai-edit-removed';
                ghost.textContent = chunk.text;
                decorations.push(
                    Decoration.widget(Math.min(cursor, region.to), ghost, {
                        side: -1,
                        key: `removed-${region.id}-${cursor}`,
                    }),
                );
                // Removed text is not in the new doc — don't advance cursor
            }
        }
    }

    return DecorationSet.create(doc, decorations);
}

// ── Extension ────────────────────────────────────────────────────────────────

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        aiEditDecoration: {
            /** Apply AI edit decorations. Replaces any existing decorations. */
            setAiEdits: (regions: AiEditRegion[]) => ReturnType;
            /** Clear all AI edit decorations immediately. */
            clearAiEdits: () => ReturnType;
        };
    }
}

export const AiEditDecorationExtension = Extension.create({
    name: 'aiEditDecoration',

    addCommands() {
        return {
            setAiEdits:
                (regions: AiEditRegion[]) =>
                    ({ tr, dispatch, state }) => {
                        if (dispatch) {
                            tr.setMeta(aiEditPluginKey, { action: 'set', regions });
                            dispatch(tr);
                        }
                        return true;
                    },
            clearAiEdits:
                () =>
                    ({ tr, dispatch }) => {
                        if (dispatch) {
                            tr.setMeta(aiEditPluginKey, { action: 'clear' });
                            dispatch(tr);
                        }
                        return true;
                    },
        };
    },

    addProseMirrorPlugins() {
        const rafIds = new Map<string, number>();

        return [
            new Plugin<AiEditPluginState>({
                key: aiEditPluginKey,

                state: {
                    init(): AiEditPluginState {
                        return { regions: [], decorations: DecorationSet.empty };
                    },

                    apply(tr, pluginState, _oldState, newState): AiEditPluginState {
                        const meta = tr.getMeta(aiEditPluginKey);

                        if (meta?.action === 'set') {
                            const regions: AiEditRegion[] = meta.regions;
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
                        return aiEditPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },
                },

                view() {
                    return {
                        update(view) {
                            const pluginState = aiEditPluginKey.getState(view.state);
                            if (!pluginState || pluginState.regions.length === 0) return;

                            // Schedule auto-expiry RAF for each region
                            for (const region of pluginState.regions) {
                                if (rafIds.has(region.id)) continue;
                                const delay = region.expiresAt - Date.now();
                                if (delay <= 0) {
                                    // Already expired — clear immediately
                                    const tr = view.state.tr.setMeta(aiEditPluginKey, { action: 'clear' });
                                    view.dispatch(tr);
                                    return;
                                }
                                const id = setTimeout(() => {
                                    rafIds.delete(region.id);
                                    if (!view.isDestroyed) {
                                        const clearTr = view.state.tr.setMeta(aiEditPluginKey, { action: 'clear' });
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
