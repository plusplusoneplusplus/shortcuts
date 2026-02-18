/**
 * AIActionsDropdown — portal-rendered dropdown menu for AI actions on task files.
 * Shows "Follow Prompt" and "Update Document" options.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { cn } from './cn';
import { FollowPromptDialog } from './FollowPromptDialog';
import { UpdateDocumentDialog } from './UpdateDocumentDialog';

export interface AIActionsDropdownProps {
    wsId: string;
    taskPath: string;
}

type DialogType = 'follow-prompt' | 'update-document' | null;

export function AIActionsDropdown({ wsId, taskPath }: AIActionsDropdownProps) {
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState<DialogType>(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const taskName = taskPath.split('/').pop()?.replace(/\.md$/, '') || taskPath;

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (open) {
            setOpen(false);
            return;
        }
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;
        // Will correct overflow after render via useEffect
        setMenuPos({ top, left });
        setOpen(true);
    }, [open]);

    // Correct menu overflow after it renders
    useEffect(() => {
        if (!open || !menuRef.current || !triggerRef.current) return;
        const menu = menuRef.current;
        const trigger = triggerRef.current;
        const menuRect = menu.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();

        let { top, left } = menuPos;
        if (left + menuRect.width > window.innerWidth - 8) {
            left = triggerRect.right - menuRect.width;
        }
        if (top + menuRect.height > window.innerHeight - 8) {
            top = triggerRect.top - menuRect.height - 4;
        }
        if (top !== menuPos.top || left !== menuPos.left) {
            setMenuPos({ top, left });
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        // Defer to next frame so the opening click doesn't close it
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', handler);
        });
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    const handleAction = useCallback((action: DialogType) => {
        setOpen(false);
        setDialog(action);
    }, []);

    const closeDialog = useCallback(() => setDialog(null), []);

    return (
        <>
            <button
                ref={triggerRef}
                className={cn(
                    'flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-[10px]',
                    'hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors',
                    open && 'bg-black/[0.06] dark:bg-white/[0.06]'
                )}
                onClick={handleToggle}
                title="AI Actions"
                data-testid="ai-actions-trigger"
            >
                ✨
            </button>

            {open && ReactDOM.createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-50 min-w-[180px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg py-1"
                    style={{ top: menuPos.top, left: menuPos.left }}
                    data-testid="ai-actions-menu"
                >
                    <button
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        onClick={() => handleAction('follow-prompt')}
                    >
                        <span>📝</span>
                        <span className="text-[#1e1e1e] dark:text-[#cccccc]">Follow Prompt</span>
                    </button>
                    <button
                        className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                        onClick={() => handleAction('update-document')}
                    >
                        <span>✏️</span>
                        <span className="text-[#1e1e1e] dark:text-[#cccccc]">Update Document</span>
                    </button>
                </div>,
                document.body
            )}

            {dialog === 'follow-prompt' && (
                <FollowPromptDialog wsId={wsId} taskPath={taskPath} taskName={taskName} onClose={closeDialog} />
            )}
            {dialog === 'update-document' && (
                <UpdateDocumentDialog wsId={wsId} taskPath={taskPath} taskName={taskName} onClose={closeDialog} />
            )}
        </>
    );
}
