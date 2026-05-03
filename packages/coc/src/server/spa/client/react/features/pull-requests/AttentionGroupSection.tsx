import { forwardRef, useState } from 'react';
import { cn } from '../../ui';
import { PullRequestRow } from './PullRequestRow';
import type { PullRequest } from './pr-utils';
import type { AttentionGroupConfig } from './pr-attention-groups';

interface AttentionGroupSectionProps {
    config: AttentionGroupConfig;
    prs: PullRequest[];
    selectedPrId: number | string | null;
    onRowClick: (pr: PullRequest) => void;
}

export const AttentionGroupSection = forwardRef<HTMLDivElement, AttentionGroupSectionProps>(
    function AttentionGroupSection({ config, prs, selectedPrId, onRowClick }, ref) {
        const [isExpanded, setIsExpanded] = useState(true);

        return (
            <section
                ref={ref}
                className="border-b border-gray-100 dark:border-gray-800"
                data-group-id={config.group}
                data-testid="attention-group-section"
            >
                <div className="sticky top-[41px] z-10 flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm dark:border-gray-800 dark:bg-gray-900">
                    <button
                        type="button"
                        className="flex flex-1 items-center gap-2 text-left"
                        onClick={() => setIsExpanded(value => !value)}
                        aria-expanded={isExpanded}
                        data-testid={`attention-group-toggle-${config.group}`}
                    >
                        <span
                            className={cn('inline-block text-gray-500 transition-transform dark:text-gray-400', !isExpanded && 'rotate-90')}
                            aria-hidden="true"
                        >
                            ▾
                        </span>
                        <span aria-hidden="true">{config.icon}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{config.label}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', config.color)}>
                            {prs.length}
                        </span>
                    </button>
                </div>
                {isExpanded && (
                    <div data-testid={`attention-group-rows-${config.group}`}>
                        {prs.map(pr => (
                            <PullRequestRow
                                key={pr.id}
                                pr={pr}
                                onClick={() => onRowClick(pr)}
                                isSelected={(pr.number ?? pr.id) === selectedPrId}
                            />
                        ))}
                    </div>
                )}
            </section>
        );
    },
);
