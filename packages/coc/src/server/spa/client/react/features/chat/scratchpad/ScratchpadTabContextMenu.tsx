import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import type { ScratchpadTabContextMenuState } from './useScratchpadTabContextMenu';

export function buildScratchpadAbsolutePath(workspaceRootPath: string, relativePath: string): string {
    const root = toForwardSlashes(workspaceRootPath).replace(/\/+$/, '');
    const relative = toForwardSlashes(relativePath).replace(/^\/+/, '');
    return root ? `${root}/${relative}` : relative;
}

interface ScratchpadTabContextMenuProps {
    ctxMenu: ScratchpadTabContextMenuState;
    workspaceRootPath?: string;
    onClose: () => void;
}

export function ScratchpadTabContextMenu({ ctxMenu, workspaceRootPath, onClose }: ScratchpadTabContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const absoluteButtonRef = useRef<HTMLButtonElement>(null);
    const relativeButtonRef = useRef<HTMLButtonElement>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
    const hasWorkspaceRootPath = !!workspaceRootPath?.trim();

    const absolutePath = useMemo(
        () => hasWorkspaceRootPath ? buildScratchpadAbsolutePath(workspaceRootPath ?? '', ctxMenu.filePath) : '',
        [ctxMenu.filePath, hasWorkspaceRootPath, workspaceRootPath],
    );

    const copyText = useCallback(async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyStatus('copied');
            if (closeTimerRef.current !== null) {
                clearTimeout(closeTimerRef.current);
            }
            closeTimerRef.current = setTimeout(onClose, 250);
        } catch (err) {
            console.error('Failed to copy scratchpad path:', err);
            setCopyStatus('failed');
        }
    }, [onClose]);

    useEffect(() => {
        return () => {
            if (closeTimerRef.current !== null) {
                clearTimeout(closeTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const target = hasWorkspaceRootPath ? absoluteButtonRef.current : relativeButtonRef.current;
        target?.focus();
    }, [hasWorkspaceRootPath]);

    useEffect(() => {
        const handleMouseDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const focusRelative = useCallback(() => {
        relativeButtonRef.current?.focus();
    }, []);

    const focusAbsolute = useCallback(() => {
        (hasWorkspaceRootPath ? absoluteButtonRef.current : relativeButtonRef.current)?.focus();
    }, [hasWorkspaceRootPath]);

    const handleMenuKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            document.activeElement === relativeButtonRef.current ? focusAbsolute() : focusRelative();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            document.activeElement === relativeButtonRef.current ? focusAbsolute() : focusRelative();
        } else if (event.key === 'Enter' || event.key === ' ') {
            const active = document.activeElement;
            if (active === absoluteButtonRef.current || active === relativeButtonRef.current) {
                event.preventDefault();
                (active as HTMLButtonElement).click();
            }
        } else if (event.key === 'Tab') {
            event.preventDefault();
            document.activeElement === relativeButtonRef.current ? focusAbsolute() : focusRelative();
        }
    }, [focusAbsolute, focusRelative]);

    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[10004] min-w-[180px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] shadow-xl rounded-md py-1"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
            data-testid="scratchpad-tab-context-menu"
            role="menu"
            aria-label="Scratchpad file tab actions"
            onKeyDown={handleMenuKeyDown}
        >
            <button
                ref={absoluteButtonRef}
                className={[
                    'w-full text-left px-3 py-1.5 text-xs transition-colors',
                    hasWorkspaceRootPath
                        ? 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d] cursor-pointer'
                        : 'text-[#a0a0a0] dark:text-[#5a5a5a] cursor-default',
                ].join(' ')}
                onClick={(event) => {
                    event.stopPropagation();
                    if (hasWorkspaceRootPath) {
                        void copyText(absolutePath);
                    }
                }}
                disabled={!hasWorkspaceRootPath}
                title={hasWorkspaceRootPath ? absolutePath : 'Workspace has no root path'}
                role="menuitem"
                type="button"
                data-testid="scratchpad-copy-absolute-path"
            >
                Copy Absolute Path
            </button>
            <button
                ref={relativeButtonRef}
                className="w-full text-left px-3 py-1.5 text-xs transition-colors text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d] cursor-pointer"
                onClick={(event) => {
                    event.stopPropagation();
                    void copyText(ctxMenu.filePath);
                }}
                role="menuitem"
                type="button"
                data-testid="scratchpad-copy-relative-path"
            >
                Copy Relative Path
            </button>
            <div className="sr-only" aria-live="polite" data-testid="scratchpad-copy-status">
                {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : ''}
            </div>
        </div>,
        document.body,
    );
}
