/**
 * Tests that the PullRequestDetail markdown renderer strips mailto: links
 * while preserving HTTP/HTTPS links.
 *
 * These tests use the real Marked library (no mocks) to verify the
 * custom renderer behavior end-to-end.
 */

import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';

// Replicate the custom renderer from PullRequestDetail.tsx
const descRenderer = {
    link(href: string, _title: string | null | undefined, text: string) {
        if (href && /^mailto:/i.test(href)) {
            return `<span>${text}</span>`;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
};

const descMarked = new Marked({ gfm: true, breaks: true, renderer: descRenderer });

describe('PullRequestDetail mailto stripping', () => {
    it('renders bare email address as plain text (no mailto link)', () => {
        const html = String(descMarked.parse('Contact user@example.com for details'));
        expect(html).not.toContain('mailto:');
        expect(html).not.toContain('<a href="mailto:');
        expect(html).toContain('user@example.com');
    });

    it('renders explicit markdown mailto link as plain text', () => {
        const html = String(descMarked.parse('[Email me](mailto:user@example.com)'));
        expect(html).not.toContain('mailto:');
        expect(html).toContain('<span>Email me</span>');
    });

    it('preserves HTTP links as clickable anchors', () => {
        const html = String(descMarked.parse('Visit https://example.com for more'));
        expect(html).toContain('<a href="https://example.com"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it('handles mixed email and HTTP links correctly', () => {
        const md = 'Contact user@example.com or visit [site](https://example.com)';
        const html = String(descMarked.parse(md));
        // Email should be plain text
        expect(html).not.toContain('mailto:');
        expect(html).toContain('user@example.com');
        // HTTP link should remain clickable
        expect(html).toContain('<a href="https://example.com"');
    });

    it('handles MAILTO: with uppercase scheme', () => {
        const html = String(descMarked.parse('[Contact](MAILTO:User@Example.COM)'));
        expect(html).not.toContain('mailto:');
        expect(html).not.toContain('MAILTO:');
        expect(html).toContain('<span>Contact</span>');
    });
});
