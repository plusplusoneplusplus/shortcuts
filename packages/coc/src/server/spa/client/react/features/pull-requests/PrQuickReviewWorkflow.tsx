/**
 * Quick review workflow lens grid — surfaces what reviewer/author/lead
 * should focus on next.
 */

import type { PersonaLens } from './pr-mock-data';

interface PrQuickReviewWorkflowProps {
    lenses: PersonaLens[];
}

export function PrQuickReviewWorkflow({ lenses }: PrQuickReviewWorkflowProps) {
    return (
        <div
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-quick-workflow"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Quick review workflow
                </h2>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    Reviewer, author, and lead needs in one pass
                </span>
            </header>
            <div className="grid grid-cols-1 gap-1.5 p-2 md:grid-cols-3">
                {lenses.map(lens => (
                    <section
                        key={lens.persona}
                        className="rounded-[5px] border border-gray-200 bg-white p-[7px] dark:border-gray-700 dark:bg-gray-800/40"
                        data-testid="pr-quick-workflow-lens"
                    >
                        <h3 className="m-0 mb-[3px] text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                            {lens.persona}
                        </h3>
                        <p className="m-0 text-[11px] leading-[1.35] text-gray-500 dark:text-gray-400">{lens.body}</p>
                    </section>
                ))}
            </div>
        </div>
    );
}
