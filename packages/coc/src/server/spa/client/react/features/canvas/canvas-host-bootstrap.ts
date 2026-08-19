/**
 * The two in-frame `CanvasHost` bootstraps, generated from one method table.
 *
 * Both hosts an extension can find itself talking to are built here:
 *
 *   - `buildLiveCanvasHostBootstrap()`    — the panel's host. Every method in
 *     `CANVAS_HOST_METHODS` becomes a correlated request to the parent window.
 *   - `buildOfflineCanvasHostBootstrap()` — an exported artifact's host. Every
 *     method in the SAME table becomes a rejection with `code: 'offline'`.
 *
 * Generating both from `CANVAS_HOST_METHODS` is the point: a method cannot exist
 * in one host and be missing from the other, which is the failure that leaves an
 * exported artifact hanging on a promise the live panel settles fine. The only
 * hand-written method is `onState`, which needs no host — live it replays the
 * last `canvas-state` push, offline it replays a frozen literal.
 *
 * Pure string building: no DOM, no React, no `Date.now()`. Node-safe, so the
 * offline exporter (which runs outside a browser) can call it, and deterministic,
 * so the same input yields byte-identical output.
 */

import {
    CANVAS_HOST_METHODS,
    CANVAS_HOST_REQUEST_TIMEOUT_MS,
    CANVAS_HOST_VERSION,
    OFFLINE_CANVAS_HOST_MESSAGE_PREFIX,
    OFFLINE_CANVAS_HOST_MESSAGE_SUFFIX,
} from './canvas-host-contract';

/** `invoke: function (name, params) { return request({…}); },` — one live method. */
function liveMethodSource(indent: string): string {
    return CANVAS_HOST_METHODS
        .map(m => `${indent}${m.name}: function (${m.params}) {\n${indent}    return request(${m.requestPayload});\n${indent}},`)
        .join('\n');
}

/**
 * The live host: `window.CanvasHost` wired to the parent through protocol v2.
 *
 * Each call gets a monotonic id and a pending entry; the parent's
 * `{ type: 'response', id, ok, … }` settles it. A request that goes unanswered
 * for `CANVAS_HOST_REQUEST_TIMEOUT_MS` rejects with `code: 'timeout'` rather
 * than leaking a promise that never settles — that bound exists to survive a
 * host-side bug, not to police a slow capability.
 */
export function buildLiveCanvasHostBootstrap(): string {
    return `<script>
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
${liveMethodSource('        ')}
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
}

/** `listFiles: offline('listFiles'),` — one offline method, from the same table. */
function offlineMethodSource(indent: string): string {
    return CANVAS_HOST_METHODS
        .map(m => `${indent}${m.name}: offline('${m.name}'),`)
        .join('\n');
}

/**
 * The offline host baked into an exported artifact: the frozen state delivered
 * synchronously to `onState`, and every server-backed method rejecting with
 * `code: 'offline'`.
 *
 * Rejecting — rather than no-oping — is what makes the degradation honest under
 * protocol v2: a v2 extension `await`s these calls, so returning `undefined` or
 * a promise that never settles would hang the exported page instead of letting
 * the extension render its own "unavailable" state. Each rejected promise gets a
 * no-op `catch` attached before it is handed out, so an extension that fires and
 * forgets raises no unhandled rejection, while one that awaits still sees the code.
 *
 * Files are deliberately NOT inlined into an export — it would multiply the file
 * size with no bound and no story for what happens at 100 MB — so `listFiles`
 * and `readFile` are offline here for the same reason as `invoke`: the artifact
 * is told, loudly, rather than left hanging.
 *
 * @param stateLiteral JS source for the frozen state (already `<`-escaped).
 * @param metaLiteral  JS source for the `{ revision, title }` meta object.
 */
export function buildOfflineCanvasHostBootstrap(stateLiteral: string, metaLiteral: string): string {
    return (
        '<script>\n' +
        '(function () {\n' +
        `    var STATE = ${stateLiteral};\n` +
        `    var META = ${metaLiteral};\n` +
        '    function offline(method) {\n' +
        '        return function () {\n' +
        `            var err = new Error(${JSON.stringify(OFFLINE_CANVAS_HOST_MESSAGE_PREFIX)} + method + ${JSON.stringify(OFFLINE_CANVAS_HOST_MESSAGE_SUFFIX)});\n` +
        "            err.code = 'offline';\n" +
        '            var rejected = Promise.reject(err);\n' +
        '            rejected.catch(function () { /* observed on await; silent when ignored */ });\n' +
        '            return rejected;\n' +
        '        };\n' +
        '    }\n' +
        '    window.CanvasHost = {\n' +
        `        version: ${CANVAS_HOST_VERSION},\n` +
        '        onState: function (cb) {\n' +
        "            if (typeof cb !== 'function') return;\n" +
        '            try { cb(STATE, META); } catch (e) { /* extension render error — leave as-is */ }\n' +
        '        },\n' +
        offlineMethodSource('        ') + '\n' +
        '    };\n' +
        '})();\n' +
        '</script>'
    );
}
