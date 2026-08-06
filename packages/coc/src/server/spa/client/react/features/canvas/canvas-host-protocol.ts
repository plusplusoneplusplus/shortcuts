/**
 * Shared constants and types for the `window.CanvasHost` bridge — the
 * postMessage protocol between an extension canvas's sandboxed iframe and its
 * host.
 *
 * Kept in its own module (no React, no DOM, no imports) because both hosts need
 * it: the live host in `ExtensionCanvasView.tsx` and the offline host baked into
 * an exported artifact by `html-export/extension.ts`, which must stay pure and
 * Node-safe. A single definition here is what keeps the two bootstraps from
 * drifting to different version numbers or error codes.
 *
 * Protocol v2 — request/response: every extension→host message carries a
 * monotonic `id` and the host replies with
 * `{ __canvasHost: true, type: 'response', id, ok, result | error }`. A message
 * that arrives with no `id` is a pre-v2 sender: it is serviced in full, just
 * without a reply.
 */

/** Protocol version exposed to extensions as `CanvasHost.version`. */
export const CANVAS_HOST_VERSION = 2;

/**
 * How long a request waits for its reply before rejecting with `code: 'timeout'`.
 * Deliberately above the server-side capability budget, so a slow-but-working
 * capability is never killed here — this bound only exists so a host-side bug
 * cannot hang an extension on a promise that never settles.
 */
export const CANVAS_HOST_REQUEST_TIMEOUT_MS = 60_000;

/**
 * The closed set of failure codes an extension may branch on, so authors never
 * have to string-match a message.
 *
 *  - `offline`          — no host at all (an exported, view-only artifact).
 *  - `timeout`          — the host never answered within the timeout above.
 *  - `revision-conflict`— a `setState` lost the revision check.
 *  - `capability-error` — the capability itself failed, or the request was unsupported.
 */
export type CanvasHostErrorCode = 'offline' | 'timeout' | 'revision-conflict' | 'capability-error';

/** The single rejection shape every CanvasHost failure uses. */
export interface CanvasHostError {
    code: CanvasHostErrorCode;
    message: string;
}
