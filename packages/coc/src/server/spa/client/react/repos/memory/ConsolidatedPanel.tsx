/**
 * ConsolidatedPanel — collapsible panel that fetches and displays
 * the consolidated memory markdown content with a copy button.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { memoryApi } from './memoryApi';

interface ConsolidatedPanelProps {
    repoId: string;
    onClose: () => void;
}

export function ConsolidatedPanel({ repoId, onClose }: ConsolidatedPanelProps) {
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

    return (
        <div
            className="mb-3 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md bg-[#f5f5f5] dark:bg-[#1e1e1e] overflow-hidden"
            data-testid="consolidated-panel"
        >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-medium text-[#616161] dark:text-[#999]">
                    Consolidated Memory
                </span>
                <div className="flex items-center gap-1.5">
                    {content && (
                        <button
                            onClick={handleCopy}
                            className="text-xs px-2 py-0.5 rounded border border-[#848484]/50 text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                            data-testid="consolidated-copy-btn"
                        >
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="text-xs px-2 py-0.5 rounded text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] transition-colors"
                        data-testid="consolidated-close-btn"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="px-3 py-2 max-h-80 overflow-y-auto">
                {loading ? (
                    <div className="text-xs text-[#848484] py-2" data-testid="consolidated-loading">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="text-xs text-red-500 py-2" data-testid="consolidated-error">
                        {error}
                    </div>
                ) : (
                    <pre
                        className="text-xs text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap break-words m-0 font-mono leading-relaxed"
                        data-testid="consolidated-content"
                    >
                        {content}
                    </pre>
                )}
            </div>
        </div>
    );
}
