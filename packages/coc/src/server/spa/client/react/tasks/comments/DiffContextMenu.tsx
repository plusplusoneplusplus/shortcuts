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
}

export function DiffContextMenu({ visible, position, onAddComment, onClose }: DiffContextMenuProps) {
    if (!visible) return null;
    return (
        <ContextMenu
            position={position}
            items={[{ label: 'Add comment', icon: '💬', onClick: onAddComment }]}
            onClose={onClose}
        />
    );
}
