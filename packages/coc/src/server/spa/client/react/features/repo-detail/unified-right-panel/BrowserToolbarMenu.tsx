import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserEngine } from '../../../shared/file-path/browser-bridge';
import { nativeViewToolbarButton } from './NativeViewTab';

export function BrowserToolbarMenu({ open, onOpenChange, engine, canOpenExternal, onOpenExternal, onImportCookies }: {
    open: boolean;
    onOpenChange(open: boolean): void;
    engine?: BrowserEngine;
    canOpenExternal: boolean;
    onOpenExternal(): void;
    onImportCookies?: () => void;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const actionRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const [position, setPosition] = useState({ top: 0, right: 0 });

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        (canOpenExternal ? actionRef.current : panelRef.current)?.focus();
        const outside = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) onOpenChange(false);
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [open, canOpenExternal, onOpenChange]);

    return <>
        <button
            ref={triggerRef}
            type="button"
            className={`flex-shrink-0 ${nativeViewToolbarButton}`}
            aria-label="Browser options"
            title="Browser options"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => onOpenChange(!open)}
            onKeyDown={event => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    onOpenChange(true);
                }
            }}
        >…</button>
        {open && createPortal(
            <div
                ref={panelRef}
                id={id}
                role="menu"
                aria-label="Browser options"
                tabIndex={-1}
                data-native-view-overlay
                style={position}
                className="fixed z-50 w-56 max-w-[calc(100vw-8px)] max-h-[25vh] overflow-auto rounded border border-[#c8c8c8] bg-white p-1 text-xs text-[#1f1f1f] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
                onBlur={event => {
                    const next = event.relatedTarget as Node | null;
                    if (!event.currentTarget.contains(next) && !triggerRef.current?.contains(next)) onOpenChange(false);
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenChange(false);
                        triggerRef.current?.focus();
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        const actions = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
                        const current = actions.indexOf(document.activeElement as HTMLButtonElement);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
                            : (current + (event.key === 'ArrowUp' ? -1 : 1) + actions.length) % actions.length;
                        actions[next]?.focus();
                    }
                }}
            >
                {engine && <div role="presentation" className="px-2 py-1 text-[#616161] dark:text-[#9d9d9d]" title="This tab's browser engine" data-testid="browser-engine">
                    Engine: {engine === 'electron' ? 'Electron' : 'WebView2'}
                </div>}
                <button
                    ref={actionRef}
                    type="button"
                    role="menuitem"
                    className={`w-full whitespace-normal text-left ${nativeViewToolbarButton}`}
                    disabled={!canOpenExternal}
                    onClick={() => {
                        onOpenChange(false);
                        triggerRef.current?.focus();
                        onOpenExternal();
                    }}
                    data-testid="browser-open-external"
                >Open in system browser</button>
                {onImportCookies && <button type="button" role="menuitem" className={`w-full text-left ${nativeViewToolbarButton}`}
                    onClick={() => { onOpenChange(false); onImportCookies(); }} data-testid="browser-import-cookies">Import cookies…</button>}
            </div>, document.body)}
    </>;
}
