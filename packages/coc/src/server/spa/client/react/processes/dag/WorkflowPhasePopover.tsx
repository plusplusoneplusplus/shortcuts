import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';
import type { DAGNodeState } from './types';
import { cn } from '../../shared/cn';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { BottomSheet } from '../../shared/BottomSheet';

export interface PhaseDetail {
    phase: PipelinePhase;
    status: DAGNodeState;
    durationMs?: number;
    error?: string;
    itemCount?: number;
    // input
    sourceType?: string;
    parameters?: Record<string, string>;
    // filter
    filterType?: string;
    rulesSummary?: string;
    includedCount?: number;
    excludedCount?: number;
    // map
    concurrency?: number;
    batchSize?: number;
    model?: string;
    items?: Array<{ label: string; status: string; durationMs?: number }>;
    totalItems?: number;
    successfulItems?: number;
    failedItems?: number;
    // reduce
    reduceType?: string;
    outputPreview?: string;
    // job
    promptPreview?: string;
}

export interface WorkflowPhasePopoverProps {
    phase: PhaseDetail | null;
    onClose: () => void;
    onScrollToConversation?: () => void;
}

const labelClass = 'text-[10px] uppercase text-[#848484]';
const valueClass = 'text-[11px] text-[#1e1e1e] dark:text-[#cccccc]';
const gridClass = 'grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-xs';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    if (value == null || value === '') return null;
    return (
        <>
            <span className={labelClass}>{label}</span>
            <span className={valueClass}>{value}</span>
        </>
    );
}

function formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function InputDetails({ phase }: { phase: PhaseDetail }) {
    return (
        <div className={gridClass}>
            <Row label="Source Type" value={phase.sourceType} />
            <Row label="Item Count" value={phase.itemCount != null ? String(phase.itemCount) : undefined} />
            {phase.parameters && Object.keys(phase.parameters).length > 0 && (
                <>
                    <span className={labelClass}>Parameters</span>
                    <div className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc]">
                        {Object.entries(phase.parameters).map(([k, v]) => (
                            <div key={k}><span className="text-[#848484]">{k}:</span> {v}</div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function FilterDetails({ phase }: { phase: PhaseDetail }) {
    return (
        <div className={gridClass}>
            <Row label="Filter Type" value={phase.filterType} />
            <Row label="Rules" value={phase.rulesSummary} />
            <Row label="Included" value={phase.includedCount != null ? String(phase.includedCount) : undefined} />
            <Row label="Excluded" value={phase.excludedCount != null ? String(phase.excludedCount) : undefined} />
            <Row label="Duration" value={phase.durationMs != null ? formatMs(phase.durationMs) : undefined} />
        </div>
    );
}

function MapDetails({ phase }: { phase: PhaseDetail }) {
    const MAX_ROWS = 20;
    const items = phase.items ?? [];
    const shown = items.slice(0, MAX_ROWS);
    const overflow = items.length - MAX_ROWS;

    return (
        <div>
            <div className={gridClass}>
                <Row label="Concurrency" value={phase.concurrency != null ? String(phase.concurrency) : undefined} />
                <Row label="Batch Size" value={phase.batchSize != null ? String(phase.batchSize) : undefined} />
                <Row label="Model" value={phase.model} />
            </div>
            {shown.length > 0 && (
                <table className="mt-2 w-full text-[11px]" data-testid="map-items-table">
                    <thead>
                        <tr className={cn(labelClass, 'text-left')}>
                            <th className="pr-2 pb-1">Item</th>
                            <th className="pr-2 pb-1">Status</th>
                            <th className="pb-1">Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((item, i) => (
                            <tr key={i} className="text-[#1e1e1e] dark:text-[#cccccc]">
                                <td className="pr-2">{item.label}</td>
                                <td className="pr-2">
                                    <span className={cn(
                                        'inline-block px-1 rounded text-[10px]',
                                        item.status === 'completed' && 'bg-[#e6f4ea] text-[#16825d]',
                                        item.status === 'failed' && 'bg-[#fde8e8] text-[#f14c4c]',
                                        item.status !== 'completed' && item.status !== 'failed' && 'bg-[#f3f3f3] text-[#848484]',
                                    )}>
                                        {item.status}
                                    </span>
                                </td>
                                <td>{item.durationMs != null ? formatMs(item.durationMs) : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {overflow > 0 && (
                <div className="text-[10px] text-[#848484] mt-1">and {overflow} more…</div>
            )}
        </div>
    );
}

function ReduceDetails({ phase }: { phase: PhaseDetail }) {
    const preview = phase.outputPreview
        ? phase.outputPreview.length > 200
            ? phase.outputPreview.slice(0, 200) + '…'
            : phase.outputPreview
        : undefined;

    return (
        <div className={gridClass}>
            <Row label="Reduce Type" value={phase.reduceType} />
            <Row label="Model" value={phase.model} />
            <Row label="Output Preview" value={preview} />
        </div>
    );
}

function JobDetails({ phase }: { phase: PhaseDetail }) {
    const preview = phase.promptPreview
        ? phase.promptPreview.length > 150
            ? phase.promptPreview.slice(0, 150) + '…'
            : phase.promptPreview
        : undefined;

    return (
        <div className={gridClass}>
            <Row label="Model" value={phase.model} />
            <Row label="Prompt" value={preview} />
            <Row label="Duration" value={phase.durationMs != null ? formatMs(phase.durationMs) : undefined} />
        </div>
    );
}

function PhaseContent({ phase }: { phase: PhaseDetail }) {
    switch (phase.phase) {
        case 'input': return <InputDetails phase={phase} />;
        case 'filter': return <FilterDetails phase={phase} />;
        case 'map': return <MapDetails phase={phase} />;
        case 'reduce': return <ReduceDetails phase={phase} />;
        case 'job': return <JobDetails phase={phase} />;
        default: return null;
    }
}

export function WorkflowPhasePopover({ phase, onClose, onScrollToConversation }: WorkflowPhasePopoverProps) {
    const { isMobile } = useBreakpoint();

    if (!phase) return null;

    const phaseLabels: Record<string, string> = {
        input: 'Input',
        filter: 'Filter',
        map: 'Map',
        reduce: 'Reduce',
        job: 'Job',
    };

    const content = (
        <>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    {phaseLabels[phase.phase] ?? phase.phase} Phase
                </span>
                {!isMobile && (
                    <button
                        data-testid="phase-popover-close"
                        className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-sm leading-none px-1"
                        onClick={onClose}
                    >
                        ×
                    </button>
                )}
            </div>

            {/* Phase-specific content */}
            <PhaseContent phase={phase} />

            {/* Error message */}
            {phase.status === 'failed' && phase.error && (
                <div className="mt-2">
                    <div className={cn(labelClass, 'text-[#f14c4c] mb-0.5')}>Error</div>
                    <pre className="text-[11px] text-[#f14c4c] whitespace-pre-wrap break-words">{phase.error}</pre>
                </div>
            )}

            {/* Scroll to conversation link */}
            {phase.status === 'failed' && onScrollToConversation && (
                <button
                    data-testid="scroll-to-conversation"
                    className="mt-2 text-[11px] text-[#0078d4] dark:text-[#3794ff] hover:underline cursor-pointer bg-transparent border-none p-0"
                    onClick={onScrollToConversation}
                >
                    View in Conversation ↓
                </button>
            )}
        </>
    );

    if (isMobile) {
        return (
            <BottomSheet isOpen={true} onClose={onClose}>
                <div className="p-4" data-testid="phase-popover">
                    {content}
                </div>
            </BottomSheet>
        );
    }

    return (
        <div
            data-testid="phase-popover"
            className="bg-[#f8f8f8] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md p-3 mt-2 transition-all duration-200 overflow-hidden max-h-[300px] overflow-y-auto"
        >
            {content}
        </div>
    );
}
