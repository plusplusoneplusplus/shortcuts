import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { useApp } from '../../contexts/AppContext';
import { ToastContext } from '../../contexts/ToastContext';
import { useOptionalChatPrefs } from '../../contexts/chatPrefsConsumer';
import { queueJobHash } from '../../queue/queueJobRoute';
import { RailControlsContext, RailHoverPreview } from '../repo-detail/RailHoverPreview';
import { compareChatRecency, getChatRowTitle } from './latestSentinelChat';
import { markNativeUnreadRead, unreadRailTaskVisible } from './unreadMarkAllRead';
import type { RailPinnedTab } from './rail-pinned-jobs';

/** Upper bound for one Mark all read run, so a stalled owner cannot leave the action pending. */
export const MARK_ALL_READ_TIMEOUT_MS = 120_000;
const MARK_ALL_READ_TIMEOUT_MESSAGE = 'Marking conversations read timed out. Some may already be read; try again.';

export interface UnreadRailRow {
    key: string;
    title: string;
    href: string;
    meta?: ReactNode;
    open: () => void;
}

/** A projection of the mounted list's unread state. Opening this UI performs no reads or writes. */
export function RailUnreadChats({ scopeKey, scopeLabel, rows, count = rows.length, partial = false, onMarkAllRead, markAllReadDisabledReason }: {
    scopeKey: string;
    scopeLabel: string;
    rows: readonly UnreadRailRow[];
    count?: number;
    partial?: boolean;
    onMarkAllRead?: (signal: AbortSignal) => Promise<void>;
    markAllReadDisabledReason?: string;
}) {
    const rail = useContext(RailControlsContext);
    const toast = useContext(ToastContext);
    const flight = useRef<AbortController | null>(null);
    const [pendingScope, setPendingScope] = useState<string | null>(null);
    const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
    useEffect(() => {
        setPendingScope(null);
        setFailure(null);
        return () => { flight.current?.abort(); flight.current = null; };
    }, [scopeKey]);
    const busy = pendingScope === scopeKey;
    const markAllRead = async () => {
        if (flight.current || !onMarkAllRead || count === 0 || markAllReadDisabledReason) return;
        const controller = new AbortController();
        flight.current = controller;
        setPendingScope(scopeKey);
        setFailure(null);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, MARK_ALL_READ_TIMEOUT_MS);
        // Settles on scope change or deadline even if a stalled request ignores the signal.
        const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
        try {
            await Promise.race([onMarkAllRead(controller.signal), stopped]);
        } catch (error) {
            if (timedOut || !controller.signal.aborted) {
                const message = timedOut ? MARK_ALL_READ_TIMEOUT_MESSAGE
                    : error instanceof Error ? error.message : 'Could not mark conversations read.';
                setFailure({ scope: scopeKey, message });
                toast?.addToast(message, 'error');
            }
        } finally {
            clearTimeout(timer);
            if (flight.current === controller) {
                flight.current = null;
                setPendingScope(null);
            }
        }
    };
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
        headerActions: onMarkAllRead && <button type="button" onClick={() => { void markAllRead(); }}
            disabled={busy || count === 0 || !!markAllReadDisabledReason} aria-busy={busy}
            title={markAllReadDisabledReason}
            className="rounded text-[10px] text-[#0078d4] hover:underline focus-visible:outline focus-visible:outline-[#007acc] disabled:cursor-default disabled:opacity-50 dark:text-[#3794ff]">
            {busy ? 'Marking…' : 'Mark all read'}
        </button>,
        renderRows: dismiss => <>
            {failure?.scope === scopeKey && <li role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{failure.message}</li>}
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
export function NativeRailUnreadChats({ history, unseenProcessIds, routeId, tab, onOpen, scopeKey, scopeLabel, client, workspaceId }: {
    history: readonly any[];
    unseenProcessIds: ReadonlySet<string>;
    routeId: string;
    tab: RailPinnedTab;
    onOpen: (task: any) => void;
    scopeKey: string;
    scopeLabel: string;
    client: CocClient;
    workspaceId: string;
}) {
    const prefs = useOptionalChatPrefs();
    const { state } = useApp();
    const excluded = new Set(state.myWorkExcludedTypes ?? []);
    const rows = history.filter(task => unseenProcessIds.has(task.id)
        && unreadRailTaskVisible(task, tab, excluded, prefs?.archivedChatIds))
        .sort(compareChatRecency)
        .map(task => ({ key: task.id, title: getChatRowTitle(task), href: queueJobHash(routeId, task, tab), open: () => onOpen(task) }));
    return <RailUnreadChats scopeKey={`${scopeKey}:${tab}:${JSON.stringify([...excluded].sort())}`} scopeLabel={scopeLabel} rows={rows}
        onMarkAllRead={signal => markNativeUnreadRead({ client, workspaceId, tab, excluded, archived: prefs?.archivedChatIds, signal })} />;
}
