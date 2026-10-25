import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNativeViewPlacement } from './useNativeViewPlacement';
import { placeBrowserWebview } from './browserWebviewLayerStore';

export const nativeViewToolbarButton = 'rounded px-2 py-1 hover:bg-[#e8e8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-[#37373d]';
/** The quiet row behind native view controls. */
export const nativeViewToolbar = 'flex-shrink-0 items-center gap-1.5 border-b border-[#e5e5e5] bg-[#f8f8f8] px-2 py-1 text-xs dark:border-[#333] dark:bg-[#252526]';
/** A round icon-only button, used in the navigation capsule and for toolbar menus. */
export const nativeViewIconButton = 'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[#424242] hover:bg-[#e8e8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-[#c5c5c5] dark:hover:bg-[#37373d]';
/** The pill around an address, editable (browser) or read-only (HTML page path). */
export const nativeViewAddressField = 'h-7 min-w-0 flex-1 rounded-full border border-[#e0e0e0] bg-white px-3 shadow-[0_1px_1px_rgba(0,0,0,0.03)] dark:border-[#3c3c3c] dark:bg-[#1e1e1e]';

/** The part of a desktop view bridge that places a native view. */
export interface NativeViewBridge {
    setBounds(id: string, rect: { x: number; y: number; width: number; height: number } | null): void;
    hide(id: string): void;
}

export interface NativeViewTabProps {
    /** Undefined outside the desktop app: no native view, only `children`. */
    bridge: NativeViewBridge | undefined;
    viewId: string;
    embed?: 'webview';
    /** Keep the native view over the placeholder (tab active, panel visible, page shown). */
    shown: boolean;
    /** Collapse the placeholder, e.g. while an error or empty state takes its place. */
    surfaceHidden: boolean;
    placeholderTestId: string;
    toolbar: ReactNode;
    /** Banners, errors and fallbacks drawn between the toolbar and the view. */
    children?: ReactNode;
}

/**
 * Shared frame for Electron guests and native desktop views: a toolbar, then
 * a placeholder registered with the guest layer or native placement hook.
 */
export function NativeViewTab({
    bridge, viewId, embed, shown, surfaceHidden, placeholderTestId, toolbar, children,
}: NativeViewTabProps) {
    const placeholder = useRef<HTMLDivElement>(null);
    const placement = useMemo(() => bridge && embed !== 'webview' ? {
        setBounds: (rect: { x: number; y: number; width: number; height: number }) => bridge.setBounds(viewId, rect),
        hide: () => bridge.hide(viewId),
    } : null, [bridge, viewId, embed]);
    useNativeViewPlacement(placeholder, shown, placement);
    useLayoutEffect(() => {
        if (embed !== 'webview' || !placeholder.current) return;
        return placeBrowserWebview(viewId, placeholder.current, shown && !surfaceHidden);
    }, [embed, viewId, shown, surfaceHidden]);

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-white text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#cccccc]">
            {toolbar}
            {children}
            {bridge && (
                <div
                    ref={placeholder}
                    className="min-h-0 flex-1"
                    style={{ display: surfaceHidden ? 'none' : undefined }}
                    data-testid={placeholderTestId}
                />
            )}
        </div>
    );
}

export interface NativeViewNavButtonsProps {
    canGoBack: boolean;
    canGoForward: boolean;
    /** Show Stop in place of Reload; omit when the view cannot stop. */
    loading?: boolean;
    disabled?: boolean;
    onNav(action: 'back' | 'forward' | 'reload' | 'stop'): void;
    testIdPrefix: string;
}

/** A 14px stroked icon in the toolbar's shared line weight. */
export function NativeViewIcon({ children }: { children: ReactNode }) {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

/** Back / forward / reload (or stop) for a native view, in one rounded capsule. */
export function NativeViewNavButtons({
    canGoBack, canGoForward, loading, disabled, onNav, testIdPrefix,
}: NativeViewNavButtonsProps) {
    return (
        <div
            role="group"
            aria-label="Page navigation"
            className="inline-flex flex-shrink-0 items-center gap-px rounded-full border border-[#e0e0e0] bg-white p-px shadow-[0_1px_1px_rgba(0,0,0,0.03)] dark:border-[#3c3c3c] dark:bg-[#1e1e1e]"
            data-testid={`${testIdPrefix}-nav`}
        >
            <button
                className={nativeViewIconButton}
                type="button"
                aria-label="Back"
                title="Back"
                disabled={disabled || !canGoBack}
                onClick={() => onNav('back')}
                data-testid={`${testIdPrefix}-back`}
            >
                <NativeViewIcon><path d="M13 8H3M7 4 3 8l4 4" /></NativeViewIcon>
            </button>
            <button
                className={nativeViewIconButton}
                type="button"
                aria-label="Forward"
                title="Forward"
                disabled={disabled || !canGoForward}
                onClick={() => onNav('forward')}
                data-testid={`${testIdPrefix}-forward`}
            >
                <NativeViewIcon><path d="M3 8h10M9 4l4 4-4 4" /></NativeViewIcon>
            </button>
            <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-[#e0e0e0] dark:bg-[#3c3c3c]" data-testid={`${testIdPrefix}-nav-separator`} />
            {loading ? (
                <button
                    className={nativeViewIconButton}
                    type="button"
                    aria-label="Stop"
                    title="Stop"
                    onClick={() => onNav('stop')}
                    data-testid={`${testIdPrefix}-stop`}
                >
                    <NativeViewIcon><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></NativeViewIcon>
                </button>
            ) : (
                <button
                    className={nativeViewIconButton}
                    type="button"
                    aria-label="Reload"
                    title="Reload"
                    disabled={disabled}
                    onClick={() => onNav('reload')}
                    data-testid={`${testIdPrefix}-reload`}
                >
                    <NativeViewIcon><path d="M13 8a5 5 0 1 1-1.46-3.54L13 5.5M13 2.5v3h-3" /></NativeViewIcon>
                </button>
            )}
        </div>
    );
}
