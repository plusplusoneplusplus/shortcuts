import { reviewVoteIcon } from './pr-utils';
import type { Reviewer } from './pr-utils';

interface ReviewerBadgeProps {
    reviewer: Reviewer;
}

export function ReviewerBadge({ reviewer }: ReviewerBadgeProps) {
    const { icon, label } = reviewVoteIcon(reviewer.vote);
    const name = reviewer.identity.displayName ?? reviewer.identity.email ?? 'Unknown';

    return (
        <div className="flex items-center gap-2 py-1" data-testid="reviewer-badge">
            <span className="text-base leading-none" title={label}>{icon}</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">@{name}</span>
            {reviewer.isRequired && (
                <span className="text-xs text-gray-400 dark:text-gray-500">(required)</span>
            )}
            <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{label}</span>
        </div>
    );
}
