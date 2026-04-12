import type { DeliveryMode } from '@plusplusoneplusplus/forge';

export interface SendButtonProps {
    disabled: boolean;
    ctrlHeld: boolean;
    onSend: (deliveryMode?: DeliveryMode) => void;
    /** data-testid for the button. Default: "activity-chat-send-btn" */
    'data-testid'?: string;
}

/** @deprecated Use {@link SendButtonProps} instead. */
export type SplitSendButtonProps = SendButtonProps & { sending?: boolean };

const BASE = 'shrink-0 h-[34px] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
const BLUE = 'bg-[#0078d4] hover:bg-[#106ebe]';
const ORANGE = 'bg-[#e8912d] hover:bg-[#c97a25]';

/**
 * Single send/steer button. Default click enqueues; holding Ctrl/Cmd
 * switches appearance to "⚡ Steer" (orange) and sends with `'immediate'`.
 */
export function SendButton(props: SendButtonProps) {
    const { disabled, ctrlHeld, onSend } = props;
    const testId = props['data-testid'] ?? 'activity-chat-send-btn';
    const steering = ctrlHeld;

    return (
        <button
            type="button"
            disabled={disabled}
            className={`${BASE} px-2 sm:px-3 rounded ${steering ? ORANGE : BLUE}`}
            onClick={() => onSend(steering ? 'immediate' : 'enqueue')}
            data-testid={testId}
            title={steering
                ? 'Release Ctrl to queue instead'
                : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
        >
            {steering ? '⚡ Steer' : 'Send'}
        </button>
    );
}

/** @deprecated Use {@link SendButton} instead. */
export const SplitSendButton = SendButton as (props: SplitSendButtonProps) => JSX.Element;
