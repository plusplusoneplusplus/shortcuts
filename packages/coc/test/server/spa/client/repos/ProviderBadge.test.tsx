/**
 * @vitest-environment jsdom
 * Tests for ProviderBadge — rendering for copilot, codex, and missing-provider metadata.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderBadge } from '../../../../../src/server/spa/client/react/features/chat/ProviderBadge';

describe('ProviderBadge', () => {
    describe('rendering', () => {
        it('renders "Codex" label for codex provider', () => {
            render(<ProviderBadge provider="codex" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.textContent).toBe('Codex');
            expect(badge.getAttribute('data-provider')).toBe('codex');
        });

        it('renders "Copilot" label for copilot provider', () => {
            render(<ProviderBadge provider="copilot" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.textContent).toBe('Copilot');
            expect(badge.getAttribute('data-provider')).toBe('copilot');
        });

        it('has title attribute with provider name for codex', () => {
            render(<ProviderBadge provider="codex" />);
            expect(screen.getByTestId('provider-badge').getAttribute('title')).toBe('Agent: Codex');
        });

        it('has title attribute with provider name for copilot', () => {
            render(<ProviderBadge provider="copilot" />);
            expect(screen.getByTestId('provider-badge').getAttribute('title')).toBe('Agent: Copilot');
        });

        it('applies custom className', () => {
            const { container } = render(<ProviderBadge provider="codex" className="my-custom-class" />);
            expect(container.querySelector('.my-custom-class')).toBeTruthy();
        });
    });

    describe('styling', () => {
        it('codex badge has emerald tint classes', () => {
            render(<ProviderBadge provider="codex" />);
            const badge = screen.getByTestId('provider-badge');
            // The badge should have emerald variant classes
            expect(badge.className).toContain('emerald');
        });

        it('copilot badge has neutral classes', () => {
            render(<ProviderBadge provider="copilot" />);
            const badge = screen.getByTestId('provider-badge');
            // The badge should NOT have emerald variant classes
            expect(badge.className).not.toContain('emerald');
        });
    });
});
