import { useState, useEffect, type RefObject } from 'react';
import { PipelineDAGChart } from './PipelineDAGChart';
import { buildDAGData } from './buildDAGData';
import { usePipelinePhase } from '../../hooks/usePipelinePhase';
import { formatDuration, statusIcon } from '../../utils/format';
import type { PhaseDetail } from './PipelinePhasePopover';

export interface PipelineDAGSectionProps {
    process: any;
    eventSourceRef?: RefObject<EventSource | null>;
    onScrollToConversation?: (phaseName: string) => void;
}

function detectDarkMode(): boolean {
    if (typeof document !== 'undefined') {
        return document.documentElement.classList.contains('dark');
    }
    return false;
}

export function PipelineDAGSection({ process, eventSourceRef, onScrollToConversation }: PipelineDAGSectionProps) {
    const [expanded, setExpanded] = useState(true);
    const [now, setNow] = useState(Date.now());
    const isDark = detectDarkMode();

    const isRunning = process?.status === 'running';

    // Live timer for running process — updates elapsed display every second
    useEffect(() => {
        if (!isRunning) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isRunning]);

    // SSE live data
    const { dagData: liveDagData, disconnected } = usePipelinePhase(
        eventSourceRef?.current ?? null,
        process?.metadata,
    );

    // Data source selection: live when running, static when terminal
    const dagData = isRunning && liveDagData
        ? liveDagData
        : buildDAGData(process);

    if (!dagData) return null;

    // Extract phase detail metadata from process
    const phaseDetails: Record<string, PhaseDetail> = {};
    const meta = process?.metadata;
    const stats = meta?.executionStats;
    const config = meta?.pipelineConfig;

    for (const node of dagData.nodes) {
        const detail: PhaseDetail = {
            phase: node.phase,
            status: node.state as any,
            durationMs: node.durationMs,
            itemCount: node.itemCount ?? node.totalItems,
        };

        // Phase errors from metadata
        if (meta?.phaseErrors?.[node.phase]) {
            detail.error = meta.phaseErrors[node.phase];
        }

        switch (node.phase) {
            case 'input':
                detail.sourceType = config?.input?.type ?? config?.input?.source;
                if (config?.input?.parameters) detail.parameters = config.input.parameters;
                break;
            case 'filter':
                detail.filterType = config?.filter?.type;
                detail.rulesSummary = config?.filter?.rules
                    ? (Array.isArray(config.filter.rules) ? config.filter.rules.join(', ') : String(config.filter.rules))
                    : undefined;
                if (stats) {
                    const totalIn = stats.totalItems ?? 0;
                    const totalOut = stats.successfulMaps != null ? stats.successfulMaps + (stats.failedMaps ?? 0) : totalIn;
                    detail.includedCount = totalOut;
                    detail.excludedCount = totalIn > totalOut ? totalIn - totalOut : undefined;
                }
                break;
            case 'map':
                detail.concurrency = stats?.maxConcurrency ?? config?.map?.concurrency;
                detail.batchSize = config?.map?.batchSize;
                detail.model = config?.map?.model ?? meta?.model;
                detail.totalItems = stats?.totalItems ?? node.totalItems;
                detail.successfulItems = stats?.successfulMaps;
                detail.failedItems = stats?.failedMaps ?? node.failedItems;
                break;
            case 'reduce':
                detail.reduceType = config?.reduce?.type;
                detail.model = config?.reduce?.model ?? meta?.model;
                detail.outputPreview = meta?.reduceOutput ?? meta?.result;
                break;
            case 'job':
                detail.model = config?.model ?? meta?.model;
                detail.promptPreview = config?.prompt ?? meta?.prompt;
                break;
        }

        phaseDetails[node.phase] = detail;
    }

    const handleScrollToConversation = onScrollToConversation
        ? (phaseName: string) => onScrollToConversation(phaseName)
        : undefined;

    const status = process.status || 'completed';
    const icon = statusIcon(status);
    const durationText = dagData.totalDurationMs != null ? formatDuration(dagData.totalDurationMs) : '';

    // Compute elapsed time for running nodes
    const runningNodeStartedAt = isRunning
        ? dagData.nodes.find(n => n.state === 'running')
        : undefined;

    let caption = '';
    if (status === 'completed') {
        caption = `✅ Pipeline completed${durationText ? ` in ${durationText}` : ''}`;
    } else if (status === 'running') {
        caption = '🔄 Running...';
    } else if (status === 'failed') {
        caption = `❌ Pipeline failed${durationText ? ` after ${durationText}` : ''}`;
    } else if (status === 'cancelled') {
        caption = '🚫 Pipeline cancelled';
    } else {
        caption = `${icon} ${status}`;
    }

    return (
        <div data-testid="pipeline-dag-section" className="mb-4">
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-2 cursor-pointer
                           border-b border-[#e0e0e0] dark:border-[#3c3c3c]
                           text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]"
                onClick={() => setExpanded(prev => !prev)}
                data-testid="dag-section-header"
            >
                <span>
                    {expanded ? '▾' : '▸'} Pipeline Flow
                    {disconnected && (
                        <span
                            className="ml-1 text-[#e8912d]"
                            title="Live updates disconnected"
                            data-testid="dag-disconnect-warning"
                        >⚠️</span>
                    )}
                </span>
                {durationText && (
                    <span className="text-xs text-[#848484]">{durationText}</span>
                )}
            </div>

            {/* Body */}
            {expanded && (
                <div className="px-4 py-3">
                    <PipelineDAGChart
                        data={dagData}
                        isDark={isDark}
                        now={isRunning ? now : undefined}
                        phaseDetails={phaseDetails}
                        onScrollToConversation={handleScrollToConversation}
                    />
                    <div className="text-xs text-[#848484] text-center mt-2">
                        {caption}
                    </div>
                </div>
            )}
        </div>
    );
}
