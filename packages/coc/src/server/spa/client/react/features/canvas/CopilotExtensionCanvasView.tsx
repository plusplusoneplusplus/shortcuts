import { useEffect, useRef, useState } from 'react';
import { useCloneBaseUrl } from '../../repos/cloneRouting';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';

export interface ExtensionCanvasBridge {
    open(viewId: string, workspaceId: string, canvasId: string): Promise<
        { ok: true; embed: 'webview'; src: string; partition: string; title?: string }
        | { ok: false; message: string }
    >;
    adopt(viewId: string, guestId: number): Promise<void>;
    close(viewId: string): void;
    onState(callback: (state: {
        viewId: string; status: 'loading' | 'loaded' | 'failed'; error?: string;
    }) => void): () => void;
}

export function CopilotExtensionCanvasView({
    workspaceId, canvasId, routingRef, allowDesktopGuest = false,
}: {
    workspaceId: string;
    canvasId: string;
    routingRef?: string | null;
    allowDesktopGuest?: boolean;
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

    useEffect(() => {
        if (!enabled || !bridge) return;
        const viewId = `extension-canvas-${crypto.randomUUID()}`;
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
        void bridge.open(viewId, workspaceId, canvasId).then(result => {
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
    }, [enabled, bridge, workspaceId, canvasId, routingRef]);

    if (!enabled) {
        return <div className="p-6 text-center text-xs text-[#848484]">Open in the CoC desktop app</div>;
    }
    return (
        <div className="relative h-full min-h-[200px]" data-testid="copilot-extension-canvas">
            {status !== 'loaded' && (
                <div role={status === 'failed' ? 'alert' : 'status'} className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-[#848484]">
                    {status === 'failed' ? error : 'Loading extension canvas…'}
                </div>
            )}
            <div ref={hostRef} className="h-full" hidden={status === 'failed'} />
        </div>
    );
}
