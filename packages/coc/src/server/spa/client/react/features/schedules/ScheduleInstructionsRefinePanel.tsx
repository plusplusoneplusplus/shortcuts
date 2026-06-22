/**
 * ScheduleInstructionsRefinePanel — lets users ask AI to rewrite rough prompt
 * routine instructions into a clearer, well-structured prompt.
 *
 * Mirrors the three-phase WorkflowAIRefinePanel flow (input → refining →
 * preview) but works on plain instruction text and renders the change as a
 * before/after unified diff. The actual request is supplied via the `refine`
 * callback so the panel stays decoupled from the CoC client (and clone routing).
 */

import { useState, useRef } from 'react';
import { Button, Spinner } from '../../ui';
import { UnifiedDiffViewer } from '../git/diff/UnifiedDiffViewer';
import { generateUnifiedDiff } from '../git/diff/unifiedDiffUtils';

export interface ScheduleInstructionsRefinePanelProps {
    /** The current instructions being refined (the "before" side of the diff). */
    currentInstructions: string;
    /** Performs the refine request; resolves with the refined instructions. */
    refine: (hint: string, signal: AbortSignal) => Promise<string>;
    /** Called with the refined text when the user applies the result. */
    onApply: (refined: string) => void | Promise<void>;
    /** Called when the user dismisses the panel without applying. */
    onCancel: () => void;
}

type RefinePhase = 'input' | 'refining' | 'preview';

/** Treat caller aborts as a silent return (no error banner). */
function isAbort(err: unknown): boolean {
    const e = err as { name?: string; code?: string } | null | undefined;
    return e?.name === 'AbortError' || e?.code === 'ABORTED';
}

export function ScheduleInstructionsRefinePanel({
    currentInstructions,
    refine,
    onApply,
    onCancel,
}: ScheduleInstructionsRefinePanelProps) {
    const [phase, setPhase] = useState<RefinePhase>('input');
    const [hint, setHint] = useState('');
    const [refined, setRefined] = useState('');
    const [diff, setDiff] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    async function handleRefine() {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setPhase('refining');
        setError(null);

        try {
            const result = await refine(hint.trim(), controller.signal);
            const next = (result ?? '').trim();
            setDiff(generateUnifiedDiff(currentInstructions, next, 'instructions.txt'));
            setRefined(next);
            setPhase('preview');
        } catch (err) {
            if (isAbort(err)) {
                setPhase('input');
            } else {
                setError((err as Error)?.message || 'Refinement failed. Please try again.');
                setPhase('input');
            }
        }
    }

    function handleCancel() {
        abortRef.current?.abort();
        if (phase === 'refining') {
            // Cancelling mid-refine just returns to input — the panel stays open.
            setPhase('input');
        } else {
            onCancel();
        }
    }

    async function handleApply() {
        setApplying(true);
        try {
            await Promise.resolve(onApply(refined));
        } catch (err) {
            setError((err as Error)?.message || 'Failed to apply changes');
        } finally {
            setApplying(false);
        }
    }

    const panelTitle =
        phase === 'preview' ? 'Review Changes' :
        phase === 'refining' ? 'Refining...' :
        'Refine Instructions with AI';

    return (
        <div
            className="rounded border border-[#d0d0d0] dark:border-[#555] bg-[#f8f8f8] dark:bg-[#252526] p-3 mt-2"
            data-testid="schedule-refine-panel"
        >
            <h4 className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">{panelTitle}</h4>

            {phase === 'input' && (
                <div className="flex flex-col gap-2">
                    <textarea
                        value={hint}
                        onChange={e => { setHint(e.target.value.slice(0, 500)); setError(null); }}
                        placeholder="Optional: tell AI how to improve it (e.g. 'make it more specific')"
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#ccc] rounded resize-y"
                        data-testid="schedule-refine-hint"
                    />

                    {error && (
                        <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1" data-testid="schedule-refine-error">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={handleCancel}>Cancel</Button>
                        <Button size="sm" onClick={handleRefine} data-testid="schedule-refine-submit">
                            Refine with AI ✨
                        </Button>
                    </div>
                </div>
            )}

            {phase === 'refining' && (
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col items-center gap-2 py-3">
                        <Spinner size="md" />
                        <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">Refining instructions...</div>
                        <div className="text-[10px] text-[#848484]">⏱ This usually takes 10–30 seconds.</div>
                    </div>
                    <div className="flex justify-end">
                        <Button variant="secondary" size="sm" onClick={handleCancel}>Cancel</Button>
                    </div>
                </div>
            )}

            {phase === 'preview' && (
                <div className="flex flex-col gap-2">
                    <UnifiedDiffViewer diff={diff} fileName="instructions.txt" data-testid="schedule-refine-diff" />

                    {error && (
                        <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-2 py-1" data-testid="schedule-refine-error">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setPhase('input')}>← Back</Button>
                        <Button variant="secondary" size="sm" onClick={handleRefine}>Re-refine 🔄</Button>
                        <Button size="sm" loading={applying} onClick={handleApply} data-testid="schedule-refine-apply">
                            Apply ✓
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
