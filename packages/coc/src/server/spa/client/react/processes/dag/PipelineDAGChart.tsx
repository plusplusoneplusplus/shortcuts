import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { PipelinePhase, PipelineConfig } from '@plusplusoneplusplus/pipeline-core';
import type { DAGChartData } from './types';
import { DAGNode } from './DAGNode';
import { DAGEdge } from './DAGEdge';
import { getEdgeBadgeText, getEdgeSchemaText } from './edgeAnnotations';
import { DAGProgressBar } from './DAGProgressBar';
import { DAGLegend } from './DAGLegend';
import { DAGBreadcrumb } from './DAGBreadcrumb';
import { PipelinePhasePopover } from './PipelinePhasePopover';
import { DAGHoverTooltip } from './DAGHoverTooltip';
import { mapErrorsToPhases, getNodeErrors } from './errorMapping';
import { useZoomPan } from '../../hooks/useZoomPan';
import { ZoomControls } from './ZoomControls';
import type { PhaseDetail } from './PipelinePhasePopover';
import type { EdgeState } from './dag-colors';

export interface PipelineDAGChartProps {
    data: DAGChartData;
    isDark: boolean;
    onNodeClick?: (phase: PipelinePhase) => void;
    /** Current timestamp, used to compute elapsed time for running nodes. */
    now?: number;
    /** Phase detail metadata keyed by phase name. */
    phaseDetails?: Record<string, PhaseDetail>;
    /** Callback to scroll to a conversation turn related to the given phase. */
    onScrollToConversation?: (phaseName: string) => void;
    /** Number of parallel workers for the map phase. */
    parallelCount?: number;
    /** Pipeline config from YAML for hover tooltips. */
    pipelineConfig?: PipelineConfig;
    /** Validation errors mapped to phases, for rendering error pins on nodes */
    validationErrors?: string[];
    /** When true, enables preview-mode behaviors: auto-fit on mount, unmapped errors on first node only, no legend (rendered externally). */
    previewMode?: boolean;
}

const NODE_W = 120;
const NODE_H = 70;
const GAP_X = 60;
const PADDING = 20;

function deriveEdgeState(fromState: string, toState: string): EdgeState {
    if (fromState === 'failed') return 'error';
    if (fromState === 'completed' && toState !== 'waiting') return 'completed';
    if (fromState === 'running' || toState === 'running') return 'active';
    return 'waiting';
}

export function PipelineDAGChart({ data, isDark, onNodeClick, now, phaseDetails, onScrollToConversation, parallelCount, pipelineConfig, validationErrors, previewMode }: PipelineDAGChartProps) {
    const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
    const [hoveredPhase, setHoveredPhase] = useState<PipelinePhase | null>(null);
    const [hoverAnchor, setHoverAnchor] = useState<{ x: number; y: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const nodeCount = data.nodes.length;
    if (nodeCount === 0) return null;

    const handleNodeClick = (phase: PipelinePhase) => {
        setSelectedPhase(prev => prev === phase ? null : phase);
        // Dismiss hover tooltip on click
        setHoveredPhase(null);
        setHoverAnchor(null);
        if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
        onNodeClick?.(phase);
    };

    // Escape key clears selection
    useEffect(() => {
        if (!selectedPhase) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelectedPhase(null);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [selectedPhase]);

    // Click outside clears selection
    useEffect(() => {
        if (!selectedPhase) return;
        const handler = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (containerRef.current?.contains(target)) return;
            setSelectedPhase(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [selectedPhase]);

    // Cleanup leave timer
    useEffect(() => {
        return () => {
            if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
        };
    }, []);

    const handleNodeMouseEnter = (phase: PipelinePhase, e: React.MouseEvent) => {
        if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
        setHoveredPhase(phase);
        if (containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            setHoverAnchor({
                x: e.clientX - containerRect.left,
                y: e.clientY - containerRect.top,
            });
        }
    };

    const handleNodeMouseLeave = () => {
        leaveTimerRef.current = setTimeout(() => {
            setHoveredPhase(null);
            setHoverAnchor(null);
        }, 150);
    };

    const handleTooltipMouseEnter = () => {
        if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    };

    const handleTooltipMouseLeave = () => {
        handleNodeMouseLeave();
    };

    const totalWidth= 2 * PADDING + nodeCount * NODE_W + (nodeCount - 1) * GAP_X;
    const totalHeight = 2 * PADDING + NODE_H + 34; // extra for progress bar + duration overlay

    const positions = data.nodes.map((_, i) => ({
        x: PADDING + i * (NODE_W + GAP_X),
        y: PADDING,
    }));

    const mapNode = data.nodes.find(n => n.phase === 'map');

    const phaseErrors = useMemo(
        () => validationErrors?.length ? mapErrorsToPhases(validationErrors) : null,
        [validationErrors]
    );

    const {
        containerRef: zoomContainerRef,
        svgTransform,
        zoomIn, zoomOut, reset: zoomReset, fitToView,
        zoomLabel,
        state: zoomState,
    } = useZoomPan({ contentWidth: totalWidth, contentHeight: totalHeight });

    const mergedRef = useCallback((node: HTMLDivElement | null) => {
        (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        (zoomContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }, [zoomContainerRef]);

    // Auto-fit to view on mount in preview mode
    useEffect(() => {
        if (!previewMode) return;
        // Use rAF to ensure container has been laid out before measuring
        const id = requestAnimationFrame(() => fitToView());
        return () => cancelAnimationFrame(id);
    }, [previewMode, fitToView]);

    const selectedDetail = selectedPhase && phaseDetails?.[selectedPhase] ? phaseDetails[selectedPhase] : null;

    return (
        <div ref={mergedRef} data-testid="dag-chart-container" className="relative" style={{ overflow: 'hidden', maxHeight: previewMode ? 180 : 300, cursor: zoomState.isDragging ? 'grabbing' : 'grab' }}>
        <DAGBreadcrumb nodes={data.nodes} isDark={isDark} />
        <svg
            ref={svgRef}
            data-testid="dag-chart"
            className="w-full"
            viewBox={`0 0 ${totalWidth} ${totalHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={previewMode ? { maxHeight: 140 } : undefined}
        >
            <defs>
                <style>{`
                    @keyframes dag-edge-dash {
                        to { stroke-dashoffset: -20; }
                    }
                `}</style>
            </defs>

            <g transform={svgTransform}>
            {/* Edges */}
            {data.nodes.map((node, i) => {
                if (i === 0) return null;
                const prev = data.nodes[i - 1];
                const fromPos = positions[i - 1];
                const toPos = positions[i];
                const badgeText = getEdgeBadgeText(prev.phase, node.phase, pipelineConfig);
                const tooltipText = getEdgeSchemaText(prev.phase, node.phase, pipelineConfig);
                const prevElapsedMs = now != null && prev.state === 'running' && prev.startedAt != null
                    ? now - prev.startedAt
                    : prev.durationMs;
                return (
                    <DAGEdge
                        key={`edge-${prev.phase}-${node.phase}`}
                        fromX={fromPos.x + NODE_W}
                        fromY={fromPos.y + NODE_H / 2}
                        toX={toPos.x}
                        toY={toPos.y + NODE_H / 2}
                        state={deriveEdgeState(prev.state, node.state)}
                        isDark={isDark}
                        badgeText={badgeText}
                        tooltipText={tooltipText}
                        completedItems={prev.itemCount ?? prev.totalItems}
                        elapsedMs={prevElapsedMs}
                    />
                );
            })}

            {/* Nodes */}
            {data.nodes.map((node, i) => {
                const elapsedMs = now != null && node.state === 'running' && node.startedAt != null
                    ? now - node.startedAt
                    : undefined;
                return (
                    <DAGNode
                        key={node.phase}
                        node={node}
                        x={positions[i].x}
                        y={positions[i].y}
                        isDark={isDark}
                        onClick={handleNodeClick}
                        onMouseEnter={pipelineConfig ? handleNodeMouseEnter : undefined}
                        onMouseLeave={pipelineConfig ? handleNodeMouseLeave : undefined}
                        elapsedMs={elapsedMs}
                        selected={node.phase === selectedPhase}
                        parallelCount={node.phase === 'map' ? parallelCount : undefined}
                        validationErrors={phaseErrors ? getNodeErrors(phaseErrors, node.phase, previewMode ? { previewMode: true, firstPhase: data.nodes[0]?.phase } : undefined) : undefined}
                        totalDurationMs={data.totalDurationMs}
                    />
                );
            })}

            {/* Progress bar for map node */}
            {mapNode && mapNode.totalItems != null && mapNode.totalItems > 0 && (() => {
                const mapIdx = data.nodes.findIndex(n => n.phase === 'map');
                if (mapIdx < 0) return null;
                const pos = positions[mapIdx];
                const successCount = (mapNode.totalItems ?? 0) - (mapNode.failedItems ?? 0);
                return (
                    <g transform={`translate(${pos.x}, ${pos.y + NODE_H + 4})`}>
                        <DAGProgressBar
                            successCount={successCount}
                            failedCount={mapNode.failedItems ?? 0}
                            totalCount={mapNode.totalItems}
                            width={NODE_W}
                        />
                    </g>
                );
            })()}
            </g>
        </svg>
        <ZoomControls
            zoomLabel={zoomLabel}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={zoomReset}
            onFitToView={fitToView}
        />
        {hoveredPhase && hoverAnchor && pipelineConfig && !selectedPhase && (
            <DAGHoverTooltip
                phase={hoveredPhase}
                config={pipelineConfig}
                anchor={hoverAnchor}
                onMouseEnter={handleTooltipMouseEnter}
                onMouseLeave={handleTooltipMouseLeave}
            />
        )}
        {selectedPhase && selectedDetail && (
            <PipelinePhasePopover
                phase={selectedDetail}
                onClose={() => setSelectedPhase(null)}
                onScrollToConversation={
                    selectedDetail.status === 'failed' && onScrollToConversation
                        ? () => onScrollToConversation(selectedPhase)
                        : undefined
                }
            />
        )}
        {!previewMode && <DAGLegend isDark={isDark} />}
        </div>
    );
}
