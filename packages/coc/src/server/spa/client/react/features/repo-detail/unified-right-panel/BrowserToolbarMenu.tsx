import { useEffect, useId, useRef } from 'react';
import type { BrowserEngine } from '../../../shared/file-path/browser-bridge';
import { nativeViewToolbarButton } from './NativeViewTab';

export function BrowserToolbarMenu({ open, onOpenChange, engine, canOpenExternal, onOpenExternal }: {
    open: boolean;
    onOpenChange(open: boolean): void;
    engine?: BrowserEngine;
    canOpenExternal: boolean;
    onOpenExternal(): void;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const actionRef = useRef<HTMLButtonElement>(null);
    const id = useId();

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
        {/* Reserve toolbar space: native surfaces paint above DOM popovers. */}
        {open && <div className="flex w-full justify-end">
            <div
                ref={panelRef}
                id={id}
                role="menu"
                aria-label="Browser options"
                tabIndex={-1}
                className="w-56 max-w-full max-h-[25vh] overflow-auto rounded border border-[#c8c8c8] bg-white p-1 text-xs text-[#1f1f1f] shadow-lg dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]"
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
                        if (canOpenExternal) actionRef.current?.focus();
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
            </div>
        </div>}
    </>;
}
