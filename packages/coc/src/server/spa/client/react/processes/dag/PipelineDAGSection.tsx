import { useState } from 'react';
import { PipelineDAGChart } from './PipelineDAGChart';
import { buildDAGData } from './buildDAGData';
import { formatDuration, statusIcon } from '../../utils/format';

export interface PipelineDAGSectionProps {
    process: any;
}

function detectDarkMode(): boolean {
    if (typeof document !== 'undefined') {
        return document.documentElement.classList.contains('dark');
    }
    return false;
}

export function PipelineDAGSection({ process }: PipelineDAGSectionProps) {
    const [expanded, setExpanded] = useState(true);
    const isDark = detectDarkMode();

    const dagData = buildDAGData(process);
    if (!dagData) return null;

    const status = process.status || 'completed';
    const icon = statusIcon(status);
    const durationText = dagData.totalDurationMs != null ? formatDuration(dagData.totalDurationMs) : '';

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
                <span>{expanded ? '▾' : '▸'} Pipeline Flow</span>
                {durationText && (
                    <span className="text-xs text-[#848484]">{durationText}</span>
                )}
            </div>

            {/* Body */}
            {expanded && (
                <div className="px-4 py-3">
                    <PipelineDAGChart data={dagData} isDark={isDark} />
                    <div className="text-xs text-[#848484] text-center mt-2">
                        {caption}
                    </div>
                </div>
            )}
        </div>
    );
}
