/**
 * SPA ETag / Cache-Busting Tests — getBundleETag
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

// We test getBundleETag by importing the real module, which reads actual bundle files.
// The real bundles exist at build time, so these tests run after `npm run build`.

describe('getBundleETag', () => {
    // Import fresh module for each test to reset cached state
    let getBundleETag: () => string;

    beforeEach(async () => {
        // Clear module cache to get a fresh import with reset static state
        vi.resetModules();
        const mod = await import('../../src/server/spa/html-template');
        getBundleETag = mod.getBundleETag;
    });

    it('returns a quoted string (RFC 7232 format)', () => {
        const etag = getBundleETag();
        expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    });

    it('returns the same value on repeated calls (cache hit)', () => {
        const etag1 = getBundleETag();
        const etag2 = getBundleETag();
        expect(etag1).toBe(etag2);
    });

    it('is a 16-char hex SHA-256 prefix', () => {
        const etag = getBundleETag();
        // Strip quotes
        const hex = etag.slice(1, -1);
        expect(hex).toHaveLength(16);
        expect(hex).toMatch(/^[0-9a-f]+$/);
    });
});

describe('getBundleETag in generateDashboardHtml', () => {
    it('injects version into __DASHBOARD_CONFIG__', async () => {
        const { generateDashboardHtml } = await import('../../src/server/spa/html-template');
        const html = generateDashboardHtml();
        expect(html).toContain("version: '");
        // The version value has its quotes HTML-escaped by escapeHtml
        const match = html.match(/version:\s*'(&quot;[0-9a-f]{16}&quot;)'/);
        expect(match).not.toBeNull();
    });

    it('version matches getBundleETag() (HTML-escaped)', async () => {
        const { generateDashboardHtml, getBundleETag } = await import('../../src/server/spa/html-template');
        const etag = getBundleETag();
        const html = generateDashboardHtml();
        // escapeHtml converts " to &quot;
        const escaped = etag.replace(/"/g, '&quot;');
        expect(html).toContain(`version: '${escaped}'`);
    });
});
