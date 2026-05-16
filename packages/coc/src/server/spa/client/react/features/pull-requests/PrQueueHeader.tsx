/**
 * Header for the redesigned PR review command queue. Static eyebrow,
 * title, and copy that frame the queue rail.
 */

interface PrQueueHeaderProps {
    eyebrow?: string;
    title?: string;
    copy?: string;
}

const DEFAULT_EYEBROW = 'Review command queue';
const DEFAULT_TITLE = 'Ship the right PR first';
const DEFAULT_COPY = 'AI ranks queue items by review cost, unresolved risk, and release relevance.';

export function PrQueueHeader({
    eyebrow = DEFAULT_EYEBROW,
    title = DEFAULT_TITLE,
    copy = DEFAULT_COPY,
}: PrQueueHeaderProps) {
    return (
        <div
            className="border-b border-gray-200 px-2.5 pb-2 pt-[9px] dark:border-gray-700"
            data-testid="pr-queue-header"
        >
            <p className="m-0 mb-[3px] text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:text-gray-400">
                {eyebrow}
            </p>
            <h1 className="m-0 text-[18px] font-semibold leading-[1.12] text-gray-900 dark:text-gray-100">
                {title}
            </h1>
            <p className="m-0 mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{copy}</p>
        </div>
    );
}
