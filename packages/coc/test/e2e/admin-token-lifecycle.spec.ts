/**
 * Admin Token Lifecycle E2E Tests
 *
 * Coverage gap: admin.spec.ts only tests the two-step wipe UI flow and
 * mocked failure scenarios. No test exercises the real token lifecycle:
 *   - Token one-time use (consumed after first valid DELETE)
 *   - New token invalidates the previous token
 *   - Expired token rejected with 403
 *
 * Token TTL tests require the server to be created with a short TTL
 * (via options.tokenTtlMs), which was added specifically to support this.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedProcess, request } from './fixtures/seed';

// ============================================================================
// Area 2 — Token One-Time Use
// ============================================================================

test.describe('Admin token — one-time use', () => {
    test('wipe token is consumed after first use; second DELETE with same token returns 403', async ({ serverUrl }) => {
        await seedProcess(serverUrl, 'token-otu-proc', { status: 'completed' });

        // Obtain a real wipe token via the API
        const tokenRes = await request(`${serverUrl}/api/admin/data/wipe-token`);
        expect(tokenRes.status).toBe(200);
        const { token } = JSON.parse(tokenRes.body);
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);

        // First DELETE should succeed (token is valid and not yet consumed)
        const wipe1 = await request(`${serverUrl}/api/admin/data?confirm=${token}`, { method: 'DELETE' });
        expect(wipe1.status).toBe(200);

        // Second DELETE with the SAME token should be rejected — token was consumed
        const wipe2 = await request(`${serverUrl}/api/admin/data?confirm=${token}`, { method: 'DELETE' });
        expect(wipe2.status).toBe(403);
        expect(JSON.parse(wipe2.body).error).toMatch(/invalid or expired/i);
    });
});

// ============================================================================
// Area 2 — New Token Invalidates Previous
// ============================================================================

test.describe('Admin token — new token invalidates previous', () => {
    test('generating a second token makes the first token invalid', async ({ serverUrl }) => {
        await seedProcess(serverUrl, 'token-invalidate-proc', { status: 'completed' });

        // Generate token A
        const resA = await request(`${serverUrl}/api/admin/data/wipe-token`);
        const { token: tokenA } = JSON.parse(resA.body);

        // Generate token B — this REPLACES token A in the server's single-slot manager
        const resB = await request(`${serverUrl}/api/admin/data/wipe-token`);
        const { token: tokenB } = JSON.parse(resB.body);

        expect(tokenA).not.toBe(tokenB);

        // Token A is now stale — should return 403
        const wipeA = await request(`${serverUrl}/api/admin/data?confirm=${tokenA}`, { method: 'DELETE' });
        expect(wipeA.status).toBe(403);

        // Token B is the active one — should succeed
        const wipeB = await request(`${serverUrl}/api/admin/data?confirm=${tokenB}`, { method: 'DELETE' });
        expect(wipeB.status).toBe(200);
    });
});

// ============================================================================
// Area 2 — Expired Token Rejected
// ============================================================================

test.describe('Admin token — expiry', () => {
    test('token is rejected with 403 after TTL expires', async () => {
        // Create a dedicated short-TTL server (200 ms) outside the shared fixture
        const { createExecutionServer } = require('../../dist/server/index');
        const { FileProcessStore } = require('@plusplusoneplusplus/pipeline-core');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-token-ttl-'));
        const store = new FileProcessStore({ dataDir: tmpDir });

        const server = await createExecutionServer({
            store,
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
            tokenTtlMs: 200, // 200 ms — expires quickly for the test
        });

        try {
            const serverUrl: string = server.url;

            // Obtain a token from the short-TTL server
            const tokenRes = await request(`${serverUrl}/api/admin/data/wipe-token`);
            expect(tokenRes.status).toBe(200);
            const tokenBody = JSON.parse(tokenRes.body);
            const { token } = tokenBody;
            // The server reports a short expiresIn
            expect(tokenBody.expiresIn).toBeCloseTo(0.2, 1);

            // Wait longer than the TTL for the token to expire
            await new Promise(r => setTimeout(r, 350));

            // The expired token should be rejected
            const wipeRes = await request(`${serverUrl}/api/admin/data?confirm=${token}`, { method: 'DELETE' });
            expect(wipeRes.status).toBe(403);
            expect(JSON.parse(wipeRes.body).error).toMatch(/invalid or expired/i);
        } finally {
            await server.close();
            safeRmSync(tmpDir);
        }
    });
});

// ============================================================================
// Area 2 — Missing Token Returns 400 (not 403)
// ============================================================================

test.describe('Admin token — missing token handling', () => {
    test('DELETE without confirm token returns 400', async ({ serverUrl }) => {
        const res = await request(`${serverUrl}/api/admin/data`, { method: 'DELETE' });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/confirmation token/i);
    });

    test('GET wipe-token response includes expiresIn field', async ({ serverUrl }) => {
        const res = await request(`${serverUrl}/api/admin/data/wipe-token`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(typeof body.token).toBe('string');
        expect(typeof body.expiresIn).toBe('number');
        expect(body.expiresIn).toBeGreaterThan(0);
    });
});

// ============================================================================
// Area 2 — UI: Wipe flow shows confirm/cancel after token generation
// ============================================================================

test.describe('Admin token — UI display after generation', () => {
    test('clicking Wipe Data triggers token fetch and shows confirm/cancel buttons', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        await page.click('#admin-toggle');
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#admin-page-content')).not.toBeEmpty({ timeout: 5_000 });

        // Initially no confirm/cancel buttons
        await expect(page.locator('#admin-wipe-confirm')).toHaveCount(0);
        await expect(page.locator('#admin-wipe-cancel')).toHaveCount(0);

        // Track that the wipe-token API is actually called (token was generated)
        const tokenRequest = page.waitForRequest(req =>
            req.url().includes('/admin/data/wipe-token'),
        );

        await page.click('#admin-wipe-btn');

        // Server must have been called for a real token
        await tokenRequest;

        // Confirm and cancel buttons appear after token is obtained
        await expect(page.locator('#admin-wipe-confirm')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('#admin-wipe-cancel')).toBeVisible();
    });
});
