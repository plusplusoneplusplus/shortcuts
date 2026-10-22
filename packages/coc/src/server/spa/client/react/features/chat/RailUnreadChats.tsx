import { useContext, type ReactNode } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useOptionalChatPrefs } from '../../contexts/chatPrefsConsumer';
import { queueJobHash } from '../../queue/queueJobRoute';
import { RailControlsContext, RailHoverPreview } from '../repo-detail/RailHoverPreview';
import { compareChatRecency, getChatRowTitle } from './latestSentinelChat';
import { isChatTask, taskMatchesFilter } from './task-type-filter';
import type { RailPinnedTab } from './rail-pinned-jobs';

export interface UnreadRailRow {
    key: string;
    title: string;
    href: string;
    meta?: ReactNode;
    open: () => void;
}

/** A projection of the mounted list's unread state. Opening this UI performs no reads or writes. */
export function RailUnreadChats({ scopeKey, scopeLabel, rows, count = rows.length, partial = false }: {
    scopeKey: string;
    scopeLabel: string;
    rows: readonly UnreadRailRow[];
    count?: number;
    partial?: boolean;
}) {
    const rail = useContext(RailControlsContext);
    if (!rail) return null;
    return <RailHoverPreview key={scopeKey} {...rail} scopeLabel={scopeLabel} controls={[{
        key: 'unread', count,
        label: `${count} unread ${count === 1 ? 'conversation' : 'conversations'}${partial ? ', partial' : ''}`,
        heading: 'Unread conversations',
        showWhenEmpty: true,
        clickOpensPreview: true,
        closeLabel: 'Close unread preview',
        description: 'Hover, focus or click to preview unread conversations.',
        className: 'border-[#d0d7de] bg-white text-[#0078d4] hover:bg-[#eaf4ff] dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#3794ff] dark:hover:bg-[#19384f]',
        badgeClassName: 'bg-[#0078d4] dark:bg-[#3794ff]',
        icon: <span aria-hidden="true">●</span>,
        renderRows: dismiss => <>
            {partial && <li role="status" className="px-3 py-2 text-xs text-[#848484]">Partial unread list.</li>}
            {rows.length === 0 && <li className="px-3 py-3 text-xs text-[#848484]">
                {count > 0 || partial ? 'No unread conversations in the loaded list.' : 'No unread conversations.'}
            </li>}
            {rows.map(row => <li key={row.key} className="border-b border-[#e5e5e5] last:border-0 dark:border-[#3c3c3c]">
                <a href={row.href} className="block px-3 py-2 text-xs hover:bg-[#eaf4ff] focus-visible:outline focus-visible:outline-[#007acc] dark:hover:bg-[#19384f]"
                    onClick={event => {
                        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        dismiss();
                        row.open();
                    }}>
                    <span className="line-clamp-2 break-words font-semibold">{row.title}</span>
                    {row.meta && <span className="mt-1 block text-[10px] text-[#656d76] dark:text-[#aaa]">{row.meta}</span>}
                </a>
            </li>)}
        </>,
    }]} />;
}

/** Reuses the native list's seen ids, archive preferences, tab and type exclusions. */
export function NativeRailUnreadChats({ history, unseenProcessIds, routeId, tab, onOpen, scopeKey, scopeLabel }: {
    history: readonly any[];
    unseenProcessIds: ReadonlySet<string>;
    routeId: string;
    tab: RailPinnedTab;
    onOpen: (task: any) => void;
    scopeKey: string;
    scopeLabel: string;
}) {
    const prefs = useOptionalChatPrefs();
    const { state } = useApp();
    const excluded = new Set(state.myWorkExcludedTypes ?? []);
    const rows = history.filter(task => unseenProcessIds.has(task.id)
        && !prefs?.archivedChatIds.has(task.id) && taskMatchesFilter(task, excluded)
        && (tab === 'activity' || (tab === 'chats' ? isChatTask(task) : !isChatTask(task))))
        .sort(compareChatRecency)
        .map(task => ({ key: task.id, title: getChatRowTitle(task), href: queueJobHash(routeId, task, tab), open: () => onOpen(task) }));
    return <RailUnreadChats scopeKey={scopeKey} scopeLabel={scopeLabel} rows={rows} />;
}
