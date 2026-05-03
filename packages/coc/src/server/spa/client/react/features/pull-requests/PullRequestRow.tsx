import { cn } from '../../ui';
import { prStatusBadge, formatTimestamp } from './pr-utils';
import type { PullRequest } from './pr-utils';

interface PullRequestRowProps {
    pr: PullRequest;
    onClick: () => void;
    isSelected?: boolean;
    onSelect?: (id: string, checked: boolean, shiftKey: boolean) => void;
    isChecked?: boolean;
    groupLabel?: string;
    groupColor?: string;
    groupEmoji?: string;
    groupReason?: string;
    /** When true, the selection checkbox is rendered. Hidden by default. */
    batchMode?: boolean;
}

export function PullRequestRow({ pr, onClick, isSelected, onSelect, isChecked, groupLabel, groupColor, groupEmoji, groupReason, batchMode }: PullRequestRowProps) {
    const badge = prStatusBadge(pr.status);
    const reviewerCount = pr.reviewers?.length ?? 0;

    return (
        <div
            className={cn(
                "pr-row flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-700",
                isSelected
                    ? "bg-blue-50 dark:bg-gray-700"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
            )}
            onClick={onClick}
            data-testid="pr-row"
        >
            {batchMode && (
                <input
                    type="checkbox"
                    data-testid="pr-row-checkbox"
                    checked={isChecked ?? false}
                    onChange={e => {
                        e.stopPropagation();
                        const shiftKey = e.nativeEvent instanceof MouseEvent ? e.nativeEvent.shiftKey : false;
                        onSelect?.(String(pr.number ?? pr.id), e.target.checked, shiftKey);
                    }}
                    onClick={e => e.stopPropagation()}
                    className="shrink-0 mt-1 mr-1 cursor-pointer accent-blue-500"
                />
            )}
            {groupLabel ? (
                <span
                    className={cn('pr-group-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 mt-0.5', groupColor)}
                    title={groupLabel}
                    data-testid="pr-group-badge"
                >
                    {groupEmoji && <span aria-hidden="true">{groupEmoji}</span>} {groupLabel}
                </span>
            ) : (
                <span
                    className={`pr-status-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 mt-0.5 ${badge.className}`}
                    title={badge.label}
                >
                    {badge.emoji} {badge.label}
                </span>
            )}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    {pr.number != null && (
                        <span className="pr-number text-xs text-gray-400 shrink-0">#{pr.number}</span>
                    )}
                    <span className="pr-title text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {pr.title}
                    </span>
                </div>
                {groupReason && (
                    <div className="pr-group-reason text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic" data-testid="pr-group-reason">
                        {groupReason}
                    </div>
                )}
                {pr.author?.displayName && (
                    <div className="pr-author text-xs font-medium text-gray-700 dark:text-gray-300 mt-0.5 flex items-center gap-1">
                        <span className="inline-block w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 text-center leading-4 text-gray-600 dark:text-gray-200 text-[10px] shrink-0" aria-hidden="true">
                            {pr.author.displayName.charAt(0).toUpperCase()}
                        </span>
                        <span>{pr.author.displayName}</span>
                    </div>
                )}
                <div className="pr-branches text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    <span>{pr.targetBranch}</span>
                    <span className="mx-1">←</span>
                    <span>{pr.sourceBranch}</span>
                    {reviewerCount > 0 && (
                        <>
                            <span className="mx-1">·</span>
                            <span>{reviewerCount} reviewer{reviewerCount !== 1 ? 's' : ''}</span>
                        </>
                    )}
                </div>
                <div className="pr-time text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Updated {formatTimestamp(pr.updatedAt)}
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
