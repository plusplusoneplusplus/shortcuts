import { useState, useEffect, useRef } from 'react';
import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';
import { PipelineDAGChart } from './PipelineDAGChart';
import { buildDAGData } from './buildDAGData';
import { MapItemGrid } from './MapItemGrid';
import type { ChildProcess } from './MapItemGrid';
import { ItemConversationPanel } from './ItemConversationPanel';
import { usePipelinePhase } from '../../hooks/usePipelinePhase';
import { useItemProcessEvents } from '../../hooks/useItemProcessEvents';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { fetchApi } from '../../hooks/useApi';
import { formatDuration, statusIcon } from '../../utils/format';
import { BottomSheet } from '../../shared';
import type { PhaseDetail } from './PipelinePhasePopover';

export interface WorkflowDetailViewProps {
    processId: string;
    onNavigateToProcess?: (processId: string) => void;
}

function detectDarkMode(): boolean {
    if (typeof document !== 'undefined') {
        return document.documentElement.classList.contains('dark');
    }
    return false;
}

export function WorkflowDetailView({ processId, onNavigateToProcess }: WorkflowDetailViewProps) {
    const [process, setProcess] = useState<any>(null);
    const [children, setChildren] = useState<ChildProcess[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedPhase, setExpandedPhase] = useState<PipelinePhase | null>(null);
    const [now, setNow] = useState(Date.now());
    const [selectedItemProcessId, setSelectedItemProcessId] = useState<string | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const isDark = detectDarkMode();
    const { isMobile } = useBreakpoint();

    const isRunning = process?.status === 'running';

    // Fetch process and children on mount
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all([
            fetchApi(`/processes/${encodeURIComponent(processId)}`),
            fetchApi(`/processes/${encodeURIComponent(processId)}/children`),
        ])
            .then(([processData, childrenData]) => {
                if (cancelled) return;
                setProcess(processData.process ?? processData);
                const items = Array.isArray(childrenData) ? childrenData : (childrenData.children ?? []);
                setChildren(items.map((c: any, i: number) => ({
                    processId: c.id ?? c.processId,
                    itemIndex: c.metadata?.itemIndex ?? c.itemIndex ?? i,
                    status: c.status ?? 'queued',
                    promptPreview: c.metadata?.promptPreview ?? c.promptPreview,
                    durationMs: c.durationMs ?? c.duration,
                    error: c.error ?? c.metadata?.error,
                })));
                setLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err.message ?? 'Failed to load workflow');
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [processId]);

    // SSE for live processes
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!isRunning) return;

        const es = new EventSource(`/api/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
        };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [processId, isRunning]);

    // Live timer for running process
    useEffect(() => {
        if (!isRunning) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isRunning]);

    // SSE hooks
    const { dagData: liveDagData, disconnected } = usePipelinePhase(
        eventSourceRef.current,
        process?.metadata,
    );

    const { items: liveItems } = useItemProcessEvents(eventSourceRef.current);

    // Data source selection
    const dagData = isRunning && liveDagData
        ? liveDagData
        : buildDAGData(process);

    // Merge live items with REST children
    const mergedChildren: ChildProcess[] = (() => {
        if (liveItems.size === 0) return children;
        const result = [...children];
        for (const [pid, item] of liveItems) {
            const idx = result.findIndex(c => c.processId === pid);
            if (idx >= 0) {
                result[idx] = { ...result[idx], ...item };
            } else {
                result.push(item);
            }
        }
        return result;
    })();

    // Build phaseDetails
    const phaseDetails: Record<string, PhaseDetail> = {};
    if (dagData) {
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

            if (meta?.phaseErrors?.[node.phase]) {
                detail.error = meta.phaseErrors[node.phase];
            }

            switch (node.phase) {
                case 'input':
                    detail.sourceType = config?.input?.type ?? config?.input?.source;
                    break;
                case 'filter':
                    detail.filterType = config?.filter?.type;
                    detail.rulesSummary = config?.filter?.rules
                        ? (Array.isArray(config.filter.rules) ? config.filter.rules.join(', ') : String(config.filter.rules))
                        : undefined;
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
    }

    const handleMapNodeExpand = (expanded: boolean) => {
        setExpandedPhase(expanded ? 'map' : null);
    };

    const handleItemClick = (itemProcessId: string) => {
        setSelectedItemProcessId(itemProcessId);
    };

    if (loading) {
        return (
            <div data-testid="workflow-detail-loading" className="flex items-center justify-center py-8 text-[#848484]">
                Loading workflow…
            </div>
        );
    }

    if (error) {
        return (
            <div data-testid="workflow-detail-error" className="flex items-center justify-center py-8 text-[#f14c4c]">
                {error}
            </div>
        );
    }

    if (!dagData) {
        return (
            <div data-testid="workflow-detail-empty" className="flex items-center justify-center py-8 text-[#848484]">
                No pipeline data available.
            </div>
        );
    }

    const status = process?.status || 'completed';
    const icon = statusIcon(status);
    const durationText = dagData.totalDurationMs != null ? formatDuration(dagData.totalDurationMs) : '';
    const config = process?.metadata?.pipelineConfig;
    const parallelCount: number | undefined = config?.map?.parallel ?? config?.map?.concurrency;

    let caption = '';
    if (status === 'completed') {
        caption = `✅ Workflow completed${durationText ? ` in ${durationText}` : ''}`;
    } else if (status === 'running') {
        caption = '🔄 Running...';
    } else if (status === 'failed') {
        caption = `❌ Workflow failed${durationText ? ` after ${durationText}` : ''}`;
    } else if (status === 'cancelled') {
        caption = '🚫 Workflow cancelled';
    } else {
        caption = `${icon} ${status}`;
    }

    return (
        <div data-testid="workflow-detail-view" className="px-4 py-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    Workflow Detail
                    {disconnected && (
                        <span className="ml-1 text-[#e8912d]" title="Live updates disconnected">⚠️</span>
                    )}
                </h2>
                {durationText && (
                    <span className="text-xs text-[#848484]">{durationText}</span>
                )}
            </div>

            {/* DAG Chart */}
            <PipelineDAGChart
                data={dagData}
                isDark={isDark}
                now={isRunning ? now : undefined}
                phaseDetails={phaseDetails}
                parallelCount={parallelCount}
                pipelineConfig={config}
                onMapNodeExpand={handleMapNodeExpand}
                mapExpanded={expandedPhase === 'map'}
            />

            {/* Caption bar */}
            <div className="text-xs text-[#848484] text-center mt-2">
                {caption}
            </div>

            {/* Expandable Map Item Grid */}
            <div
                data-testid="map-item-grid-wrapper"
                style={{
                    transition: 'max-height 300ms ease',
                    maxHeight: expandedPhase === 'map' ? '2000px' : '0',
                    overflow: 'hidden',
                }}
            >
                {expandedPhase === 'map' && (
                    <MapItemGrid
                        items={mergedChildren}
                        onItemClick={handleItemClick}
                        isLive={isRunning}
                        isDark={isDark}
                        selectedProcessId={selectedItemProcessId ?? undefined}
                    />
                )}
            </div>

            {/* Item Conversation Panel */}
            {selectedItemProcessId && (
                isMobile
                    ? <BottomSheet isOpen onClose={() => setSelectedItemProcessId(null)} title="Item Conversation" height={80}>
                        <ItemConversationPanel processId={selectedItemProcessId} onClose={() => setSelectedItemProcessId(null)} isDark={isDark} />
                      </BottomSheet>
                    : <ItemConversationPanel processId={selectedItemProcessId} onClose={() => setSelectedItemProcessId(null)} isDark={isDark} />
            )}
        </div>
    );
}
