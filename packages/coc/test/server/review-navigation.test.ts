/**
 * Review Navigation Tests
 *
 * Tests for the client-side SPA routing additions in core.ts
 * and the client modules (review-config, review-browser, review-editor).
 * These tests verify the bundled client JS contains the expected routing logic.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function getClientBundle(): string {
    const bundlePath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.js');
    return fs.readFileSync(bundlePath, 'utf8');
}

describe('Review SPA — Client Bundle', () => {
    it('contains review route detection for /review', () => {
        const bundle = getClientBundle();
        // The bundle should contain the route detection regex
        expect(bundle).toContain('/review/');
        expect(bundle).toContain('review-browser');
    });

    it('contains review-editor initialization', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('review-editor');
        expect(bundle).toContain('__REVIEW_CONFIG__');
    });

    it('contains rich markdown rendering functions', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('renderMarkdownContent');
        expect(bundle).toContain('renderSourceContent');
        expect(bundle).toContain('review-code-block');
    });

    it('contains comment CRUD actions', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('resolveComment');
        expect(bundle).toContain('deleteComment');
        expect(bundle).toContain('reopenComment');
        expect(bundle).toContain('addComment');
    });

    it('contains mode toggle logic', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('review-mode-review');
        expect(bundle).toContain('review-mode-source');
    });

    it('contains HttpTransport class', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('HttpTransport');
    });

    it('contains showPage function', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('showPage');
    });

    it('contains file browser init logic', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('review-browser-content');
        expect(bundle).toContain('review-file-card');
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

    it('contains review-config module with getReviewConfig', () => {
        const bundle = getClientBundle();
        // esbuild may rename exports, but the function body references __REVIEW_CONFIG__
        expect(bundle).toContain('getReviewConfig');
    });
});
