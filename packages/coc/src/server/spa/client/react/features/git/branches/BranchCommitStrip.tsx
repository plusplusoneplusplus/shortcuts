/**
 * BranchCommitStrip — compact read-only list of commits in the branch range.
 *
 * Shown in the upper panel of the BranchRangeOverview "cup" layout.
 * Displays a header summary and a scrollable list of commit rows.
 */

import { formatRelativeTime } from '../../../utils/format';
import type { GitCommitItem } from '../commits/CommitList';
import type { BranchRangeInfo } from './BranchChanges';
import { type GitRangeContextDragPayload, writePointerContextDragData } from '../../chat/sessionContextDrag';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';

const BASE_MODE_OPTIONS: Array<{ mode: GitRangeBaseMode; label: string; title: string }> = [
    { mode: 'default-branch', label: 'vs main', title: 'Diff everything on this branch against the default branch' },
    { mode: 'upstream', label: 'unpushed', title: 'Diff against the branch upstream — unpushed commits only' },
];

interface BranchCommitStripProps {
    commits: GitCommitItem[];
    branchRangeData: BranchRangeInfo;
    onAllCommentsClick?: () => void;
    commentCount?: number;
    onAskAI?: () => void;
    sessionContextPayload?: GitRangeContextDragPayload | null;
    /** Comparison base currently in effect. */
    baseMode?: GitRangeBaseMode;
    /** Called when the user picks a different base. Omit to hide the toggle. */
    onBaseModeChange?: (mode: GitRangeBaseMode) => void;
}

export function BranchCommitStrip({ commits, branchRangeData, onAllCommentsClick, commentCount, onAskAI, sessionContextPayload, baseMode = 'default-branch', onBaseModeChange }: BranchCommitStripProps) {
    const branchLabel = branchRangeData.branchName || branchRangeData.headRef;
    const baseShort = branchRangeData.baseRef.replace(/^origin\//, '');
    // The server may have fallen back to the default branch when the branch has
    // no upstream — say so rather than silently showing a different diff.
    const fellBack = baseMode === 'upstream' && !!branchRangeData.baseModeFallback;

    return (
        <div className="flex flex-col h-full" data-testid="branch-commit-strip">
            {/* Header */}
            <div
                className={`px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#252526] flex-shrink-0${sessionContextPayload ? ' cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-inset hover:ring-sky-300 dark:hover:ring-sky-700' : ''}`}
                data-testid="branch-commit-strip-header"
                draggable={!!sessionContextPayload}
                onDragStart={sessionContextPayload ? e => writePointerContextDragData(e.dataTransfer, sessionContextPayload) : undefined}
                data-session-context-source={sessionContextPayload ? 'true' : undefined}
                data-session-context-kind={sessionContextPayload ? 'range' : undefined}
                title={sessionContextPayload ? `${sessionContextPayload.label} - drag to attach as range context` : undefined}
            >
                <div className="flex items-center gap-1">
                    <div className="text-xs font-semibold text-[#616161] dark:text-[#999] truncate flex-1">
                        {branchLabel}
                        {' · '}
                        {branchRangeData.commitCount} commit{branchRangeData.commitCount !== 1 ? 's' : ''}
                        {' ahead of '}
                        {baseShort}
                    </div>
                    {onAskAI && (
                        <button
                            onClick={onAskAI}
                            title="Ask AI about branch changes"
                            className="text-xs px-1.5 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] flex-shrink-0"
                            data-testid="branch-range-ask-ai-btn"
                        >
                            🤖
                        </button>
                    )}
                    {onAllCommentsClick && (
                        <button
                            onClick={onAllCommentsClick}
                            title="Show all branch comments"
                            className="text-xs px-1.5 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] flex-shrink-0"
                            data-testid="branch-range-all-comments-btn"
                        >
                            💬 {commentCount && commentCount > 0 ? commentCount : ''}
                        </button>
                    )}
                </div>
                <div className="text-xs text-[#848484] mt-0.5">
                    <span className="text-[#16825d]">+{branchRangeData.additions}</span>
                    {' '}
                    <span className="text-[#d32f2f]">−{branchRangeData.deletions}</span>
                    {' · '}
                    {branchRangeData.fileCount} file{branchRangeData.fileCount !== 1 ? 's' : ''}
                </div>
                {onBaseModeChange && (
                    <div className="flex items-center gap-1 mt-1" data-testid="branch-range-base-toggle">
                        {BASE_MODE_OPTIONS.map(option => (
                            <button
                                key={option.mode}
                                onClick={() => onBaseModeChange(option.mode)}
                                title={option.title}
                                aria-pressed={baseMode === option.mode}
                                className={`text-[11px] px-1.5 py-0.5 rounded border ${baseMode === option.mode
                                    ? 'border-[#007acc] text-[#007acc] bg-[#007acc]/10'
                                    : 'border-[#e0e0e0] dark:border-[#3c3c3c] text-[#848484] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]'}`}
                                data-testid={`branch-range-base-${option.mode}`}
                            >
                                {option.label}
                            </button>
                        ))}
                        <span className="text-[11px] text-[#848484] truncate" data-testid="branch-range-base-ref">
                            {branchRangeData.baseRef}
                        </span>
                    </div>
                )}
                {fellBack && (
                    <div className="text-[11px] text-[#848484] mt-0.5" data-testid="branch-range-base-fallback">
                        no upstream — showing vs {branchRangeData.baseRef}
                    </div>
                )}
            </div>

            {/* Commit rows */}
            <div className="flex-1 overflow-y-auto" data-testid="branch-commit-strip-list">
                {commits.length === 0 ? (
                    <div
                        className="px-4 py-3 text-xs text-[#848484] italic"
                        data-testid="branch-commit-strip-empty"
                    >
                        No commits ahead of base
                    </div>
                ) : (
                    commits.map(commit => (
                        <div
                            key={commit.hash}
                            className="flex items-center gap-2 px-4 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] last:border-b-0 hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]"
                            data-testid={`branch-commit-row-${commit.shortHash}`}
                        >
                            <span className="font-mono text-xs flex-shrink-0 text-[#f57c00] dark:text-[#ffb74d]">
                                {commit.shortHash}
                            </span>
                            <span className="text-xs text-[#1e1e1e] dark:text-[#ccc] flex-1 min-w-0 truncate">
                                {commit.subject}
                            </span>
                            <span className="text-[11px] text-[#848484] flex-shrink-0">
                                {formatRelativeTime(commit.date)}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
