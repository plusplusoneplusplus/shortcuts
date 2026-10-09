/**
 * SentinelRailShortcut — collapsed-rail button that opens the list's latest
 * Sentinel chat. `RepoChatTab` portals it into `SplitWorkspacePanel`'s rail so
 * it reads the same scoped running/history rows and opens through the tab's own
 * `selectTask` (clone route included). Renders nothing when no eligible chat exists.
 */

import { cn } from '../../ui';
import { useOptionalChatPrefs } from '../../contexts/chatPrefsConsumer';
import { getChatRowTitle, getChatSelectionId, selectLatestSentinelChat } from './latestSentinelChat';

export interface SentinelRailShortcutProps {
    running: readonly any[];
    history: readonly any[];
    selectedTaskId: string | null;
    onOpen: (task: any) => void;
}

export function SentinelRailShortcut({ running, history, selectedTaskId, onOpen }: SentinelRailShortcutProps) {
    const archivedChatIds = useOptionalChatPrefs()?.archivedChatIds;
    const task = selectLatestSentinelChat(running, history, archivedChatIds);
    if (!task) return null;

    const selected = selectedTaskId === getChatSelectionId(task);
    const label = `Open latest Sentinel chat: ${getChatRowTitle(task)}`;
    return (
        <button
            type="button"
            className={cn(
                'flex h-7 w-7 items-center justify-center rounded text-[13px] leading-none transition-colors',
                'hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc]/50',
                selected && 'bg-teal-50 ring-1 ring-teal-500/60 dark:bg-teal-500/10 dark:ring-teal-500/50',
            )}
            onClick={() => onOpen(task)}
            aria-label={label}
            aria-current={selected ? 'true' : undefined}
            title={label}
            data-testid="split-workspace-left-sentinel"
            data-sentinel-task-id={String(task.id)}
        >
            <span aria-hidden="true">🛡️</span>
        </button>
    );
}
