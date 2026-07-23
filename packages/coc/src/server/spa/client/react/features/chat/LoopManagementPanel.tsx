/**
 * LoopManagementPanel — dropdown/popover panel for managing loops on a conversation.
 *
 * Shows a list of loops with status, description, and action buttons
 * (pause/resume/cancel). Rendered as a positioned panel below the LoopBadge.
 */
import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../../ui/cn';
import type { LoopEntry } from '@plusplusoneplusplus/coc-client';
import { LoopIcon } from './icons/LoopIcon';

export interface LoopManagementPanelProps {
    loops: LoopEntry[];
    isOpen: boolean;
    onClose: () => void;
    onPause: (loopId: string) => Promise<void>;
    onResume: (loopId: string) => Promise<void>;
    onCancel: (loopId: string) => Promise<void>;
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

export function LoopManagementPanel({ loops, isOpen, onClose, onPause, onResume, onCancel }: LoopManagementPanelProps) {
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

    const activeLoops = loops.filter(l => l.status === 'active' || l.status === 'paused');
    const inactiveLoops = loops.filter(l => l.status === 'cancelled' || l.status === 'expired');

    async function handleAction(loopId: string, action: () => Promise<void>) {
        setPending(p => ({ ...p, [loopId]: true }));
        try {
            await action();
        } catch { /* ignore */ }
        setPending(p => ({ ...p, [loopId]: false }));
    }

    function renderLoop(loop: LoopEntry) {
        const isPending = pending[loop.id];
        return (
            <div
                key={loop.id}
                className="flex items-start gap-2 py-2 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] last:border-b-0"
                data-testid={`loop-item-${loop.id}`}
            >
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={cn(
                            'inline-block px-1 py-0 rounded text-[9px] font-semibold uppercase tracking-wider',
                            STATUS_STYLES[loop.status] ?? STATUS_STYLES.cancelled,
                        )}>
                            {loop.status}
                        </span>
                        <span className="text-[10px] text-[#848484] font-mono">
                            every {formatInterval(loop.intervalMs)}
                        </span>
                    </div>
                    <div className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] truncate" title={loop.description || loop.prompt}>
                        {loop.description || loop.prompt.substring(0, 60)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[9px] text-[#848484]">
                        <span>Ticks: {loop.tickCount}</span>
                        <span>·</span>
                        <span>Last: {formatRelativeTime(loop.lastTickAt)}</span>
                        {loop.status === 'active' && loop.nextTickAt && (
                            <>
                                <span>·</span>
                                <span
                                    className="text-[#15703a] dark:text-[#4ade80]"
                                    title={formatAbsoluteTime(loop.nextTickAt)}
                                    data-testid={`loop-next-${loop.id}`}
                                >
                                    Next: {formatFutureTime(loop.nextTickAt)}
                                </span>
                            </>
                        )}
                        {loop.pausedReason && (
                            <>
                                <span>·</span>
                                <span className="text-[#b08800] dark:text-[#fbbf24]" title={loop.pausedReason}>
                                    {loop.pausedReason}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {loop.status === 'active' && (
                        <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[#d0d0d0] dark:border-[#505050] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors disabled:opacity-50"
                            onClick={() => handleAction(loop.id, () => onPause(loop.id))}
                            disabled={isPending}
                            title="Pause loop"
                            data-testid={`loop-pause-${loop.id}`}
                        >
                            ⏸
                        </button>
                    )}
                    {loop.status === 'paused' && (
                        <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[#b7e1cd] dark:border-[#2a5a3a] text-[#15703a] dark:text-[#4ade80] hover:bg-[#e6f4ea] dark:hover:bg-[#1a3a2a] transition-colors disabled:opacity-50"
                            onClick={() => handleAction(loop.id, () => onResume(loop.id))}
                            disabled={isPending}
                            title="Resume loop"
                            data-testid={`loop-resume-${loop.id}`}
                        >
                            ▶
                        </button>
                    )}
                    {(loop.status === 'active' || loop.status === 'paused') && (
                        <button
                            className="text-[10px] px-1.5 py-0.5 rounded border border-[#f5c2c2] dark:border-[#7a3030] text-[#cf222e] dark:text-[#f87171] hover:bg-[#ffebe9] dark:hover:bg-[#3a1a1a] transition-colors disabled:opacity-50"
                            onClick={() => handleAction(loop.id, () => onCancel(loop.id))}
                            disabled={isPending}
                            title="Cancel loop"
                            data-testid={`loop-cancel-${loop.id}`}
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
            data-testid="loop-management-panel"
        >
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-[11px] font-semibold text-[#1e1e1e] dark:text-[#cccccc] inline-flex items-center gap-1">
                    <LoopIcon className="w-3.5 h-3.5" />
                    <span>Loops ({loops.length})</span>
                </span>
            </div>
            {loops.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-[#848484] text-center">
                    No loops for this conversation
                </div>
            ) : (
                <>
                    {activeLoops.map(renderLoop)}
                    {inactiveLoops.length > 0 && activeLoops.length > 0 && (
                        <div className="px-3 py-1 text-[9px] text-[#848484] uppercase tracking-wider font-semibold bg-[#f8f8f8] dark:bg-[#252525]">
                            Inactive
                        </div>
                    )}
                    {inactiveLoops.map(renderLoop)}
                </>
            )}
        </div>
    );
}
