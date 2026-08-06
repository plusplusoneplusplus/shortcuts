/**
 * useCanvasComments — text selection anchoring, comment CRUD, and the
 * "send open comments to the AI" batch.
 *
 * Selection lives here because both selection actions (Ask AI / Comment) are
 * comment-adjacent: the anchor text of a new comment IS the current selection.
 * Delivery uses the caller-supplied `onSendToAi` (the normal follow-up path),
 * so a busy AI receives the batch at the next turn boundary; comments are only
 * marked `sent` once the message is accepted.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Canvas, CanvasComment, CocClient } from '@plusplusoneplusplus/coc-client';
import { buildAskAiPrompt, buildCommentsMessage } from '../canvas-panel-model';

export interface UseCanvasCommentsOptions {
    client: CocClient;
    workspaceId: string;
    canvasId: string;
    canvas: Canvas | null;
    canvasRef: React.MutableRefObject<Canvas | null>;
    /** Bumped by useCanvasRecord after each successful load. */
    loadNonce: number;
    /** Prefills the chat composer with a selection-targeted edit prompt. */
    onAskAi?: (prompt: string) => void;
    /** Sends a message to the AI through the normal follow-up path. */
    onSendToAi?: (message: string) => Promise<void>;
}

export interface CanvasComments {
    comments: CanvasComment[];
    openComments: CanvasComment[];
    selection: string | null;
    setSelection: (text: string | null) => void;
    commentAnchor: string | null;
    commentDraft: string;
    setCommentDraft: (text: string) => void;
    sendingComments: boolean;
    askAi: () => void;
    startComment: () => void;
    cancelComment: () => void;
    submitComment: () => Promise<void>;
    deleteComment: (commentId: string) => Promise<void>;
    sendComments: () => Promise<void>;
}

export function useCanvasComments({
    client, workspaceId, canvasId, canvas, canvasRef, loadNonce, onAskAi, onSendToAi,
}: UseCanvasCommentsOptions): CanvasComments {
    const [comments, setComments] = useState<CanvasComment[]>([]);
    const [selection, setSelection] = useState<string | null>(null);
    const [commentAnchor, setCommentAnchor] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState('');
    const [sendingComments, setSendingComments] = useState(false);

    // Reset on canvas switch, before any fetch for the new canvas lands.
    useEffect(() => {
        setSelection(null);
        setCommentAnchor(null);
        setCommentDraft('');
        setComments([]);
    }, [workspaceId, canvasId]);

    useEffect(() => {
        if (loadNonce === 0) return;
        client.canvases.listComments(workspaceId, canvasId)
            .then(setComments)
            .catch(() => { /* comments are best-effort */ });
    }, [workspaceId, canvasId, loadNonce]);

    const askAi = useCallback(() => {
        if (!canvas || !selection || !onAskAi) return;
        onAskAi(buildAskAiPrompt(canvas, selection));
        setSelection(null);
    }, [canvas, selection, onAskAi]);

    const startComment = useCallback(() => {
        if (!selection) return;
        setCommentAnchor(selection);
        setCommentDraft('');
        setSelection(null);
    }, [selection]);

    const cancelComment = useCallback(() => {
        setCommentAnchor(null);
        setCommentDraft('');
    }, []);

    const submitComment = useCallback(async () => {
        if (!commentAnchor || !commentDraft.trim()) return;
        try {
            const comment = await client.canvases.addComment(workspaceId, canvasId, {
                anchorText: commentAnchor,
                body: commentDraft.trim(),
            });
            setComments(prev => [...prev, comment]);
            setCommentAnchor(null);
            setCommentDraft('');
        } catch { /* leave the compose box open on failure */ }
    }, [workspaceId, canvasId, commentAnchor, commentDraft]);

    const deleteComment = useCallback(async (commentId: string) => {
        try {
            await client.canvases.deleteComment(workspaceId, canvasId, commentId);
            setComments(prev => prev.filter(c => c.id !== commentId));
        } catch { /* keep the comment on failure */ }
    }, [workspaceId, canvasId]);

    const openComments = comments.filter(c => c.status === 'open');

    const sendComments = useCallback(async () => {
        const current = canvasRef.current;
        if (!current || !onSendToAi || openComments.length === 0 || sendingComments) return;
        setSendingComments(true);
        try {
            await onSendToAi(buildCommentsMessage(current, openComments));
            const updates = await Promise.all(openComments.map(c =>
                client.canvases.setCommentStatus(workspaceId, canvasId, c.id, 'sent').catch(() => null),
            ));
            setComments(prev => prev.map(c => updates.find(u => u?.id === c.id) ?? c));
        } catch { /* comments stay open if the send failed */ } finally {
            setSendingComments(false);
        }
    }, [workspaceId, canvasId, onSendToAi, openComments, sendingComments]);

    return {
        comments,
        openComments,
        selection,
        setSelection,
        commentAnchor,
        commentDraft,
        setCommentDraft,
        sendingComments,
        askAi,
        startComment,
        cancelComment,
        submitComment,
        deleteComment,
        sendComments,
    };
}
