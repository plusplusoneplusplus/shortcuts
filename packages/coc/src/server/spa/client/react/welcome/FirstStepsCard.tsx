import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, type OnboardingProgress } from '../contexts/AppContext';
import { Button, Card, cn } from '../shared';

interface Step {
    id: string;
    title: string;
    helper: string;
    /** Key in OnboardingProgress that marks this step complete. Undefined for workspace-tracked steps. */
    progressKey?: keyof OnboardingProgress;
}

const STEPS: Step[] = [
    {
        id: 'add-repo',
        title: 'Add your first repository',
        helper: 'Register a local git repository to get started.',
    },
    {
        id: 'use-chat',
        title: 'Start a conversation',
        helper: "Ask AI about your codebase — try 'Explain this project'.",
        progressKey: 'hasUsedChat',
    },
    {
        id: 'run-workflow',
        title: 'Run a workflow',
        helper: 'Define and execute reusable AI pipelines with YAML.',
        progressKey: 'hasRunWorkflow',
    },
    {
        id: 'open-wiki',
        title: 'Explore the wiki',
        helper: 'Browse auto-generated documentation for your codebase.',
        progressKey: 'hasOpenedWiki',
    },
];

export { STEPS };
export type { Step };

export interface FirstStepsCardProps {
    onAddRepo: () => void;
}

export function FirstStepsCard({ onAddRepo }: FirstStepsCardProps) {
    const { state, dispatch } = useApp();
    const { workspaces, onboardingProgress } = state;

    const isStepDone = (step: Step): boolean => {
        if (!step.progressKey) return workspaces.length > 0;
        return onboardingProgress[step.progressKey];
    };

    const completedCount = STEPS.filter(s => isStepDone(s)).length;
    const allDone = completedCount === STEPS.length;

    const celebratingRef = useRef(false);
    const [celebrating, setCelebrating] = useState(false);

    useEffect(() => {
        if (allDone && !celebratingRef.current) {
            celebratingRef.current = true;
            setCelebrating(true);
            const timer = setTimeout(() => {
                dispatch({ type: 'UPDATE_ONBOARDING', payload: { dismissed: true } });
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [allDone, dispatch]);

    const handleDismiss = useCallback(() => {
        dispatch({ type: 'UPDATE_ONBOARDING', payload: { dismissed: true } });
    }, [dispatch]);

    if (celebrating) {
        return (
            <Card className="mx-2 my-4 p-4 text-center" data-testid="first-steps-celebration">
                <div className="text-2xl mb-2">🎉</div>
                <p className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    You&#39;re all set!
                </p>
            </Card>
        );
    }

    return (
        <Card className="mx-2 my-4 p-4" data-testid="first-steps-card">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    Get Started
                </h3>
                <span className="text-xs text-[#848484]" data-testid="first-steps-progress">
                    {completedCount} of {STEPS.length} complete
                </span>
            </div>

            {/* Steps list */}
            <ol className="space-y-3 list-none p-0 m-0">
                {STEPS.map((step, idx) => {
                    const done = isStepDone(step);
                    const isActive = !done && STEPS.slice(0, idx).every(s => isStepDone(s));
                    return (
                        <li
                            key={step.id}
                            data-testid={`first-step-${step.id}`}
                            className={cn(
                                'flex items-start gap-3 rounded-md p-2 transition-colors',
                                isActive && 'bg-[#e8e8e8]/50 dark:bg-[#ffffff08]'
                            )}
                        >
                            {/* Number / check circle */}
                            <div
                                className={cn(
                                    'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                                    done
                                        ? 'bg-[#16825d] text-white'
                                        : 'border-2 border-[#c8c8c8] dark:border-[#555] text-[#848484]'
                                )}
                                aria-label={done ? `Step ${idx + 1} complete` : `Step ${idx + 1}`}
                            >
                                {done ? '✓' : idx + 1}
                            </div>

                            {/* Text + optional action */}
                            <div className="flex-1 min-w-0">
                                <p className={cn(
                                    'text-xs font-medium',
                                    done
                                        ? 'text-[#848484] line-through'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc]'
                                )}>
                                    {step.title}
                                </p>
                                {!done && (
                                    <p className="text-[11px] text-[#848484] mt-0.5">
                                        {step.helper}
                                    </p>
                                )}
                                {!done && step.id === 'add-repo' && (
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        className="mt-2"
                                        data-testid="first-steps-add-repo"
                                        onClick={onAddRepo}
                                    >
                                        + Add Repository
                                    </Button>
                                )}
                                {!done && step.id === 'open-wiki' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="mt-1"
                                        data-testid="first-steps-open-wiki"
                                        onClick={() => dispatch({
                                            type: 'SET_ACTIVE_TAB', tab: 'wiki'
                                        })}
                                    >
                                        Open Wiki
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {/* Dismiss link */}
            <div className="mt-3 text-right">
                <button
                    type="button"
                    className="text-[11px] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] underline"
                    data-testid="first-steps-dismiss"
                    onClick={handleDismiss}
                >
                    Dismiss
                </button>
            </div>
        </Card>
    );
}
