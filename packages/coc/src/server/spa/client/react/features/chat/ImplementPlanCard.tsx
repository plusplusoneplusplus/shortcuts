/**
 * ImplementPlanCard — inline action card shown after a completed plan-mode chat.
 *
 * Renders a single CTA that immediately enqueues a new autopilot task
 * referencing the plan file produced in this conversation. When the new task
 * is created, navigation happens via the `onImplemented` callback.
 *
 * Visibility conditions are owned by the parent (ChatDetail). This component
 * only renders the card and runs the enqueue + navigation handler.
 */

import { useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { cn } from '../../ui/cn';

export interface ImplementPlanCardProps {
    planFilePath: string;
    workspaceId?: string;
    workingDirectory?: string;
    onImplemented: (newProcessId: string) => void;
}

export function ImplementPlanCard({
    planFilePath,
    workspaceId,
    workingDirectory,
    onImplemented,
}: ImplementPlanCardProps) {
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleClick() {
        if (submitting || submitted) return;
        setSubmitting(true);
        setError(null);
        try {
            const result = await getSpaCocClient().queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: 'autopilot' as any,
                    prompt: `Read and implement the plan file at ${planFilePath}`,
                    context: { files: [planFilePath] },
                    workingDirectory,
                    workspaceId,
                } as any,
            });
            const rawId = (result as any).task?.id ?? (result as any).id;
            if (!rawId) throw new Error('No task id returned from enqueue');
            const processId = isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);
            setSubmitted(true);
            onImplemented(processId);
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to start implementation'));
        } finally {
            setSubmitting(false);
        }
    }

    const disabled = submitting || submitted;

    return (
        <div
            className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-4 py-3"
            data-testid="implement-plan-card"
        >
            <div className="flex items-start gap-3 rounded-md border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f7f7f7] dark:bg-[#252526] p-3">
                <div className="text-xl leading-none" aria-hidden="true">🚀</div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        Implement this plan
                    </div>
                    <p className="mt-0.5 text-xs text-[#5a5a5a] dark:text-[#999]">
                        Start a new autopilot session to execute the plan produced in this conversation.
                    </p>
                    <p className="mt-1 text-[11px] font-mono text-[#848484] truncate" title={planFilePath}>
                        {planFilePath}
                    </p>
                    {error && (
                        <p className="mt-1 text-xs text-[#f14c4c]" data-testid="implement-plan-card-error">
                            {error}
                        </p>
                    )}
                </div>
                <div className="flex-shrink-0">
                    <button
                        type="button"
                        data-testid="implement-plan-card-btn"
                        onClick={handleClick}
                        disabled={disabled}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors',
                            disabled
                                ? 'bg-blue-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700',
                        )}
                    >
                        {submitted ? '✓ Implementing' : submitting ? '⏳ Starting…' : 'Implement →'}
                    </button>
                </div>
            </div>
        </div>
    );
}
