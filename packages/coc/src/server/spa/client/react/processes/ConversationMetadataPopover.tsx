import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { formatDuration } from '../utils/format';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { BottomSheet } from '../shared/BottomSheet';

interface MetaRow {
    label: string;
    value: string;
    breakAll?: boolean;
    mono?: boolean;
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

function buildRows(process: any, turnsCount?: number): MetaRow[] {
    if (!process) return [];

    const rows: MetaRow[] = [];
    const push = (label: string, value: unknown, opts?: { breakAll?: boolean; mono?: boolean }) => {
        const str = toStringValue(value);
        if (!str) return;
        rows.push({ label, value: str, breakAll: opts?.breakAll, mono: opts?.mono });
    };

    const processId = toStringValue(process.id);
    const queueTaskId = toStringValue(process?.metadata?.queueTaskId)
        || (processId?.startsWith('queue_') ? processId.slice('queue_'.length) : null);
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
    push('Model', process?.metadata?.model || process?.config?.model || process?.model);
    push('Mode', process?.metadata?.mode || process?.mode);
    push('Session ID', sessionId, { breakAll: true, mono: true });
    push('Backend', process?.metadata?.backend);
    push('Started', formatTimestamp(startedAt));
    push('Ended', formatTimestamp(endedAt));
    push('Duration', duration != null ? formatDuration(duration) : null);
    push('Working Directory', process.workingDirectory || process?.payload?.workingDirectory, { breakAll: true });
    push('Workspace', process.workspaceName || process.workspaceId || process?.metadata?.workspaceId);
    if (typeof turnsCount === 'number' && turnsCount >= 0) {
        push('Turns', turnsCount);
    }

    return rows;
}

export function ConversationMetadataPopover({ process, turnsCount }: { process: any; turnsCount?: number }) {
    const [open, setOpen] = useState(false);
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
                        <span
                            className={[
                                'text-[#1e1e1e] dark:text-[#cccccc]',
                                row.breakAll ? 'break-all' : 'break-words',
                                row.mono ? 'font-mono' : '',
                            ].join(' ')}
                        >
                            {row.value}
                        </span>
                    </div>
                ))}
            </div>
        </>
    );

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={open ? 'Hide conversation metadata' : 'Show conversation metadata'}
                title="Conversation metadata"
                className="h-6 w-6 rounded-full border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-semibold text-[#4f4f4f] dark:text-[#cccccc] bg-white dark:bg-[#1f1f1f] hover:border-[#0078d4] dark:hover:border-[#3794ff] transition-colors"
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
                    className="fixed z-50 w-[480px] max-w-[calc(100vw-16px)] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-3 shadow-lg"
                    style={{ top: menuPos.top, left: menuPos.left }}
                >
                    {popoverContent}
                </div>,
                document.body
            )}
        </>
    );
}
