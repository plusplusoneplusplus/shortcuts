/**
 * CronManagementPanel — pause/resume/cancel list for a conversation's crons,
 * positioned below the CronBadge that opens it.
 */
import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../../ui/cn';
import type { CronEntry } from '@plusplusoneplusplus/coc-client';
import { CronIcon } from './icons/CronIcon';

export interface CronManagementPanelProps {
    crons: CronEntry[];
    isOpen: boolean;
    onClose: () => void;
    onPause: (cronId: string) => Promise<void>;
    onResume: (cronId: string) => Promise<void>;
    onCancel: (cronId: string) => Promise<void>;
}

function formatInterval(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatRelativeTime(isoDate: string | null): string {
    if (!isoDate) return 'never';
    const diff = Date.now() - new Date(isoDate).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
    return `${Math.round(diff / 86_400_000)}d ago`;
}

function formatFutureTime(isoDate: string | null): string {
    if (!isoDate) return '—';
    const diff = new Date(isoDate).getTime() - Date.now();
    if (diff <= 0) return 'due now';
    if (diff < 60_000) return `in ${Math.round(diff / 1000)}s`;
    if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
    if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
    return `in ${Math.round(diff / 86_400_000)}d`;
}

function formatAbsoluteTime(isoDate: string | null): string | undefined {
    if (!isoDate) return undefined;
    return new Date(isoDate).toLocaleString();
}

const STATUS_STYLES: Record<string, string> = {
    active: 'text-[#15703a] dark:text-[#4ade80] bg-[#e6f4ea] dark:bg-[#1a3a2a]',
    paused: 'text-[#b08800] dark:text-[#fbbf24] bg-[#fff8e1] dark:bg-[#3a2f1a]',
    cancelled: 'text-[#848484] bg-[#f0f0f0] dark:bg-[#2d2d2d]',
    expired: 'text-[#848484] bg-[#f0f0f0] dark:bg-[#2d2d2d]',
};

export function CronManagementPanel({ crons, isOpen, onClose, onPause, onResume, onCancel }: CronManagementPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [pending, setPending] = useState<Record<string, boolean>>({});

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const activeCrons = crons.filter(l => l.status === 'active' || l.status === 'paused');
    const inactiveCrons = crons.filter(l => l.status === 'cancelled' || l.status === 'expired');

    async function handleAction(cronId: string, action: () => Promise<void>) {
        setPending(p => ({ ...p, [cronId]: true }));
        try {
            await action();
        } catch { /* ignore */ }
        setPending(p => ({ ...p, [cronId]: false }));
    }

    function renderCron(cron: CronEntry) {
        const isPending = pending[cron.id];
        return (
            <div
                key={cron.id}
                className="flex items-start gap-2 py-2 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] last:border-b-0"
                data-testid={`cron-item-${cron.id}`}
            >
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={cn(
                            'inline-block px-1 py-0 rounded text-[9px] font-semibold uppercase tracking-wider',
                            STATUS_STYLES[cron.status] ?? STATUS_STYLES.cancelled,
                        )}>
                            {cron.status}
                        </span>
                        <span className="text-[10px] text-[#848484] font-mono">
                            every {formatInterval(cron.intervalMs)}
                        </span>
                    </div>
                    <div className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] truncate" title={cron.description || cron.prompt}>
                        {cron.description || cron.prompt.substring(0, 60)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[9px] text-[#848484]">
                        <span>Ticks: {cron.tickCount}</span>
                        <span>·</span>
                        <span>Last: {formatRelativeTime(cron.lastTickAt)}</span>
                        {cron.status === 'active' && cron.nextTickAt && (
                            <>
                                <span>·</span>
                                <span
                                    className="text-[#15703a] dark:text-[#4ade80]"
                                    title={formatAbsoluteTime(cron.nextTickAt)}
                                    data-testid={`cron-next-${cron.id}`}
                                >
                                    Next: {formatFutureTime(cron.nextTickAt)}
                                </span>
                            </>
                        )}
                        {cron.pausedReason && (
                            <>
                                <span>·</span>
                                <span className="text-[#b08800] dark:text-[#fbbf24]" title={cron.pausedReason}>
                                    {cron.pausedReason}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {cron.status === 'active' && (
                        <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[#d0d0d0] dark:border-[#505050] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors disabled:opacity-50"
                            onClick={() => handleAction(cron.id, () => onPause(cron.id))}
                            disabled={isPending}
                            title="Pause cron"
                            data-testid={`cron-pause-${cron.id}`}
                        >
                            ⏸
                        </button>
                    )}
                    {cron.status === 'paused' && (
                        <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[#b7e1cd] dark:border-[#2a5a3a] text-[#15703a] dark:text-[#4ade80] hover:bg-[#e6f4ea] dark:hover:bg-[#1a3a2a] transition-colors disabled:opacity-50"
                            onClick={() => handleAction(cron.id, () => onResume(cron.id))}
                            disabled={isPending}
                            title="Resume cron"
                            data-testid={`cron-resume-${cron.id}`}
                        >
                            ▶
                        </button>
                    )}
                    {(cron.status === 'active' || cron.status === 'paused') && (
                        <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[#f5c2c2] dark:border-[#7a3030] text-[#cf222e] dark:text-[#f87171] hover:bg-[#ffebe9] dark:hover:bg-[#3a1a1a] transition-colors disabled:opacity-50"
                            onClick={() => handleAction(cron.id, () => onCancel(cron.id))}
                            disabled={isPending}
                            title="Cancel cron"
                            data-testid={`cron-cancel-${cron.id}`}
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            ref={panelRef}
            className={cn(
                'absolute top-full left-0 mt-1 z-50 w-[320px] max-h-[400px] overflow-y-auto',
                'rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c]',
                'bg-white dark:bg-[#1e1e1e] shadow-lg',
            )}
            data-testid="cron-management-panel"
        >
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-[11px] font-semibold text-[#1e1e1e] dark:text-[#cccccc] inline-flex items-center gap-1">
                    <CronIcon className="w-3.5 h-3.5" />
                    <span>Crons ({crons.length})</span>
                </span>
            </div>
            {crons.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-[#848484] text-center">
                    No crons for this conversation
                </div>
            ) : (
                <>
                    {activeCrons.map(renderCron)}
                    {inactiveCrons.length > 0 && activeCrons.length > 0 && (
                        <div className="px-3 py-1 text-[9px] text-[#848484] uppercase tracking-wider font-semibold bg-[#f8f8f8] dark:bg-[#252525]">
                            Inactive
                        </div>
                    )}
                    {inactiveCrons.map(renderCron)}
                </>
            )}
        </div>
    );
}
