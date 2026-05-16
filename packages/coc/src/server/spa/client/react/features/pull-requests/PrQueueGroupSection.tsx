/**
 * Simple labeled section in the PR review command queue. Replaces the
 * older AttentionGroupSection with a flatter, non-collapsible visual
 * that matches the redesigned queue rail.
 */

import { forwardRef, type ReactNode } from 'react';
import type { QueueSection } from './pr-attention-groups';

interface PrQueueGroupSectionProps {
    section: QueueSection;
    label: string;
    /** Pre-rendered PR rows (keep row rendering in the parent so it can
     *  pass batch-mode props consistently). */
    children: ReactNode;
}

export const PrQueueGroupSection = forwardRef<HTMLElement, PrQueueGroupSectionProps>(
    function PrQueueGroupSection({ section, label, children }, ref) {
        return (
            <section
                ref={ref}
                className="border-b border-gray-200 py-2 last:border-b-0 dark:border-gray-800"
                data-testid="pr-queue-group"
                data-queue-section={section}
            >
                <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {label}
                </div>
                <div data-testid="pr-queue-group-rows">{children}</div>
            </section>
        );
    },
);
