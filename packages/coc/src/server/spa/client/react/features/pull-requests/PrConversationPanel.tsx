/**
 * Conversation timeline panel for the PR overview tab. Renders an AI-grouped
 * timeline of activity plus a reply textarea with a "Draft reply" assist.
 */

import { useRef, useState } from 'react';
import type { AiTimelineEvent } from './pr-mock-data';

interface PrConversationPanelProps {
    events: AiTimelineEvent[];
}

const DRAFT_REPLY_TEMPLATE =
    'Thanks. I agree the abort path needs proof. I will add a slow-consumer test that aborts after a split UTF-8 boundary and confirms retry does not replay the trailing partial record.';

export function PrConversationPanel({ events }: PrConversationPanelProps) {
    const [reply, setReply] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    function handleDraftReply() {
        setReply(DRAFT_REPLY_TEMPLATE);
        requestAnimationFrame(() => textareaRef.current?.focus());
    }

    return (
        <div
            className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-conversation"
        >
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-sm font-semibold text-gray-900 dark:text-gray-100">Conversation</h2>
                <button
                    type="button"
                    onClick={handleDraftReply}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    data-testid="pr-draft-reply"
                >
                    Draft reply to reviewer
                </button>
            </header>
            <div className="px-4 py-4">
                <div className="grid gap-3" data-testid="pr-timeline">
                    {events.map((event, idx) => (
                        <div
                            key={`${event.initials}-${idx}`}
                            className="grid items-start gap-2.5"
                            style={{ gridTemplateColumns: '28px 1fr' }}
                            data-testid="pr-timeline-event"
                        >
                            <span className="grid h-7 w-7 place-items-center rounded-full border border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                {event.initials}
                            </span>
                            <div>
                                <strong className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                    {event.title}
                                </strong>
                                <p className="m-0 mt-0.5 text-[13px] text-gray-600 dark:text-gray-400">
                                    {event.detail}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
                <textarea
                    ref={textareaRef}
                    value={reply}
                    onChange={event => setReply(event.target.value)}
                    placeholder="Write a reply or ask AI to draft one..."
                    className="mt-3.5 w-full resize-y rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    style={{ minHeight: 86 }}
                    data-testid="pr-reply-box"
                />
            </div>
        </div>
    );
}
