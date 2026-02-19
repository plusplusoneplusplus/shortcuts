import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '../utils/format';

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
    const sessionId = toStringValue(process.sdkSessionId)
        || toStringValue(process.sessionId)
        || parseSessionIdFromResult(process.result);

    push('Process ID', process.id, { breakAll: true, mono: true });
    push('Queue Task ID', queueTaskId, { breakAll: true, mono: true });
    push('Type', process.type);
    push('Status', process.status);
    push('Model', process?.metadata?.model || process?.config?.model || process?.model);
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
    const rootRef = useRef<HTMLDivElement | null>(null);
    const rows = useMemo(() => buildRows(process, turnsCount), [process, turnsCount]);

    useEffect(() => {
        if (!open) return;

        const handleOutsidePointer = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (!target || !rootRef.current) return;
            if (!rootRef.current.contains(target)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsidePointer);
        document.addEventListener('touchstart', handleOutsidePointer);
        return () => {
            document.removeEventListener('mousedown', handleOutsidePointer);
            document.removeEventListener('touchstart', handleOutsidePointer);
        };
    }, [open]);

    if (rows.length === 0) return null;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-label={open ? 'Hide conversation metadata' : 'Show conversation metadata'}
                title="Conversation metadata"
                className="h-6 w-6 rounded-full border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-semibold text-[#4f4f4f] dark:text-[#cccccc] bg-white dark:bg-[#1f1f1f] hover:border-[#0078d4] dark:hover:border-[#3794ff] transition-colors"
                onClick={() => setOpen((prev) => !prev)}
            >
                i
            </button>

            {open && (
                <div className="absolute right-0 top-7 z-20 w-[360px] max-w-[calc(100vw-24px)] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] p-3 shadow-lg">
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
                </div>
            )}
        </div>
    );
}
