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
    /** When true, the section label is hidden (used by the collapsed rail). */
    compact?: boolean;
    /** Pre-rendered PR rows (keep row rendering in the parent so it can
     *  pass batch-mode props consistently). */
    children: ReactNode;
}

export const PrQueueGroupSection = forwardRef<HTMLElement, PrQueueGroupSectionProps>(
    function PrQueueGroupSection({ section, label, compact, children }, ref) {
        return (
            <section
                ref={ref}
                className="border-b border-gray-200 py-1 last:border-b-0 dark:border-gray-800"
                data-testid="pr-queue-group"
                data-queue-section={section}
            >
                {!compact && (
                    <div className="px-2.5 pb-[3px] pt-[5px] text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
                        {label}
                    </div>
                )}
                <div data-testid="pr-queue-group-rows">{children}</div>
            </section>
        );
    },
);
