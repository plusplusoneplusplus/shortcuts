import { Spinner } from '../../ui';
import { cn } from '../../ui/cn';

export interface CompactionBubbleProps {
    /** Custom instructions typed after the `/compact` token, if any. */
    instructions?: string;
}

/**
 * Synthetic, in-progress "user action" bubble shown while a `/compact` runs
 * (AC-02). It mirrors the user-message bubble style (right-aligned, rounded)
 * so the `/compact` action reads as something the user did, and shows a live
 * "Compacting context…" status with a spinner.
 *
 * This bubble is PURELY a client render driven by the process compaction state
 * (local optimistic flag on the triggering tab; `metadata.compaction.state`
 * on reloads / other tabs). It is never persisted as a conversation turn and
 * never enters the provider model history. Once compaction settles, the
 * persisted display-only result turn (AC-03) supersedes it.
 */
export function CompactionBubble({ instructions }: CompactionBubbleProps) {
    const trimmed = instructions?.trim();
    return (
        <div className="flex justify-end py-1.5 chat-message user" data-testid="compaction-bubble">
            <div
                className={cn(
                    'group min-w-0 max-w-[85%] sm:max-w-[78%] rounded-2xl px-3.5 py-2',
                    'bg-[#f3f4f6] dark:bg-[#2a2a2c]',
                )}
            >
                <div
                    className="font-mono text-[12px] text-[#1f2328] dark:text-[#cccccc] break-words"
                    data-testid="compaction-bubble-command"
                >
                    /compact{trimmed ? ` ${trimmed}` : ''}
                </div>
                <div
                    className="mt-1 flex items-center gap-2 text-[12px] text-[#6b7280] dark:text-[#9aa0a6]"
                    data-testid="compaction-bubble-status"
                    role="status"
                    aria-live="polite"
                >
                    <Spinner size="sm" />
                    <span>Compacting context…</span>
                </div>
            </div>
        </div>
    );
}
