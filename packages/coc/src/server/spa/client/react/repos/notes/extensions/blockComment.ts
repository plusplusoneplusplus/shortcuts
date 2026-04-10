import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const blockCommentPluginKey = new PluginKey('blockComment');

export interface BlockCommentOptions {
    onBlockCommentActivated: (commentId: string | null) => void;
}

export interface BlockCommentStorage {
    activeBlockCommentId: string | null;
}

interface BlockCommentPluginState {
    comments: Map<string, number[]>;
    decorations: DecorationSet;
}

type BlockCommentMeta =
    | { action: 'add'; commentId: string; pos: number }
    | { action: 'remove'; commentId: string };

function buildDecorations(
    comments: Map<string, number[]>,
    doc: { nodeAt(pos: number): { nodeSize: number } | null; content: { size: number } },
): DecorationSet {
    const decorations: Decoration[] = [];
    for (const [commentId, positions] of comments) {
        for (const pos of positions) {
            const node = doc.nodeAt(pos);
            if (!node) continue;
            decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                    class: 'block-comment',
                    'data-block-comment-id': commentId,
                }),
            );
        }
    }
    return DecorationSet.create(doc as never, decorations);
}

export const BlockCommentExtension = Extension.create<BlockCommentOptions, BlockCommentStorage>({
    name: 'blockComment',

    addOptions() {
        return {
            onBlockCommentActivated: () => {},
        };
    },

    addStorage() {
        return {
            activeBlockCommentId: null,
        };
    },

    addCommands() {
        return {
            setBlockComment:
                (commentId: string) =>
                    ({ tr, dispatch }) => {
                        if (!commentId) return false;
                        const { $from } = tr.selection;
                        // Walk up to find the top-level block node (depth 1)
                        let depth = $from.depth;
                        while (depth > 1) depth--;
                        const pos = $from.before(depth);
                        if (dispatch) {
                            tr.setMeta(blockCommentPluginKey, {
                                action: 'add',
                                commentId,
                                pos,
                            } satisfies BlockCommentMeta);
                            dispatch(tr);
                        }
                        return true;
                    },

            unsetBlockComment:
                (commentId: string) =>
                    ({ tr, dispatch }) => {
                        if (dispatch) {
                            tr.setMeta(blockCommentPluginKey, {
                                action: 'remove',
                                commentId,
                            } satisfies BlockCommentMeta);
                            dispatch(tr);
                        }
                        return true;
                    },
        };
    },

    addProseMirrorPlugins() {
        const extensionThis = this;

        return [
            new Plugin<BlockCommentPluginState>({
                key: blockCommentPluginKey,

                state: {
                    init(_, state) {
                        return {
                            comments: new Map(),
                            decorations: DecorationSet.create(state.doc as never, []),
                        };
                    },

                    apply(tr, oldPluginState, _oldEditorState, newEditorState) {
                        const meta = tr.getMeta(blockCommentPluginKey) as BlockCommentMeta | undefined;
                        let { comments } = oldPluginState;

                        if (meta) {
                            // Clone so we don't mutate the old state
                            comments = new Map(comments);
                            if (meta.action === 'add') {
                                const existing = comments.get(meta.commentId) ?? [];
                                comments.set(meta.commentId, [...existing, meta.pos]);
                            } else if (meta.action === 'remove') {
                                comments.delete(meta.commentId);
                            }
                        } else if (tr.docChanged) {
                            // Remap positions through the transaction mapping
                            const remapped = new Map<string, number[]>();
                            for (const [id, positions] of comments) {
                                const newPositions: number[] = [];
                                for (const pos of positions) {
                                    const mapped = tr.mapping.map(pos);
                                    if (mapped >= 0 && mapped < newEditorState.doc.content.size) {
                                        newPositions.push(mapped);
                                    }
                                }
                                if (newPositions.length > 0) {
                                    remapped.set(id, newPositions);
                                }
                            }
                            comments = remapped;
                        } else if (!meta) {
                            // No doc change and no meta — state unchanged
                            return oldPluginState;
                        }

                        return {
                            comments,
                            decorations: buildDecorations(comments, newEditorState.doc),
                        };
                    },
                },

                props: {
                    decorations(state) {
                        return blockCommentPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },
                },
            }),
        ];

        void extensionThis; // referenced for onSelectionUpdate below
    },

    onSelectionUpdate() {
        const { editor } = this;
        const pluginState = blockCommentPluginKey.getState(editor.state) as BlockCommentPluginState | undefined;
        if (!pluginState) return;

        const { $from } = editor.state.selection;
        let foundId: string | null = null;

        // Walk up from cursor depth to depth 1 looking for a block comment
        for (let depth = $from.depth; depth >= 1; depth--) {
            const pos = $from.before(depth);
            for (const [commentId, positions] of pluginState.comments) {
                if (positions.includes(pos)) {
                    foundId = commentId;
                    break;
                }
            }
            if (foundId) break;
        }

        if (foundId !== this.storage.activeBlockCommentId) {
            this.storage.activeBlockCommentId = foundId;
            this.options.onBlockCommentActivated(foundId);
        }
    },
});
