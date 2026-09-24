import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
    UnifiedPanelTabMenuAction,
    UnifiedPanelTabMenuItem,
} from './unifiedPanelTabMenuModel';

const VIEWPORT_MARGIN = 4;

export interface UnifiedPanelTabContextMenuProps {
    x: number;
    y: number;
    items: readonly UnifiedPanelTabMenuItem[];
    onAction: (action: UnifiedPanelTabMenuAction) => void;
    onDismiss: () => void;
}

export function UnifiedPanelTabContextMenu({
    x,
    y,
    items,
    onAction,
    onDismiss,
}: UnifiedPanelTabContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef(new Map<UnifiedPanelTabMenuAction, HTMLButtonElement>());
    const [position, setPosition] = useState({ x, y });

    useLayoutEffect(() => {
        const rect = menuRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition({
            x: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN)),
            y: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN)),
        });
    }, [x, y, items]);

    useEffect(() => {
        const first = items.find(item => !item.disabled);
        if (first) itemRefs.current.get(first.action)?.focus();
    }, [items]);

    useEffect(() => {
        const onMouseDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) onDismiss();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onDismiss();
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [onDismiss]);

    const focusableItems = () => items
        .filter(item => !item.disabled)
        .map(item => itemRefs.current.get(item.action))
        .filter((item): item is HTMLButtonElement => item !== undefined);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const focusable = focusableItems();
        if (focusable.length === 0) return;
        const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
        let next = current;
        if (event.key === 'ArrowDown') next = (current + 1 + focusable.length) % focusable.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + focusable.length) % focusable.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = focusable.length - 1;
        else if (event.key === 'Enter' || event.key === ' ') {
            if (current >= 0) {
                event.preventDefault();
                focusable[current].click();
            }
            return;
        } else {
            return;
        }
        event.preventDefault();
        focusable[next].focus();
    };

    let previousGroup: UnifiedPanelTabMenuItem['group'] | null = null;
    return (
        <div
            ref={menuRef}
            role="menu"
            aria-label="Tab actions"
            data-testid="unified-panel-tab-menu"
            style={{ top: position.y, left: position.x }}
            onKeyDown={onKeyDown}
            className="fixed z-50 min-w-[190px] rounded border border-[#e0e0e0] bg-white py-1 text-xs text-[#1e1e1e] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
        >
            {items.map(item => {
                const separator = previousGroup !== null && previousGroup !== item.group;
                previousGroup = item.group;
                return (
                    <div key={item.action}>
                        {separator && (
                            <div
                                role="separator"
                                className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                            />
                        )}
                        <button
                            ref={node => {
                                if (node) itemRefs.current.set(item.action, node);
                                else itemRefs.current.delete(item.action);
                            }}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            aria-disabled={item.disabled}
                            data-testid={`unified-panel-tab-menu-${item.action}`}
                            onClick={() => {
                                if (!item.disabled) onAction(item.action);
                            }}
                            className={[
                                'block w-full border-none bg-transparent px-3 py-1 text-left',
                                item.disabled
                                    ? 'cursor-default text-[#a0a0a0] dark:text-[#666]'
                                    : 'cursor-pointer hover:bg-[#e8e8e8] focus:bg-[#e8e8e8] focus:outline-none dark:hover:bg-[#37373d] dark:focus:bg-[#37373d]',
                            ].join(' ')}
                        >
                            {item.label}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
