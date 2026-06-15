import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../../ui/Dialog';
import { Button, Spinner } from '../../ui';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useCocClient } from '../../repos/cloneRouting';
import type { WorkItem, WorkItemAiClarificationResponse } from '@plusplusoneplusplus/coc-client';

type DraftPhase = 'idle' | 'generating' | 'clarifying' | 'failed';

interface WorkflowDraftItem {
    id: string;
    title: string;
    updatedAt: string;
    currentContentVersion?: number;
    plan?: {
        version: number;
        currentVersion?: number;
        content?: string;
    };
}

export interface WorkItemAiDraftApplyDialogProps {
    open: boolean;
    workspaceId: string;
    item: WorkflowDraftItem;
    onClose: () => void;
    onApplied: (item: WorkItem) => void;
}

const MAX_CLARIFICATION_ROUNDS = 3;

function getCurrentContentVersion(item: WorkflowDraftItem): number | null {
    return item.currentContentVersion ?? item.plan?.currentVersion ?? item.plan?.version ?? null;
}

function buildDraftPrompt(item: WorkflowDraftItem): string {
    if (item.plan?.content?.trim()) {
        return 'Revise this saved Work Item using its title, description, and current implementation plan. Keep the title unchanged and return an updated description plus implementation plan.';
    }
    return 'Draft this saved title-only Work Item using its title. Keep the title unchanged and return a concise description plus a v1 implementation plan.';
}

function isAbortError(error: unknown): boolean {
    const maybe = error as { code?: unknown; name?: unknown } | null;
    return maybe?.code === 'ABORTED' || maybe?.name === 'AbortError';
}

export function WorkItemAiDraftApplyDialog({ open, workspaceId, item, onClose, onApplied }: WorkItemAiDraftApplyDialogProps) {
    const cloneClient = useCocClient(workspaceId); // AC-07: apply AI draft on the selected clone's server.
    const [phase, setPhase] = useState<DraftPhase>('idle');
    const [questions, setQuestions] = useState<string[]>([]);
    const [answers, setAnswers] = useState<string[]>([]);
    const [clarificationCount, setClarificationCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const requestSeqRef = useRef(0);
    const prompt = useMemo(() => buildDraftPrompt(item), [item]);
    const isRevision = !!item.plan?.content?.trim();

    const startDraft = useCallback(async (options: { answers?: string[]; clarificationCount?: number; forceDraft?: boolean } = {}) => {
        const requestSeq = ++requestSeqRef.current;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setPhase('generating');
        setError(null);

        try {
            const effectiveClarificationCount = options.forceDraft
                ? MAX_CLARIFICATION_ROUNDS
                : options.clarificationCount ?? clarificationCount;
            const response = await cloneClient.workItems.applyAiDraft(
                workspaceId,
                item.id,
                {
                    prompt,
                    targets: ['fields', 'goal'],
                    baseUpdatedAt: item.updatedAt,
                    baseContentVersion: getCurrentContentVersion(item),
                    clarificationAnswers: options.answers && options.answers.length > 0 ? options.answers : undefined,
                    clarificationCount: effectiveClarificationCount,
                    summary: isRevision ? 'AI revised implementation plan' : 'AI drafted implementation plan',
                    reason: isRevision ? 'User requested AI revision' : 'User requested AI draft',
                },
                { signal: controller.signal },
            );
            if (requestSeq !== requestSeqRef.current || controller.signal.aborted) return;

            if (response.kind === 'clarification') {
                const clarification = response as WorkItemAiClarificationResponse;
                setQuestions(clarification.questions);
                setAnswers(new Array(clarification.questions.length).fill(''));
                setClarificationCount(clarification.clarificationCount + 1);
                setPhase('clarifying');
                return;
            }

            onApplied(response.item);
            onClose();
        } catch (err) {
            if (requestSeq !== requestSeqRef.current || controller.signal.aborted || isAbortError(err)) return;
            setError(getSpaCocClientErrorMessage(err, 'Failed to draft with AI'));
            setPhase('failed');
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
        }
    }, [clarificationCount, isRevision, item, onApplied, onClose, prompt, workspaceId, cloneClient]);

    useEffect(() => {
        if (!open) return;
        setPhase('idle');
        setQuestions([]);
        setAnswers([]);
        setClarificationCount(0);
        setError(null);
        void startDraft({ clarificationCount: 0 });
        return () => {
            requestSeqRef.current += 1;
            abortRef.current?.abort();
            abortRef.current = null;
        };
    // Auto-start exactly once for each opened item snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, workspaceId, item.id, item.updatedAt, item.currentContentVersion, item.plan?.version]);

    const handleClose = useCallback(() => {
        requestSeqRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        onClose();
    }, [onClose]);

    const handleContinue = useCallback(() => {
        void startDraft({ answers, clarificationCount });
    }, [answers, clarificationCount, startDraft]);

    const handleDraftAnyway = useCallback(() => {
        void startDraft({ answers, clarificationCount, forceDraft: true });
    }, [answers, clarificationCount, startDraft]);

    const handleRetry = useCallback(() => {
        void startDraft({ clarificationCount: 0 });
    }, [startDraft]);

    const isGenerating = phase === 'generating';
    const title = isRevision ? 'Revise with AI' : 'Draft with AI';

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            title={title}
            id="work-item-ai-draft-apply-dialog"
            footer={
                <>
                    <Button variant="secondary" onClick={handleClose} data-testid="wi-ai-draft-cancel-btn">
                        {isGenerating ? 'Cancel drafting' : 'Cancel'}
                    </Button>
                    {phase === 'clarifying' && (
                        <>
                            <Button variant="ghost" onClick={handleDraftAnyway} data-testid="wi-ai-draft-anyway-btn">
                                Draft anyway
                            </Button>
                            <Button variant="primary" onClick={handleContinue} data-testid="wi-ai-draft-continue-btn">
                                Continue drafting
                            </Button>
                        </>
                    )}
                    {phase === 'failed' && (
                        <Button variant="primary" onClick={handleRetry} data-testid="wi-ai-draft-retry-btn">
                            Retry
                        </Button>
                    )}
                </>
            }
        >
            <div className="space-y-3 text-sm" data-testid="wi-ai-draft-apply-body">
                {isGenerating && (
                    <div className="flex items-center gap-2 rounded-md border border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] p-3" data-testid="wi-ai-draft-progress">
                        <Spinner size="sm" />
                        <span>{isRevision ? 'Creating a new AI-authored version…' : 'Creating the first AI-authored draft…'}</span>
                    </div>
                )}
                {phase === 'clarifying' && (
                    <div className="space-y-3" data-testid="wi-ai-draft-clarification">
                        <p className="text-xs text-[#656d76] dark:text-[#999]">
                            AI needs a little more context before saving a version.
                        </p>
                        {questions.map((question, index) => (
                            <label key={question} className="block space-y-1">
                                <span className="block text-xs font-medium text-[#1f2328] dark:text-[#cccccc]">{question}</span>
                                <textarea
                                    className="w-full rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#1e1e1e] p-2 text-xs text-[#1e1e1e] dark:text-[#cccccc] resize-y focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                                    rows={2}
                                    value={answers[index] ?? ''}
                                    onChange={event => {
                                        const next = [...answers];
                                        next[index] = event.target.value;
                                        setAnswers(next);
                                    }}
                                    data-testid={`wi-ai-draft-answer-${index}`}
                                />
                            </label>
                        ))}
                    </div>
                )}
                {phase === 'failed' && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" data-testid="wi-ai-draft-error">
                        {error}
                    </div>
                )}
                <p className="text-[11px] leading-[1.4] text-[#656d76] dark:text-[#999]">
                    The saved Work Item snapshot is checked before AI starts and again before the version is saved. If the item changes, drafting stops and asks you to reload.
                </p>
            </div>
        </Dialog>
    );
}
