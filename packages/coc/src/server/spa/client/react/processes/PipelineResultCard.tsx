/**
 * PipelineResultCard — renders pipeline-specific result content:
 * header with name + status, stats grid, markdown result with mermaid support.
 */

import { useRef } from 'react';
import { Card, Badge, Button } from '../shared';
import { MarkdownView } from './MarkdownView';
import { renderMarkdownToHtml } from '../../markdown-renderer';
import { useMermaid } from '../hooks/useMermaid';
import { formatDuration, copyToClipboard } from '../utils/format';

export interface PipelineResultCardProps {
    process: any;
    className?: string;
}

export function PipelineResultCard({ process, className }: PipelineResultCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const pipelineName = process.metadata?.pipelineName || 'Workflow Execution';
    const stats = process.metadata?.executionStats;
    const result = process.result || '';
    const status = process.status || 'running';

    useMermaid(cardRef, result);

    const successRate = stats && stats.totalItems > 0
        ? Math.round((stats.successfulMaps / stats.totalItems) * 100)
        : null;

    const handleCopy = () => {
        if (result) {
            copyToClipboard(result);
        }
    };

    return (
        <Card className={className}>
            <div ref={cardRef} data-testid="pipeline-result-card">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        {pipelineName}
                    </span>
                    <Badge status={status} />
                    {process.durationMs != null && (
                        <span className="text-xs text-[#848484] ml-auto">{formatDuration(process.durationMs)}</span>
                    )}
                </div>

                {/* Stats grid */}
                {stats && (
                    <div className="grid grid-cols-3 gap-2 text-xs px-4 py-3" data-testid="stats-grid">
                        <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center">
                            <div className="text-[#848484]">Total Items</div>
                            <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{stats.totalItems}</div>
                        </div>
                        <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center">
                            <div className="text-[#848484]">Successful</div>
                            <div className="font-medium text-[#16825d] dark:text-[#89d185]">{stats.successfulMaps}</div>
                        </div>
                        <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center">
                            <div className="text-[#848484]">Failed</div>
                            <div className="font-medium text-[#f14c4c] dark:text-[#f48771]">{stats.failedMaps}</div>
                        </div>
                        {successRate !== null && (
                            <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center">
                                <div className="text-[#848484]">Success Rate</div>
                                <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{successRate}%</div>
                            </div>
                        )}
                        {stats.mapPhaseTimeMs != null && (
                            <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center">
                                <div className="text-[#848484]">Map Phase</div>
                                <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{formatDuration(stats.mapPhaseTimeMs)}</div>
                            </div>
                        )}
                        {stats.maxConcurrency != null && (
                            <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-2 text-center">
                                <div className="text-[#848484]">Concurrency</div>
                                <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{stats.maxConcurrency}</div>
                            </div>
                        )}
                    </div>
                )}

                {/* Result content */}
                <div className="px-4 py-3">
                    {result ? (
                        <MarkdownView html={renderMarkdownToHtml(result)} />
                    ) : (
                        <p className="text-xs text-[#848484]">No output available.</p>
                    )}
                </div>

                {/* Copy button */}
                {result && (
                    <div className="px-4 pb-3">
                        <Button variant="secondary" size="sm" onClick={handleCopy} data-testid="copy-result-btn">
                            📋 Copy Result
                        </Button>
                    </div>
                )}
            </div>
        </Card>
    );
}
