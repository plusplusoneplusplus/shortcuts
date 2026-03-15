import type { QueuedMessage } from '../utils/chatUtils';

export function QueuedBubble({ msg }: { msg: QueuedMessage }) {
    const icon =
        msg.status === 'steering' ? '⚡' :
        msg.status === 'queued'   ? '🕐' :
        '…';
    const label =
        msg.status === 'steering' ? 'steering' :
        msg.status === 'queued'   ? 'queued' :
        'sending…';
    return (
        <div className="turn-bubble turn-bubble--optimistic" data-status={msg.status} style={{
            opacity: msg.status === 'steering' ? 0.9 : 0.75,
            borderLeft: `3px solid ${msg.status === 'steering' ? 'var(--color-warning, #e8912d)' : 'var(--color-accent-muted, #0078d4)'}`,
            fontStyle: 'italic',
            padding: '8px 12px',
            borderRadius: '6px',
        }}>
            <span>{icon}</span>{' '}
            <span>{msg.content}</span>{' '}
            <span style={{ fontSize: '0.75em', color: 'var(--color-text-secondary, #848484)', marginLeft: '0.5em' }}>{label}</span>
        </div>
    );
}
