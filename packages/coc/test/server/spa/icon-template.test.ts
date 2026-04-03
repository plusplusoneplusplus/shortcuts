/**
 * icon-template tests
 *
 * Covers:
 *   - hostnameToGradient: determinism, triadic spacing, full coverage of inputs
 *   - generateIconSvg: valid SVG, color injection, default fallback
 */

import { describe, it, expect } from 'vitest';
import { hostnameToGradient, generateIconSvg } from '../../../src/server/spa/icon-template';

// ============================================================================
// hostnameToGradient
// ============================================================================

describe('hostnameToGradient', () => {
    it('returns values in [0, 360)', () => {
        const cases = ['DESKTOP-ABC123', 'my-macbook-pro', 'dev-server-01', '', 'a', 'z'.repeat(200)];
        for (const h of cases) {
            const { hue1, hue2 } = hostnameToGradient(h);
            expect(hue1).toBeGreaterThanOrEqual(0);
            expect(hue1).toBeLessThan(360);
            expect(hue2).toBeGreaterThanOrEqual(0);
            expect(hue2).toBeLessThan(360);
        }
    });

    it('is deterministic for the same hostname', () => {
        const a = hostnameToGradient('my-machine');
        const b = hostnameToGradient('my-machine');
        expect(a).toEqual(b);
    });

    it('produces different results for different hostnames', () => {
        const a = hostnameToGradient('host-alpha');
        const b = hostnameToGradient('host-beta');
        expect(a).not.toEqual(b);
    });

    it('hue2 is always (hue1 + 120) % 360', () => {
        const hostnames = ['foo', 'bar', 'baz', 'WORKSTATION', 'ubuntu-devbox'];
        for (const h of hostnames) {
            const { hue1, hue2 } = hostnameToGradient(h);
            expect(hue2).toBe((hue1 + 120) % 360);
        }
    });

    it('handles empty string without throwing', () => {
        expect(() => hostnameToGradient('')).not.toThrow();
    });

    it('handles very long hostnames without throwing', () => {
        expect(() => hostnameToGradient('x'.repeat(1000))).not.toThrow();
    });
});

// ============================================================================
// generateIconSvg
// ============================================================================

describe('generateIconSvg', () => {
    it('returns a string containing SVG root element', () => {
        const svg = generateIconSvg('my-machine');
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('injects hostname-derived hsl colors', () => {
        const svg = generateIconSvg('my-machine');
        expect(svg).toMatch(/hsl\(\d+,75%,65%\)/);
    });

    it('uses default colors when no hostname is provided', () => {
        const svg = generateIconSvg();
        expect(svg).toContain('#58a6ff');
        expect(svg).toContain('#a371f7');
    });

    it('uses default colors when hostname is undefined', () => {
        const svg = generateIconSvg(undefined);
        expect(svg).toContain('#58a6ff');
    });

    it('produces different SVG for different hostnames', () => {
        const a = generateIconSvg('machine-alpha');
        const b = generateIconSvg('machine-beta');
        expect(a).not.toBe(b);
    });

    it('produces the same SVG for the same hostname (deterministic)', () => {
        const a = generateIconSvg('stable-host');
        const b = generateIconSvg('stable-host');
        expect(a).toBe(b);
    });

    it('SVG contains the two C arc paths', () => {
        const svg = generateIconSvg('test');
        // Outer C
        expect(svg).toContain('M 58 15 A 35 35');
        // Inner C
        expect(svg).toContain('M 48 30 A 20 20');
    });

    it('SVG contains a dark background rect', () => {
        const svg = generateIconSvg('test');
        expect(svg).toContain('#0d1117');
    });

    it('does not contain unresolved template placeholders', () => {
        const svg = generateIconSvg('my-host');
        expect(svg).not.toContain('${');
    });
});
