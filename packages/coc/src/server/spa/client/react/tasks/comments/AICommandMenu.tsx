/**
 * AICommandMenu — self-contained dropdown for AI commands (Clarify / Go Deeper / Custom).
 * Rendered as a portal to document.body with overflow-aware positioning.
 * Shared by CommentCard and CommentPopover.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Button, Spinner } from '../../shared';
import { DASHBOARD_AI_COMMANDS } from '../../shared/ai-commands';

export interface AICommandMenuProps {
    onCommand: (commandId: string, customQuestion?: string) => void;
    loading?: boolean;
    disabled?: boolean;
    triggerClassName?: string;
    'data-testid'?: string;
}

export function AICommandMenu({
    onCommand,
    loading,
    disabled,
    triggerClassName,
    'data-testid': testIdPrefix = 'ai',
}: AICommandMenuProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [customInputOpen, setCustomInputOpen] = useState(false);
    const [customText, setCustomText] = useState('');
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const customInputRef = useRef<HTMLInputElement>(null);

    const handleToggleMenu = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (menuOpen) { setMenuOpen(false); return; }
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, left: rect.left });
        setCustomInputOpen(false);
        setCustomText('');
        setMenuOpen(true);
    }, [menuOpen]);

    const handleMenuCommand = (cmd: (typeof DASHBOARD_AI_COMMANDS)[number]) => {
        if (cmd.isCustomInput) {
            setCustomInputOpen(true);
            requestAnimationFrame(() => customInputRef.current?.focus());
        } else {
            setMenuOpen(false);
            onCommand(cmd.id);
        }
    };

    const handleCustomSubmit = () => {
        const text = customText.trim();
        if (!text) return;
        setMenuOpen(false);
        setCustomInputOpen(false);
        setCustomText('');
        onCommand('custom', text);
    };

    // Overflow correction after render
    useEffect(() => {
        if (!menuOpen || !menuRef.current || !triggerRef.current) return;
        const menu = menuRef.current.getBoundingClientRect();
        const trigger = triggerRef.current.getBoundingClientRect();
        let { top, left } = menuPos;
        if (left + menu.width > window.innerWidth - 8) left = trigger.right - menu.width;
        if (top + menu.height > window.innerHeight - 8) top = trigger.top - menu.height - 4;
        if (top !== menuPos.top || left !== menuPos.left) setMenuPos({ top, left });
    }, [menuOpen]);  // eslint-disable-line react-hooks/exhaustive-deps

    // Outside click
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)
            ) setMenuOpen(false);
        };
        requestAnimationFrame(() => document.addEventListener('mousedown', handler));
        return () => document.removeEventListener('mousedown', handler);
    }, [menuOpen]);

    // Escape key
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [menuOpen]);

    return (
        <>
            <button
                ref={triggerRef}
                className={triggerClassName}
                onClick={handleToggleMenu}
                title="Ask AI"
                aria-label="Ask AI"
                disabled={disabled || loading}
                data-testid={`${testIdPrefix}-menu-trigger`}
            >
                {loading
                    ? <Spinner size="sm" data-testid={`${testIdPrefix}-loading-spinner`} />
                    : '🤖'}
            </button>

            {menuOpen && ReactDOM.createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[10004] min-w-[160px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg py-1"
                    style={{ top: menuPos.top, left: menuPos.left }}
                    data-testid={`${testIdPrefix}-command-menu`}
                    onClick={e => e.stopPropagation()}
                >
                    {!customInputOpen
                        ? DASHBOARD_AI_COMMANDS.map(cmd => (
                            <button
                                key={cmd.id}
                                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-[#1e1e1e] dark:text-[#cccccc]"
                                onClick={() => handleMenuCommand(cmd)}
                                data-testid={`${testIdPrefix}-cmd-${cmd.id}`}
                            >
                                <span>{cmd.icon}</span>
                                <span>{cmd.label}</span>
                            </button>
                        ))
                        : <div className="px-2 py-1.5 flex flex-col gap-1">
                            <input
                                ref={customInputRef}
                                type="text"
                                className="w-full p-1 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                                placeholder="Ask anything…"
                                value={customText}
                                onChange={e => setCustomText(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && customText.trim()) handleCustomSubmit();
                                    if (e.key === 'Escape') setMenuOpen(false);
                                }}
                                data-testid={`${testIdPrefix}-custom-input`}
                            />
                            <Button size="sm" disabled={!customText.trim()} onClick={handleCustomSubmit}>Ask</Button>
                        </div>
                    }
                </div>,
                document.body
            )}
        </>
    );
}
