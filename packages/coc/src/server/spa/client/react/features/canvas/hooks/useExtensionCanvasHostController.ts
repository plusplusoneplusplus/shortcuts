/**
 * useExtensionCanvasHostController — the host side of the `CanvasHost`
 * postMessage protocol for a live extension canvas.
 *
 * Everything between "a message arrived from the frame" and "a REST call
 * settled" lives here: request correlation, the canvases client calls, the
 * mapping from a rejected call to a `CanvasHostErrorCode`, and the two pieces of
 * UI state those outcomes drive (the pending-capability indicator and the error
 * banner). `ExtensionCanvasView` is left to render.
 *
 * Splitting it out is what makes the protocol testable on its own: unsupported
 * request types, revision conflicts, file errors and pre-v2 senders can each be
 * driven by dispatching one message at a hook, instead of mounting an iframe
 * host and inferring the reply from the DOM.
 *
 * Error mapping, which is the part extensions actually branch on:
 *   - a failed capability   → `capability-error`, AND the banner (a human must see it)
 *   - a failed `set-state`  → `revision-conflict`, AND the banner
 *   - a failed file call    → `file-error`, and deliberately NO banner: a missing
 *     data file is the artifact's business (render an empty state), not a
 *     panel-level failure to put in front of the user
 *   - anything unrecognized → `capability-error`, answered rather than left to
 *     time out 60 s later
 *
 * A message with no `id` is a pre-v2 sender: it is serviced in full and simply
 * gets no reply, never dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Canvas } from '@plusplusoneplusplus/coc-client';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import {
    CANVAS_HOST_REVISION_CONFLICT_MESSAGE,
    canvasHostErrorMessage,
    canvasHostFailure,
    canvasHostRequestId,
    canvasHostResponse,
    canvasHostStateMessage,
    canvasHostSuccess,
    isCanvasHostMessage,
    parseCanvasState,
    serializeCanvasState,
    unsupportedCanvasHostRequest,
    type CanvasHostResponsePayload,
} from '../canvas-host-contract';
import { EXTENSION_ERROR_MESSAGE_TYPE } from '../extension-runtime';

export interface ExtensionCanvasHostControllerOptions {
    /** Clone-aware canvases client for the workspace that OWNS this canvas. */
    client: Pick<CocClient, 'canvases'>;
    workspaceId: string;
    /** The current canvas record. Its revision is the one `set-state` checks against. */
    canvas: Canvas;
    /** Called whenever a capability/setState produced a new canvas record. */
    onCanvasSaved: (canvas: Canvas) => void;
}

export interface ExtensionCanvasHostController {
    /** Attach to the extension iframe — the controller talks to its content window. */
    iframeRef: RefObject<HTMLIFrameElement>;
    /**
     * Capability invocations in flight. An async capability has a 30 s budget,
     * so without this the panel would sit silent for half a minute after a
     * click. Counted rather than boolean: an artifact may fire several actions,
     * and the indicator should clear when the LAST one settles.
     */
    pendingInvokes: number;
    /** The last failure worth showing a human, or null. */
    actionError: string | null;
    beginReload(): boolean;
    endReload(): void;
}

export function useExtensionCanvasHostController({
    client,
    workspaceId,
    canvas,
    onCanvasSaved,
}: ExtensionCanvasHostControllerOptions): ExtensionCanvasHostController {
    const [actionError, setActionError] = useState<string | null>(null);
    const [pendingInvokes, setPendingInvokes] = useState(0);
    const pendingMutations = useRef(0);
    const reloading = useRef(false);
    const beginReload = useCallback(() => {
        if (reloading.current) return false;
        if (pendingMutations.current > 0) {
            setActionError('Wait for canvas actions and state saves to finish before reloading. Actions will not be replayed.');
            return false;
        }
        reloading.current = true;
        return true;
    }, []);
    const endReload = useCallback(() => { reloading.current = false; }, []);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Read through refs inside the message handler: the listener is bound once
    // per client/workspace, and must always act on the CURRENT canvas — not the
    // one captured when it was attached.
    const canvasIdRef = useRef(canvas.id);
    canvasIdRef.current = canvas.id;
    const canvasCurrentRef = useRef(canvas);
    canvasCurrentRef.current = canvas;

    const postState = useCallback((target: Canvas) => {
        iframeRef.current?.contentWindow?.postMessage(
            canvasHostStateMessage(parseCanvasState(target.content), {
                revision: target.revision,
                title: target.title,
            }),
            '*',
        );
    }, []);

    // Push state into the iframe whenever the canvas record changes.
    useEffect(() => {
        postState(canvas);
    }, [canvas, postState]);

    useEffect(() => {
        let active = true;
        const handleMessage = (event: MessageEvent) => {
            if (event.source !== iframeRef.current?.contentWindow) return;
            const source = event.source as Window;
            const current = () => active && source === iframeRef.current?.contentWindow;
            const data = event.data;
            if (!isCanvasHostMessage(data)) return;

            // Pre-v2 senders carry no correlation id. They are serviced exactly as
            // before — the reply is simply skipped, never the work.
            const requestId = canvasHostRequestId(data);
            const respond = (payload: CanvasHostResponsePayload) => {
                if (requestId === null || !current()) return;
                source.postMessage(canvasHostResponse(requestId, payload), '*');
            };
            /** What a settled mutation hands back: the new revision plus the state it produced. */
            const savedResult = (saved: Canvas) => ({
                revision: saved.revision,
                state: parseCanvasState(saved.content),
            });

            if (reloading.current) {
                respond(canvasHostFailure('capability-error', 'Canvas reload in progress. This request was not started.'));
                return;
            }

            if (data.type === 'ready') {
                postState(canvasCurrentRef.current);
                respond(canvasHostSuccess(null));
                return;
            }

            // A JSX extension whose libraries failed to load, or whose mount()
            // threw, reports it here. The frame paints its own banner too — this
            // surfaces the same failure outside the sandbox, where a user who has
            // scrolled past the frame can still see it. Not a request: no reply.
            if (data.type === EXTENSION_ERROR_MESSAGE_TYPE) {
                setActionError(
                    typeof data.message === 'string' && data.message
                        ? data.message
                        : 'The canvas extension failed to load',
                );
                return;
            }

            if (data.type === 'invoke-capability' && typeof data.name === 'string') {
                pendingMutations.current++;
                setPendingInvokes(n => n + 1);
                client.canvases.invokeCapability(workspaceId, canvasIdRef.current, data.name, data.params)
                    .then(saved => {
                        if (!current()) return;
                        setActionError(null);
                        onCanvasSaved(saved);
                        respond(canvasHostSuccess(savedResult(saved)));
                    })
                    .catch(err => {
                        if (!current()) return;
                        // The banner stays — a human still needs to see the failure —
                        // AND the extension's promise rejects so it can react itself.
                        const message = canvasHostErrorMessage(err, 'Capability failed');
                        setActionError(message);
                        respond(canvasHostFailure('capability-error', message));
                    })
                    .finally(() => {
                        pendingMutations.current--;
                        if (current()) setPendingInvokes(n => Math.max(0, n - 1));
                    });
                return;
            }

            // Read-only file access, scoped to this canvas's own files directory.
            // Deliberately does NOT set `actionError` — see the header.
            if (data.type === 'list-files') {
                client.canvases.listFiles(workspaceId, canvasIdRef.current)
                    .then(files => respond(canvasHostSuccess({ files })))
                    .catch(err => respond(
                        canvasHostFailure('file-error', canvasHostErrorMessage(err, 'Failed to list canvas files')),
                    ));
                return;
            }

            if (data.type === 'read-file') {
                if (typeof data.path !== 'string' || !data.path) {
                    respond(canvasHostFailure('file-error', 'readFile needs a path'));
                    return;
                }
                const base64 = (data.options as { encoding?: string } | undefined)?.encoding === 'base64';
                client.canvases.readFile(
                    workspaceId,
                    canvasIdRef.current,
                    data.path,
                    base64 ? { encoding: 'base64' } : undefined,
                )
                    .then(file => respond(canvasHostSuccess(file)))
                    .catch(err => respond(
                        canvasHostFailure('file-error', canvasHostErrorMessage(err, 'Failed to read canvas file')),
                    ));
                return;
            }

            if (data.type === 'set-state') {
                const content = serializeCanvasState(data.state);
                pendingMutations.current++;
                client.canvases.save(workspaceId, canvasIdRef.current, {
                    content,
                    expectedRevision: canvasCurrentRef.current.revision,
                })
                    .then(saved => {
                        if (!current()) return;
                        setActionError(null);
                        onCanvasSaved({ ...saved, content });
                        respond(canvasHostSuccess(savedResult({ ...saved, content })));
                    })
                    .catch(() => {
                        if (!current()) return;
                        setActionError(CANVAS_HOST_REVISION_CONFLICT_MESSAGE);
                        respond(canvasHostFailure('revision-conflict', CANVAS_HOST_REVISION_CONFLICT_MESSAGE));
                    })
                    .finally(() => { pendingMutations.current--; });
                return;
            }

            // Unknown/malformed request: answer it rather than letting the
            // extension's promise sit until the timeout.
            respond(unsupportedCanvasHostRequest(data.type));
        };

        window.addEventListener('message', handleMessage);
        return () => { active = false; window.removeEventListener('message', handleMessage); };
    }, [client, workspaceId, canvas.id, onCanvasSaved, postState]);

    return { iframeRef, pendingInvokes, actionError, beginReload, endReload };
}
