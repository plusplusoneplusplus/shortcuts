/**
 * Shared CORS Utilities
 *
 * Single source of truth for CORS header logic.
 * Reflects the request Origin only when it is a loopback origin (or explicitly
 * configured in the policy). Non-loopback cross-origin requests receive NO
 * `Access-Control-Allow-Origin` header, so browsers block them; `*` is never
 * emitted. Same-origin and no-Origin requests are unaffected (browsers do not
 * require the header for those).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';

// ============================================================================
// Types
// ============================================================================

export interface CorsPolicy {
    /**
     * Origins to allow in addition to loopback origins.
     * Use `'*'` to reflect any origin (permissive — avoid on public endpoints).
     */
    allowedOrigins: string[] | '*';
    /** Send `Access-Control-Allow-Credentials: true` when reflecting a specific origin. */
    credentials: boolean;
    methods: string[];
    headers: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Loopback hostnames. A loopback origin can never reach another machine, so
 * reflecting it for cross-origin requests is safe (the dashboard SPA and a
 * forwarded remote CoC differ only by port, both on loopback). Note this set
 * deliberately excludes `0.0.0.0` — it is a bind/wildcard address, not a
 * hostname a browser ever sends as an Origin.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Authorization', 'Content-Type'];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if `origin` is an `http:`/`https:` origin on a loopback
 * hostname (`localhost`, `127.0.0.1`, or `::1`). Any port is accepted.
 *
 * Shared by the REST CORS layer and the WebSocket upgrade/verify path so both
 * make the identical allow/reject decision. Everything else (other hostnames,
 * other schemes, malformed values) is rejected.
 *
 * Examples:
 *   isLoopbackOrigin('http://127.0.0.1:4000')        → true
 *   isLoopbackOrigin('https://localhost:5000')       → true
 *   isLoopbackOrigin('http://[::1]:4000')            → true
 *   isLoopbackOrigin('http://evil.com')              → false
 *   isLoopbackOrigin('http://192.168.1.10')          → false
 *   isLoopbackOrigin('http://attacker.localhost.evil.com') → false
 */
export function isLoopbackOrigin(origin: string | undefined | null): boolean {
    if (!origin) {
        return false;
    }
    try {
        const { protocol, hostname } = new URL(origin);
        if (protocol !== 'http:' && protocol !== 'https:') {
            return false;
        }
        // URL() normalizes an IPv6 host to bracketed form (e.g. "[::1]");
        // strip the brackets before matching the hostname set.
        const host = hostname.startsWith('[') && hostname.endsWith(']')
            ? hostname.slice(1, -1)
            : hostname;
        return LOOPBACK_HOSTNAMES.has(host);
    } catch {
        return false;
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the default CORS policy:
 * - Loopback origins are always allowed (any port, http or https).
 * - No additional explicitly-listed origins beyond loopback.
 * - Credentials allowed for reflected origins.
 * - All standard HTTP methods including PUT/PATCH.
 * - `Authorization` and `Content-Type` in allowed headers.
 */
export function getDefaultCorsPolicy(): CorsPolicy {
    return {
        allowedOrigins: [],
        credentials: true,
        methods: DEFAULT_METHODS,
        headers: DEFAULT_HEADERS,
    };
}

/**
 * Returns true if a request carrying `origin` is allowed to make a cross-origin
 * request under `policy`. Loopback origins are always allowed; otherwise the
 * origin must be `'*'`-policy or explicitly listed. A missing Origin (e.g.
 * same-origin or non-browser callers) is not a cross-origin request and is
 * reported as not-reflected here — callers handle it as "no CORS header needed".
 */
function isOriginAllowed(origin: string | undefined, policy: CorsPolicy): boolean {
    if (origin === undefined) {
        return false;
    }
    return (
        policy.allowedOrigins === '*' ||
        isLoopbackOrigin(origin) ||
        (Array.isArray(policy.allowedOrigins) && policy.allowedOrigins.includes(origin))
    );
}

/**
 * Apply CORS headers to `res` according to `policy`.
 *
 * - If the request carries an `Origin` that is a loopback origin, is explicitly
 *   listed in `policy.allowedOrigins`, or `policy.allowedOrigins === '*'`, the
 *   origin is reflected back and (optionally) credentials are enabled.
 * - All other requests receive NO `Access-Control-Allow-Origin` header. The
 *   wildcard `*` is never sent, and a non-loopback Origin is never reflected,
 *   so browsers block such cross-origin reads. Same-origin and no-Origin
 *   requests are unaffected — browsers do not require the header for those.
 *
 * `Access-Control-Allow-Methods`/`-Headers` are always advertised so a
 * preflight from an allowed origin sees the permitted methods/headers.
 */
export function applyCorsHeaders(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    policy: CorsPolicy,
): void {
    const origin = req.headers['origin'] as string | undefined;

    if (isOriginAllowed(origin, policy) && origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        // Vary on Origin so shared caches do not serve one origin's reflected
        // header to another.
        res.setHeader('Vary', 'Origin');
        if (policy.credentials) {
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
    }

    res.setHeader('Access-Control-Allow-Methods', policy.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', policy.headers.join(', '));
}
