/**
 * PipelineAIRefinePanel — lets users submit a natural-language instruction to
 * refine an existing pipeline YAML, tracks progress through three phases
 * (input → refining → preview), and renders the result as a unified diff.
 */

import { useState, useRef } from 'react';
import { Button, Spinner } from '../shared';
import { refinePipeline } from './pipeline-api';
import { UnifiedDiffViewer } from './UnifiedDiffViewer';
import { generateUnifiedDiff } from './unifiedDiffUtils';

export interface PipelineAIRefinePanelProps {
    workspaceId: string;
    pipelineName: string;
    currentYaml: string;
    onApply: (newYaml: string) => void | Promise<void>;
    onCancel: () => void;
}

type RefinePhase = 'input' | 'refining' | 'preview';

export function PipelineAIRefinePanel({
    workspaceId,
    pipelineName,
    currentYaml,
    onApply,
    onCancel,
}: PipelineAIRefinePanelProps) {
    const [phase, setPhase] = useState<RefinePhase>('input');
    const [instruction, setInstruction] = useState('');
    const [refinedYaml, setRefinedYaml] = useState('');
    const [diff, setDiff] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    async function handleRefine() {
        if (instruction.trim().length < 10) return;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setPhase('refining');
        setError(null);

        try {
            const result = await refinePipeline(
                workspaceId,
                pipelineName,
                instruction.trim(),
                currentYaml,
                undefined,
                controller.signal,
            );
            const diffStr = generateUnifiedDiff(currentYaml, result.yaml, 'pipeline.yaml');
            setDiff(diffStr);
            setRefinedYaml(result.yaml);
            setPhase('preview');
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setPhase('input');
            } else {
                setError(err.message || 'Refinement failed. Please try again.');
                setPhase('input');
            }
        }
    }

    function handleCancel() {
        abortRef.current?.abort();
        if (phase === 'refining') {
            setPhase('input');
        } else {
            onCancel();
        }
    }

    async function handleApply() {
        setSubmitting(true);
        try {
            await Promise.resolve(onApply(refinedYaml));
            setPhase('input');
            setInstruction('');
            setRefinedYaml('');
            setDiff('');
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to apply changes');
        } finally {
            setSubmitting(false);
        }
    }

    const panelTitle =
        phase === 'preview' ? 'Review Changes' :
        phase === 'refining' ? 'Refining...' :
        'Edit with AI';

    return (
        <div data-testid="pipeline-ai-refine-panel">
            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-3">
                {panelTitle}
            </h3>

            {phase === 'input' && (
                <div className="flex flex-col gap-3">
                    <div>
                        <textarea
                            value={instruction}
                            onChange={e => { setInstruction(e.target.value.slice(0, 2000)); setError(null); }}
                            placeholder="Describe your change..."
                            rows={5}
                            className="w-full px-2 py-1.5 text-sm border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] rounded resize-none"
                            data-testid="refine-instruction"
                        />
                        <div className={`text-xs mt-1 ${instruction.length > 1900 ? 'text-red-500' : 'text-[#848484]'}`}>
                            {instruction.length} / 2000 characters
                        </div>
                    </div>

                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5" data-testid="refine-error">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
                        <Button
                            disabled={instruction.trim().length < 10}
                            onClick={handleRefine}
                            data-testid="refine-submit"
                        >
                            Refine with AI ✨
                        </Button>
                    </div>
                </div>
            )}

            {phase === 'refining' && (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col items-center gap-3 py-4">
                        <Spinner size="lg" />
                        <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Refining pipeline...</div>
                        <div className="text-xs text-[#848484]">⏱ This usually takes 10–30 seconds.</div>
                    </div>
                    <div className="flex justify-end">
                        <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
                    </div>
                </div>
            )}

            {phase === 'preview' && (
                <div className="flex flex-col gap-3">
                    <UnifiedDiffViewer diff={diff} fileName="pipeline.yaml" data-testid="refine-diff" />

                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1.5" data-testid="refine-error">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setPhase('input')}>← Back</Button>
                        <Button variant="secondary" onClick={handleRefine}>Re-refine 🔄</Button>
                        <Button loading={submitting} onClick={handleApply} data-testid="refine-apply">
                            Apply Changes ✓
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
