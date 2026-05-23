/**
 * Shared CORS Utilities
 *
 * Single source of truth for CORS header logic.
 * Reflects the request Origin when it matches the allowlist (localhost variants
 * or explicitly configured origins). Falls back to `*` for unknown origins.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';

// ============================================================================
// Types
// ============================================================================

export interface CorsPolicy {
    /**
     * Origins to allow in addition to localhost variants.
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

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const DEFAULT_HEADERS = ['Authorization', 'Content-Type'];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if `origin` is an HTTP origin on a well-known localhost hostname.
 * Any port is accepted.
 */
function isLocalhostOrigin(origin: string): boolean {
    try {
        const { protocol, hostname } = new URL(origin);
        return protocol === 'http:' && LOCALHOST_HOSTNAMES.has(hostname);
    } catch {
        return false;
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the default CORS policy:
 * - Localhost variants are always allowed (any port).
 * - No additional explicitly-listed origins beyond localhost.
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
 * Apply CORS headers to `res` according to `policy`.
 *
 * - If the request carries an `Origin` that is a localhost variant, explicitly
 *   listed in `policy.allowedOrigins`, or if `policy.allowedOrigins === '*'`,
 *   the origin is reflected back and (optionally) credentials are enabled.
 * - All other requests receive `Access-Control-Allow-Origin: *` with no
 *   credentials header, which is safe for unknown / unauthenticated callers.
 */
export function applyCorsHeaders(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    policy: CorsPolicy,
): void {
    const origin = req.headers['origin'] as string | undefined;

    const shouldReflect =
        origin !== undefined &&
        (
            policy.allowedOrigins === '*' ||
            isLocalhostOrigin(origin) ||
            (Array.isArray(policy.allowedOrigins) && policy.allowedOrigins.includes(origin))
        );

    if (shouldReflect && origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        if (policy.credentials) {
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', policy.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', policy.headers.join(', '));
}
