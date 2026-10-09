import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserEngine, BrowserPreferences, DesktopBrowserBridge } from '../../../shared/file-path/browser-bridge';
import { nativeViewToolbarButton } from './NativeViewTab';

export function BrowserToolbarMenu({ open, onOpenChange, engine, canOpenExternal, onOpenExternal, onImportCookies, onHistory, bridge }: {
    open: boolean;
    onOpenChange(open: boolean): void;
    engine?: BrowserEngine;
    canOpenExternal: boolean;
    onOpenExternal(): void;
    onImportCookies?: () => void;
    onHistory?(): void;
    bridge?: DesktopBrowserBridge;
}) {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const [position, setPosition] = useState({ top: 0, right: 0 });
    const [preferences, setPreferences] = useState<BrowserPreferences | null>(null);
    const [zoomError, setZoomError] = useState<string | null>(null);
    const [zoomBusy, setZoomBusy] = useState(false);
    const [zoomUnsupported, setZoomUnsupported] = useState(false);
    const zoomPending = useRef(false);
    const zoomRequest = useRef(0);

    useEffect(() => {
        if (!open || !bridge?.setPageZoom) return;
        let disposed = false;
        const refresh = async () => {
            const request = ++zoomRequest.current;
            try {
                const result = await bridge.getPreferences();
                if (!disposed && request === zoomRequest.current) setPreferences(result);
            } catch (error) {
                if (!disposed && request === zoomRequest.current) {
                    setPreferences(null);
                    setZoomError(error instanceof Error ? error.message : 'Could not read web page zoom.');
                }
            }
        };
        void refresh();
        const off = bridge.onPreferencesChanged(() => { void refresh(); });
        return () => { disposed = true; ++zoomRequest.current; off(); };
    }, [open, bridge]);

    const zoom = preferences?.pageZoom;
    const zoomAvailable = Boolean(!zoomUnsupported && bridge?.setPageZoom && zoom
        && preferences?.engines.some(item => item.engine === (engine ?? preferences.defaultEngine) && item.available));
    const changeZoom = async (percent: number) => {
        if (!bridge?.setPageZoom || !zoomAvailable || zoomPending.current) return;
        zoomPending.current = true;
        setZoomBusy(true);
        setZoomError(null);
        try {
            const result = await bridge.setPageZoom(percent);
            if (!result.ok) {
                setZoomError(result.message ?? `Could not change web page zoom: ${result.reason}`);
                if (result.reason === 'unsupported') setZoomUnsupported(true);
            }
            const request = ++zoomRequest.current;
            const next = await bridge.getPreferences();
            if (request === zoomRequest.current) setPreferences(next);
        } catch (error) {
            setZoomError(error instanceof Error ? error.message : 'Could not change web page zoom.');
        } finally {
            zoomPending.current = false;
            setZoomBusy(false);
        }
    };

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
        (panelRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? panelRef.current)?.focus();
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
                {onHistory && <button type="button" role="menuitem" className={`w-full text-left ${nativeViewToolbarButton}`}
                    onClick={() => { onOpenChange(false); triggerRef.current?.focus(); onHistory(); }}>History</button>}
                {engine && <div role="presentation" className="px-2 py-1 text-[#616161] dark:text-[#9d9d9d]" title="This tab's browser engine" data-testid="browser-engine">
                    Engine: {engine === 'electron' ? 'Electron' : 'WebView2'}
                </div>}
                <div role="group" aria-label="Web page zoom" className="border-b border-[#e5e5e5] px-2 py-1 dark:border-[#333]">
                    <div className="mb-1 text-[#616161] dark:text-[#9d9d9d]" title="All embedded web pages in every workspace and desktop window. Does not change app zoom.">Web page zoom (all pages)</div>
                    <div className="flex items-center gap-1">
                        <button type="button" role="menuitem" className={nativeViewToolbarButton} aria-label="Zoom out all web pages"
                            disabled={!zoomAvailable || zoomBusy || !zoom || zoom.percent <= zoom.min}
                            onClick={() => zoom && void changeZoom(zoom.percent - zoom.step)}>-</button>
                        <span className="min-w-10 text-center" aria-live="polite" data-testid="browser-page-zoom-percent">{zoomAvailable && zoom ? `${zoom.percent}%` : 'Unavailable'}</span>
                        <button type="button" role="menuitem" className={nativeViewToolbarButton} aria-label="Zoom in all web pages"
                            disabled={!zoomAvailable || zoomBusy || !zoom || zoom.percent >= zoom.max}
                            onClick={() => zoom && void changeZoom(zoom.percent + zoom.step)}>+</button>
                        <button type="button" role="menuitem" className={nativeViewToolbarButton} aria-label="Reset all web pages to 100%"
                            disabled={!zoomAvailable || zoomBusy || zoom?.percent === 100}
                            onClick={() => void changeZoom(100)}>Reset</button>
                    </div>
                    {zoomError && <div role="alert" className="mt-1 text-[#a1260d] dark:text-[#f48771]">{zoomError}</div>}
                </div>
                <button
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
