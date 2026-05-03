/**
 * PromotePanel — queue-based memory promotion trigger.
 *
 * Phases: idle → submitting → queued → streaming → done
 *
 * The panel enqueues a memory-promote task via POST, then streams output
 * from the standard process SSE endpoint. Supports cross-tab awareness:
 * if a promotion is already running, the panel picks it up automatically.
 *
 * The executor promotes durable candidates without rewriting bounded memory.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { memoryApi } from './memoryApi';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useModels } from '../../hooks/useModels';

interface PromotePanelProps {
    repoId: string;
    /** Pending candidate count (from overview stats; legacy field name). */
    pendingRawCount?: number;
    /** Server-reported promotion status (from stats). */
    promotionStatus?: 'idle' | 'queued' | 'running';
    /** Active processId from server stats (for cross-tab awareness). */
    promotionProcessId?: string;
    /** Active taskId from server stats (for cancellation). */
    promotionTaskId?: string;
    onClose: () => void;
    onDone: () => void;
}

type AggregatePhase = 'idle' | 'submitting' | 'queued' | 'streaming' | 'done';

export function PromotePanel({
    repoId,
    pendingRawCount,
    promotionStatus,
    promotionProcessId,
    promotionTaskId,
    onClose,
    onDone,
}: PromotePanelProps) {
    const { models: modelInfos } = useModels();
    const enabledModels = modelInfos.filter(m => m.enabled);
    const modelIds = (enabledModels.length > 0 ? enabledModels : modelInfos).map(m => m.id);

    const [phase, setPhase] = useState<AggregatePhase>('idle');
    const [model, setModel] = useState('');
    const [streamOutput, setStreamOutput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [processId, setProcessId] = useState<string | null>(null);
    const [taskId, setTaskId] = useState<string | null>(null);
    const esRef = useRef<EventSource | null>(null);
    const outputRef = useRef<HTMLPreElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Auto-scroll stream output
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [streamOutput]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            esRef.current?.close();
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // Cross-tab awareness: pick up running/queued tasks on mount
    useEffect(() => {
        if (phase !== 'idle') return;
        if (promotionStatus === 'running' && promotionProcessId) {
            setProcessId(promotionProcessId);
            setTaskId(promotionTaskId ?? null);
            setPhase('streaming');
        } else if (promotionStatus === 'queued' && promotionProcessId) {
            setProcessId(promotionProcessId);
            setTaskId(promotionTaskId ?? null);
            setPhase('queued');
        }
    }, [promotionStatus, promotionProcessId, promotionTaskId, phase]);

    // Start SSE streaming when entering streaming phase
    const startStreaming = useCallback((pid: string) => {
        esRef.current?.close();
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

        const url = getSpaCocClient().processes.streamUrl(pid);
        const es = new EventSource(url);
        esRef.current = es;

        es.addEventListener('chunk', (e: MessageEvent) => {
            setStreamOutput(prev => prev + e.data);
        });

        es.addEventListener('complete', () => {
            es.close();
            esRef.current = null;
            setPhase('done');
            onDone();
        });

        es.onerror = () => {
            es.close();
            esRef.current = null;
            fetchProcessResult(pid);
        };
    }, [onDone]);

    useEffect(() => {
        if (phase === 'streaming' && processId) {
            startStreaming(processId);
        }
    }, [phase, processId, startStreaming]);

    // Poll stats in queued phase to detect transition to running
    useEffect(() => {
        if (phase !== 'queued') return;
        const poll = setInterval(async () => {
            try {
                const stats = await memoryApi.getOverview(repoId);
                const status = stats.promotionStatus ?? stats.consolidationStatus;
                const activeProcessId = stats.promotionProcessId ?? stats.consolidationProcessId;
                if (status === 'running') {
                    if (activeProcessId) {
                        setProcessId(activeProcessId);
                    }
                    setPhase('streaming');
                } else if (!status || status === 'idle') {
                    setPhase('done');
                    onDone();
                }
            } catch { /* ignore poll errors */ }
        }, 3000);
        pollRef.current = poll;
        return () => { clearInterval(poll); pollRef.current = null; };
    }, [phase, repoId, onDone]);

    const fetchProcessResult = async (pid: string) => {
        try {
            const detail = await getSpaCocClient().processes.get(pid);
            const proc = detail.process ?? detail;
            if (proc.status === 'completed') {
                setPhase('done');
                onDone();
            } else if (proc.status === 'failed') {
                setError((proc as any).error ?? 'Promotion failed');
                setPhase('idle');
            } else {
                // Still running — reconnect SSE
                setPhase('streaming');
            }
        } catch (e: unknown) {
            setError(getSpaCocClientErrorMessage(e, 'Failed to fetch result'));
            setPhase('idle');
        }
    };

    const handleRun = async () => {
        setPhase('submitting');
        setStreamOutput('');
        setError(null);

        try {
            const result = await memoryApi.promote(repoId, model || undefined);
            if (result.status === 'already-running' || result.status === 'already-queued') {
                setProcessId(result.processId);
                setTaskId(result.taskId);
                setPhase(result.status === 'already-running' ? 'streaming' : 'queued');
                return;
            }
            setTaskId(result.taskId);
            setProcessId(result.processId);
            setPhase('queued');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to enqueue promotion');
            setPhase('idle');
        }
    };

    const handleCancel = async () => {
        if (!taskId) return;
        try {
            await getSpaCocClient().queue.cancel(taskId);
        } catch { /* ignore */ }
        esRef.current?.close();
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setPhase('idle');
    };

    const isRunning = phase === 'queued' || phase === 'streaming';

    const footerContent = (() => {
        if (phase === 'idle') {
            return (
                <>
                    <button
                        onClick={onClose}
                        className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                    >
                        Close
                    </button>
                    <button
                        onClick={handleRun}
                        disabled={pendingRawCount === 0}
                        className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="aggregate-run-btn"
                    >
                         Promote Memory ▶
                    </button>
                </>
            );
        }
        if (phase === 'queued') {
            return (
                <button
                    onClick={handleCancel}
                    className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                    data-testid="aggregate-cancel-btn"
                >
                    Cancel
                </button>
            );
        }
        if (phase === 'streaming') {
            return (
                <button
                    disabled
                    className="text-xs px-2.5 py-1 rounded bg-[#0078d4]/60 text-white cursor-not-allowed"
                >
                    Running…
                </button>
            );
        }
        if (phase === 'done') {
            return (
                <button
                    onClick={onClose}
                    className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                >
                    Close
                </button>
            );
        }
        return null;
    })();

    return (
        <Dialog
            open={true}
            onClose={onClose}
            title="Promote Memory"
            className="max-w-[672px]"
            id="aggregate-panel"
            disableClose={isRunning}
            onMinimize={isRunning ? onClose : undefined}
            footer={footerContent}
        >
            <div data-testid="aggregate-panel">
                {phase === 'idle' && (
                    <>
                        <div className="flex items-center gap-4 mb-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                            <span className="text-[#848484]">
                                {pendingRawCount != null ? `${pendingRawCount} pending candidate${pendingRawCount !== 1 ? 's' : ''}` : 'Loading…'}
                            </span>
                            <div className="flex items-center gap-1.5 ml-auto">
                                <span className="text-[#848484]">Model:</span>
                                <select
                                    value={model}
                                    onChange={e => setModel(e.target.value)}
                                    className="text-[11px] px-1.5 py-0.5 border border-[#c8c8c8] dark:border-[#555] rounded bg-transparent focus:outline-none focus:border-[#0078d4] w-40"
                                    data-testid="aggregate-model-select"
                                >
                                    <option value="">Default</option>
                                    {modelIds.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                        </div>
                        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                    </>
                )}

                {phase === 'submitting' && (
                    <div className="text-xs text-[#848484] py-2 text-center">Submitting…</div>
                )}

                {phase === 'queued' && (
                    <div className="text-xs text-[#848484] py-2 text-center flex items-center justify-center gap-2" data-testid="aggregate-queued">
                        <span className="inline-block w-3 h-3 border-2 border-[#e8a317] border-t-transparent rounded-full animate-spin" />
                        Waiting in queue…
                    </div>
                )}

                {phase === 'streaming' && (
                    <pre
                        ref={outputRef}
                        className="text-[11px] font-mono text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#252526] rounded p-2 max-h-64 overflow-y-auto whitespace-pre-wrap"
                        data-testid="aggregate-stream-output"
                    >
                        {streamOutput || 'Running…'}
                    </pre>
                )}

                {phase === 'done' && (
                    <div className="text-xs text-green-600 dark:text-green-400 py-2 text-center" data-testid="aggregate-done">
                        ✓ Memory promotion complete.
                    </div>
                )}
            </div>
        </Dialog>
    );
}
