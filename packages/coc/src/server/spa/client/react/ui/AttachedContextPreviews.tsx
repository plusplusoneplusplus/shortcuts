import { cn } from './cn';
import {
    shortenSessionProcessId,
    type AttachedContextItem,
    type AttachedPointerContextItem,
} from '../features/chat/hooks/useAttachedContext';

export interface AttachedContextPreviewsProps {
    items: AttachedContextItem[];
    onRemove: (id: string) => void;
    className?: string;
    'data-testid'?: string;
}

function formatCount(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function isPointerContextItem(item: AttachedContextItem): item is AttachedPointerContextItem {
    return item.kind === 'work-item' || item.kind === 'commit' || item.kind === 'range' || item.kind === 'pull-request';
}

function getPointerContextLabel(item: AttachedPointerContextItem): string {
    if (item.kind === 'work-item') return 'Work Item';
    if (item.kind === 'commit') return 'Commit';
    if (item.kind === 'range') return 'Range';
    return 'PR';
}

function getPointerContextIcon(item: AttachedPointerContextItem): string {
    if (item.kind === 'work-item') return '▣';
    if (item.kind === 'commit') return '◇';
    if (item.kind === 'range') return '↔';
    return '#';
}

function getPointerContextMeta(item: AttachedPointerContextItem): string {
    if (item.kind === 'work-item') {
        return [item.title, item.status, item.type, item.workItemId].filter(Boolean).join(' · ');
    }
    if (item.kind === 'commit') {
        return [item.subject, item.commitHash !== item.shortHash ? shortenSessionProcessId(item.commitHash) : ''].filter(Boolean).join(' · ');
    }
    if (item.kind === 'range') {
        return [
            item.branchName,
            item.commitCount !== undefined ? formatCount(item.commitCount, 'commit', 'commits') : '',
            item.fileCount !== undefined ? formatCount(item.fileCount, 'file', 'files') : '',
        ].filter(Boolean).join(' · ');
    }
    return [item.title, item.status, item.pullRequestId].filter(Boolean).join(' · ');
}

export function AttachedContextPreviews({ items, onRemove, className, ...props }: AttachedContextPreviewsProps) {
    if (items.length === 0) return null;

    return (
        <div
            className={cn('flex flex-col gap-1.5', className)}
            data-testid={props['data-testid'] ?? 'attached-context-previews'}
        >
            {items.map(item => (
                <div
                    key={item.id}
                    className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs text-[#1e1e1e] dark:text-[#cccccc]',
                        item.kind === 'ralph-session'
                            ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/30'
                            : isPointerContextItem(item)
                                ? 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30'
                                : 'border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#2d2d2d]',
                    )}
                    data-testid={item.kind === 'session'
                        ? 'attached-session-context-chip'
                        : item.kind === 'ralph-session'
                            ? 'attached-ralph-context-chip'
                            : isPointerContextItem(item)
                                ? `attached-${item.kind}-context-chip`
                                : 'attached-context-chip'}
                >
                    <span className="shrink-0">{item.kind === 'session' ? '🧵' : item.kind === 'ralph-session' ? '🔄' : isPointerContextItem(item) ? getPointerContextIcon(item) : '📎'}</span>
                    <span className={cn(
                        'shrink-0 font-medium text-[10px] uppercase tracking-wide',
                        item.kind === 'ralph-session'
                            ? 'text-purple-700 dark:text-purple-300'
                            : isPointerContextItem(item)
                                ? 'text-sky-700 dark:text-sky-300'
                                : 'text-[#848484]',
                    )}>
                        {item.kind === 'session'
                            ? 'Session'
                            : item.kind === 'ralph-session'
                                ? 'RALPH'
                                : isPointerContextItem(item)
                                    ? getPointerContextLabel(item)
                                    : item.role === 'user' ? 'You' : 'Assistant'}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[#1e1e1e] dark:text-[#cccccc]">
                        {item.kind === 'session' ? (
                            <>
                                <span className="font-medium">{item.title}</span>
                                <span
                                    className="ml-1 text-[#848484]"
                                    data-testid="attached-session-context-meta"
                                >
                                    {item.status} · {item.lastActivityAt} · {shortenSessionProcessId(item.sourceProcessId)}
                                </span>
                            </>
                        ) : item.kind === 'ralph-session' ? (
                            <>
                                <span className="font-medium">{item.displayLabel}</span>
                                <span
                                    className="ml-1 text-purple-700/80 dark:text-purple-300/80"
                                    data-testid="attached-ralph-context-meta"
                                >
                                    {item.phase}/{item.status} · {formatCount(item.processCount, 'process', 'processes')} · {formatCount(item.iterationCount, 'iteration', 'iterations')} · {item.lastActivityAt} · {shortenSessionProcessId(item.sourceRalphSessionId)}
                                </span>
                            </>
                        ) : isPointerContextItem(item) ? (
                            <>
                                <span className="font-medium">{item.label}</span>
                                {getPointerContextMeta(item) && (
                                    <span
                                        className="ml-1 text-sky-700/80 dark:text-sky-300/80"
                                        data-testid="attached-pointer-context-meta"
                                    >
                                        {getPointerContextMeta(item)}
                                    </span>
                                )}
                            </>
                        ) : item.preview}
                    </span>
                    <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        title="Remove context"
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-transparent border-none text-[#848484] hover:text-[#f14c4c] cursor-pointer text-sm"
                        data-testid="attached-context-remove"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
