/**
 * WebSocket URL construction that honors a per-clone `baseUrl` (AC-03).
 *
 * The SPA opens WebSockets to the CoC server for the process-event stream
 * (`/ws`), terminal PTYs (`/ws/terminal?…`), and comment subscriptions (`/ws`).
 * Historically every call site derived the URL from `window.location`. To make a
 * remote clone's sockets reach that clone's server, route the construction
 * through `cloneWsUrl(path, baseUrl?)`:
 *
 *   • `baseUrl` omitted/empty → reproduce the legacy `window.location` behavior
 *     EXACTLY (`ws(s)://{location.host}{path}`), so local clones are unchanged.
 *   • `baseUrl` present → swap in that origin's host + port and map the scheme
 *     (http→ws, https→wss), keeping `{path}` (incl. any query string) verbatim.
 *
 * `baseUrl` is the remote routing key (the server's effectiveUrl, e.g.
 * `http://127.0.0.1:4000`) carried by AC-01's `RemoteWorkspaceMarker`. No
 * composite IDs, no serverId namespace.
 */

/** Map an http(s) protocol to its ws(s) equivalent. Defaults to `ws:`. */
function toWsProtocol(httpProtocol: string): 'ws:' | 'wss:' {
    return httpProtocol === 'https:' ? 'wss:' : 'ws:';
}

/**
 * Build a WebSocket URL for `path` (which may include a leading `/` and an
 * embedded query string). When `baseUrl` is given the socket targets that
 * origin; otherwise it targets the current page origin (legacy behavior).
 */
export function cloneWsUrl(path: string, baseUrl?: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    if (baseUrl) {
        // Parse only the origin from baseUrl; keep `path` (and its query) verbatim
        // so terminal query strings like `?workspaceId=…` are not URL-mangled.
        const origin = new URL(baseUrl);
        const protocol = toWsProtocol(origin.protocol);
        return `${protocol}//${origin.host}${normalizedPath}`;
    }

    const locationLike = (globalThis as { location?: Location }).location;
    if (!locationLike) {
        // Non-browser (SSR/tests without jsdom): return a relative URL, matching
        // coc-client's buildWebSocketUrl fallback.
        return normalizedPath;
    }
    const protocol = toWsProtocol(locationLike.protocol);
    return `${protocol}//${locationLike.host}${normalizedPath}`;
}
