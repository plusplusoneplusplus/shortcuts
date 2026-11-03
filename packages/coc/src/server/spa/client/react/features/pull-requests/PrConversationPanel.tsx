/**
 * Activity timeline for the PR overview tab: a deterministic list of events
 * plus a reply box.
 */

import { useState } from 'react';
import type { PrTimelineEvent } from './pr-derived-data';

interface PrConversationPanelProps {
    events: PrTimelineEvent[];
}

export function PrConversationPanel({ events }: PrConversationPanelProps) {
    const [reply, setReply] = useState('');

    return (
        <section data-testid="pr-conversation">
            <h2 className="m-0 mb-2 text-[15px] font-semibold text-gray-900 dark:text-gray-100">Activity</h2>
            <div className="grid gap-2" data-testid="pr-timeline">
                {events.map((event, idx) => (
                    <div
                        key={`${event.initials}-${idx}`}
                        className="grid items-start gap-2"
                        style={{ gridTemplateColumns: '24px 1fr' }}
                        data-testid="pr-timeline-event"
                    >
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-100 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                            {event.initials}
                        </span>
                        <div>
                            <strong className="text-[13px] font-medium leading-snug text-gray-900 dark:text-gray-100">
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
                value={reply}
                onChange={event => setReply(event.target.value)}
                placeholder="Write a reply…"
                className="mt-3 w-full resize-y rounded-lg border-0 bg-gray-100 px-3 py-2 text-[13px] text-gray-900 outline-none focus:ring-2 focus:ring-blue-500/30 dark:bg-gray-800 dark:text-gray-100"
                style={{ minHeight: 44 }}
                data-testid="pr-reply-box"
            />
        </section>
    );
}
