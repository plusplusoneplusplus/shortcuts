/**
 * WorkflowDAGPreview — parses pipeline YAML and renders a static DAG preview.
 * Supports both linear pipelines (input→map→reduce) and workflow DAGs (nodes with from).
 */

import { useMemo, useState } from 'react';
import { WorkflowDAGChart as LinearDAGChart } from '../processes/dag';
import { DAGLegend } from '../processes/dag/DAGLegend';
import { WorkflowDAGChart } from './WorkflowDAGChart';
import { buildPreviewDAG } from './buildPreviewDAG';

export interface WorkflowDAGPreviewProps {
    yamlContent: string;
    /** Pipeline validation errors to display as pins on DAG nodes */
    validationErrors?: string[];
}

function detectDarkMode(): boolean {
    if (typeof document !== 'undefined') {
        return document.documentElement.classList.contains('dark');
    }
    return false;
}

export function WorkflowDAGPreview({ yamlContent, validationErrors }: WorkflowDAGPreviewProps) {
    const [expanded, setExpanded] = useState(true);
    const isDark = detectDarkMode();

    const result = useMemo(() => buildPreviewDAG(yamlContent), [yamlContent]);

    if (!result) return null;

    return (
        <div data-testid="workflow-dag-preview" className="mb-3">
            <div
                className="flex items-center gap-2 py-2 cursor-pointer text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]"
                onClick={() => setExpanded(prev => !prev)}
                data-testid="dag-preview-header"
            >
                <span>{expanded ? '▾' : '▸'} Workflow Flow Preview</span>
            </div>
            {expanded && (
                <div className="py-2">
                    {result.type === 'linear' ? (
                        <>
                            <LinearDAGChart data={result.data} isDark={isDark} pipelineConfig={result.config} validationErrors={validationErrors} previewMode />
                            <DAGLegend isDark={isDark} />
                        </>
                    ) : (
                        <WorkflowDAGChart data={result.data} isDark={isDark} />
                    )}
                    <div className="text-xs text-[#848484] text-center mt-1">
                        {result.type === 'workflow'
                            ? `${result.data.nodes.length} nodes · ${result.data.edges.length} edges`
                            : `${result.data.nodes.length} phase${result.data.nodes.length !== 1 ? 's' : ''}`
                        }
                    </div>
                </div>
            )}
        </div>
    );
}
