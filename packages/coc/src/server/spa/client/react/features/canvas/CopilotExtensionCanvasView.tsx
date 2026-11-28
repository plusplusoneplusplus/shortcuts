import { useCallback, useEffect, useRef, useState } from 'react';
import { useCloneBaseUrl } from '../../repos/cloneRouting';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';

export interface ExtensionCanvasBridge {
    open(viewId: string, workspaceId: string, canvasId: string, reload?: boolean): Promise<
        { ok: true; embed: 'webview'; src: string; partition: string; title?: string }
        | { ok: false; message: string }
    >;
    adopt(viewId: string, guestId: number): Promise<void>;
    close(viewId: string): void;
    onState(callback: (state: {
        viewId: string; status: 'loading' | 'loaded' | 'failed'; error?: string;
    }) => void): () => void;
}

export interface ExtensionRuntimeReload {
    id: string;
    error?: string;
}

/** Saved reload markers drive guest replacement independently of ordinary revisions. */
export function parseExtensionRuntimeReload(content: string): ExtensionRuntimeReload | undefined {
    try {
        const marker: unknown = JSON.parse(content)?.runtimeReload;
        if (!marker || typeof marker !== 'object' || !('id' in marker)
            || typeof marker.id !== 'string' || !marker.id.trim()
            || ('error' in marker && typeof marker.error !== 'string')) return undefined;
        return { id: marker.id, ...('error' in marker ? { error: marker.error as string } : {}) };
    } catch {
        return undefined;
    }
}

export function CopilotExtensionCanvasView({
    workspaceId, canvasId, routingRef, allowDesktopGuest = false, runtimeReload, onRegisterReload,
}: {
    workspaceId: string;
    canvasId: string;
    routingRef?: string | null;
    allowDesktopGuest?: boolean;
    runtimeReload?: ExtensionRuntimeReload;
    /** The canvas header owns the Reload button; it stays disabled while the guest loads. */
    onRegisterReload?: (reload: (() => void) | null, options?: { disabled?: boolean }) => void;
}) {
    const ref = routingRef === null ? undefined : routingRef ?? workspaceId;
    const baseUrl = useCloneBaseUrl(ref);
    const owner = useWorkspaceOwner(ref);
    const local = routingRef === null || (owner ? !owner.baseUrl
        : !baseUrl && resolveCloneRoute(ref).kind === 'local');
    const bridge = (window as { cocDesktop?: { extensionCanvas?: ExtensionCanvasBridge } })
        .cocDesktop?.extensionCanvas;
    const enabled = allowDesktopGuest && local && !!bridge;
    const hostRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
    const [error, setError] = useState<string>();
    const [reloadNonce, setReloadNonce] = useState(0);
    const reloadRequested = useRef<{ workspaceId: string; canvasId: string; routingRef?: string | null } | null>(null);
    const runtimeReloadId = runtimeReload?.id;
    const runtimeReloadError = runtimeReload?.error;

    useEffect(() => {
        if (!enabled || !bridge) return;
        const viewId = `extension-canvas-${crypto.randomUUID()}`;
        const requested = reloadRequested.current;
        const reload = !!requested && requested.workspaceId === workspaceId && requested.canvasId === canvasId
            && requested.routingRef === routingRef;
        reloadRequested.current = null;
        if (!reload && runtimeReloadError !== undefined) {
            setStatus('failed');
            setError(runtimeReloadError || 'Failed to reload extension canvas');
            return;
        }
        let disposed = false;
        let failed = false;
        let guest: (HTMLElement & { getWebContentsId(): number }) | undefined;
        setStatus('loading');
        setError(undefined);
        const fail = (reason: unknown) => {
            if (disposed || failed) return;
            failed = true;
            setStatus('failed');
            setError(reason instanceof Error ? reason.message : String(reason));
            guest?.remove();
            bridge.close(viewId);
        };
        const unsubscribe = bridge.onState(state => {
            if (disposed || failed || state.viewId !== viewId) return;
            if (state.status === 'failed') fail(state.error || 'Failed to load extension canvas');
            else setStatus(state.status);
        });
        const opening = reload ? bridge.open(viewId, workspaceId, canvasId, true)
            : bridge.open(viewId, workspaceId, canvasId);
        void opening.then(result => {
            if (disposed || failed) {
                bridge.close(viewId);
                return;
            }
            if (!result.ok) {
                fail(result.message);
                return;
            }
            guest = document.createElement('webview') as HTMLElement & { getWebContentsId(): number };
            guest.setAttribute('partition', result.partition);
            guest.setAttribute('src', result.src);
            guest.setAttribute('aria-label', result.title || 'Extension canvas');
            guest.style.cssText = 'display:flex;width:100%;height:100%;';
            guest.addEventListener('dom-ready', () => {
                if (disposed || failed || !guest) return;
                try {
                    void bridge.adopt(viewId, guest.getWebContentsId()).catch(fail);
                } catch (reason) {
                    fail(reason);
                }
            }, { once: true });
            hostRef.current?.appendChild(guest);
        }).catch(fail);
        return () => {
            disposed = true;
            unsubscribe();
            guest?.remove();
            bridge.close(viewId);
        };
    }, [enabled, bridge, workspaceId, canvasId, routingRef, reloadNonce, runtimeReloadId, runtimeReloadError]);

    const reload = useCallback(() => {
        if (status === 'loading' || !window.confirm('Reload this extension? This restarts its shared runtime in this conversation. Unsaved page input may be lost. Saved instance input and session files are kept. Other open canvases from this extension will refresh too. Running actions finish before reload. Actions are not replayed.')) return;
        reloadRequested.current = { workspaceId, canvasId, routingRef };
        setStatus('loading');
        setReloadNonce(value => value + 1);
    }, [status, workspaceId, canvasId, routingRef]);

    useEffect(() => {
        if (!enabled) return;
        onRegisterReload?.(reload, { disabled: status === 'loading' });
        return () => onRegisterReload?.(null);
    }, [enabled, onRegisterReload, reload, status]);

    if (!enabled) {
        return <div className="p-6 text-center text-xs text-[#848484]">Open in the CoC desktop app</div>;
    }
    return (
        <div className="flex h-full min-h-[200px] flex-col" data-testid="copilot-extension-canvas">
            <div className="relative min-h-0 flex-1">
                {status !== 'loaded' && (
                    <div role={status === 'failed' ? 'alert' : 'status'} className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-[#848484]">
                        {status === 'failed' ? error : 'Loading extension canvas…'}
                    </div>
                )}
                <div ref={hostRef} className="h-full" hidden={status === 'failed'} />
            </div>
        </div>
    );
}
