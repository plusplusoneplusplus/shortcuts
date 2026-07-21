/**
 * Minimal HTTP helpers and route registry for the container server.
 *
 * The container serves a small set of container-level APIs plus an
 * agent-scoped proxy. A `RouteTable` replaces a long sequence of inline
 * `if` branches with an ordered list of matchers so route modules can be
 * registered independently while preserving first-match-wins ordering.
 */

import * as http from 'http';
import { URL } from 'url';

/** Context handed to every route handler. */
export interface RouteContext {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    url: URL;
    method: string;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;
export type RouteMatcher = (method: string, url: URL) => boolean;

interface RouteEntry {
    match: RouteMatcher;
    handle: RouteHandler;
}

/**
 * Ordered route registry. Routes are tried in registration order and the
 * first matching route handles the request. If no route matches, `dispatch`
 * returns false so the caller can send a 404.
 */
export class RouteTable {
    private routes: RouteEntry[] = [];

    /** Register a route matched by a custom predicate. Order matters — first match wins. */
    when(match: RouteMatcher, handle: RouteHandler): this {
        this.routes.push({ match, handle });
        return this;
    }

    /** Register a route matched by exact method + pathname. */
    on(method: string, pathname: string, handle: RouteHandler): this {
        return this.when((m, url) => m === method && url.pathname === pathname, handle);
    }

    /** Register a route matched by method + pathname prefix. */
    onPrefix(method: string, prefix: string, handle: RouteHandler): this {
        return this.when((m, url) => m === method && url.pathname.startsWith(prefix), handle);
    }

    /**
     * Dispatch to the first matching route. Returns true when a route handled
     * the request, false when none matched (caller should send a 404).
     */
    async dispatch(ctx: RouteContext): Promise<boolean> {
        for (const route of this.routes) {
            if (route.match(ctx.method, ctx.url)) {
                await route.handle(ctx);
                return true;
            }
        }
        return false;
    }
}

/** Write a JSON response with the given status code. */
export function sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/** Read and JSON-parse a request body. Rejects on invalid JSON. */
export async function readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
