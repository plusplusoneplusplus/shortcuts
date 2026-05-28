/**
 * @vitest-environment jsdom
 * Tests for ProviderBadge — rendering for copilot, codex, and claude metadata.
 *
 * Visual contract:
 *  - Renders as a rounded-full pill with a leading colored dot, mirroring the
 *    "Thinking" `ChatStatusPill` style.
 *  - Provider-specific brand palette: Copilot=green, Claude=orange/coral,
 *    Codex=indigo/blue-purple.
 *  - `data-provider` attribute + `Agent: <Label>` title are stable for tests
 *    and tooling.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderBadge, getProviderAvatarClasses, getProviderDotClasses } from '../../../../../src/server/spa/client/react/features/chat/ProviderBadge';

describe('ProviderBadge', () => {
    describe('rendering', () => {
        it('renders "Codex" label for codex provider', () => {
            render(<ProviderBadge provider="codex" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.textContent).toBe('Codex');
            expect(badge.getAttribute('data-provider')).toBe('codex');
        });

        it('renders "Claude" label for claude provider', () => {
            render(<ProviderBadge provider="claude" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.textContent).toBe('Claude');
            expect(badge.getAttribute('data-provider')).toBe('claude');
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

        it('has title attribute with provider name for claude', () => {
            render(<ProviderBadge provider="claude" />);
            expect(screen.getByTestId('provider-badge').getAttribute('title')).toBe('Agent: Claude');
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

    describe('pill style (mirrors ChatStatusPill / "Thinking" badge)', () => {
        it('renders a rounded-full pill with a leading dot', () => {
            const { container } = render(<ProviderBadge provider="copilot" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.className).toContain('rounded-full');
            expect(badge.className).toContain('border');
            // Leading dot — the first child span has the 6px×6px rounded dot.
            const dot = container.querySelector('span[aria-hidden="true"]');
            expect(dot).toBeTruthy();
            expect(dot!.className).toContain('w-[6px]');
            expect(dot!.className).toContain('h-[6px]');
            expect(dot!.className).toContain('rounded-full');
        });
    });

    describe('provider color palette', () => {
        it('copilot badge uses green (#16825d) accents', () => {
            const { container } = render(<ProviderBadge provider="copilot" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.className).toContain('16825d');
            const dot = container.querySelector('span[aria-hidden="true"]')!;
            expect(dot.className).toContain('16825d');
        });

        it('claude badge uses warm coral/orange (#d97757) accents', () => {
            const { container } = render(<ProviderBadge provider="claude" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.className).toContain('d97757');
            const dot = container.querySelector('span[aria-hidden="true"]')!;
            expect(dot.className).toContain('d97757');
        });

        it('codex badge uses indigo (#6366f1) accents', () => {
            const { container } = render(<ProviderBadge provider="codex" />);
            const badge = screen.getByTestId('provider-badge');
            expect(badge.className).toContain('6366f1');
            const dot = container.querySelector('span[aria-hidden="true"]')!;
            expect(dot.className).toContain('6366f1');
        });

        it('copilot badge does NOT carry emerald-tailwind tint (legacy)', () => {
            render(<ProviderBadge provider="copilot" />);
            // Old palette mistakenly applied emerald to codex; ensure we
            // didn't regress copilot to the same Tailwind keyword.
            const badge = screen.getByTestId('provider-badge');
            expect(badge.className).not.toContain('emerald');
        });
    });
});

describe('getProviderAvatarClasses', () => {
    it('returns the green palette for copilot', () => {
        const classes = getProviderAvatarClasses('copilot');
        expect(classes).toContain('15703a');
        expect(classes).toContain('dafbe1');
    });

    it('returns the coral/orange palette for claude', () => {
        const classes = getProviderAvatarClasses('claude');
        expect(classes).toContain('b5532c');
        expect(classes).toContain('fdece1');
    });

    it('returns the indigo palette for codex', () => {
        const classes = getProviderAvatarClasses('codex');
        expect(classes).toContain('4f46e5');
        expect(classes).toContain('eef0ff');
    });

    it('falls back to the copilot palette for undefined provider', () => {
        const classes = getProviderAvatarClasses(undefined);
        // Must equal the copilot palette so the legacy avatar look is
        // preserved when a chat has no provider metadata.
        expect(classes).toBe(getProviderAvatarClasses('copilot'));
    });
});

describe('getProviderDotClasses', () => {
    it('returns the green dot palette for copilot', () => {
        const classes = getProviderDotClasses('copilot');
        expect(classes).toContain('16825d');
        expect(classes).toContain('89d185');
    });

    it('returns the coral/orange dot palette for claude', () => {
        const classes = getProviderDotClasses('claude');
        expect(classes).toContain('d97757');
        expect(classes).toContain('f4a17d');
    });

    it('returns the indigo dot palette for codex', () => {
        const classes = getProviderDotClasses('codex');
        expect(classes).toContain('6366f1');
        expect(classes).toContain('a5b4fc');
    });

    it('falls back to the copilot dot palette for undefined provider', () => {
        expect(getProviderDotClasses(undefined)).toBe(getProviderDotClasses('copilot'));
    });

    it('falls back to the copilot dot palette for unknown runtime provider values', () => {
        expect(getProviderDotClasses('future-provider' as any)).toBe(getProviderDotClasses('copilot'));
    });
});
