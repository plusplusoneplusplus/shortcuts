import type { DeliveryMode } from '@plusplusoneplusplus/forge';

export interface SplitSendButtonProps {
    sending: boolean;
    disabled: boolean;
    ctrlHeld: boolean;
    onSend: (deliveryMode?: DeliveryMode) => void;
    /** data-testid for the primary (Queue / Send) button. Default: "activity-chat-send-btn" */
    'data-testid'?: string;
}

const BASE = 'shrink-0 h-[34px] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
const BLUE = 'bg-[#0078d4] hover:bg-[#106ebe]';
const ORANGE = 'bg-[#e8912d] hover:bg-[#c97a25]';

/**
 * When idle (`sending=false`): single Send button (shows "⚡ Steer" when Ctrl held).
 * When streaming (`sending=true`): split button group — Queue (blue) | ⚡ Steer (orange).
 */
export function SplitSendButton(props: SplitSendButtonProps) {
    const { sending, disabled, ctrlHeld, onSend } = props;
    const primaryTestId = props['data-testid'] ?? 'activity-chat-send-btn';

    if (!sending) {
        // Single button — same as commit 003 behavior
        return (
            <button
                type="button"
                disabled={disabled}
                className={`${BASE} px-2 sm:px-3 rounded ${ctrlHeld ? ORANGE : BLUE}`}
                onClick={() => onSend()}
                data-testid={primaryTestId}
                title={ctrlHeld
                    ? 'Release Ctrl to queue instead'
                    : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
            >
                {ctrlHeld ? '⚡ Steer' : 'Send'}
            </button>
        );
    }

    // Split button group — Queue | Steer
    return (
        <span className="inline-flex shrink-0" data-testid="split-send-group">
            <button
                type="button"
                disabled={disabled}
                className={`${BASE} px-2 sm:px-3 rounded-l border-r border-white/30 ${BLUE}`}
                onClick={() => onSend('enqueue')}
                data-testid={primaryTestId}
                title="Queue after current response (Enter)"
            >
                Queue <span className="hidden sm:inline text-[10px] opacity-70">↵</span>
            </button>
            <button
                type="button"
                disabled={disabled}
                className={`${BASE} px-2 sm:px-3 rounded-r ${ORANGE} ${ctrlHeld ? 'ring-2 ring-white' : ''}`}
                onClick={() => onSend('immediate')}
                data-testid="split-send-steer-btn"
                title="Inject into running session now (Ctrl+Enter)"
            >
                ⚡ Steer <span className="hidden sm:inline text-[10px] opacity-70">⌃↵</span>
            </button>
        </span>
    );
}
