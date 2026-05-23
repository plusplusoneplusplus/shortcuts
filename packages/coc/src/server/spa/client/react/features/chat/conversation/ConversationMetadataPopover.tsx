import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { formatDuration } from '../../../utils/format';
import { isQueueProcessId, toTaskId } from '../../../utils/queue-process-id';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { BottomSheet } from '../../../ui/BottomSheet';
import { Dialog } from '../../../ui/Dialog';
import { getRalphContext } from '../../../../../../tasks/task-types';

const RALPH_FIELD_TRUNCATE = 200;

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + '…';
}

interface MetaRow {
    label: string;
    value: string;
    breakAll?: boolean;
    mono?: boolean;
    link?: string;
}

function toStringValue(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return null;
}

function formatTimestamp(value: unknown): string | null {
    const raw = toStringValue(value);
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString();
}

function parseSessionIdFromResult(result: unknown): string | null {
    if (typeof result !== 'string' || !result.trim()) return null;
    try {
        const parsed = JSON.parse(result);
        return toStringValue((parsed as any)?.sessionId);
    } catch {
        return null;
    }
}

export function getSessionIdFromProcess(process: any): string | null {
    if (!process) return null;
    return toStringValue(process.sdkSessionId)
        || toStringValue(process.sessionId)
        || parseSessionIdFromResult(process.result);
}

function getAgentNameFromProcess(process: any): string | null {
    return toStringValue(process?.metadata?.agentName)
        || toStringValue(process?.metadata?.agent)
        || toStringValue(process?.metadata?.provider)
        || toStringValue(process?.agentName)
        || toStringValue(process?.provider);
}

export function buildRows(process: any, turnsCount?: number): MetaRow[] {
    if (!process) return [];

    const rows: MetaRow[] = [];
    const push = (label: string, value: unknown, opts?: { breakAll?: boolean; mono?: boolean; link?: string }) => {
        const str = toStringValue(value);
        if (!str) return;
        rows.push({ label, value: str, breakAll: opts?.breakAll, mono: opts?.mono, link: opts?.link });
    };

    const processId = toStringValue(process.id);
    const queueTaskId = toStringValue(process?.metadata?.queueTaskId)
        || (processId && isQueueProcessId(processId) ? toTaskId(processId) : null);
    const startedAt = process.startTime || process.startedAt || process.createdAt;
    const endedAt = process.endTime || process.completedAt;
    const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
    const endedMs = endedAt ? new Date(endedAt).getTime() : NaN;
    const computedDuration = Number.isFinite(startedMs) && Number.isFinite(endedMs)
        ? Math.max(0, endedMs - startedMs)
        : undefined;
    const duration = typeof process.duration === 'number' ? process.duration : computedDuration;
    const sessionId = getSessionIdFromProcess(process);

    push('Process ID', process.id, { breakAll: true, mono: true });
    push('Queue Task ID', queueTaskId, { breakAll: true, mono: true });
    push('Type', process.type);
    push('Status', process.status);
    push('Model', process?.metadata?.model || process?.config?.model || process?.model || 'default');
    push('Mode', process?.metadata?.mode || process?.mode);
    push('Agent Provider', getAgentNameFromProcess(process));
    push('Session ID', sessionId, { breakAll: true, mono: true, link: sessionId ? `#logs?sessionId=${encodeURIComponent(sessionId)}` : undefined });
    push('Backend', process?.metadata?.backend);
    push('Started', formatTimestamp(startedAt));
    push('Ended', formatTimestamp(endedAt));
    push('Duration', duration != null ? formatDuration(duration) : null);
    push('Working Directory', process.workingDirectory || process?.payload?.workingDirectory, { breakAll: true });
    push('Workspace', process.workspaceName || process.workspaceId || process?.metadata?.workspaceId);
    if (typeof turnsCount === 'number' && turnsCount >= 0) {
        push('Turns', turnsCount);
    }
    push('File Path', process.dataFilePath, { breakAll: true, mono: true });

    const ralph = getRalphContext(process);
    if (ralph) {
        push('Ralph · Phase', ralph.phase);
        push('Ralph · Session ID', ralph.sessionId, { breakAll: true, mono: true });
        if (typeof ralph.currentIteration === 'number') {
            push('Ralph · Iteration', ralph.currentIteration);
        }
        if (ralph.originalGoal) {
            push('Ralph · Goal', truncate(ralph.originalGoal, RALPH_FIELD_TRUNCATE), { breakAll: true });
        }
    }

    return rows;
}

export interface ConversationMetadataPopoverProps {
    process: any;
    turnsCount?: number;
    /** When provided, a "Resume In CLI" action button is shown at the bottom of the popover. */
    resumeSessionId?: string | null;
    resumeLaunching?: boolean;
    onLaunchInteractiveResume?: () => void;
    /** When provided, a "Fork conversation" action button is shown at the bottom of the popover. */
    onFork?: () => void;
    forking?: boolean;
}

export function ConversationMetadataPopover({ process, turnsCount, resumeSessionId, resumeLaunching, onLaunchInteractiveResume, onFork, forking }: ConversationMetadataPopoverProps) {
    const [open, setOpen] = useState(false);
    const [systemPromptOpen, setSystemPromptOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const rows = useMemo(() => buildRows(process, turnsCount), [process, turnsCount]);
    const { isMobile } = useBreakpoint();

    const handleToggle = useCallback(() => {
        if (open) {
            setOpen(false);
            return;
        }
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, left: rect.right });
        setOpen(true);
    }, [open]);

    // Correct popover overflow after render
    useEffect(() => {
        if (!open || !popoverRef.current || !triggerRef.current) return;
        const popover = popoverRef.current;
        const trigger = triggerRef.current;
        const popoverRect = popover.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();

        let { top, left } = menuPos;
        // Align right edge of popover with right edge of trigger
        left = triggerRect.right - popoverRect.width;
        if (left < 8) left = 8;
        if (left + popoverRect.width > window.innerWidth - 8) {
            left = window.innerWidth - popoverRect.width - 8;
        }
        if (top + popoverRect.height > window.innerHeight - 8) {
            top = triggerRect.top - popoverRect.height - 4;
        }
        if (top < 8) top = 8;
        if (top !== menuPos.top || left !== menuPos.left) {
            setMenuPos({ top, left });
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (popoverRef.current?.contains(target)) return;
            if (triggerRef.current?.contains(target)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('touchstart', handler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('touchstart', handler);
        };
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    if (rows.length === 0) return null;

    const popoverContent = (
        <>
            <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">
                Conversation metadata
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-xs">
                {rows.map((row) => (
                    <div key={row.label} className="contents">
                        <span className="text-[#848484]">{row.label}</span>
                        {row.link ? (
                            <div className={[
                                'flex flex-wrap items-baseline gap-x-1.5',
                                row.breakAll ? 'break-all' : 'break-words',
                                row.mono ? 'font-mono' : '',
                            ].join(' ')}>
                                <span className="text-[#1e1e1e] dark:text-[#cccccc]">
                                    {row.value}
                                </span>
                                <a
                                    href={row.link}
                                    className="text-[#0078d4] dark:text-[#3794ff] hover:underline text-[10px]"
                                    title="View logs for this session"
                                >
                                    🔍 logs
                                </a>
                            </div>
                        ) : (
                            <span
                                className={[
                                    'text-[#1e1e1e] dark:text-[#cccccc]',
                                    row.breakAll ? 'break-all' : 'break-words',
                                    row.mono ? 'font-mono' : '',
                                ].join(' ')}
                            >
                                {row.value}
                            </span>
                        )}
                    </div>
                ))}
                {process?.metadata?.systemPrompt && (
                    <div className="contents">
                        <span className="text-[#848484]">System Prompt</span>
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="text-[#1e1e1e] dark:text-[#cccccc]">
                                {(process.metadata.systemPrompt as string).length.toLocaleString()} chars
                            </span>
                            <button
                                type="button"
                                className="text-[#0078d4] dark:text-[#3794ff] hover:underline text-[10px]"
                                title="View full system prompt"
                                onClick={() => { setOpen(false); setSystemPromptOpen(true); }}
                            >
                                👁 view
                            </button>
                        </div>
                    </div>
                )}
            </div>
            {(resumeSessionId && onLaunchInteractiveResume || onFork) && (
                <div className="mt-3 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-wrap gap-2">
                    {resumeSessionId && onLaunchInteractiveResume && (
                        <button
                            type="button"
                            disabled={resumeLaunching}
                            onClick={() => { onLaunchInteractiveResume(); setOpen(false); }}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#0078d4] dark:text-[#3794ff] border border-[#0078d4] dark:border-[#3794ff] hover:bg-[#e8f0fb] dark:hover:bg-[#1a2a40] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <span>▶</span>
                            {resumeLaunching ? 'Launching…' : 'Resume In CLI'}
                        </button>
                    )}
                    {onFork && (
                        <button
                            type="button"
                            disabled={forking}
                            onClick={() => { onFork(); setOpen(false); }}
                            title="Fork this conversation into a new independent chat"
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[#0078d4] dark:text-[#3794ff] border border-[#0078d4] dark:border-[#3794ff] hover:bg-[#e8f0fb] dark:hover:bg-[#1a2a40] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <span>🍴</span>
                            {forking ? 'Forking…' : 'Fork'}
                        </button>
                    )}
                </div>
            )}
        </>
    );

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={open ? 'Hide conversation metadata' : 'Show conversation metadata'}
                title="Conversation metadata"
                className="inline-flex items-center justify-center w-[26px] h-[26px] rounded text-[12px] font-semibold italic text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
                onClick={handleToggle}
            >
                i
            </button>

            {open && isMobile && (
                <BottomSheet isOpen={true} onClose={() => setOpen(false)}>
                    <div className="p-4">
                        {popoverContent}
                    </div>
                </BottomSheet>
            )}

            {open && !isMobile && ReactDOM.createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[10003] w-[480px] max-w-[calc(100vw-16px)] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-3 shadow-lg"
                    style={{ top: menuPos.top, left: menuPos.left }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    {popoverContent}
                </div>,
                document.body
            )}

            <Dialog
                open={systemPromptOpen}
                onClose={() => setSystemPromptOpen(false)}
                title="System Prompt"
                className="max-w-[700px]"
            >
                <pre className="whitespace-pre-wrap break-words text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] overflow-y-auto max-h-[60vh] p-3 bg-[#f5f5f5] dark:bg-[#1e1e1e] rounded">
                    {process?.metadata?.systemPrompt as string}
                </pre>
            </Dialog>
        </>
    );
}
