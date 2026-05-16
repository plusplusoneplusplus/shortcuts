/**
 * Static "queue rule" copy at the bottom of the PR review command
 * queue. Reinforces how AI prioritizes the queue.
 */

interface PrQueueFooterProps {
    label?: string;
    body?: string;
}

const DEFAULT_LABEL = 'Queue rule:';
const DEFAULT_BODY = 'prioritize PRs that unblock release branches or have AI-flagged behavioral risk.';

export function PrQueueFooter({ label = DEFAULT_LABEL, body = DEFAULT_BODY }: PrQueueFooterProps) {
    return (
        <div
            className="px-4 pb-4 pt-3 text-xs text-gray-500 dark:text-gray-400"
            data-testid="pr-queue-footer"
        >
            <strong className="text-gray-700 dark:text-gray-300">{label}</strong>{' '}
            {body}
        </div>
    );
}
