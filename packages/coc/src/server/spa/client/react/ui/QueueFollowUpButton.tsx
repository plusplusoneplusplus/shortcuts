import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import { cn } from './cn';

export interface QueueFollowUpButtonProps {
    disabled: boolean;
    /** When true, render the orange "Steer" variant for immediate delivery. */
    ctrlHeld: boolean;
    onSend: (deliveryMode?: DeliveryMode) => void;
    /** Label shown for the default (queue) action. Defaults to "Queue follow-up". */
    label?: string;
    /** Display the keyboard-shortcut hint (⌘↵) on the right of the button. */
    showShortcutHint?: boolean;
    /** data-testid for the button. Default: "activity-chat-send-btn". */
    'data-testid'?: string;
}

/**
 * Outlined "Queue follow-up" button with an inline chat-bubble icon and an
 * optional keyboard shortcut hint. Holding Ctrl/Cmd switches the button into
 * the orange "Steer" state, sending with `'immediate'` delivery instead of
 * enqueueing.
 */
export function QueueFollowUpButton(props: QueueFollowUpButtonProps) {
    const { disabled, ctrlHeld, onSend, label = 'Queue follow-up', showShortcutHint = true } = props;
    const testId = props['data-testid'] ?? 'activity-chat-send-btn';
    const steering = ctrlHeld;

    return (
        <button
            type="button"
            disabled={disabled}
            className={cn(
                'shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed',
                steering
                    ? 'bg-[#e8912d] text-white hover:bg-[#c97a25] border border-transparent'
                    : 'bg-white dark:bg-[#1f1f1f] text-[#1e1e1e] dark:text-[#cccccc] border border-[#d0d0d0] dark:border-[#3c3c3c] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a]',
            )}
            onClick={() => onSend(steering ? 'immediate' : 'enqueue')}
            data-testid={testId}
            title={steering
                ? 'Release Ctrl to queue instead'
                : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
        >
            {steering ? (
                <span aria-hidden="true">⚡</span>
            ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                        d="M3 4h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                    />
                </svg>
            )}
            <span>{steering ? 'Steer' : label}</span>
            {showShortcutHint && !steering && (
                <span
                    aria-hidden="true"
                    className="ml-0.5 inline-flex items-center justify-center min-w-[22px] h-4 px-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] text-[10px] text-[#848484] font-mono"
                    data-testid="queue-follow-up-shortcut-hint"
                >
                    &#x2318;&#x21B5;
                </span>
            )}
        </button>
    );
}
