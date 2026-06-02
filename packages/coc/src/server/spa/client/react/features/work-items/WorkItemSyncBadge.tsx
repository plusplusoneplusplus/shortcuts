import type { WorkItemSyncLink, WorkItemSyncProvider } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui';

function providerLabel(provider: WorkItemSyncProvider): string {
    return provider === 'github' ? 'GitHub' : 'Azure Boards';
}

export function getPrimaryWorkItemSyncLink(syncLinks?: WorkItemSyncLink[]): WorkItemSyncLink | undefined {
    return syncLinks?.find(link => link.provider === 'github') ?? syncLinks?.[0];
}

export interface WorkItemSyncBadgeProps {
    links?: WorkItemSyncLink[];
    compact?: boolean;
    asLink?: boolean;
    className?: string;
    'data-testid'?: string;
}

export function WorkItemSyncBadge({ links, compact = false, asLink = false, className, 'data-testid': testId }: WorkItemSyncBadgeProps) {
    const link = getPrimaryWorkItemSyncLink(links);
    if (!link) return null;

    const label = providerLabel(link.provider);
    const issueNumber = link.remote.issueNumber ? ` #${link.remote.issueNumber}` : '';
    const stateLabel = link.conflict ? 'conflict' : link.dirty ? 'dirty' : 'linked';
    const text = compact ? label : `${label}${issueNumber} (${stateLabel})`;
    const title = `${label}${issueNumber || ''} ${stateLabel}`;
    const badgeClass = cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-[1.2] font-medium whitespace-nowrap',
        link.conflict
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
            : link.dirty
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300'
                : 'border-[#d0d7de] bg-white text-[#57606a] dark:border-[#555] dark:bg-[#1e1e1e] dark:text-[#9da7b3]',
        className,
    );

    if (asLink && link.remote.issueUrl) {
        return (
            <a
                href={link.remote.issueUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(badgeClass, 'hover:border-[#0969da] hover:text-[#0969da] dark:hover:text-[#58a6ff]')}
                title={title}
                data-testid={testId}
            >
                {text}
            </a>
        );
    }

    return (
        <span className={badgeClass} title={title} data-testid={testId}>
            {text}
        </span>
    );
}
