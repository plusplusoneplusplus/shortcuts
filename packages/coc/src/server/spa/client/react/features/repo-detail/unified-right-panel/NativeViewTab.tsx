import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNativeViewPlacement } from './useNativeViewPlacement';
import { placeBrowserWebview } from './browserWebviewLayerStore';

export const nativeViewToolbarButton = 'rounded px-2 py-1 hover:bg-[#e8e8e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007acc] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-[#37373d]';

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

/** Back / forward / reload (or stop) for a native view. */
export function NativeViewNavButtons({
    canGoBack, canGoForward, loading, disabled, onNav, testIdPrefix,
}: NativeViewNavButtonsProps) {
    return (
        <>
            <button
                className={nativeViewToolbarButton}
                type="button"
                aria-label="Back"
                title="Back"
                disabled={disabled || !canGoBack}
                onClick={() => onNav('back')}
                data-testid={`${testIdPrefix}-back`}
            >
                ←
            </button>
            <button
                className={nativeViewToolbarButton}
                type="button"
                aria-label="Forward"
                title="Forward"
                disabled={disabled || !canGoForward}
                onClick={() => onNav('forward')}
                data-testid={`${testIdPrefix}-forward`}
            >
                →
            </button>
            {loading ? (
                <button
                    className={nativeViewToolbarButton}
                    type="button"
                    aria-label="Stop"
                    title="Stop"
                    onClick={() => onNav('stop')}
                    data-testid={`${testIdPrefix}-stop`}
                >
                    ✕
                </button>
            ) : (
                <button
                    className={nativeViewToolbarButton}
                    type="button"
                    aria-label="Reload"
                    title="Reload"
                    disabled={disabled}
                    onClick={() => onNav('reload')}
                    data-testid={`${testIdPrefix}-reload`}
                >
                    ↻
                </button>
            )}
        </>
    );
}
