/**
 * CommitRow — one commit in the list, plus the swipe wrapper and touch-only
 * overflow button that ride along with it.
 *
 * All behavior arrives as props from the CommitList interaction kernel: the
 * derived view model, the two mutually exclusive drag bundles (reorder handle
 * vs. session-context row drag), the gesture handlers, and the selection
 * click handler. The row itself only decides what to paint.
 */

import { formatRelativeTime } from '../../../utils/format';
import { useSwipeReveal, SWIPE_LEFT_MAX, SWIPE_DETECT_THRESHOLD } from '../../../hooks/ui/useSwipeReveal';
import type { GitCommitContextDragPayload } from '../../chat/sessionContextDrag';
import { isTouchOnly, type GitCommitItem } from './commitListTypes';
import type { CommitRowViewModel } from './commitRowViewModel';
import { CommitRowBadges } from './CommitRowBadges';
import type { useLongPress } from '../../../hooks/ui/useLongPress';

/** Wrapper component that adds swipe-to-reveal gesture to a commit row. */
export function SwipeableCommitRow({ commitHash, shortHash, activeRowId, onReveal, onClose, onSwipeRight, onSwipeDetected, onSwipeAction, disabled, children }: {
    commitHash: string;
    shortHash: string;
    activeRowId: string | null;
    onReveal: (rowId: string) => void;
    onClose: () => void;
    onSwipeRight?: (rowId: string) => void;
    onSwipeDetected?: () => void;
    onSwipeAction?: (action: 'review' | 'ask-ai' | 'more', commitHash: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
}) {
    const { translateX, isSwiping, handlers } = useSwipeReveal({
        rowId: commitHash,
        activeRowId,
        onReveal,
        onClose,
        onSwipeRight,
        onSwipeDetected,
        disabled,
    });

    const showActions = translateX < -SWIPE_DETECT_THRESHOLD;

    return (
        <div className="relative overflow-hidden" data-testid={`commit-swipe-container-${shortHash}`}>
            {/* Action buttons revealed behind the row */}
            {showActions && (
                <div
                    className="absolute inset-y-0 right-0 flex items-stretch z-0"
                    style={{ width: `${SWIPE_LEFT_MAX}px` }}
                    data-testid={`commit-swipe-actions-${shortHash}`}
                >
                    <button
                        type="button"
                        className="flex-1 flex items-center justify-center text-white text-[11px] font-medium"
                        style={{ backgroundColor: '#0078d4' }}
                        onClick={() => onSwipeAction?.('review', commitHash)}
                        data-testid={`commit-swipe-review-${shortHash}`}
                    >
                        Review
                    </button>
                    <button
                        type="button"
                        className="flex-1 flex items-center justify-center text-white text-[11px] font-medium"
                        style={{ backgroundColor: '#8250df' }}
                        onClick={() => onSwipeAction?.('ask-ai', commitHash)}
                        data-testid={`commit-swipe-ask-ai-${shortHash}`}
                    >
                        Ask AI
                    </button>
                    <button
                        type="button"
                        className="flex-1 flex items-center justify-center text-white text-[11px] font-medium rounded-r"
                        style={{ backgroundColor: '#616161' }}
                        onClick={() => onSwipeAction?.('more', commitHash)}
                        data-testid={`commit-swipe-more-${shortHash}`}
                    >
                        ⋮
                    </button>
                </div>
            )}
            {/* Row content — slides left/right */}
            <div
                className="relative z-10 bg-white dark:bg-[#1e1e1e]"
                style={{
                    transform: `translateX(${translateX}px)`,
                    transition: isSwiping ? 'none' : 'transform 0.25s ease-out',
                }}
                {...handlers}
            >
                {children}
            </div>
        </div>
    );
}

export interface CommitRowProps {
    commit: GitCommitItem;
    index: number;
    vm: CommitRowViewModel;
    touchOnly: boolean;
    isMobileSelecting: boolean;
    /** Reorder handle is shown only when the list is reorderable and the commit is unpushed. */
    canDrag: boolean;
    /** Session-context payload, or null when context drag is off for this row. */
    sessionContextPayload: GitCommitContextDragPayload | null;
    handleCommitClick: (commit: GitCommitItem, e: React.MouseEvent) => void;
    handleCommitContextDragStart: (e: React.DragEvent, payload: GitCommitContextDragPayload) => void;
    handleReorderDragStart: (e: React.DragEvent, index: number) => void;
    handleRowMouseEnter: (commit: GitCommitItem, e: React.MouseEvent) => void;
    handleRowMouseLeave: () => void;
    mobileLongPress: ReturnType<typeof useLongPress>;
    longPressCommitHashRef: React.MutableRefObject<string | null>;
    handleCommitOverflowTouchStart: (e: React.TouchEvent<HTMLButtonElement>) => void;
    handleCommitOverflowTouchEnd: (e: React.TouchEvent<HTMLButtonElement>, commitHash: string) => void;
    onCommitContextMenu?: (e: React.MouseEvent, commitHash: string) => void;
    onDoubleClick?: (commit: GitCommitItem) => void;
}

export function CommitRow({
    commit, index, vm, touchOnly, isMobileSelecting, canDrag, sessionContextPayload,
    handleCommitClick, handleCommitContextDragStart, handleReorderDragStart,
    handleRowMouseEnter, handleRowMouseLeave, mobileLongPress, longPressCommitHashRef,
    handleCommitOverflowTouchStart, handleCommitOverflowTouchEnd,
    onCommitContextMenu, onDoubleClick,
}: CommitRowProps) {
    const { isSelected, isUnpushed, isMerge, isLastInGroup, isFixup, fixupEntry, groupColor, avatar } = vm;
    const isContextDragSource = !!sessionContextPayload;

    return (
        <>
            <button
                role="option"
                aria-selected={isSelected}
                data-hash={commit.hash}
                className={`commit-row w-full grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-1 text-left transition-colors border-b border-[#e0e0e0] dark:border-[#3c3c3c] ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 shadow-[inset_3px_0_0_#0078d4] dark:shadow-[inset_3px_0_0_#3794ff]' : 'hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e]'}${isFixup ? ' opacity-70' : ''}${isContextDragSource ? ' cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-sky-300 dark:hover:ring-sky-700' : ''}`}
                onClick={(e) => handleCommitClick(commit, e)}
                onDoubleClick={() => onDoubleClick?.(commit)}
                draggable={isContextDragSource}
                onDragStart={sessionContextPayload ? (e) => handleCommitContextDragStart(e, sessionContextPayload) : undefined}
                onMouseEnter={isTouchOnly() ? undefined : (e) => handleRowMouseEnter(commit, e)}
                onMouseLeave={isTouchOnly() ? undefined : handleRowMouseLeave}
                onTouchStart={touchOnly && onCommitContextMenu ? (e) => { longPressCommitHashRef.current = commit.hash; mobileLongPress.onTouchStart(e); } : undefined}
                onTouchEnd={touchOnly && onCommitContextMenu ? mobileLongPress.onTouchEnd : undefined}
                onTouchMove={touchOnly && onCommitContextMenu ? mobileLongPress.onTouchMove : undefined}
                onContextMenu={(e) => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); onCommitContextMenu?.(e, commit.hash); }}
                data-testid={`commit-row-${commit.shortHash}`}
                data-session-context-source={isContextDragSource ? 'true' : undefined}
                data-session-context-kind={isContextDragSource ? 'commit' : undefined}
                data-fixup-type={fixupEntry?.type}
                data-fixup-target={fixupEntry?.targetHash}
                title={sessionContextPayload ? `${sessionContextPayload.label} - drag to attach as commit context` : undefined}
            >
                {/* Graph column: dot + connector line down to the next commit */}
                <span className="flex flex-col items-center self-stretch pt-1 leading-none">
                    <span
                        className={`text-[10px] flex-shrink-0 ${isUnpushed ? 'text-[#f57c00] dark:text-[#ffb74d]' : isMerge ? 'text-[#8250df] dark:text-[#a371f7]' : 'text-[#0078d4] dark:text-[#3794ff]'}`}
                        style={groupColor ? { color: groupColor } : undefined}
                        data-testid={groupColor ? `fixup-dot-${commit.shortHash}` : undefined}
                        aria-hidden="true"
                    >
                        {isUnpushed ? '●' : '○'}
                    </span>
                    {!isLastInGroup && (
                        <span className="flex-1 w-px bg-[#e0e0e0] dark:bg-[#3c3c3c] mt-0.5" aria-hidden="true" />
                    )}
                </span>

                {/* Body column: subject + inline meta on a single compact row */}
                <span className="min-w-0 flex items-center gap-1.5">
                    {canDrag && (
                        <span
                            className="text-[10px] flex-shrink-0 cursor-grab text-[#848484] hover:text-[#333] dark:hover:text-[#ccc]"
                            title="Drag to reorder"
                            aria-hidden="true"
                            draggable={canDrag}
                            onDragStart={(e) => handleReorderDragStart(e, index)}
                            data-testid={`commit-reorder-handle-${commit.shortHash}`}
                        >
                            ⠿
                        </span>
                    )}
                    {isMobileSelecting && (
                        <span
                            className="text-[13px] flex-shrink-0 text-[#0078d4] dark:text-[#3794ff]"
                            aria-hidden="true"
                            data-testid={`commit-mobile-select-indicator-${commit.shortHash}`}
                        >
                            {isSelected ? '☑' : '☐'}
                        </span>
                    )}
                    {fixupEntry && (
                        <span
                            className="text-[10px] font-bold px-1.5 py-0 rounded-full leading-[18px] flex-shrink-0"
                            style={{ backgroundColor: groupColor, color: '#fff' }}
                            title={`${fixupEntry.type} for ${fixupEntry.targetHash.substring(0, 7)} — ${fixupEntry.displaySubject}`}
                            data-testid={`fixup-pill-${commit.shortHash}`}
                        >
                            {fixupEntry.pillLabel}
                        </span>
                    )}
                    <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1 leading-snug">
                        {isFixup ? fixupEntry!.displaySubject : commit.subject}
                    </span>
                    <span
                        className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full text-[8px] font-semibold flex-shrink-0"
                        style={{ background: avatar.palette.bg, color: avatar.palette.fg }}
                        title={commit.author}
                        aria-hidden="true"
                    >
                        {avatar.initials}
                    </span>
                    <span className="sr-only">{commit.author}</span>
                    <span className={`font-mono text-[11px] flex-shrink-0 ${isUnpushed ? 'text-[#f57c00] dark:text-[#ffb74d]' : 'text-[#0078d4] dark:text-[#3794ff]'}`}>{commit.shortHash}</span>
                    <span className="text-[11px] text-[#848484] dark:text-[#9d9d9d] whitespace-nowrap flex-shrink-0">{formatRelativeTime(commit.date)}</span>
                </span>

                {/* Right column: per-commit mini-flags (comments, fixup count, merge, unpushed) */}
                <CommitRowBadges commit={commit} vm={vm} />
            </button>
            {touchOnly && !isMobileSelecting && onCommitContextMenu && (
                <button
                    type="button"
                    className="absolute right-2 top-1.5 w-9 h-9 rounded text-sm text-[#616161] dark:text-[#ccc] bg-[#f0f0f0]/60 dark:bg-[#333]/60 hover:bg-[#e8e8e8] dark:hover:bg-[#333] touch-manipulation flex items-center justify-center"
                    aria-label={`Open actions for commit ${commit.shortHash}`}
                    onTouchStart={handleCommitOverflowTouchStart}
                    onTouchEnd={(e) => handleCommitOverflowTouchEnd(e, commit.hash)}
                    data-testid={`commit-mobile-actions-${commit.shortHash}`}
                >
                    ⋮
                </button>
            )}
        </>
    );
}
