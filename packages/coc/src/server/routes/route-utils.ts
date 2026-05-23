/**
 * Route creation utilities
 *
 * `createRoute` eliminates the repeated try/catch + url.parse + sendJSON boilerplate
 * found in route handlers. Typed query-parser helpers (`asString`, `asInt`, `asBool`)
 * replace ad-hoc casts from ParsedUrlQuery values.
 */

import * as url from 'url';
import type { ParsedUrlQuery } from 'querystring';
import type * as http from 'http';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError } from '../errors';

// ============================================================================
// Query-param helpers
// ============================================================================

/**
 * Extract a string value from a raw query param.
 * Returns `fallback` (default `undefined`) when the value is absent or not a string.
 */
export function asString(v: string | string[] | undefined): string | undefined;
export function asString(v: string | string[] | undefined, fallback: string): string;
export function asString(v: string | string[] | undefined, fallback?: string): string | undefined {
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' ? s : fallback;
}

/**
 * Extract an integer from a raw query param.
 * @param v - raw query value
 * @param fallback - value to return when absent or not parseable (default `undefined`)
 * @param max - cap the result to at most this value
 */
export function asInt(v: string | string[] | undefined): number | undefined;
export function asInt(v: string | string[] | undefined, fallback: number, max?: number): number;
export function asInt(v: string | string[] | undefined, fallback?: number, max?: number): number | undefined {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s !== 'string') return fallback;
    const n = parseInt(s, 10);
    if (isNaN(n)) return fallback;
    return max !== undefined ? Math.min(n, max) : n;
}

/**
 * Extract a boolean from a raw query param.
 * 'true' → true, 'false' → false, otherwise → `fallback` (default `false`).
 */
export function asBool(v: string | string[] | undefined, fallback = false): boolean {
    const s = Array.isArray(v) ? v[0] : v;
    return s === 'true' ? true : s === 'false' ? false : fallback;
}

// ============================================================================
// createRoute
// ============================================================================

/**
 * Context passed to `createRoute` handlers.
 * Includes typed `query` (from `parseQuery`), the regex `match`, the raw `req`,
 * and `res` — needed for early-exit helpers like `resolveWorkspaceOrFail`.
 * If the handler calls `sendJSON` / `handleAPIError` itself and returns `void`,
 * the wrapper skips its own response emission.
 */
export interface RouteHandlerContext<TQuery = ParsedUrlQuery> {
    query: TQuery;
    match: RegExpMatchArray;
    req: http.IncomingMessage;
    res: http.ServerResponse;
}

export type TypedHandler<TQuery, TResult> = (
    ctx: RouteHandlerContext<TQuery>
) => Promise<TResult | void> | TResult | void;

export interface CreateRouteOptions<TQuery, TResult> {
    method?: string;
    pattern: string | RegExp;
    /** Transform raw ParsedUrlQuery into a typed object. */
    parseQuery?: (raw: ParsedUrlQuery) => TQuery;
    handler: TypedHandler<TQuery, TResult>;
    /** HTTP status code to use when the handler returns a non-void result (default 200). */
    statusCode?: number;
}

/**
 * Build a `Route` that automatically:
 *  - parses `req.url` into a typed query object (via `parseQuery`)
 *  - wraps the handler in try/catch → `handleAPIError`
 *  - calls `sendJSON(res, statusCode, result)` when the handler returns a non-void value
 *
 * If the handler returns `void` (or `undefined`) the response is assumed to have
 * been sent already (e.g. via `resolveWorkspaceOrFail`'s built-in 404 or an early
 * `sendJSON` call inside the handler body).
 */
export function createRoute<TQuery = ParsedUrlQuery, TResult = unknown>(
    opts: CreateRouteOptions<TQuery, TResult>,
): Route {
    return {
        method: opts.method,
        pattern: opts.pattern,
        handler: async (req, res, match) => {
            const raw = url.parse(req.url || '/', true).query;
            const query: TQuery = opts.parseQuery ? opts.parseQuery(raw) : raw as unknown as TQuery;
            const ctx: RouteHandlerContext<TQuery> = {
                query,
                match: match ?? ([] as unknown as RegExpMatchArray),
                req,
                res,
            };
            try {
                const result = await opts.handler(ctx);
                if (result !== undefined && !res.headersSent) {
                    sendJSON(res, opts.statusCode ?? 200, result);
                }
            } catch (err) {
                if (!res.headersSent) {
                    handleAPIError(res, err);
                }
            }
        },
    };
}
