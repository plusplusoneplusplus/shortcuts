/**
 * BranchRangeAllComments — right-panel view showing all comments across all
 * branch-range files. Mirrors WorkingTreeAllComments for the branch-changes context.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../../hooks/useApi';
import { Spinner } from '../../../ui';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import type { DiffComment } from '../../../../comments/diff-comment-types';

export interface BranchRangeAllCommentsProps {
    workspaceId: string;
    baseRef: string;
    headRef: string;
    branchLabel: string;
}

export function BranchRangeAllComments({ workspaceId, baseRef, headRef, branchLabel }: BranchRangeAllCommentsProps) {
    const [comments, setComments] = useState<DiffComment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const copyAllCommentsAsPrompt = useCallback(() => {
        const openComments = comments.filter(c => c.status === 'open');
        if (!openComments.length) return;

        const byFile = new Map<string, DiffComment[]>();
        for (const c of openComments) {
            const fp = c.context.filePath;
            if (!byFile.has(fp)) byFile.set(fp, []);
            byFile.get(fp)!.push(c);
        }

        const sections = [...byFile.entries()].map(([filePath, cs]) => {
            const block = cs
                .map((c, i) =>
                    `### Comment ${i + 1} (id: ${c.id}, status: ${c.status})\n` +
                    `Lines ${c.selection.diffLineStart}–${c.selection.diffLineEnd} (${c.selection.side})\n` +
                    `Selected code:\n\`\`\`\n${c.selectedText}\n\`\`\`\n` +
                    `Comment: ${c.comment}`
                )
                .join('\n\n');
            return `## File: ${filePath} (${cs.length} comment(s))\n\n${block}`;
        }).join('\n\n');

        const prompt =
            `You are reviewing branch changes (${branchLabel}) with comments across ${byFile.size} file(s).\n\n` +
            `${sections}\n\n` +
            `Please address these comments.`;

        void navigator.clipboard.writeText(prompt);
    }, [comments, branchLabel]);

    const fetchComments = useCallback(() => {
        setLoading(true);
        setError(null);
        fetchApi(
            `/diff-comments/${encodeURIComponent(workspaceId)}` +
            `?oldRef=${encodeURIComponent(baseRef)}&newRef=${encodeURIComponent(headRef)}`
        )
            .then((data: { comments?: DiffComment[] }) => setComments(data.comments ?? []))
            .catch((err: any) => setError(err.message || 'Failed to load comments'))
            .finally(() => setLoading(false));
    }, [workspaceId, baseRef, headRef]);

    useEffect(() => {
        fetchComments();
    }, [fetchComments]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-4 py-4 text-xs text-[#848484]" data-testid="branch-range-all-comments-loading">
                <Spinner size="sm" /> Loading comments…
            </div>
        );
    }

    if (error) {
        return (
            <div className="px-4 py-4 text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="branch-range-all-comments-error">
                {error}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid="branch-range-all-comments">
            <div className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-xs font-semibold text-[#616161] dark:text-[#999]">
                Branch Changes: {branchLabel} — All Comments
            </div>
            <CommentSidebar
                comments={comments}
                loading={false}
                showFilePath
                fullWidth
                onResolve={() => undefined}
                onUnresolve={() => undefined}
                onDelete={() => undefined}
                onEdit={() => undefined}
                onAskAI={() => undefined}
                onCommentClick={() => undefined}
                onCopyPrompt={copyAllCommentsAsPrompt}
                data-testid="branch-range-all-comments-sidebar"
            />
        </div>
    );
}
