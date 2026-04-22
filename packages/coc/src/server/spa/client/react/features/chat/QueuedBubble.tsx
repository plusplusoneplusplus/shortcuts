import type { QueuedMessage } from '../../utils/chatUtils';

function QueuedItem({ msg }: { msg: QueuedMessage }) {
    return (
        <div
            className="flex items-start gap-2 px-3 py-1.5 text-sm"
            data-status={msg.status}
        >
            <span className="shrink-0 text-xs leading-5" aria-hidden>🕐</span>
            <span className="text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 break-all">{msg.content}</span>
        </div>
    );
}

/** Compact queued-follow-ups section shown below conversation turns. */
export function QueuedFollowUps({ queue }: { queue: QueuedMessage[] }) {
    if (queue.length === 0) return null;
    return (
        <div
            className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] mx-2 my-1"
            data-testid="queued-followups"
        >
            <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-[#848484] border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                Queued follow-ups ({queue.length})
            </div>
            {queue.map(msg => <QueuedItem key={msg.id} msg={msg} />)}
        </div>
    );
}

/** @deprecated Use QueuedFollowUps instead */
export function QueuedBubble({ msg }: { msg: QueuedMessage }) {
    return <QueuedItem msg={msg} />;
}
