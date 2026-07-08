import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import { cn } from './cn';

export interface QueueFollowUpButtonProps {
    disabled: boolean;
    /** When true, render the orange "Steer" variant for immediate delivery. */
    ctrlHeld: boolean;
    onSend: (deliveryMode?: DeliveryMode) => void;
    /** Label shown for the default (queue) action. Defaults to "Send". */
    label?: string;
    /** Display the keyboard-shortcut hint (⌘↵) on the right of the button. */
    showShortcutHint?: boolean;
    /** Use a 32px mobile/tablet hit area while preserving the compact desktop size. */
    mobileTapTarget?: boolean;
    /**
     * Render icon-only at every viewport: drops the text label and the ⌘↵
     * shortcut hint, keeping the label as the accessible name. Driven by the
     * composer's container-width signal for very narrow panes (unlike
     * `mobileTapTarget`, whose label hiding is viewport-gated via `sm:`).
     */
    iconOnly?: boolean;
    /** data-testid for the button. Default: "activity-chat-send-btn". */
    'data-testid'?: string;
}

/**
 * Outlined "Send" button with an inline chat-bubble icon and an
 * optional keyboard shortcut hint. Holding Ctrl/Cmd switches the button into
 * the orange "Steer" state, sending with `'immediate'` delivery instead of
 * enqueueing.
 *
 * Visual style mirrors the OpenDesign chats.html reference's `.send-btn.queue`
 * — a 28px-tall outlined chip with the keyboard shortcut hint inline,
 * separated from the label by a thin vertical divider rather than a boxed kbd.
 */
export function QueueFollowUpButton(props: QueueFollowUpButtonProps) {
    const { disabled, ctrlHeld, onSend, label = 'Send', showShortcutHint = true, mobileTapTarget = false, iconOnly = false } = props;
    const testId = props['data-testid'] ?? 'activity-chat-send-btn';
    const steering = ctrlHeld;
    const buttonLabel = steering ? 'Steer' : label;

    return (
        <button
            type="button"
            disabled={disabled}
            className={cn(
                'shrink-0 inline-flex items-center gap-1 rounded-md text-[11px] font-medium -tracking-[0.005em] cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed',
                iconOnly
                    ? 'h-[24px] w-[26px] justify-center px-0'
                    : mobileTapTarget ? 'h-8 w-8 justify-center px-0 sm:w-auto sm:pl-2.5 sm:pr-2 lg:h-[24px] lg:pl-2 lg:pr-1.5' : 'h-[24px] pl-2 pr-1.5',
                steering
                    ? 'bg-[#e8912d] text-white hover:bg-[#c97a25] border border-transparent'
                    : 'bg-white dark:bg-[#1f1f1f] text-[#1e1e1e] dark:text-[#cccccc] border border-[#d0d0d0] dark:border-[#3c3c3c] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]',
            )}
            onClick={() => onSend(steering ? 'immediate' : 'enqueue')}
            data-testid={testId}
            aria-label={buttonLabel}
            title={steering
                ? 'Release Ctrl to queue instead'
                : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
        >
            {steering ? (
                <span aria-hidden="true">⚡</span>
            ) : (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                        d="M3 4h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                    />
                </svg>
            )}
            {!iconOnly && (
                <span className={mobileTapTarget ? 'hidden sm:inline' : undefined}>{buttonLabel}</span>
            )}
            {showShortcutHint && !steering && !iconOnly && (
                <span
                    aria-hidden="true"
                    className="hidden sm:inline-flex items-center pl-1.5 ml-1 border-l border-[#e0e0e0] dark:border-[#3c3c3c] text-[9px] text-[#848484] font-mono"
                    data-testid="queue-follow-up-shortcut-hint"
                >
                    &#x2318;&#x21B5;
                </span>
            )}
        </button>
    );
}
