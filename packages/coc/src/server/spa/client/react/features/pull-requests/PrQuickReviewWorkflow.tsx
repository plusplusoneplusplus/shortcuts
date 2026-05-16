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
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-quick-workflow"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Quick review workflow
                </h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                    Reviewer, author, and lead needs in one pass
                </span>
            </header>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
                {lenses.map(lens => (
                    <section
                        key={lens.persona}
                        className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/40"
                        data-testid="pr-quick-workflow-lens"
                    >
                        <h3 className="m-0 mb-1.5 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                            {lens.persona}
                        </h3>
                        <p className="m-0 text-xs text-gray-600 dark:text-gray-400">{lens.body}</p>
                    </section>
                ))}
            </div>
        </div>
    );
}
