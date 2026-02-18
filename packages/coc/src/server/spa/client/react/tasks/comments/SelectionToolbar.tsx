/**
 * SelectionToolbar — portal-based "💬 Add comment" toolbar on text selection.
 */

import ReactDOM from 'react-dom';

export interface SelectionToolbarProps {
    visible: boolean;
    position: { top: number; left: number };
    onAddComment: () => void;
}

export function SelectionToolbar({ visible, position, onAddComment }: SelectionToolbarProps) {
    if (!visible) return null;

    return ReactDOM.createPortal(
        <div
            className="fixed z-[10004] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-lg rounded-md px-2 py-1 cursor-pointer hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 transition-colors"
            style={{ top: position.top, left: position.left }}
            onClick={(e) => { e.stopPropagation(); onAddComment(); }}
            data-testid="selection-toolbar"
            role="toolbar"
            aria-label="Add comment"
        >
            <span className="text-xs text-[#1e1e1e] dark:text-[#cccccc] whitespace-nowrap">
                💬 Add comment
            </span>
        </div>,
        document.body
    );
}
