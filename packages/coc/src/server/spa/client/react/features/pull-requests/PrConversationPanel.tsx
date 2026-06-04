/**
 * Conversation timeline panel for the PR overview tab. Renders a deterministic
 * timeline of activity plus a reply textarea with a "Draft reply" assist.
 */

import { useRef, useState } from 'react';
import type { PrTimelineEvent } from './pr-derived-data';

interface PrConversationPanelProps {
    events: PrTimelineEvent[];
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
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-conversation"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">Conversation</h2>
                <button
                    type="button"
                    onClick={handleDraftReply}
                    className="inline-flex min-h-[24px] items-center gap-1 rounded-[5px] border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    data-testid="pr-draft-reply"
                >
                    Draft reply to reviewer
                </button>
            </header>
            <div className="p-2">
                <div className="grid gap-1.5" data-testid="pr-timeline">
                    {events.map((event, idx) => (
                        <div
                            key={`${event.initials}-${idx}`}
                            className="grid items-start gap-[7px]"
                            style={{ gridTemplateColumns: '20px 1fr' }}
                            data-testid="pr-timeline-event"
                        >
                            <span className="grid h-5 w-5 place-items-center rounded-full border border-gray-200 bg-gray-50 text-[10px] font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                {event.initials}
                            </span>
                            <div>
                                <strong className="text-[12px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
                                    {event.title}
                                </strong>
                                <p className="m-0 mt-px text-[12px] leading-snug text-gray-500 dark:text-gray-400">
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
                    className="mt-1.5 w-full resize-y rounded-[5px] border border-gray-300 bg-white px-1.5 py-1 text-[12px] text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    style={{ minHeight: 48 }}
                    data-testid="pr-reply-box"
                />
            </div>
        </div>
    );
}
