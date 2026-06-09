import type { WorkItemAzureBoardsMirrorMetadata, WorkItemGitHubMirrorMetadata } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui';

export interface WorkItemGitHubMirrorBadgeProps {
    mirror?: WorkItemGitHubMirrorMetadata;
    compact?: boolean;
    asLink?: boolean;
    className?: string;
    'data-testid'?: string;
}

export function WorkItemGitHubMirrorBadge({ mirror, compact = false, asLink = false, className, 'data-testid': testId }: WorkItemGitHubMirrorBadgeProps) {
    if (!mirror) return null;

    const state = mirror.state?.toLowerCase();
    const stateLabel = state === 'closed' ? 'closed' : state === 'open' ? 'open' : undefined;
    const text = compact
        ? String(mirror.issueNumber)
        : `GitHub #${mirror.issueNumber}${stateLabel ? ` (${stateLabel})` : ''}`;
    const title = `GitHub issue #${mirror.issueNumber}${stateLabel ? ` ${stateLabel}` : ''}`;
    const badgeClass = cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-[1.2] font-medium whitespace-nowrap',
        stateLabel === 'closed'
            ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300'
            : 'border-[#d0d7de] bg-white text-[#57606a] dark:border-[#555] dark:bg-[#1e1e1e] dark:text-[#9da7b3]',
        className,
    );

    if (asLink && mirror.issueUrl) {
        return (
            <a
                href={mirror.issueUrl}
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

export interface WorkItemAzureBoardsMirrorBadgeProps {
    mirror?: WorkItemAzureBoardsMirrorMetadata;
    compact?: boolean;
    asLink?: boolean;
    className?: string;
    'data-testid'?: string;
}

export function WorkItemAzureBoardsMirrorBadge({ mirror, compact = false, asLink = false, className, 'data-testid': testId }: WorkItemAzureBoardsMirrorBadgeProps) {
    if (!mirror) return null;

    const stateLabel = mirror.state?.trim();
    const text = compact
        ? `AB#${mirror.workItemId}`
        : `Azure Boards #${mirror.workItemId}${stateLabel ? ` (${stateLabel})` : ''}`;
    const title = `Azure Boards work item #${mirror.workItemId}${stateLabel ? ` ${stateLabel}` : ''}`;
    const badgeClass = cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-[1.2] font-medium whitespace-nowrap',
        'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-300',
        className,
    );

    if (asLink && mirror.workItemUrl) {
        return (
            <a
                href={mirror.workItemUrl}
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

export interface WorkItemRemoteMirrorBadgeProps {
    githubMirror?: WorkItemGitHubMirrorMetadata;
    azureBoardsMirror?: WorkItemAzureBoardsMirrorMetadata;
    compact?: boolean;
    asLink?: boolean;
    className?: string;
    'data-testid'?: string;
}

export function WorkItemRemoteMirrorBadge({
    githubMirror,
    azureBoardsMirror,
    compact = false,
    asLink = false,
    className,
    'data-testid': testId,
}: WorkItemRemoteMirrorBadgeProps) {
    if (githubMirror) {
        return <WorkItemGitHubMirrorBadge mirror={githubMirror} compact={compact} asLink={asLink} className={className} data-testid={testId} />;
    }
    if (azureBoardsMirror) {
        return <WorkItemAzureBoardsMirrorBadge mirror={azureBoardsMirror} compact={compact} asLink={asLink} className={className} data-testid={testId} />;
    }
    return null;
}
