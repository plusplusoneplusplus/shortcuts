/**
 * WhisperCollapsedGroup — a single collapsed summary for all preceding chunks
 * in Whisper verbosity mode (level 3). Shows an aggregate header with tool call
 * and message counts. Expands to reveal Compact-level (level 1) rendering.
 */
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { cn } from '../../../../ui';
import type { WhisperSummary, FileEdit } from './toolGroupUtils';
import { groupConsecutiveToolChunks, computeFileEditTotals } from './toolGroupUtils';
import { ToolCallGroupView } from './ToolCallGroupView';
import type { RenderToolCall } from './ToolCallGroupView';
import { ToolCallVariantProvider } from './ToolCallVariant';
import { MarkdownView } from '../../../../shared/MarkdownView';
import { detectCommitsInToolGroup } from '../commitDetection';
import type { DetectedCommit } from '../commitDetection';
import type { DetectedPullRequest } from '../pullRequestDetection';
import type { DetectedPush } from '../pushDetection';
import { CommitStrip } from '../CommitStrip';
import { buildGitReviewPopOutUrl } from '../../../../layout/Router';
import { useGitReviewPopOut, gitReviewPopOutKey } from '../../../../contexts/GitReviewPopOutContext';
import { lookupCloneBaseUrl } from '../../../../repos/cloneRegistry';
import { normalizeToolName } from './toolNormalization';
import type { WhisperDiffToolCall } from './buildWhisperFileDiff';
import { clampPopoverPosition, useHoverPopover, HoverSummarySpan } from './hoverPopover';
import { buildWhisperGroupModel, collectGroupToolCalls } from './whisperGroupModel';

/**
 * Context emitted when a user opens the whisper diff panel from the files
 * popover — either the whole-group combined diff (the "N files" footer) or a
 * single focused file (a file row). Both entry points carry the SAME payload;
 * they differ only by `focusPath`, which the panel uses to pick the initial
 * dropdown selection. The panel is a filterable whole-group view: it always
 * reconstructs every file synchronously via `buildWhisperCombinedDiff`, then
 * shows the stacked "All files" view or narrows to one file by selection.
 *
 * It rides the window CustomEvent bridge (`whisperDiffEvent`) into the single
 * docked panel slot; opening one replaces whatever the dock currently shows.
 */
export interface WhisperDiffOpenContext {
    /** Every file in the group, in popover / group order (deleted ones included). */
    files: FileEdit[];
    /** Reconstructable edit/create/apply_patch calls captured in this group. */
    toolCalls: WhisperDiffToolCall[];
    /**
     * Commits detected in this group. Carried for parity with the header/popover
     * flows; the converged panel reconstructs from `toolCalls` only and never
     * fetches a commit diff, so this is currently unused by the panel.
     */
    commits: DetectedCommit[];
    /** Workspace/clone routing id, carried for parity (currently unused by the panel). */
    workspaceId?: string;
    /**
     * When set, the panel opens focused on this file's diff (a popover file-row
     * entry). Absent → the panel opens on the stacked "All files" view (the
     * footer entry). Thereafter the selection is user-driven inside the panel.
     */
    focusPath?: string;
}

interface ToolLike {
    toolName: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    args?: Record<string, unknown>;
    id?: string;
    result?: string;
}

interface ToolChunk {
    kind: string;
    key: string;
    html?: string;
    toolId?: string;
    parentToolId?: string;
    [key: string]: unknown;
}

export interface WhisperCollapsedGroupProps {
    precedingChunks: ToolChunk[];
    summary: WhisperSummary;
    toolById: Map<string, ToolLike>;
    toolsWithChildren: Set<string>;
    toolParentById: Map<string, string>;
    isStreaming?: boolean;
    groupSingleLineMessages: boolean;
    workspaceId?: string;
    renderToolTree: (toolId: string, depth: number) => React.ReactNode;
    /**
     * Opens the transient read-only diff panel for a clicked changed file, or
     * — from the multi-file popover footer — the whole-group combined diff. When
     * omitted, file popover rows and the footer stay non-interactive (hover-only).
     */
    onOpenFileDiff?: (ctx: WhisperDiffOpenContext) => void;
}

// Popover positioning (`clampPopoverPosition`) and the hover state machine
// (`useHoverPopover` / `HoverSummarySpan`) live in ./hoverPopover.
// Header-part construction + group tool-call collection live in
// ./whisperGroupModel.

// ---------------------------------------------------------------------------
// shortenPath — shows dir/basename, truncating middle for long paths
// ---------------------------------------------------------------------------

export function shortenPath(filePath: string, maxLen = 40): string {
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 2) return parts.join('/');
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const short = `${secondLast}/${last}`;
    if (short.length <= maxLen) return short;
    // Truncate the directory part
    const available = maxLen - last.length - 2; // 2 for "…/"
    if (available > 0) {
        return secondLast.slice(0, available) + '…/' + last;
    }
    return last;
}

// ---------------------------------------------------------------------------
// DiffBar — proportional green/red bar for insertions/deletions
// ---------------------------------------------------------------------------

interface DiffBarProps {
    insertions: number;
    deletions: number;
    isCreate: boolean;
    isDeleted?: boolean;
}

function DiffBar({ insertions, deletions, isCreate, isDeleted }: DiffBarProps) {
    const total = insertions + deletions;
    if (total === 0) return null;

    if (isDeleted) {
        return (
            <span
                className="inline-flex shrink-0 h-[8px] w-[60px] rounded-sm overflow-hidden bg-[#e8e8e8] dark:bg-[#333]"
                data-testid="diff-bar"
                title="removed"
            >
                <span className="h-full bg-[#999] dark:bg-[#666] w-full" />
            </span>
        );
    }

    const greenPct = isCreate ? 100 : (insertions / total) * 100;

    return (
        <span
            className="inline-flex shrink-0 h-[8px] w-[60px] rounded-sm overflow-hidden bg-[#e8e8e8] dark:bg-[#333]"
            data-testid="diff-bar"
            title={`+${insertions} −${deletions}`}
        >
            {greenPct > 0 && (
                <span
                    className="h-full bg-[#22863a] dark:bg-[#85e89d]"
                    style={{ width: `${greenPct}%` }}
                />
            )}
            {greenPct < 100 && (
                <span
                    className="h-full bg-[#cb2431] dark:bg-[#f97583]"
                    style={{ width: `${100 - greenPct}%` }}
                />
            )}
        </span>
    );
}

// ---------------------------------------------------------------------------
// SkillHoverPopover — shown when hovering over "N skills"
// ---------------------------------------------------------------------------

interface SkillHoverPopoverProps {
    skillNames: string[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

function SkillHoverPopover({ skillNames, anchorRef, popoverRef, onMouseEnter, onMouseLeave }: SkillHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const pos = clampPopoverPosition(rect, 400, skillNames.length * 28 + 8);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[200px] max-w-[400px]"
            style={{ top: pos.top, left: pos.left }}
            data-testid="skill-hover-popover"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {skillNames.map(name => (
                <div
                    key={name}
                    className="flex items-center gap-2 px-2.5 py-1 text-xs"
                    data-testid="skill-popover-row"
                >
                    <span className="shrink-0">🛠</span>
                    <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                        {name}
                    </span>
                </div>
            ))}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// SkillHoverSpan — a span that shows a skill popover on hover
// ---------------------------------------------------------------------------

interface SkillHoverSpanProps {
    text: string;
    skillNames: string[];
    testId?: string;
}

function SkillHoverSpan({ text, skillNames, testId }: SkillHoverSpanProps) {
    return (
        <HoverSummarySpan
            text={text}
            testId={testId}
            hasContent={skillNames.length > 0}
            renderPopover={(anchor) => <SkillHoverPopover skillNames={skillNames} {...anchor} />}
        />
    );
}

// ---------------------------------------------------------------------------
// MemoryHoverPopover — shown when hovering over "N memories"
// ---------------------------------------------------------------------------

const MEMORY_ACTION_ICONS: Record<string, string> = {
    add: '➕',
    replace: '🔄',
    remove: '➖',
};

const MEMORY_PREVIEW_CHAR_LIMIT = 60;
const MEMORY_FULL_HOVER_DELAY_MS = 700;

interface MemoryAction {
    action: string;
    target: string;
    content?: string;
}

interface MemoryHoverPopoverProps {
    actions: MemoryAction[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

interface MemoryFullContentPopoverProps {
    id: string;
    content: string;
    anchorRef: React.RefObject<HTMLSpanElement | null>;
}

function formatMemoryPreview(content: string): string {
    return content.length > MEMORY_PREVIEW_CHAR_LIMIT
        ? content.slice(0, MEMORY_PREVIEW_CHAR_LIMIT) + '…'
        : content;
}

function MemoryFullContentPopover({ id, content, anchorRef }: MemoryFullContentPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const pos = clampPopoverPosition(rect, 560, 320);

    return ReactDOM.createPortal(
        <div
            id={id}
            className="fixed z-[60] rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-xl min-w-[280px] max-w-[560px] p-3"
            style={{ top: pos.top, left: pos.left }}
            data-testid="memory-full-content-popover"
            onClick={e => e.stopPropagation()}
        >
            <div className="text-[10px] uppercase tracking-wide text-[#848484] mb-1">
                Full memory content
            </div>
            <pre
                className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#1e1e1e] dark:text-[#cccccc] font-mono"
                data-testid="memory-full-content"
            >
                {content}
            </pre>
        </div>,
        document.body,
    );
}

function MemoryPopoverRow({ entry, index }: { entry: MemoryAction; index: number }) {
    const [showFullContent, setShowFullContent] = useState(false);
    const contentRef = useRef<HTMLSpanElement | null>(null);
    const longHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasLongContent = !!entry.content && entry.content.length > MEMORY_PREVIEW_CHAR_LIMIT;

    const clearLongHoverTimer = useCallback(() => {
        if (longHoverTimer.current) {
            clearTimeout(longHoverTimer.current);
            longHoverTimer.current = null;
        }
    }, []);

    const startLongHover = useCallback(() => {
        if (!hasLongContent) return;
        clearLongHoverTimer();
        longHoverTimer.current = setTimeout(() => {
            setShowFullContent(true);
            longHoverTimer.current = null;
        }, MEMORY_FULL_HOVER_DELAY_MS);
    }, [clearLongHoverTimer, hasLongContent]);

    const stopLongHover = useCallback(() => {
        clearLongHoverTimer();
        setShowFullContent(false);
    }, [clearLongHoverTimer]);

    useEffect(() => () => clearLongHoverTimer(), [clearLongHoverTimer]);

    return (
        <div
            className="flex items-center gap-2 px-2.5 py-1 text-xs"
            data-testid="memory-popover-row"
        >
            <span className="shrink-0">{MEMORY_ACTION_ICONS[entry.action] ?? '📝'}</span>
            <span className="shrink-0 px-1 rounded bg-[#e8e8e8] dark:bg-[#333] text-[10px] font-medium">
                {entry.target}
            </span>
            {entry.content && (
                <span
                    ref={contentRef}
                    className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1"
                    data-testid={`memory-popover-content-${index}`}
                    onMouseEnter={startLongHover}
                    onMouseLeave={stopLongHover}
                    aria-describedby={showFullContent ? `memory-full-content-${index}` : undefined}
                >
                    {formatMemoryPreview(entry.content)}
                    {showFullContent && (
                        <MemoryFullContentPopover
                            id={`memory-full-content-${index}`}
                            content={entry.content}
                            anchorRef={contentRef}
                        />
                    )}
                </span>
            )}
        </div>
    );
}

function MemoryHoverPopover({ actions, anchorRef, popoverRef, onMouseEnter, onMouseLeave }: MemoryHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const pos = clampPopoverPosition(rect, 400, actions.length * 28 + 8);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[200px] max-w-[400px]"
            style={{ top: pos.top, left: pos.left }}
            data-testid="memory-hover-popover"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {actions.map((entry, i) => (
                <MemoryPopoverRow key={i} entry={entry} index={i} />
            ))}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// MemoryHoverSpan — a span that shows a memory popover on hover
// ---------------------------------------------------------------------------

interface MemoryHoverSpanProps {
    text: string;
    actions: MemoryAction[];
    testId?: string;
}

function MemoryHoverSpan({ text, actions, testId }: MemoryHoverSpanProps) {
    return (
        <HoverSummarySpan
            text={text}
            testId={testId}
            hasContent={actions.length > 0}
            renderPopover={(anchor) => <MemoryHoverPopover actions={actions} {...anchor} />}
        />
    );
}

// ---------------------------------------------------------------------------
// CommitHoverPopover — shown when hovering over "N commits" / "N fixups"
// ---------------------------------------------------------------------------

interface CommitHoverPopoverProps {
    commits: DetectedCommit[];
    workspaceId?: string;
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

function CommitHoverPopover({ commits, workspaceId, anchorRef, popoverRef, onMouseEnter, onMouseLeave }: CommitHoverPopoverProps) {
    const { markPoppedOut } = useGitReviewPopOut();

    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const pos = clampPopoverPosition(rect, 400, commits.length * 28 + 8);

    const handlePopOut = (e: React.MouseEvent, commit: DetectedCommit) => {
        e.stopPropagation();
        if (!workspaceId) return;
        const hash = commit.fullHash || commit.shortHash;
        const url = buildGitReviewPopOutUrl(workspaceId, hash, lookupCloneBaseUrl(workspaceId));
        const win = window.open(url, `coc-git-review-${hash}`, 'width=1200,height=800');
        if (win) {
            markPoppedOut(gitReviewPopOutKey(workspaceId, hash));
        }
    };

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[200px] max-w-[400px]"
            style={{ top: pos.top, left: pos.left }}
            data-testid="commit-hover-popover"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {commits.map(commit => (
                <div
                    key={commit.shortHash}
                    className={
                        'flex items-center gap-2 px-2.5 py-1 text-xs ' +
                        (commit.isFixup ? 'opacity-70 ' : '') +
                        (workspaceId
                            ? 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]'
                            : '')
                    }
                    data-testid={`commit-popover-row-${commit.shortHash}`}
                    onClick={workspaceId ? (e) => {
                        e.stopPropagation();
                        const hash = commit.fullHash || commit.shortHash;
                        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/git/' + hash;
                    } : undefined}
                    role={workspaceId ? 'link' : undefined}
                >
                    <span className="shrink-0">{commit.isFixup ? '🔧' : '🔀'}</span>
                    <span className="font-mono shrink-0 text-[#f57c00] dark:text-[#ffb74d]">
                        {commit.shortHash}
                    </span>
                    <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                        {commit.subject}
                    </span>
                    {workspaceId && (
                        <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => handlePopOut(e, commit)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handlePopOut(e as unknown as React.MouseEvent, commit);
                                }
                            }}
                            title="Open in new window"
                            className="shrink-0 text-xs px-1 py-0.5 rounded cursor-pointer select-none hover:bg-black/[0.1] dark:hover:bg-white/[0.12]"
                            data-testid={`commit-popover-popout-${commit.shortHash}`}
                            aria-label="Open commit in new window"
                        >
                            ↗️
                        </span>
                    )}
                </div>
            ))}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// FileHoverPopover — shown when hovering over "N files"
// ---------------------------------------------------------------------------

interface FileHoverPopoverProps {
    files: FileEdit[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    /** When provided, active (non-deleted) rows open the file's diff on click/Enter/Space. */
    onFileClick?: (file: FileEdit) => void;
    /** When provided, the multi-file summary footer opens the combined diff on click/Enter/Space. */
    onOpenCombined?: () => void;
}

function FileHoverPopover({ files, anchorRef, popoverRef, onMouseEnter, onMouseLeave, onFileClick, onOpenCombined }: FileHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const rowHeight = 28;
    const footerHeight = files.length > 1 ? 36 : 0;
    const estimatedHeight = files.length * rowHeight + footerHeight + 8;
    const pos = clampPopoverPosition(rect, 460, estimatedHeight);
    const activeFiles = files.filter(f => !f.isDeleted);
    const totals = computeFileEditTotals(activeFiles);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[240px] max-w-[460px]"
            style={{ top: pos.top, left: pos.left }}
            data-testid="file-hover-popover"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={e => e.stopPropagation()}
        >
            {files.map(file => {
                const display = shortenPath(file.path);
                const ins = file.netInsertions ?? file.insertions;
                const del = file.netDeletions ?? file.deletions;
                const icon = file.isDeleted ? '🗑️' : file.isCreate ? '📄' : '✏️';
                // Active (non-deleted) rows become actionable when a click handler
                // is wired. Deleted/removed rows stay visibly removed and disabled —
                // no reconstructed deletion diff is available for them.
                const interactive = !file.isDeleted && !!onFileClick;
                return (
                    <div
                        key={file.path}
                        className={cn(
                            'flex items-center gap-2 px-2.5 py-1 text-xs',
                            file.isDeleted && 'opacity-50',
                            interactive && 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]',
                        )}
                        data-testid={file.isDeleted ? 'file-popover-row-deleted' : 'file-popover-row'}
                        title={file.isDeleted ? `${file.path} (removed)` : file.path}
                        role={interactive ? 'button' : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        aria-disabled={file.isDeleted ? true : undefined}
                        aria-label={interactive ? `Open diff for ${file.path}` : undefined}
                        onClick={interactive ? (e) => { e.stopPropagation(); onFileClick!(file); } : undefined}
                        onKeyDown={interactive ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                onFileClick!(file);
                            }
                        } : undefined}
                    >
                        <span className="shrink-0">{icon}</span>
                        <span className={cn(
                            'truncate min-w-0 flex-1',
                            file.isDeleted
                                ? 'line-through text-[#999] dark:text-[#666]'
                                : 'text-[#1e1e1e] dark:text-[#ccc]',
                        )}>
                            {display}
                        </span>
                        {file.isDeleted ? (
                            <span className="shrink-0 text-[#999] dark:text-[#666] italic">removed</span>
                        ) : (
                            <>
                                <DiffBar insertions={ins} deletions={del} isCreate={file.isCreate} />
                                {ins > 0 && (
                                    <span className="shrink-0 text-[#22863a] dark:text-[#85e89d]">+{ins}</span>
                                )}
                                {del > 0 && (
                                    <span className="shrink-0 text-[#cb2431] dark:text-[#f97583]">−{del}</span>
                                )}
                            </>
                        )}
                    </div>
                );
            })}
            {files.length > 1 && (
                <div
                    className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5 text-xs border-t border-[#e0e0e0] dark:border-[#3c3c3c] font-medium',
                        // Becomes the "view all changes" control when a handler is wired.
                        onOpenCombined && 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42]',
                    )}
                    data-testid="file-popover-footer"
                    role={onOpenCombined ? 'button' : undefined}
                    tabIndex={onOpenCombined ? 0 : undefined}
                    aria-label={onOpenCombined ? 'Open combined diff for all files' : undefined}
                    onClick={onOpenCombined ? (e) => { e.stopPropagation(); onOpenCombined(); } : undefined}
                    onKeyDown={onOpenCombined ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onOpenCombined();
                        }
                    } : undefined}
                >
                    <span className="text-[#848484] flex-1">
                        {files.length} file{files.length !== 1 ? 's' : ''}
                    </span>
                    {totals.totalInsertions > 0 && (
                        <span className="shrink-0 text-[#22863a] dark:text-[#85e89d]">+{totals.totalInsertions}</span>
                    )}
                    {totals.totalDeletions > 0 && (
                        <span className="shrink-0 text-[#cb2431] dark:text-[#f97583]">−{totals.totalDeletions}</span>
                    )}
                </div>
            )}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// FileHoverSpan — a span that shows a file popover on hover
// ---------------------------------------------------------------------------

interface FileHoverSpanProps {
    text: string;
    files: FileEdit[];
    testId?: string;
    /** When false, suppresses the inline (+N −M) totals after the text. */
    showInlineTotals?: boolean;
    /** When provided, active file rows open the file's diff on click/Enter/Space. */
    onFileClick?: (file: FileEdit) => void;
    /** When provided, the multi-file footer opens the combined diff on click/Enter/Space. */
    onOpenCombined?: () => void;
}

function FileHoverSpan({ text, files, testId, showInlineTotals = true, onFileClick, onOpenCombined }: FileHoverSpanProps) {
    const { hovered, anchorRef, popoverRef, showPopover, hidePopover } = useHoverPopover<HTMLSpanElement>();

    const activeFiles = useMemo(() => files.filter(f => !f.isDeleted), [files]);
    const totals = useMemo(() => computeFileEditTotals(activeFiles), [activeFiles]);
    const hasTotals = totals.totalInsertions > 0 || totals.totalDeletions > 0;

    return (
        <span
            ref={anchorRef}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
            onClick={e => e.stopPropagation()}
            className="underline decoration-dotted cursor-default"
            data-testid={testId}
        >
            {text}
            {showInlineTotals && hasTotals && (
                <span className="text-[#848484] ml-0.5 no-underline" data-testid="file-total-inline">
                    ({totals.totalInsertions > 0 && <span className="text-[#22863a] dark:text-[#85e89d]">+{totals.totalInsertions}</span>}
                    {totals.totalInsertions > 0 && totals.totalDeletions > 0 && ' '}
                    {totals.totalDeletions > 0 && <span className="text-[#cb2431] dark:text-[#f97583]">−{totals.totalDeletions}</span>})
                </span>
            )}
            {hovered && files.length > 0 && (
                <FileHoverPopover
                    files={files}
                    anchorRef={anchorRef}
                    popoverRef={popoverRef}
                    onMouseEnter={showPopover}
                    onMouseLeave={hidePopover}
                    onFileClick={onFileClick}
                    onOpenCombined={onOpenCombined}
                />
            )}
        </span>
    );
}

// ---------------------------------------------------------------------------
// CommitHoverSpan — a span that shows a popover on hover
// ---------------------------------------------------------------------------

interface CommitHoverSpanProps {
    text: string;
    commits: DetectedCommit[];
    workspaceId?: string;
    testId?: string;
}

function CommitHoverSpan({ text, commits, workspaceId, testId }: CommitHoverSpanProps) {
    return (
        <HoverSummarySpan
            text={text}
            testId={testId}
            hasContent={commits.length > 0}
            renderPopover={(anchor) => <CommitHoverPopover commits={commits} workspaceId={workspaceId} {...anchor} />}
        />
    );
}

// ---------------------------------------------------------------------------
// PullRequestHoverPopover — shown when hovering over "N PRs"
// ---------------------------------------------------------------------------

interface PullRequestHoverPopoverProps {
    pullRequests: DetectedPullRequest[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

function formatPullRequestLabel(pr: DetectedPullRequest): string {
    if (pr.provider === 'azure-devops') {
        const project = pr.project || pr.organization;
        const repo = pr.repo && project ? `${project}/${pr.repo}` : pr.repo || project;
        return repo ? `${repo}!${pr.number}` : `!${pr.number}`;
    }
    const repo = pr.owner && pr.repo ? `${pr.owner}/${pr.repo}` : undefined;
    return repo ? `${repo}#${pr.number}` : `#${pr.number}`;
}

function PullRequestHoverPopover({ pullRequests, anchorRef, popoverRef, onMouseEnter, onMouseLeave }: PullRequestHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const pos = clampPopoverPosition(rect, 460, pullRequests.length * 32 + 8);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[240px] max-w-[460px]"
            style={{ top: pos.top, left: pos.left }}
            data-testid="pr-hover-popover"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {pullRequests.map(pr => (
                <a
                    key={pr.url}
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42] no-underline"
                    data-testid={`pr-popover-row-${pr.number}`}
                    onClick={e => e.stopPropagation()}
                    title={pr.url}
                    aria-label={`Open pull request ${formatPullRequestLabel(pr)}`}
                >
                    <span className="shrink-0">🔗</span>
                    <span className="font-mono shrink-0 text-[#0969da] dark:text-[#58a6ff]">
                        {formatPullRequestLabel(pr)}
                    </span>
                    <span className="text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1">
                        Open PR
                    </span>
                    <span className="shrink-0 text-[#848484]" aria-hidden="true">↗</span>
                </a>
            ))}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// PullRequestHoverSpan — a span that shows a PR popover on hover
// ---------------------------------------------------------------------------

interface PullRequestHoverSpanProps {
    text: string;
    pullRequests: DetectedPullRequest[];
    testId?: string;
}

function PullRequestHoverSpan({ text, pullRequests, testId }: PullRequestHoverSpanProps) {
    return (
        <HoverSummarySpan
            text={text}
            testId={testId}
            hasContent={pullRequests.length > 0}
            renderPopover={(anchor) => <PullRequestHoverPopover pullRequests={pullRequests} {...anchor} />}
        />
    );
}

// ---------------------------------------------------------------------------
// PushHoverPopover — shown when hovering over "N pushed"
// ---------------------------------------------------------------------------

interface PushHoverPopoverProps {
    pushes: DetectedPush[];
    anchorRef: React.RefObject<HTMLSpanElement | null>;
    popoverRef: React.RefObject<HTMLDivElement | null>;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

/** "remote → branch" label for a detected push (branch falls back to summary). */
function formatPushLabel(push: DetectedPush): string {
    const target = push.branch || push.summary || '';
    return target ? `${push.remote} → ${target}` : push.remote;
}

function PushHoverPopover({ pushes, anchorRef, popoverRef, onMouseEnter, onMouseLeave }: PushHoverPopoverProps) {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const pos = clampPopoverPosition(rect, 460, pushes.length * 32 + 8);

    return ReactDOM.createPortal(
        <div
            ref={popoverRef}
            className="fixed z-50 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg overflow-hidden min-w-[240px] max-w-[460px]"
            style={{ top: pos.top, left: pos.left }}
            data-testid="push-hover-popover"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            {pushes.map((push, idx) => {
                const label = formatPushLabel(push);
                const rowClass = 'flex items-center gap-2 px-2.5 py-1.5 text-xs';
                const inner = (
                    <>
                        <span className="shrink-0" aria-hidden="true">⬆️</span>
                        <span
                            className={cn(
                                'font-mono shrink-0 truncate min-w-0 flex-1',
                                push.url ? 'text-[#0969da] dark:text-[#58a6ff]' : 'text-[#1e1e1e] dark:text-[#ccc]',
                            )}
                        >
                            {label}
                        </span>
                        {push.forced && (
                            <span className="shrink-0 text-[#bb2222] dark:text-[#f87171]" data-testid={`push-popover-force-${idx}`}>
                                (force)
                            </span>
                        )}
                        {push.url && <span className="shrink-0 text-[#848484]" aria-hidden="true">↗</span>}
                    </>
                );
                return push.url ? (
                    <a
                        key={`${push.toolCallId}-${idx}`}
                        href={push.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(rowClass, 'cursor-pointer hover:bg-[#e1effe] dark:hover:bg-[#1f2d42] no-underline')}
                        data-testid={`push-popover-row-${idx}`}
                        onClick={e => e.stopPropagation()}
                        title={push.url}
                        aria-label={`Open pushed branch ${label}`}
                    >
                        {inner}
                    </a>
                ) : (
                    <div
                        key={`${push.toolCallId}-${idx}`}
                        className={rowClass}
                        data-testid={`push-popover-row-${idx}`}
                        title={label}
                    >
                        {inner}
                    </div>
                );
            })}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// PushHoverSpan — a span that shows a push popover on hover
// ---------------------------------------------------------------------------

interface PushHoverSpanProps {
    text: string;
    pushes: DetectedPush[];
    testId?: string;
}

function PushHoverSpan({ text, pushes, testId }: PushHoverSpanProps) {
    return (
        <HoverSummarySpan
            text={text}
            testId={testId}
            hasContent={pushes.length > 0}
            renderPopover={(anchor) => <PushHoverPopover pushes={pushes} {...anchor} />}
        />
    );
}

export function WhisperCollapsedGroup({
    precedingChunks,
    summary,
    toolById,
    toolsWithChildren,
    toolParentById,
    isStreaming,
    groupSingleLineMessages,
    workspaceId,
    renderToolTree,
    onOpenFileDiff,
}: WhisperCollapsedGroupProps) {
    const [expanded, setExpanded] = useState(false);

    // Reconstructable tool calls captured in this group, flattened from the
    // preceding chunks (both standalone tool chunks and tool-groups). This is
    // the primary diff source replayed by `buildWhisperFileDiff` when a file
    // row is clicked.
    const groupToolCalls = useMemo<WhisperDiffToolCall[]>(
        () => collectGroupToolCalls(precedingChunks, toolById),
        [precedingChunks, toolById],
    );

    // A file row opens the converged panel focused on that file (its dropdown
    // selection is pre-set via `focusPath`). Same whole-group payload as the
    // footer — the builder surfaces deleted/non-reconstructable files downstream,
    // so the full ordered list is carried through unchanged.
    const handleFileClick = useCallback(
        (file: FileEdit) => {
            if (!onOpenFileDiff) return;
            onOpenFileDiff({
                files: summary.fileEdits ?? [],
                toolCalls: groupToolCalls,
                commits: summary.commits ?? [],
                workspaceId,
                focusPath: file.path,
            });
        },
        [onOpenFileDiff, summary.fileEdits, groupToolCalls, summary.commits, workspaceId],
    );
    const onFileClick = onOpenFileDiff ? handleFileClick : undefined;

    // The multi-file footer opens the SAME converged panel with no `focusPath`,
    // so it lands on the stacked "All files" view.
    const handleOpenCombined = useCallback(() => {
        if (!onOpenFileDiff) return;
        onOpenFileDiff({
            files: summary.fileEdits ?? [],
            toolCalls: groupToolCalls,
            commits: summary.commits ?? [],
            workspaceId,
        });
    }, [onOpenFileDiff, summary.fileEdits, groupToolCalls, summary.commits, workspaceId]);
    const onOpenCombined = onOpenFileDiff ? handleOpenCombined : undefined;

    const { headerParts, headerTextPlain, duration } = useMemo(
        () => buildWhisperGroupModel(summary),
        [summary],
    );

    const headerElements: React.ReactNode[] = [];
    headerParts.forEach((part, idx) => {
        if (idx > 0) headerElements.push(<span key={`sep-${idx}`}> · </span>);
        if (part.kind === 'commit' && summary.commits && summary.commits.length > 0) {
            headerElements.push(
                <CommitHoverSpan key={`part-${idx}`} text={part.text} commits={summary.commits} workspaceId={workspaceId} testId="whisper-commit-hover" />,
            );
        } else if (part.kind === 'fixup' && summary.fixupCommits && summary.fixupCommits.length > 0) {
            headerElements.push(
                <CommitHoverSpan key={`part-${idx}`} text={part.text} commits={summary.fixupCommits} workspaceId={workspaceId} testId="whisper-fixup-hover" />,
            );
        } else if (part.kind === 'pr' && summary.pullRequests && summary.pullRequests.length > 0) {
            headerElements.push(
                <PullRequestHoverSpan key={`part-${idx}`} text={part.text} pullRequests={summary.pullRequests} testId="whisper-pr-hover" />,
            );
        } else if (part.kind === 'push' && summary.pushes && summary.pushes.length > 0) {
            headerElements.push(
                <PushHoverSpan key={`part-${idx}`} text={part.text} pushes={summary.pushes} testId="whisper-push-hover" />,
            );
        } else if (part.kind === 'file' && summary.fileEdits && summary.fileEdits.length > 0) {
            headerElements.push(
                <FileHoverSpan key={`part-${idx}`} text={part.text} files={summary.fileEdits} testId="whisper-file-hover" onFileClick={onFileClick} onOpenCombined={onOpenCombined} />,
            );
        } else if (part.kind === 'removed-file' && summary.fileEdits && summary.fileEdits.length > 0) {
            headerElements.push(
                <FileHoverSpan key={`part-${idx}`} text={part.text} files={summary.fileEdits} testId="whisper-removed-hover" showInlineTotals={false} onFileClick={onFileClick} onOpenCombined={onOpenCombined} />,
            );
        } else if (part.kind === 'skill' && summary.skillNames && summary.skillNames.length > 0) {
            headerElements.push(
                <SkillHoverSpan key={`part-${idx}`} text={part.text} skillNames={summary.skillNames} testId="whisper-skill-hover" />,
            );
        } else if (part.kind === 'memory' && summary.memoryActions && summary.memoryActions.length > 0) {
            headerElements.push(
                <MemoryHoverSpan key={`part-${idx}`} text={part.text} actions={summary.memoryActions} testId="whisper-memory-hover" />,
            );
        } else {
            headerElements.push(<span key={`part-${idx}`}>{part.text}</span>);
        }
    });
    if (duration) {
        headerElements.push(<span key="duration"> ({duration})</span>);
    }

    // When expanded, apply Compact-level grouping to preceding chunks
    const groupedChunks = useMemo(() => {
        if (!expanded) return [];
        const excludeFromGrouping = new Set([
            ...toolsWithChildren,
            ...toolParentById.keys(),
        ]);
        return groupConsecutiveToolChunks(
            precedingChunks,
            toolById as Map<string, any>,
            excludeFromGrouping,
            { groupSingleLineMessages },
        );
    }, [expanded, precedingChunks, toolById, toolsWithChildren, toolParentById, groupSingleLineMessages]);

    return (
        <div
            className="whisper-collapsed-group rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden"
            data-testid="whisper-collapsed-group"
        >
            <button
                type="button"
                className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 md:px-3 md:py-1.5 text-xs text-left transition-colors',
                    'bg-[#f5f5f5] dark:bg-[#2a2a2a] text-[#848484] hover:bg-[#ebebeb] dark:hover:bg-[#333]',
                    'opacity-70 hover:opacity-100',
                )}
                onClick={() => setExpanded(v => !v)}
                aria-expanded={expanded}
                data-testid="whisper-toggle"
            >
                <span>🔇</span>
                <span className="flex-1 truncate" data-testid="whisper-header-text" title={headerTextPlain}>{headerElements}</span>
                <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
            </button>
            {expanded && (
                <ToolCallVariantProvider value="whisper-row">
                <div className="px-2 py-1.5 space-y-1.5 md:px-3 md:py-2 md:space-y-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] opacity-80 bg-white dark:bg-[#252525]" data-testid="whisper-expanded-content">
                    {(() => {
                        const nodes: React.ReactNode[] = [];
                        let accHtml = '';
                        let accKey = '';
                        const flushContent = () => {
                            if (accKey && accHtml) {
                                nodes.push(<MarkdownView key={accKey} html={accHtml} />);
                                accHtml = '';
                                accKey = '';
                            }
                        };
                        for (const chunk of groupedChunks) {
                            if (chunk.kind === 'content' && (chunk as any).html) {
                                if ((chunk as any).parentToolId && toolById.has((chunk as any).parentToolId)) continue;
                                if (!accKey) accKey = chunk.key;
                                accHtml += (chunk as any).html;
                            } else if (chunk.kind === 'tool' && chunk.toolId) {
                                if (toolParentById.has(chunk.toolId)) continue;
                                const toolNode = renderToolTree(chunk.toolId, 0);
                                if (toolNode !== null) {
                                    flushContent();
                                    const tool = toolById.get(chunk.toolId);
                                    const toolName = normalizeToolName(tool?.toolName ?? '');
                                    if ((toolName === 'powershell' || toolName === 'shell' || toolName === 'bash') && tool?.result) {
                                        const commits = detectCommitsInToolGroup([{
                                            id: chunk.toolId,
                                            toolName,
                                            args: tool.args,
                                            result: tool.result,
                                            status: tool.status,
                                        }]);
                                        if (commits.length > 0) {
                                            nodes.push(
                                                <React.Fragment key={chunk.key + '-with-commit'}>
                                                    {toolNode}
                                                    <CommitStrip commits={commits} workspaceId={workspaceId} />
                                                </React.Fragment>
                                            );
                                            continue;
                                        }
                                    }
                                    nodes.push(toolNode);
                                }
                            } else if (chunk.kind === 'tool-group' && (chunk as any).toolIds) {
                                flushContent();
                                const toolIds = (chunk as any).toolIds as string[];
                                const toolCalls = toolIds
                                    .map(id => toolById.get(id))
                                    .filter((tc): tc is NonNullable<typeof tc> => tc != null) as unknown as RenderToolCall[];
                                const commits = (chunk as any).category === 'shell'
                                    ? detectCommitsInToolGroup(toolCalls as any)
                                    : undefined;
                                nodes.push(
                                    <ToolCallGroupView
                                        key={chunk.key}
                                        category={(chunk as any).category}
                                        toolCalls={toolCalls}
                                        contentItems={(chunk as any).contentItems}
                                        orderedItems={(chunk as any).orderedItems}
                                        isStreaming={!!isStreaming}
                                        compactness={1}
                                        agentId={(chunk as any).agentId}
                                        renderToolTree={renderToolTree}
                                        commits={commits}
                                        workspaceId={workspaceId}
                                    />
                                );
                            }
                        }
                        flushContent();
                        return nodes;
                    })()}
                </div>
                </ToolCallVariantProvider>
            )}
        </div>
    );
}
