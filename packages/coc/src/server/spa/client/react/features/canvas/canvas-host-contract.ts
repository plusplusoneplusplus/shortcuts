/**
 * The `window.CanvasHost` contract — the single definition of the postMessage
 * protocol between an extension canvas's sandboxed iframe and its host.
 *
 * Kept in its own module (no React, no DOM, no imports) because THREE places
 * need it and none of them may drift from the others:
 *   - the live host in `ExtensionCanvasView.tsx` / `useExtensionCanvasHostController`
 *   - the offline host baked into an exported artifact by `html-export/extension.ts`,
 *     which must stay pure and Node-safe
 *   - the bootstrap builders in `canvas-host-bootstrap.ts`, which generate BOTH
 *     in-frame hosts from the method table below
 *
 * The method table is what makes the two hosts provably parallel: a new
 * `CanvasHost` API is added once, here, and both bootstraps pick it up — the
 * live one wiring it to a request, the offline one to an `offline` rejection.
 * Neither host can silently omit a method the other has.
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
 *  - `file-error`       — a `listFiles`/`readFile` failed: no such file, a path
 *                         the server refused, or one over the size cap. Distinct
 *                         from `capability-error` because a missing data file is
 *                         something an artifact routinely handles itself
 *                         (render an empty state) rather than a broken action.
 */
export type CanvasHostErrorCode = 'offline' | 'timeout' | 'revision-conflict' | 'capability-error' | 'file-error';

/** The single rejection shape every CanvasHost failure uses. */
export interface CanvasHostError {
    code: CanvasHostErrorCode;
    message: string;
}

/** Message `type` values an extension may send to its host. */
export type CanvasHostRequestType = 'ready' | 'invoke-capability' | 'set-state' | 'list-files' | 'read-file';

/** Method names exposed on `window.CanvasHost`. */
export type CanvasHostMethod = 'onState' | 'invoke' | 'setState' | 'listFiles' | 'readFile';

/**
 * One server-backed `CanvasHost` method, described well enough that both
 * bootstraps can be generated from it.
 *
 * `onState` is deliberately NOT in this table: it is the one purely local
 * method (a callback registration, no host round-trip), so each bootstrap
 * implements it directly — live from the last `canvas-state` message, offline
 * from a frozen literal.
 */
export interface CanvasHostMethodSpec {
    /** The name on `window.CanvasHost`. */
    readonly name: Exclude<CanvasHostMethod, 'onState'>;
    /** The request `type` this method posts to the host. */
    readonly requestType: Exclude<CanvasHostRequestType, 'ready'>;
    /** JS parameter list source for the generated function, e.g. `'name, params'`. */
    readonly params: string;
    /** JS source for the request payload literal, referencing `params`. */
    readonly requestPayload: string;
}

/**
 * Every method that needs a host to work — and therefore every method an
 * offline export must reject. The bootstrap builders iterate this; adding an
 * entry is the whole change needed to give both hosts a new API.
 */
export const CANVAS_HOST_METHODS: readonly CanvasHostMethodSpec[] = [
    {
        name: 'invoke',
        requestType: 'invoke-capability',
        params: 'name, params',
        requestPayload: "{ type: 'invoke-capability', name: name, params: params || {} }",
    },
    {
        name: 'setState',
        requestType: 'set-state',
        params: 'state',
        requestPayload: "{ type: 'set-state', state: state }",
    },
    {
        name: 'listFiles',
        requestType: 'list-files',
        params: '',
        requestPayload: "{ type: 'list-files' }",
    },
    {
        name: 'readFile',
        requestType: 'read-file',
        params: 'path, options',
        requestPayload: "{ type: 'read-file', path: path, options: options || {} }",
    },
];

/** The wire shape of an extension→host message, before any validation. */
export interface CanvasHostRequestMessage {
    __canvasHost?: boolean;
    type?: string;
    /** Correlation id (protocol v2). Absent on pre-v2 senders — service without replying. */
    id?: number;
    name?: string;
    params?: Record<string, unknown>;
    state?: unknown;
    /** `read-file`: the canvas-relative path to read. */
    path?: unknown;
    /** `read-file`: caller options, currently `{ encoding?: 'base64' }`. */
    options?: unknown;
    /** `extension-error`: the frame could not load its libraries or mount. */
    message?: string;
}

/** What the host hands back for a settled request. */
export type CanvasHostResponsePayload =
    | { ok: true; result: unknown }
    | { ok: false; error: CanvasHostError };

/** Whether a received message is addressed to this protocol at all. */
export function isCanvasHostMessage(data: unknown): data is CanvasHostRequestMessage {
    return !!data && (data as CanvasHostRequestMessage).__canvasHost === true;
}

/**
 * The correlation id of a request, or `null` for a pre-v2 sender that carries
 * none. `null` means "service the work, post no reply" — never "drop it".
 */
export function canvasHostRequestId(data: CanvasHostRequestMessage): number | null {
    return typeof data.id === 'number' ? data.id : null;
}

/** Build the response envelope the in-frame bootstrap settles a request from. */
export function canvasHostResponse(id: number, payload: CanvasHostResponsePayload) {
    return { __canvasHost: true as const, type: 'response' as const, id, ...payload };
}

/** Build the `canvas-state` push the host sends on load and on every update. */
export function canvasHostStateMessage(state: unknown, meta: { revision: number; title: string }) {
    return {
        __canvasHost: true as const,
        type: 'canvas-state' as const,
        state,
        revision: meta.revision,
        title: meta.title,
    };
}

/** A failure payload, in the one shape every CanvasHost rejection uses. */
export function canvasHostFailure(code: CanvasHostErrorCode, message: string): { ok: false; error: CanvasHostError } {
    return { ok: false, error: { code, message } };
}

/** A success payload. */
export function canvasHostSuccess(result: unknown): { ok: true; result: unknown } {
    return { ok: true, result };
}

/** `err.message` when it is one, else a caller-chosen fallback. */
export function canvasHostErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** The message an unknown/malformed request is answered with. */
export function unsupportedCanvasHostRequest(type: unknown): { ok: false; error: CanvasHostError } {
    return canvasHostFailure('capability-error', `Unsupported CanvasHost request "${String(type)}"`);
}

/** The message a lost `setState` revision check is reported with. */
export const CANVAS_HOST_REVISION_CONFLICT_MESSAGE =
    'State save failed — the canvas may have changed underneath the extension';

/**
 * Why a server-backed method cannot work in an exported, view-only artifact,
 * split around the method name.
 *
 * The offline bootstrap builds this message inside the frame, from a `method`
 * variable it only has at call time, so it needs the two halves rather than the
 * finished string — and keeping them here is what stops the wording from being
 * retyped into generated JS where nothing checks it.
 */
export const OFFLINE_CANVAS_HOST_MESSAGE_PREFIX = 'CanvasHost.';
export const OFFLINE_CANVAS_HOST_MESSAGE_SUFFIX =
    ' is unavailable in this view-only snapshot — there is no server and nothing is saved.';

/** Why a server-backed method cannot work in an exported, view-only artifact. */
export function offlineCanvasHostMessage(method: string): string {
    return `${OFFLINE_CANVAS_HOST_MESSAGE_PREFIX}${method}${OFFLINE_CANVAS_HOST_MESSAGE_SUFFIX}`;
}

/**
 * Parse a canvas's stored `content` into the state an extension sees. Empty
 * content is an empty object; malformed JSON is `null`, which the extension can
 * tell apart from `{}` rather than being handed a half-parsed value.
 */
export function parseCanvasState(content: string): unknown {
    try {
        return content.trim() ? JSON.parse(content) : {};
    } catch {
        return null;
    }
}

/** Serialize an extension-supplied state back into canvas `content`. */
export function serializeCanvasState(state: unknown): string {
    return JSON.stringify(state ?? {}, null, 2);
}
