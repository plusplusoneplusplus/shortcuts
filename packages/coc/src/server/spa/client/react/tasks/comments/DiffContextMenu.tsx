/**
 * DiffContextMenu — portal-based right-click context menu for diff viewers.
 * Wraps the generic ContextMenu with an "Add comment" item.
 */

import { ContextMenu } from './ContextMenu';

export interface DiffContextMenuProps {
    visible: boolean;
    position: { x: number; y: number };
    onAddComment: () => void;
    onClose: () => void;
    onAskAI?: () => void;
    onCopyAsContext?: () => void;
}

export function DiffContextMenu({ visible, position, onAddComment, onClose, onAskAI, onCopyAsContext }: DiffContextMenuProps) {
    if (!visible) return null;
    const items = [
        { label: 'Add comment', icon: '💬', onClick: onAddComment },
        ...(onAskAI ? [{ label: 'Ask AI', icon: '🤖', onClick: onAskAI }] : []),
        ...(onCopyAsContext ? [{ label: 'Copy as context', icon: '📋', onClick: onCopyAsContext }] : []),
    ];
    return (
        <ContextMenu
            position={position}
            items={items}
            onClose={onClose}
        />
    );
}
