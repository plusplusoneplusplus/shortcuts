/**
 * ExtensionCanvasView — renders a custom extension canvas in a sandboxed iframe.
 *
 * The extension's `ui.html` runs inside `<iframe sandbox="allow-scripts">`
 * (no same-origin access — the page cannot reach the dashboard's cookies or
 * API directly). A bootstrap script injected ahead of the extension HTML
 * exposes `window.CanvasHost` to the extension:
 *
 *   CanvasHost.version            — protocol version marker (2)
 *   CanvasHost.onState(cb)        — re-render callback: cb(state, { revision, title })
 *   CanvasHost.invoke(name, p)    — invoke a declared capability (server-side vm)
 *   CanvasHost.setState(state)    — escape hatch: replace the JSON state directly
 *
 * The host side of the postMessage protocol lives here: it posts
 * `canvas-state` messages on load and on every live update, and services
 * `invoke-capability` / `set-state` requests through the canvases REST client
 * so human UI actions go through the same gate as AI capability calls.
 *
 * Protocol v2 — request/response. `invoke` and `setState` return promises: each
 * extension→host message carries a monotonic `id`, and the host answers with
 * `{ __canvasHost: true, type: 'response', id, ok, result | error }`, which the
 * bootstrap uses to settle the matching entry in its pending map. A request that
 * gets no reply inside REQUEST_TIMEOUT_MS rejects rather than leaking a pending
 * promise. Every rejection carries one shape — an Error with a `code` field, one
 * of 'offline' | 'timeout' | 'revision-conflict' | 'capability-error' — so
 * extension authors branch on `code` instead of string-matching messages.
 *
 * Backwards compatible in both directions: an extension that ignores the
 * returned promise behaves exactly as before, and a message that arrives with no
 * `id` (a pre-v2 sender) is still serviced in full — the host simply posts no
 * reply for it rather than dropping the request.
 *
 * Two authoring paths share this host:
 *   - `ui.html` — the extension's own self-contained HTML+JS, injected after the
 *     bootstrap and otherwise untouched. Loads nothing.
 *   - `ui.js` — a compiled JSX component assigning
 *     `window.CanvasExtension = { mount(rootEl, host) }`. The frame gets a root
 *     element plus a runtime script (see `extension-runtime.ts`) that loads the
 *     manifest's declared libraries from the PAGE origin as classic scripts, in
 *     order, and then calls `mount()`. When that fails, the frame paints a
 *     banner and posts `extension-error` here rather than rendering nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Canvas, CanvasExtension } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../repos/cloneRouting';
import {
    CANVAS_HOST_VERSION,
    CANVAS_HOST_REQUEST_TIMEOUT_MS,
    type CanvasHostError,
} from './canvas-host-protocol';
import {
    EXTENSION_ERROR_MESSAGE_TYPE,
    buildExtensionRootHtml,
    buildExtensionRuntimeScript,
} from './extension-runtime';
import { isCanvasLibraryId } from '../../../../../canvas/canvas-libraries';

export interface ExtensionCanvasViewProps {
    workspaceId: string;
    canvas: Canvas;
    /** Called whenever a capability/setState produced a new canvas record. */
    onCanvasSaved: (canvas: Canvas) => void;
}

interface HostMessage {
    __canvasHost?: boolean;
    type?: string;
    /** Correlation id (protocol v2). Absent on pre-v2 senders — service without replying. */
    id?: number;
    name?: string;
    params?: Record<string, unknown>;
    state?: unknown;
    /** `extension-error`: the frame could not load its libraries or mount. */
    message?: string;
}

const BOOTSTRAP_SCRIPT = `<script>
(function () {
    var stateCallback = null;
    var latest = null;
    var nextRequestId = 1;
    var pending = {};
    var TIMEOUT_MS = ${CANVAS_HOST_REQUEST_TIMEOUT_MS};

    function hostError(code, message) {
        var err = new Error(message || code);
        err.code = code;
        return err;
    }

    function settle(id) {
        var entry = pending[id];
        if (!entry) return null;
        delete pending[id];
        clearTimeout(entry.timer);
        return entry;
    }

    function request(message) {
        var id = nextRequestId++;
        message.__canvasHost = true;
        message.id = id;
        return new Promise(function (resolve, reject) {
            pending[id] = {
                resolve: resolve,
                reject: reject,
                timer: setTimeout(function () {
                    var entry = settle(id);
                    if (entry) entry.reject(hostError('timeout', 'CanvasHost request timed out after ' + TIMEOUT_MS + 'ms'));
                }, TIMEOUT_MS),
            };
            parent.postMessage(message, '*');
        });
    }

    window.CanvasHost = {
        version: ${CANVAS_HOST_VERSION},
        onState: function (cb) {
            stateCallback = cb;
            if (latest) cb(latest.state, latest.meta);
        },
        invoke: function (name, params) {
            return request({ type: 'invoke-capability', name: name, params: params || {} });
        },
        setState: function (state) {
            return request({ type: 'set-state', state: state });
        },
    };
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.__canvasHost !== true) return;
        if (data.type === 'response') {
            var entry = settle(data.id);
            if (!entry) return;
            if (data.ok) entry.resolve(data.result);
            else entry.reject(hostError(
                (data.error && data.error.code) || 'capability-error',
                (data.error && data.error.message) || 'CanvasHost request failed',
            ));
            return;
        }
        if (data.type !== 'canvas-state') return;
        latest = { state: data.state, meta: { revision: data.revision, title: data.title } };
        if (stateCallback) stateCallback(latest.state, latest.meta);
    });
    parent.postMessage({ __canvasHost: true, type: 'ready' }, '*');
})();
</script>`;

/** The extension documents the frame renders from. A subset of `CanvasExtension`. */
export interface ExtensionSrcDocSource {
    /** Legacy/vanilla authoring: self-contained HTML+JS. */
    uiHtml?: string;
    /** JSX authoring: compiled UI assigning `window.CanvasExtension`. Wins over `uiHtml`. */
    uiJs?: string;
    /** Vendored libraries to load first, dependency-resolved and in order. */
    libraries?: readonly string[];
}

/**
 * Build the iframe `srcdoc`.
 *
 * Two shapes, chosen by which document the extension has:
 *   - `uiJs` — the JSX path: bootstrap, a root element, then the runtime script
 *     that loads the declared libraries from `assetBase` and calls `mount()`.
 *   - `uiHtml` — the legacy path, byte for byte what it always was: bootstrap
 *     followed by the extension's own HTML. Nothing is loaded, nothing injected.
 *
 * `assetBase` is the PAGE origin, deliberately — vendored bundles are the one
 * thing not routed through the workspace-owning server, because they are static
 * assets of the dashboard itself and identical everywhere.
 */
export function buildExtensionSrcDoc(source: ExtensionSrcDocSource, assetBase?: string): string {
    if (source.uiJs) {
        const libraries = (source.libraries ?? []).filter(isCanvasLibraryId);
        const runtime = buildExtensionRuntimeScript({
            uiJs: source.uiJs,
            libraries,
            assetBase: assetBase ?? '',
        });
        return [BOOTSTRAP_SCRIPT, buildExtensionRootHtml(), runtime].join('\n');
    }
    return BOOTSTRAP_SCRIPT + '\n' + (source.uiHtml ?? '');
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

    // Route every canvas REST call to the workspace's OWNING server: the remote
    // clone's origin for a remote workspace, else the default page origin. The
    // bare page-origin client (getSpaCocClient) 404s for remote workspaces —
    // their canvas (incl. the extension docs) lives only on the remote server —
    // even though the parent CanvasPanel already loads the content via this same
    // clone-aware client, so the frame renders while the extension GET fails.
    const client = useCocClient(workspaceId);

    // (Re)load extension documents when the canvas or its revision changes —
    // the AI may have replaced the UI/capabilities via
    // create_or_update_extension_canvas, which bumps the revision.
    useEffect(() => {
        let cancelled = false;
        client.canvases.getExtension(workspaceId, canvas.id)
            .then(loaded => {
                if (cancelled) return;
                setExtension(prev =>
                    prev && prev.uiHtml === loaded.uiHtml && prev.uiJs === loaded.uiJs
                        && prev.capabilitiesJs === loaded.capabilitiesJs
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
    }, [client, workspaceId, canvas.id, canvas.revision]);

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

            // Pre-v2 senders carry no correlation id. They are serviced exactly as
            // before — the reply is simply skipped, never the work.
            const requestId = typeof data.id === 'number' ? data.id : null;
            const respond = (payload: { ok: true; result: unknown } | { ok: false; error: CanvasHostError }) => {
                if (requestId === null) return;
                iframeRef.current?.contentWindow?.postMessage({
                    __canvasHost: true,
                    type: 'response',
                    id: requestId,
                    ...payload,
                }, '*');
            };
            /** What a settled mutation hands back: the new revision plus the state it produced. */
            const savedResult = (saved: Canvas) => ({ revision: saved.revision, state: parseState(saved.content) });

            if (data.type === 'ready') {
                postState(canvasCurrentRef.current);
                respond({ ok: true, result: null });
                return;
            }

            // A JSX extension whose libraries failed to load, or whose mount()
            // threw, reports it here. The frame paints its own banner too — this
            // surfaces the same failure outside the sandbox, where a user who has
            // scrolled past the frame can still see it. Not a request: no reply.
            if (data.type === EXTENSION_ERROR_MESSAGE_TYPE) {
                setActionError(typeof data.message === 'string' && data.message
                    ? data.message
                    : 'The canvas extension failed to load');
                return;
            }

            if (data.type === 'invoke-capability' && typeof data.name === 'string') {
                client.canvases.invokeCapability(workspaceId, canvasIdRef.current, data.name, data.params)
                    .then(saved => {
                        setActionError(null);
                        onCanvasSaved(saved);
                        respond({ ok: true, result: savedResult(saved) });
                    })
                    .catch(err => {
                        // The banner stays — a human still needs to see the failure —
                        // AND the extension's promise rejects so it can react itself.
                        const message = err instanceof Error ? err.message : 'Capability failed';
                        setActionError(message);
                        respond({ ok: false, error: { code: 'capability-error', message } });
                    });
                return;
            }

            if (data.type === 'set-state') {
                const content = JSON.stringify(data.state ?? {}, null, 2);
                client.canvases.save(workspaceId, canvasIdRef.current, {
                    content,
                    expectedRevision: canvasCurrentRef.current.revision,
                })
                    .then(saved => {
                        setActionError(null);
                        onCanvasSaved({ ...saved, content });
                        respond({ ok: true, result: savedResult({ ...saved, content }) });
                    })
                    .catch(() => {
                        const message = 'State save failed — the canvas may have changed underneath the extension';
                        setActionError(message);
                        respond({ ok: false, error: { code: 'revision-conflict', message } });
                    });
                return;
            }

            // Unknown/malformed request: answer it rather than letting the
            // extension's promise sit until the timeout.
            respond({ ok: false, error: { code: 'capability-error', message: `Unsupported CanvasHost request "${String(data.type)}"` } });
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [client, workspaceId, onCanvasSaved, postState]);

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
                srcDoc={buildExtensionSrcDoc(
                    { uiHtml: extension.uiHtml, uiJs: extension.uiJs, libraries: extension.manifest?.libraries },
                    // Page origin, not the workspace-owning server: the vendored
                    // bundles are static dashboard assets, identical on every
                    // clone. Absolute so the about:srcdoc frame never has to
                    // resolve a relative URL against an inherited base.
                    typeof window !== 'undefined' ? window.location.origin : '',
                )}
                data-testid="extension-canvas-iframe"
            />
        </div>
    );
}
