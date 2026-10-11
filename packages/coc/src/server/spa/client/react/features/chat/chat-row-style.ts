/**
 * Shared look of one chat-list row: the status dot, the mode pill and the row
 * grid. `ChatListPane` and the repo-group aggregated list both render rows with
 * these classes so status, mode and selection styling stay identical.
 */
import { cn } from '../../ui';
import { getProviderDotClasses, type ChatProvider } from './ProviderBadge';

export type ChatRowModeKey = 'ask' | 'auto' | 'script' | 'ralph' | 'sentinel';

/** Row grid: status dot, mode pill, title, trailing time/actions. */
export const CHAT_ROW_LAYOUT_CLASSES = cn(
    'chat-row group relative cursor-pointer leading-none transition-colors',
    'grid items-center gap-2 px-4 py-2 md:px-3 md:py-1',
    'grid-cols-[10px_20px_minmax(0,1fr)_auto]',
    'text-[12.5px] min-h-[40px] md:min-h-0 md:h-[26px]',
    'border-b border-[#e0e0e0]/60 dark:border-[#3c3c3c]/60',
    'hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2b]',
);

/** Selected (open) row highlight, excluding multi-select. */
export const CHAT_ROW_SELECTED_CLASSES = cn(
    'bg-[#0078d4]/[0.08] dark:bg-[#3794ff]/[0.10] ring-2 ring-[#0078d4]/40 dark:ring-[#3794ff]/40',
    'before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-[#0078d4] dark:before:bg-[#3794ff]',
);

/**
 * Mode badge: tinted border + soft tinted background, font:9.5px/1 mono uppercase.
 * A group child gets a muted variant (lower-contrast border/bg, same text color)
 * so the parent's aggregate-mode pill remains the dominant anchor.
 */
export function getChatRowModeBadgeClasses(modeKey: ChatRowModeKey, isGroupChild = false): string {
    return cn(
        'inline-flex items-center justify-center border font-mono font-bold uppercase select-none',
        'text-[9.5px] leading-none tracking-[0.06em] py-[4px] w-full',
        modeKey === 'ask' ? 'rounded-full' : 'rounded-[3px]',
        !isGroupChild && modeKey === 'ask' && 'text-amber-600 dark:text-amber-400 border-amber-400/70 dark:border-amber-500/60 bg-amber-50/60 dark:bg-amber-500/10',
        !isGroupChild && modeKey === 'auto' && 'text-emerald-600 dark:text-emerald-400 border-emerald-500/70 dark:border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-500/10',
        !isGroupChild && modeKey === 'script' && 'text-[#1e1e1e] dark:text-[#dcdcdc] border-[#3c3c3c]/55 dark:border-[#9d9d9d]/45 bg-[#1e1e1e]/[0.06] dark:bg-[#dcdcdc]/[0.06]',
        !isGroupChild && modeKey === 'ralph' && 'text-purple-600 dark:text-purple-400 border-purple-500/70 dark:border-purple-500/60 bg-purple-50/60 dark:bg-purple-500/10',
        !isGroupChild && modeKey === 'sentinel' && 'text-teal-600 dark:text-teal-400 border-teal-500/70 dark:border-teal-500/60 bg-teal-50/60 dark:bg-teal-500/10',
        isGroupChild && modeKey === 'ask' && 'text-amber-600 dark:text-amber-400 border-amber-400/30 dark:border-amber-500/25 bg-transparent',
        isGroupChild && modeKey === 'auto' && 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 dark:border-emerald-500/25 bg-transparent',
        isGroupChild && modeKey === 'script' && 'text-[#1e1e1e] dark:text-[#dcdcdc] border-[#3c3c3c]/25 dark:border-[#9d9d9d]/20 bg-transparent',
        isGroupChild && modeKey === 'ralph' && 'text-purple-600 dark:text-purple-400 border-purple-500/30 dark:border-purple-500/25 bg-transparent',
        isGroupChild && modeKey === 'sentinel' && 'text-teal-600 dark:text-teal-400 border-teal-500/30 dark:border-teal-500/25 bg-transparent',
    );
}

export interface ChatRowDotState {
    isRunning: boolean;
    isQueued: boolean;
    isFailed: boolean;
    isAwaitingInput?: boolean;
    provider?: ChatProvider;
}

export function getChatRowDotClasses({ isRunning, isQueued, isFailed, isAwaitingInput, provider }: ChatRowDotState): string {
    return cn(
        'w-2 h-2 rounded-full justify-self-center transition-shadow',
        isRunning && isAwaitingInput && 'bg-amber-500 dark:bg-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.28)]',
        isRunning && !isAwaitingInput && getProviderDotClasses(provider),
        isRunning && !isAwaitingInput && 'animate-pulse shadow-[0_0_0_3px_rgba(0,120,212,0.22)]',
        !isRunning && isFailed && 'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.20)]',
        !isRunning && isQueued && !isFailed && 'bg-[#dcdcdc] dark:bg-[#6b6b6b]',
        !isRunning && !isQueued && !isFailed && 'bg-[#bbbbbb] dark:bg-[#5c5c5c]',
    );
}
