/**
 * @vitest-environment jsdom
 *
 * Tests for the shared provider brand visuals (`providerVisuals.tsx`) used by
 * the AI Provider admin page and the Dreams provider-activity section.
 *
 * Focus: the OpenCode brand icon. It must render the real OpenCode logomark
 * (white blocky "o" outline + gray inner block) rather than the old generic
 * placeholder, and `ProviderAvatar` must wire up the per-provider CSS class so
 * the `aip-avatar-opencode` dark backdrop applies.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
    PROVIDER_LABELS,
    PROVIDER_ICONS,
    ProviderAvatar,
} from '../../../../../src/server/spa/client/react/shared/providerVisuals';

afterEach(() => cleanup());

const ALL_PROVIDERS = ['copilot', 'codex', 'claude', 'opencode'] as const;

describe('providerVisuals registry', () => {
    it('exposes a label, icon, and avatar for every provider', () => {
        for (const provider of ALL_PROVIDERS) {
            expect(PROVIDER_LABELS[provider]).toBeTruthy();
            expect(typeof PROVIDER_ICONS[provider]).toBe('function');
        }
    });

    it('labels OpenCode as "OpenCode"', () => {
        expect(PROVIDER_LABELS.opencode).toBe('OpenCode');
    });
});

describe('ProviderAvatar', () => {
    it('applies the provider-specific avatar class for each provider', () => {
        for (const provider of ALL_PROVIDERS) {
            const { container } = render(<ProviderAvatar provider={provider} />);
            const avatar = container.querySelector('span.aip-avatar');
            expect(avatar).toBeTruthy();
            expect(avatar!.classList.contains(`aip-avatar-${provider}`)).toBe(true);
            // Each avatar renders exactly one inline SVG icon.
            expect(container.querySelectorAll('svg').length).toBe(1);
            cleanup();
        }
    });

    it('renders the real OpenCode logomark with its two-tone brand fills', () => {
        const { container } = render(<ProviderAvatar provider="opencode" />);
        const svg = container.querySelector('svg')!;
        expect(svg).toBeTruthy();
        // The official logomark uses a 512x512 viewBox.
        expect(svg.getAttribute('viewBox')).toBe('0 0 512 512');

        const fills = Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('fill'));
        // White outer "o" outline + gray inner block — the OpenCode brand colors.
        expect(fills).toContain('#fff');
        expect(fills).toContain('#5A5858');
    });

    it('no longer renders the old generic placeholder (24x24 currentColor circle)', () => {
        const { container } = render(<ProviderAvatar provider="opencode" />);
        const svg = container.querySelector('svg')!;
        // Old placeholder used a 0 0 24 24 viewBox and a single currentColor path.
        expect(svg.getAttribute('viewBox')).not.toBe('0 0 24 24');
        const fills = Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('fill'));
        expect(fills).not.toContain('currentColor');
    });
});
