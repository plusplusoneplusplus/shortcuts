/**
 * QuickAskSidenotePopover — compact popover showing a side-note's quoted term
 * and AI answer, with Copy / Retry / Dismiss actions. Reuses the CommentPopover
 * shell styling; falls back to a BottomSheet on mobile.
 */

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Spinner } from '../../../ui';
import { clampToViewport } from '../../../tasks/comments/viewportUtils';
import { MarkdownView } from '../../../shared/MarkdownView';
import { renderMarkdownToHtml } from '../../../../diff/markdown-renderer';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { BottomSheet } from '../../../ui/BottomSheet';
import { buildQuickAskTranscript, type ClientSideNote, type QuickAskTurn } from './types';

const ACTION_BTN = 'inline-flex items-center justify-center h-6 px-1.5 gap-1 rounded transition-colors text-[11px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';
const ICON_BTN = 'inline-flex items-center justify-center h-6 w-6 shrink-0 rounded transition-colors text-[12px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

/**
 * Optional reply control that turns the one-shot popover into a multi-turn
 * thread (notes editor + PDF/paper surfaces only — AC-02). When present the
 * popover renders {@link QuickAskReply.turns} as stacked Q/A blocks plus an
 * always-visible reply row (input + icon-only Copy/Dismiss). Chat side-notes
 * omit it and render exactly as before (mirrors the optional `resolve` prop).
 */
export interface QuickAskReply {
    /** The full thread — turn 0 is the original ask, later turns are follow-ups. */
    turns: QuickAskTurn[];
    /** Send a new follow-up question (already trimmed non-empty). */
    onSend: (question: string) => void;
    /** Retry a per-turn error, keyed by turn index. */
    onRetry: (turnIndex: number) => void;
    /** A follow-up is in flight → the input is disabled to prevent double-send. */
    disabled?: boolean;
    /** The soft cap has been hit → the input is disabled and a notice shows. */
    atCap?: boolean;
    /** Soft cap size, shown in the at-cap notice. */
    maxTurns?: number;
}

export interface QuickAskSidenotePopoverProps {
    note: ClientSideNote;
    position: { top: number; left: number };
    onClose: () => void;
    /**
     * Copy the side-note. In reply mode `text` carries the whole thread
     * transcript (AC-03); one-shot callers ignore it and copy `note.answer`.
     */
    onCopy: (note: ClientSideNote, text?: string) => void;
    onRetry: (id: string) => void;
    onDelete: (id: string) => void;
    /**
     * Optional resolve/reopen control (paper annotations only, Goal 4 AC-02).
     * Chat side-notes omit it → no button is rendered.
     */
    resolve?: {
        resolved: boolean;
        onToggle: (id: string, resolved: boolean) => void;
    };
    /**
     * Optional multi-turn reply control (notes + PDF surfaces). Chat side-notes
     * omit it → the popover renders exactly its one-shot form.
     */
    reply?: QuickAskReply;
}

/** One Q/A block in the multi-turn thread body. Reuses the same test ids as the
 * single-turn body so a one-turn thread is indistinguishable from today's. */
function ThreadTurn({ turn, index, onRetry }: {
    turn: QuickAskTurn;
    index: number;
    onRetry: (turnIndex: number) => void;
}) {
    return (
        <div className="flex flex-col gap-1" data-testid="quick-ask-thread-turn">
            {turn.question && (
                <div
                    className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="quick-ask-popover-question"
                >
                    <span className="font-medium text-[#3794ff]">Q:</span>{' '}
                    {turn.question}
                </div>
            )}
            {turn.status === 'asking' && (
                <div className="flex items-center gap-2 text-[11px] text-[#848484]" data-testid="quick-ask-popover-loading">
                    <Spinner size="sm" /> asking…
                </div>
            )}
            {turn.status === 'error' && (
                <div
                    className="flex items-center gap-2 p-1.5 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400"
                    data-testid="quick-ask-popover-error"
                >
                    <span className="flex-1">{turn.error || 'Lookup failed'}</span>
                    <button className={ACTION_BTN} onClick={() => onRetry(index)} data-testid="quick-ask-popover-retry">
                        ↻ Retry
                    </button>
                </div>
            )}
            {turn.status === 'ready' && (
                <div className="text-[12px] text-[#1e1e1e] dark:text-[#cccccc]" data-testid="quick-ask-popover-answer">
                    <MarkdownView html={renderMarkdownToHtml(turn.answer)} />
                </div>
            )}
        </div>
    );
}

export function QuickAskSidenotePopover({
    note,
    position,
    onClose,
    onCopy,
    onRetry,
    onDelete,
    resolve,
    reply,
}: QuickAskSidenotePopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [clampedPos, setClampedPos] = useState(position);
    const [copied, setCopied] = useState(false);
    const [replyText, setReplyText] = useState('');
    const { isMobile } = useBreakpoint();

    useEffect(() => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setClampedPos(clampToViewport(position, rect.width, rect.height));
        }
    }, [position]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {onClose();}
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    // Dismiss when the user clicks outside the popover. Clicks on a side-note
    // chip are ignored so the chip's own activation logic can toggle/switch the
    // open note instead of this closing it out from under that click.
    useEffect(() => {
        if (isMobile) {return;}
        const onDown = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (ref.current?.contains(target)) {return;}
            if (target?.closest('[data-testid^="quick-ask-chip"]')) {return;}
            onClose();
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [isMobile, onClose]);

    const handleCopy = () => {
        // In reply mode copy the whole transcript (all ready turns); the one-shot
        // path copies just the single answer (handled by the driver from `note`).
        onCopy(note, reply ? buildQuickAskTranscript(reply.turns) : undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };

    const replyBlocked = !!reply && (!!reply.disabled || !!reply.atCap);
    const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter (no modifier) sends; Shift+Enter inserts a newline.
        if (e.key !== 'Enter' || e.shiftKey) {return;}
        e.preventDefault();
        if (!reply || replyBlocked) {return;}
        const trimmed = replyText.trim();
        if (!trimmed) {return;} // empty → no-op
        reply.onSend(trimmed);
        setReplyText('');
    };

    // A one-turn thread is shown identically to today's single answer; a thread
    // with at least one ready turn enables Copy.
    const threadReady = reply
        ? reply.turns.some(t => t.status === 'ready')
        : note.status === 'ready';

    const content = (
        <>
            {/* Header */}
            <div className="flex items-center gap-1.5">
                <span className="text-[12px]" aria-hidden="true">💡</span>
                <span className="text-[11px] font-medium text-[#3794ff]">Quick answer</span>
                {note.createdAt && note.status === 'ready' && (
                    <span className="text-[10px] text-[#a0a0a0] ml-auto shrink-0">
                        {new Date(note.createdAt).toLocaleString()}
                    </span>
                )}
                {!isMobile && (
                    <button
                        className={`shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] text-sm leading-none ${note.createdAt && note.status === 'ready' ? '' : 'ml-auto'}`}
                        onClick={onClose}
                        data-testid="quick-ask-popover-close"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                )}
            </div>

            {/* Quoted term */}
            <blockquote className="border-l-2 border-[#3794ff] pl-2 text-[11px] text-[#848484] italic line-clamp-2">
                {note.anchor.selectedText.length > 200
                    ? note.anchor.selectedText.slice(0, 200) + '…'
                    : note.anchor.selectedText}
            </blockquote>

            {/* Custom question (AC-03) — omitted entirely for the default-explain
                case. In reply mode each thread turn renders its own Q line. */}
            {!reply && note.question && (
                <div
                    className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="quick-ask-popover-question"
                >
                    <span className="font-medium text-[#3794ff]">Q:</span>{' '}
                    {note.question}
                </div>
            )}

            {/* Body — multi-turn thread when a reply control is present, else the
                one-shot single answer (chat side-notes, unchanged). */}
            {reply ? (
                <div
                    className="flex flex-col gap-2 max-h-[240px] overflow-y-auto"
                    data-testid="quick-ask-thread"
                >
                    {reply.turns.map((turn, i) => (
                        <ThreadTurn key={i} turn={turn} index={i} onRetry={reply.onRetry} />
                    ))}
                </div>
            ) : (
                <>
                    {note.status === 'asking' && (
                        <div className="flex items-center gap-2 text-[11px] text-[#848484]" data-testid="quick-ask-popover-loading">
                            <Spinner size="sm" /> asking…
                        </div>
                    )}
                    {note.status === 'error' && (
                        <div
                            className="flex items-center gap-2 p-1.5 rounded bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400"
                            data-testid="quick-ask-popover-error"
                        >
                            <span className="flex-1">{note.error || 'Lookup failed'}</span>
                            <button className={ACTION_BTN} onClick={() => onRetry(note.id)} data-testid="quick-ask-popover-retry">
                                ↻ Retry
                            </button>
                        </div>
                    )}
                    {note.status === 'ready' && (
                        <div className="max-h-[200px] overflow-y-auto text-[12px] text-[#1e1e1e] dark:text-[#cccccc]" data-testid="quick-ask-popover-answer">
                            <MarkdownView html={renderMarkdownToHtml(note.answer)} />
                        </div>
                    )}
                </>
            )}

            {/* At-cap notice (reply mode only). */}
            {reply?.atCap && (
                <div
                    className="text-[10px] text-[#a0a0a0] italic"
                    data-testid="quick-ask-reply-cap-notice"
                >
                    Follow-up limit reached{reply.maxTurns ? ` (max ${reply.maxTurns} turns)` : ''}.
                </div>
            )}

            {/* Actions / reply row. In reply mode Copy + Dismiss collapse to
                icon-only buttons sharing the always-visible follow-up input row. */}
            {reply ? (
                <div className="flex items-center gap-1 pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <textarea
                        rows={1}
                        className="flex-1 min-w-0 resize-none bg-transparent text-[12px] text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#a0a0a0] outline-none disabled:opacity-50"
                        placeholder={reply.atCap ? 'Follow-up limit reached' : 'Ask a follow-up…'}
                        value={replyText}
                        disabled={replyBlocked}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={handleReplyKeyDown}
                        data-testid="quick-ask-reply-input"
                        aria-label="Ask a follow-up"
                    />
                    {threadReady && (
                        <button className={ICON_BTN} onClick={handleCopy} title={copied ? 'Copied' : 'Copy transcript'} data-testid="quick-ask-popover-copy">
                            {copied ? '✓' : '⧉'}
                        </button>
                    )}
                    {resolve && threadReady && (
                        <button
                            className={ICON_BTN}
                            onClick={() => { resolve.onToggle(note.id, !resolve.resolved); onClose(); }}
                            title={resolve.resolved ? 'Reopen this annotation' : 'Mark this annotation resolved'}
                            data-testid="quick-ask-popover-resolve"
                        >
                            {resolve.resolved ? '↺' : '✓'}
                        </button>
                    )}
                    <button
                        className={ICON_BTN}
                        onClick={() => { onDelete(note.id); onClose(); }}
                        title="Dismiss side-note"
                        data-testid="quick-ask-popover-dismiss"
                    >
                        🗑
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-1 pt-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {note.status === 'ready' && (
                        <button className={ACTION_BTN} onClick={handleCopy} title="Copy answer" data-testid="quick-ask-popover-copy">
                            {copied ? '✓ Copied' : '⧉ Copy'}
                        </button>
                    )}
                    {resolve && note.status === 'ready' && (
                        <button
                            className={ACTION_BTN}
                            onClick={() => { resolve.onToggle(note.id, !resolve.resolved); onClose(); }}
                            title={resolve.resolved ? 'Reopen this annotation' : 'Mark this annotation resolved'}
                            data-testid="quick-ask-popover-resolve"
                        >
                            {resolve.resolved ? '↺ Reopen' : '✓ Resolve'}
                        </button>
                    )}
                    <button
                        className={`${ACTION_BTN} ml-auto`}
                        onClick={() => { onDelete(note.id); onClose(); }}
                        title="Dismiss side-note"
                        data-testid="quick-ask-popover-dismiss"
                    >
                        🗑 Dismiss
                    </button>
                </div>
            )}
        </>
    );

    if (isMobile) {
        return (
            <BottomSheet isOpen={true} onClose={onClose}>
                <div className="p-4 flex flex-col gap-1.5" data-testid="quick-ask-popover">
                    {content}
                </div>
            </BottomSheet>
        );
    }

    return ReactDOM.createPortal(
        <div
            ref={ref}
            className="fixed z-[10003] min-w-[300px] max-w-[380px] rounded-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl p-2.5 flex flex-col gap-1.5 overflow-hidden"
            style={{ top: clampedPos.top, left: clampedPos.left }}
            data-testid="quick-ask-popover"
        >
            {content}
        </div>,
        document.body,
    );
}
