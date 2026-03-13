import { prStatusBadge, formatRelativeTime } from './pr-utils';
import type { PullRequest } from './pr-utils';

interface PullRequestRowProps {
    pr: PullRequest;
    onClick: () => void;
}

export function PullRequestRow({ pr, onClick }: PullRequestRowProps) {
    const badge = prStatusBadge(pr.status);
    const reviewerCount = pr.reviewers?.length ?? 0;

    return (
        <div
            className="pr-row flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer border-b border-gray-100 dark:border-gray-700"
            onClick={onClick}
            data-testid="pr-row"
        >
            <span
                className={`pr-status-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 mt-0.5 ${badge.className}`}
                title={badge.label}
            >
                {badge.emoji} {badge.label}
            </span>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    {pr.number != null && (
                        <span className="pr-number text-xs text-gray-400 shrink-0">#{pr.number}</span>
                    )}
                    <span className="pr-title text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {pr.title}
                    </span>
                </div>
                <div className="pr-branches text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    <span>{pr.targetBranch}</span>
                    <span className="mx-1">←</span>
                    <span>{pr.sourceBranch}</span>
                    {pr.createdBy?.displayName && (
                        <>
                            <span className="mx-1">·</span>
                            <span className="pr-author">@{pr.createdBy.displayName}</span>
                        </>
                    )}
                    {reviewerCount > 0 && (
                        <>
                            <span className="mx-1">·</span>
                            <span>{reviewerCount} reviewer{reviewerCount !== 1 ? 's' : ''}</span>
                        </>
                    )}
                </div>
                <div className="pr-time text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Updated {formatRelativeTime(pr.updatedAt)}
                    {pr.commentCount != null && pr.commentCount > 0 && (
                        <>
                            <span className="mx-1">·</span>
                            <span>{pr.commentCount} comment{pr.commentCount !== 1 ? 's' : ''}</span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
