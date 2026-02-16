/**
 * SPA Navigation Tests
 *
 * Tests for the client-side SPA routing in core.ts.
 * These tests verify the bundled client JS contains the expected routing logic.
 *
 * Note: Review-specific bundle tests were removed when review initialization
 * was extracted from core.ts (004-remove-review-init).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function getClientBundle(): string {
    const bundlePath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.js');
    return fs.readFileSync(bundlePath, 'utf8');
}

describe('SPA — Client Bundle Navigation', () => {
    it('contains showPage function', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('showPage');
    });

    it('contains nav-link click interception', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('nav-link');
        expect(bundle).toContain('pushState');
    });

    it('contains popstate event handler', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('popstate');
    });

    it('does not contain review routing in core init', () => {
        const bundle = getClientBundle();
        expect(bundle).not.toContain('initFileBrowser');
        expect(bundle).not.toContain('initReviewEditor');
        expect(bundle).not.toContain('isReviewMode');
    });

    it('dashboard is the only page type in showPage', () => {
        // Read core.ts source directly to verify the type signature
        const corePath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'core.ts');
        const core = fs.readFileSync(corePath, 'utf8');
        expect(core).toContain("showPage(page: 'dashboard')");
        expect(core).not.toContain("'review-browser'");
        expect(core).not.toContain("'review-editor'");
    });
});
