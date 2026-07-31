/**
 * Admin Routes Composition — characterization tests
 *
 * Locks the set of routes produced by `registerAdminRoutes` (composed from the
 * per-domain modules) and the confirmation-token semantics, so future domain
 * splits cannot silently drop, rename, or reorder-away an admin endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerAdminRoutes } from '../../src/server/admin/admin-handler';
import { registerConfigRoutes } from '../../src/server/admin/admin-config-routes';
import { registerDataRoutes } from '../../src/server/admin/admin-data-routes';
import { registerPromptRoutes } from '../../src/server/admin/admin-prompt-routes';
import { registerSystemRoutes } from '../../src/server/admin/admin-system-routes';
import { registerStorageRoutes } from '../../src/server/admin/admin-storage-routes';
import { registerProviderRoutes } from '../../src/server/admin/admin-provider-routes';
import { TokenManager } from '../../src/server/admin/token-manager';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../../src/server/types';
import type { AdminRouteOptions } from '../../src/server/admin/admin-route-types';

function routeKey(r: Route): string {
    return `${r.method} ${r.pattern instanceof RegExp ? r.pattern.source : r.pattern}`;
}

const EXPECTED_ROUTES = [
    'GET /api/admin/config',
    'PUT /api/admin/config',
    'GET /api/admin/data/wipe-token',
    'GET /api/admin/data/stats',
    'DELETE /api/admin/data',
    'GET /api/admin/export',
    'GET /api/admin/import-token',
    'POST /api/admin/import/preview',
    'POST /api/admin/import',
    'GET /api/admin/prompts',
    'PUT ^\\/api\\/admin\\/prompts\\/([^/]+)$',
    'DELETE ^\\/api\\/admin\\/prompts\\/([^/]+)$',
    'GET /api/admin/version',
    'POST /api/admin/restart',
    'GET /api/admin/storage/status',
    'GET /api/admin/storage/migrate-token',
    'POST /api/admin/storage/migrate',
    'POST /api/admin/storage/migrate/cancel',
    'POST /api/admin/storage/scan-directory',
    'GET /api/admin/storage/import-directory-token',
    'POST /api/admin/storage/import-directory',
    'GET /api/admin/providers/availability',
];

describe('Admin Routes Composition', () => {
    let dataDir: string;
    let options: AdminRouteOptions;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-routes-comp-'));
        options = { store: new FileProcessStore({ dataDir }), dataDir };
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('registers exactly the expected admin routes', () => {
        const routes: Route[] = [];
        registerAdminRoutes(routes, options);

        expect(routes).toHaveLength(EXPECTED_ROUTES.length);
        expect(new Set(routes.map(routeKey))).toEqual(new Set(EXPECTED_ROUTES));
    });

    it('every registered route has an async handler', () => {
        const routes: Route[] = [];
        registerAdminRoutes(routes, options);
        for (const r of routes) {
            expect(typeof r.handler).toBe('function');
        }
    });

    it('composition equals the sum of the per-domain register functions', () => {
        const composed: Route[] = [];
        registerAdminRoutes(composed, options);

        const perDomain: Route[] = [];
        registerConfigRoutes(perDomain, options);
        registerDataRoutes(perDomain, options);
        registerPromptRoutes(perDomain, options);
        registerSystemRoutes(perDomain, options);
        registerStorageRoutes(perDomain, options);
        registerProviderRoutes(perDomain, options);

        expect(new Set(perDomain.map(routeKey))).toEqual(new Set(composed.map(routeKey)));
        expect(perDomain).toHaveLength(composed.length);
    });

    it('each domain module owns a disjoint slice of the route set', () => {
        const domains: Array<[string, (r: Route[], o: AdminRouteOptions) => void, number]> = [
            ['config', registerConfigRoutes, 2],
            ['data', registerDataRoutes, 7],
            ['prompt', registerPromptRoutes, 3],
            ['system', registerSystemRoutes, 2],
            ['storage', registerStorageRoutes, 7],
            ['provider', registerProviderRoutes, 1],
        ];
        const seen = new Set<string>();
        for (const [, register, count] of domains) {
            const routes: Route[] = [];
            register(routes, options);
            expect(routes).toHaveLength(count);
            for (const r of routes) {
                const key = routeKey(r);
                expect(seen.has(key)).toBe(false);
                seen.add(key);
            }
        }
        expect(seen.size).toBe(EXPECTED_ROUTES.length);
    });
});

describe('TokenManager', () => {
    it('generates a random token and reports TTL', () => {
        const mgr = new TokenManager(1234);
        expect(mgr.ttl).toBe(1234);
        const t = mgr.generate();
        expect(typeof t.token).toBe('string');
        expect(t.token.length).toBeGreaterThan(0);
        expect(mgr.activeToken?.token).toBe(t.token);
    });

    it('validates and consumes a token exactly once (one-time use)', () => {
        const mgr = new TokenManager();
        const { token } = mgr.generate();
        expect(mgr.validate(token)).toBe(true);
        // Consumed — a second validate fails.
        expect(mgr.validate(token)).toBe(false);
    });

    it('rejects an unknown token without consuming the active one', () => {
        const mgr = new TokenManager();
        const { token } = mgr.generate();
        expect(mgr.validate('not-the-token')).toBe(false);
        // The real token still validates.
        expect(mgr.validate(token)).toBe(true);
    });

    it('rejects an expired token', () => {
        const mgr = new TokenManager(-1); // already past TTL at creation
        const { token } = mgr.generate();
        expect(mgr.validate(token)).toBe(false);
    });

    it('reset() clears the active token', () => {
        const mgr = new TokenManager();
        mgr.generate();
        mgr.reset();
        expect(mgr.activeToken).toBeNull();
    });
});
