/**
 * ConsolidatedTab — inline panel for the "Consolidated" sub-tab.
 *
 * Shows the consolidated memory markdown content with copy/refresh buttons,
 * aggregate trigger, and last-consolidated timestamp.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { memoryApi } from './memoryApi';
import { formatRelativeTime } from '../../utils/format';

interface ConsolidatedTabProps {
    repoId: string;
    consolidatedAt: string | null;
    consolidationStatus?: 'idle' | 'queued' | 'running';
    consolidationProcessId?: string;
    consolidationTaskId?: string;
    onAggregate: () => void;
}

export function ConsolidatedTab({
    repoId,
    consolidatedAt,
    consolidationStatus,
    onAggregate,
}: ConsolidatedTabProps) {
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const fetchContent = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { content: text } = await memoryApi.getConsolidated(repoId);
            setContent(text);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load consolidated memory');
        } finally {
            setLoading(false);
        }
    }, [repoId]);

    useEffect(() => { fetchContent(); }, [fetchContent]);

    const handleCopy = async () => {
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback: ignored
        }
    };

    const isActive = consolidationStatus === 'queued' || consolidationStatus === 'running';
    const consolidatedLabel = consolidatedAt ? formatRelativeTime(consolidatedAt) : 'never';

    return (
        <div data-testid="consolidated-tab" className="pt-3">
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap" data-testid="consolidated-toolbar">
                <span className="text-xs text-[#848484] flex-1">
                    Last consolidated: {consolidatedLabel}
                </span>
                {content && (
                    <button
                        onClick={handleCopy}
                        className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                        data-testid="consolidated-tab-copy-btn"
                    >
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                )}
                <button
                    onClick={fetchContent}
                    className="text-xs px-2.5 py-1 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                    data-testid="consolidated-tab-refresh-btn"
                >
                    Refresh
                </button>
                {isActive ? (
                    <button
                        onClick={onAggregate}
                        className={`text-xs px-2.5 py-1 rounded inline-flex items-center gap-1.5 transition-colors ${
                            consolidationStatus === 'queued'
                                ? 'bg-[#e8a317]/15 text-[#a97a0d] dark:text-[#e8a317] border border-[#e8a317]/30'
                                : 'bg-[#0078d4]/15 text-[#0078d4] border border-[#0078d4]/30'
                        }`}
                        data-testid="consolidated-tab-aggregate-btn"
                    >
                        <span className="inline-block w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        {consolidationStatus === 'queued' ? 'Queued…' : 'Consolidating…'}
                    </button>
                ) : (
                    <button
                        onClick={onAggregate}
                        className="text-xs px-2.5 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#0078d4]/10 transition-colors"
                        data-testid="consolidated-tab-aggregate-btn"
                    >
                        Aggregate
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded overflow-y-auto max-h-[60vh]">
                {loading ? (
                    <div className="text-xs text-[#848484] py-4 text-center" data-testid="consolidated-tab-loading">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="text-xs text-red-500 py-4 px-3" data-testid="consolidated-tab-error">
                        {error}
                    </div>
                ) : !content ? (
                    <div className="text-xs text-[#848484] py-8 text-center" data-testid="consolidated-tab-empty">
                        No consolidated memory yet. Click <strong>Aggregate</strong> to generate one.
                    </div>
                ) : (
                    <pre
                        className="text-xs text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap break-words m-0 p-3 font-mono leading-relaxed"
                        data-testid="consolidated-tab-content"
                    >
                        {content}
                    </pre>
                )}
            </div>
        </div>
    );
}
