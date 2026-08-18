/**
 * CommitGroupSeparator — sticky header rendered before the first commit of a
 * date group ("Today", "This week", …) or the unpushed run at the top.
 */

import type { CommitGroup } from './commitRowViewModel';

export function CommitGroupSeparator({ group }: { group: CommitGroup }) {
    if (group.isUnpushed) {
        return (
            <div
                className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#f57c00] dark:text-[#ffb74d] border-b border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff8f0] dark:bg-[#2a1f00] flex items-center gap-1.5 sticky top-[26px] z-[1]"
                data-testid="unpushed-separator"
                aria-label={`${group.count} unpushed commit${group.count !== 1 ? 's' : ''}`}
            >
                <span aria-hidden="true">↑</span>
                Unpushed · {group.count} commit{group.count !== 1 ? 's' : ''}
            </div>
        );
    }
    return (
        <div
            className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#616161] dark:text-[#999] border-b border-t border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#1f1f1f] flex items-center sticky top-[26px] z-[1]"
            data-testid={`commit-date-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`}
        >
            {group.label} · {group.count} commit{group.count !== 1 ? 's' : ''}
        </div>
    );
}
