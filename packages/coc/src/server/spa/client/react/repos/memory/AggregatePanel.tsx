/**
 * AggregatePanel — SSE-streamed memory aggregation with review/accept/revert.
 *
 * Phases: idle → streaming → review → done
 */

import React, { useEffect, useRef, useState } from 'react';
import { memoryApi } from './memoryApi';
import { getApiBase } from '../../utils/config';

interface AggregatePanelProps {
    repoId: string;
    onClose: () => void;
    onDone: () => void;
}

type AggregatePhase = 'idle' | 'streaming' | 'review' | 'done';

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

export function AggregatePanel({ repoId, onClose, onDone }: AggregatePanelProps) {
    const [phase, setPhase] = useState<AggregatePhase>('idle');
    const [includeNotes, setIncludeNotes] = useState(true);
    const [includeAi, setIncludeAi] = useState(true);
    const [model, setModel] = useState('claude-sonnet-4.6');
    const [streamOutput, setStreamOutput] = useState('');
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [accepting, setAccepting] = useState(false);
    const [reverting, setReverting] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    const outputRef = useRef<HTMLPreElement>(null);

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
        };
    }, []);

    const handleRun = () => {
        const sources: string[] = [];
        if (includeNotes) sources.push('user');
        if (includeAi) sources.push('ai');
        if (sources.length === 0) sources.push('user', 'ai');

        setPhase('streaming');
        setStreamOutput('');
        setError(null);

        const params = new URLSearchParams({ sources: sources.join(','), model });
        const url = `${getApiBase()}/repos/${encodeURIComponent(repoId)}/memory/aggregate?${params}`;
        const es = new EventSource(url);
        esRef.current = es;

        es.addEventListener('chunk', (e: MessageEvent) => {
            setStreamOutput(prev => prev + e.data);
        });

        es.addEventListener('diff', (e: MessageEvent) => {
            setDiffLines(parseDiff(e.data));
        });

        es.addEventListener('done', () => {
            es.close();
            esRef.current = null;
            setPhase('review');
        });

        es.onerror = () => {
            es.close();
            esRef.current = null;
            setError('Aggregation failed. Please try again.');
            setPhase('idle');
        };
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

    return (
        <div
            className="mb-3 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 bg-[#fafafa] dark:bg-[#1e1e1e]"
            data-testid="aggregate-panel"
        >
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Aggregate</span>
                <button
                    onClick={onClose}
                    className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm leading-none"
                    aria-label="Close aggregate panel"
                    data-testid="aggregate-close-btn"
                >
                    ×
                </button>
            </div>

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
                            <input
                                type="text"
                                value={model}
                                onChange={e => setModel(e.target.value)}
                                className="text-[11px] px-1.5 py-0.5 border border-[#c8c8c8] dark:border-[#555] rounded bg-transparent focus:outline-none focus:border-[#0078d4] w-40"
                                data-testid="aggregate-model-input"
                            />
                        </div>
                    </div>
                    {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                    <div className="flex justify-end gap-2">
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
                    </div>
                </>
            )}

            {phase === 'streaming' && (
                <>
                    <pre
                        ref={outputRef}
                        className="text-[11px] font-mono text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#252526] rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap mb-2"
                        data-testid="aggregate-stream-output"
                    >
                        {streamOutput || 'Running…'}
                    </pre>
                    <div className="flex justify-end">
                        <button
                            disabled
                            className="text-xs px-2.5 py-1 rounded bg-[#0078d4]/60 text-white cursor-not-allowed"
                        >
                            Running…
                        </button>
                    </div>
                </>
            )}

            {phase === 'review' && (
                <>
                    <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Result</div>
                    <div
                        className="text-[11px] font-mono bg-[#f3f3f3] dark:bg-[#252526] rounded p-2 max-h-56 overflow-y-auto mb-2"
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
                    {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                    <div className="flex justify-end gap-2">
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
                    </div>
                </>
            )}
        </div>
    );
}
