/**
 * AggregatePanel — queue-based memory aggregation with review/accept/revert.
 *
 * Phases: idle → submitting → queued → streaming → review → done
 *
 * The panel enqueues a memory-aggregate task via POST, then streams output
 * from the standard process SSE endpoint. Supports cross-tab awareness:
 * if a consolidation is already running, the panel picks it up automatically.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../../shared/Dialog';
import { memoryApi } from './memoryApi';
import { getApiBase } from '../../utils/config';
import { useModels } from '../../hooks/useModels';

interface AggregatePanelProps {
    repoId: string;
    /** Server-reported consolidation status (from stats). */
    consolidationStatus?: 'idle' | 'queued' | 'running';
    /** Active processId from server stats (for cross-tab awareness). */
    consolidationProcessId?: string;
    /** Active taskId from server stats (for cancellation). */
    consolidationTaskId?: string;
    onClose: () => void;
    onDone: () => void;
}

type AggregatePhase = 'idle' | 'submitting' | 'queued' | 'streaming' | 'review' | 'done';

interface DiffLine {
    type: 'add' | 'remove' | 'unchanged';
    text: string;
}

function parseDiff(raw: string): DiffLine[] {
    return raw.split('\n').map(line => {
        if (line.startsWith('+')) return { type: 'add' as const, text: line.slice(1) };
        if (line.startsWith('-')) return { type: 'remove' as const, text: line.slice(1) };
        return { type: 'unchanged' as const, text: line.startsWith(' ') ? line.slice(1) : line };
    });
}

export function AggregatePanel({
    repoId,
    consolidationStatus,
    consolidationProcessId,
    consolidationTaskId,
    onClose,
    onDone,
}: AggregatePanelProps) {
    const { models: modelInfos } = useModels();
    const enabledModels = modelInfos.filter(m => m.enabled);
    const modelIds = (enabledModels.length > 0 ? enabledModels : modelInfos).map(m => m.id);

    const [phase, setPhase] = useState<AggregatePhase>('idle');
    const [includeNotes, setIncludeNotes] = useState(true);
    const [includeAi, setIncludeAi] = useState(true);
    const [model, setModel] = useState('');
    const [streamOutput, setStreamOutput] = useState('');
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [accepting, setAccepting] = useState(false);
    const [reverting, setReverting] = useState(false);
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
        if (consolidationStatus === 'running' && consolidationProcessId) {
            setProcessId(consolidationProcessId);
            setTaskId(consolidationTaskId ?? null);
            setPhase('streaming');
        } else if (consolidationStatus === 'queued' && consolidationProcessId) {
            setProcessId(consolidationProcessId);
            setTaskId(consolidationTaskId ?? null);
            setPhase('queued');
        }
    }, [consolidationStatus, consolidationProcessId, consolidationTaskId, phase]);

    // Start SSE streaming when entering streaming phase
    const startStreaming = useCallback((pid: string) => {
        esRef.current?.close();
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

        const url = `${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`;
        const es = new EventSource(url);
        esRef.current = es;

        es.addEventListener('chunk', (e: MessageEvent) => {
            setStreamOutput(prev => prev + e.data);
        });

        es.addEventListener('complete', () => {
            es.close();
            esRef.current = null;
            // Fetch the process result to get diff + consolidated
            fetchProcessResult(pid);
        });

        es.onerror = () => {
            es.close();
            esRef.current = null;
            // Process may have completed before we connected — check result
            fetchProcessResult(pid);
        };
    }, []);

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
                if (stats.consolidationStatus === 'running') {
                    setPhase('streaming');
                } else if (!stats.consolidationStatus || stats.consolidationStatus === 'idle') {
                    // Task completed or was cancelled while queued
                    setPhase('idle');
                }
            } catch { /* ignore poll errors */ }
        }, 3000);
        pollRef.current = poll;
        return () => { clearInterval(poll); pollRef.current = null; };
    }, [phase, repoId]);

    const fetchProcessResult = async (pid: string) => {
        try {
            const res = await fetch(`${getApiBase()}/processes/${encodeURIComponent(pid)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const proc = await res.json();
            if (proc.status === 'completed' && proc.result) {
                const resultData = typeof proc.result === 'string' ? JSON.parse(proc.result) : proc.result;
                if (resultData.diff) setDiffLines(parseDiff(resultData.diff));
                if (resultData.consolidated) setStreamOutput(resultData.consolidated);
                setPhase('review');
            } else if (proc.status === 'failed') {
                setError(proc.error ?? 'Aggregation failed');
                setPhase('idle');
            } else {
                // Still running — reconnect SSE
                setPhase('streaming');
            }
        } catch (e: any) {
            setError(e?.message ?? 'Failed to fetch result');
            setPhase('idle');
        }
    };

    const handleRun = async () => {
        const sources: string[] = [];
        if (includeNotes) sources.push('user');
        if (includeAi) sources.push('ai');
        if (sources.length === 0) sources.push('user', 'ai');

        setPhase('submitting');
        setStreamOutput('');
        setError(null);

        try {
            const result = await memoryApi.aggregate(repoId, sources, model);
            if (result.status === 'already-running') {
                // Another tab/client already started — attach to it
                setProcessId(result.processId);
                setTaskId(result.taskId);
                setPhase('streaming');
                return;
            }
            setProcessId(result.processId);
            setTaskId(result.taskId);
            setPhase('queued');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to enqueue');
            setPhase('idle');
        }
    };

    const handleCancel = async () => {
        if (!taskId) return;
        try {
            await fetch(`${getApiBase()}/queue/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
        } catch { /* ignore */ }
        esRef.current?.close();
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setPhase('idle');
    };

    const handleAccept = async () => {
        setAccepting(true);
        try {
            await memoryApi.acceptAggregate(repoId);
            setPhase('done');
            onDone();
        } catch (e: any) {
            setError(e?.message ?? 'Failed to accept');
        } finally {
            setAccepting(false);
        }
    };

    const handleRevert = async () => {
        setReverting(true);
        try {
            await memoryApi.revertAggregate(repoId);
            onClose();
        } catch (e: any) {
            setError(e?.message ?? 'Failed to revert');
        } finally {
            setReverting(false);
        }
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
                        className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                        data-testid="aggregate-run-btn"
                    >
                        Run ▶
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
        if (phase === 'review') {
            return (
                <>
                    <button
                        onClick={handleRevert}
                        disabled={reverting}
                        className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors disabled:opacity-50"
                        data-testid="aggregate-revert-btn"
                    >
                        {reverting ? 'Reverting…' : 'Revert'}
                    </button>
                    <button
                        onClick={handleAccept}
                        disabled={accepting}
                        className="text-xs px-2.5 py-1 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors disabled:opacity-50"
                        data-testid="aggregate-accept-btn"
                    >
                        {accepting ? 'Accepting…' : 'Accept ✓'}
                    </button>
                </>
            );
        }
        return null;
    })();

    return (
        <Dialog
            open={true}
            onClose={onClose}
            title="Aggregate Memory"
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
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={includeNotes}
                                    onChange={e => setIncludeNotes(e.target.checked)}
                                    data-testid="aggregate-include-notes"
                                />
                                Your notes
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={includeAi}
                                    onChange={e => setIncludeAi(e.target.checked)}
                                    data-testid="aggregate-include-ai"
                                />
                                AI observations
                            </label>
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

                {phase === 'review' && (
                    <>
                        <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Result</div>
                        <div
                            className="text-[11px] font-mono bg-[#f3f3f3] dark:bg-[#252526] rounded p-2 max-h-72 overflow-y-auto"
                            data-testid="aggregate-diff"
                        >
                            {diffLines.length > 0 ? diffLines.map((line, i) => (
                                <div
                                    key={i}
                                    className={
                                        line.type === 'add'
                                            ? 'text-green-600 dark:text-green-400'
                                            : line.type === 'remove'
                                                ? 'text-red-500 line-through opacity-70'
                                                : 'text-[#1e1e1e] dark:text-[#cccccc]'
                                    }
                                >
                                    {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                                    {line.text}
                                </div>
                            )) : (
                                <pre className="whitespace-pre-wrap text-[#1e1e1e] dark:text-[#cccccc]">{streamOutput}</pre>
                            )}
                        </div>
                        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
                    </>
                )}
            </div>
        </Dialog>
    );
}
