/**
 * ExtensionCanvasView — renders a custom extension canvas in a sandboxed iframe.
 *
 * The extension's `ui.html` runs inside `<iframe sandbox="allow-scripts">`
 * (no same-origin access — the page cannot reach the dashboard's cookies or
 * API directly). A bootstrap script injected ahead of the extension HTML
 * exposes `window.CanvasHost` to the extension:
 *
 *   CanvasHost.onState(cb)        — re-render callback: cb(state, { revision, title })
 *   CanvasHost.invoke(name, p)    — invoke a declared capability (server-side vm)
 *   CanvasHost.setState(state)    — escape hatch: replace the JSON state directly
 *
 * The host side of the postMessage protocol lives here: it posts
 * `canvas-state` messages on load and on every live update, and services
 * `invoke-capability` / `set-state` requests through the canvases REST client
 * so human UI actions go through the same gate as AI capability calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasExtension } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';

export interface ExtensionCanvasViewProps {
    workspaceId: string;
    canvas: Canvas;
    /** Called whenever a capability/setState produced a new canvas record. */
    onCanvasSaved: (canvas: Canvas) => void;
}

interface HostMessage {
    __canvasHost?: boolean;
    type?: string;
    name?: string;
    params?: Record<string, unknown>;
    state?: unknown;
}

const BOOTSTRAP_SCRIPT = `<script>
(function () {
    var stateCallback = null;
    var latest = null;
    window.CanvasHost = {
        onState: function (cb) {
            stateCallback = cb;
            if (latest) cb(latest.state, latest.meta);
        },
        invoke: function (name, params) {
            parent.postMessage({ __canvasHost: true, type: 'invoke-capability', name: name, params: params || {} }, '*');
        },
        setState: function (state) {
            parent.postMessage({ __canvasHost: true, type: 'set-state', state: state }, '*');
        },
    };
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.__canvasHost !== true || data.type !== 'canvas-state') return;
        latest = { state: data.state, meta: { revision: data.revision, title: data.title } };
        if (stateCallback) stateCallback(latest.state, latest.meta);
    });
    parent.postMessage({ __canvasHost: true, type: 'ready' }, '*');
})();
</script>`;

export function buildExtensionSrcDoc(uiHtml: string): string {
    return BOOTSTRAP_SCRIPT + '\n' + uiHtml;
}

function parseState(content: string): unknown {
    try {
        return content.trim() ? JSON.parse(content) : {};
    } catch {
        return null;
    }
}

export function ExtensionCanvasView({ workspaceId, canvas, onCanvasSaved }: ExtensionCanvasViewProps) {
    const [extension, setExtension] = useState<CanvasExtension | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const canvasIdRef = useRef(canvas.id);
    canvasIdRef.current = canvas.id;
    const canvasCurrentRef = useRef(canvas);
    canvasCurrentRef.current = canvas;

    // (Re)load extension documents when the canvas or its revision changes —
    // the AI may have replaced the UI/capabilities via
    // create_or_update_extension_canvas, which bumps the revision.
    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().canvases.getExtension(workspaceId, canvas.id)
            .then(loaded => {
                if (cancelled) return;
                setExtension(prev =>
                    prev && prev.uiHtml === loaded.uiHtml && prev.capabilitiesJs === loaded.capabilitiesJs
                        && JSON.stringify(prev.manifest) === JSON.stringify(loaded.manifest)
                        ? prev
                        : loaded,
                );
                setLoadError(null);
            })
            .catch(() => {
                if (!cancelled) setLoadError('Failed to load canvas extension');
            });
        return () => { cancelled = true; };
    }, [workspaceId, canvas.id, canvas.revision]);

    const postState = useCallback((target: Canvas) => {
        iframeRef.current?.contentWindow?.postMessage({
            __canvasHost: true,
            type: 'canvas-state',
            state: parseState(target.content),
            revision: target.revision,
            title: target.title,
        }, '*');
    }, []);

    // Push state into the iframe whenever the canvas record changes
    useEffect(() => {
        postState(canvas);
    }, [canvas, postState]);

    // Service iframe requests
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const data = event.data as HostMessage;
            if (!data || data.__canvasHost !== true) return;

            if (data.type === 'ready') {
                postState(canvasCurrentRef.current);
                return;
            }

            if (data.type === 'invoke-capability' && typeof data.name === 'string') {
                getSpaCocClient().canvases.invokeCapability(workspaceId, canvasIdRef.current, data.name, data.params)
                    .then(saved => {
                        setActionError(null);
                        onCanvasSaved(saved);
                    })
                    .catch(err => {
                        setActionError(err instanceof Error ? err.message : 'Capability failed');
                    });
                return;
            }

            if (data.type === 'set-state') {
                const content = JSON.stringify(data.state ?? {}, null, 2);
                getSpaCocClient().canvases.save(workspaceId, canvasIdRef.current, {
                    content,
                    expectedRevision: canvasCurrentRef.current.revision,
                })
                    .then(saved => {
                        setActionError(null);
                        onCanvasSaved({ ...saved, content });
                    })
                    .catch(() => {
                        setActionError('State save failed — the canvas may have changed underneath the extension');
                    });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [workspaceId, onCanvasSaved, postState]);

    if (loadError) {
        return <div className="text-xs text-red-500 py-6 text-center" data-testid="extension-canvas-error">{loadError}</div>;
    }
    if (!extension) {
        return <div className="text-xs text-[#848484] py-6 text-center">Loading extension…</div>;
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            {actionError && (
                <div className="px-3 py-1.5 text-[11px] text-red-600 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800" data-testid="extension-canvas-action-error">
                    {actionError}
                </div>
            )}
            <iframe
                ref={iframeRef}
                title={canvas.title}
                sandbox="allow-scripts"
                className="flex-1 w-full border-0 bg-white dark:bg-[#1e1e1e]"
                srcDoc={buildExtensionSrcDoc(extension.uiHtml)}
                data-testid="extension-canvas-iframe"
            />
        </div>
    );
}
