/**
 * RemoteProviderBadge — unit tests for the hosting-provider logo/label rendering.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RemoteProviderBadge } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteProviderBadge';

afterEach(cleanup);

describe('RemoteProviderBadge', () => {
    it('renders the GitHub logo with an accessible label for GitHub remotes', () => {
        render(<RemoteProviderBadge normalizedUrl="github.com/acme/shortcuts" testId="badge" />);
        const badge = screen.getByTestId('badge');
        expect(badge.getAttribute('data-provider')).toBe('github');
        expect(badge.getAttribute('aria-label')).toBe('GitHub');
        expect(badge.getAttribute('title')).toBe('GitHub');
        expect(badge.getAttribute('role')).toBe('img');
        // Icon replaces the text keyword.
        expect(badge.textContent).toBe('');
        expect(badge.querySelector('svg')).not.toBeNull();
    });

    it('renders the Azure DevOps logo for ADO remotes', () => {
        render(<RemoteProviderBadge normalizedUrl="dev.azure.com/org/project/repo" testId="badge" />);
        const badge = screen.getByTestId('badge');
        expect(badge.getAttribute('data-provider')).toBe('ado');
        expect(badge.getAttribute('aria-label')).toBe('ADO');
        expect(badge.textContent).toBe('');
        expect(badge.querySelector('svg')).not.toBeNull();
    });

    it('falls back to the plain "Remote" text for unknown or missing remotes', () => {
        render(<RemoteProviderBadge normalizedUrl="gitlab.com/acme/repo" testId="badge" />);
        const badge = screen.getByTestId('badge');
        expect(badge.getAttribute('data-provider')).toBe('remote');
        expect(badge.textContent).toBe('Remote');
        // No logo for unknown providers.
        expect(badge.querySelector('svg')).toBeNull();
    });

    it('renders "Remote" text when the URL is null', () => {
        render(<RemoteProviderBadge normalizedUrl={null} testId="badge" />);
        const badge = screen.getByTestId('badge');
        expect(badge.getAttribute('data-provider')).toBe('remote');
        expect(badge.textContent).toBe('Remote');
    });

    it('honors a custom icon size', () => {
        render(<RemoteProviderBadge normalizedUrl="github.com/acme/shortcuts" iconSize={20} testId="badge" />);
        const svg = screen.getByTestId('badge').querySelector('svg');
        expect(svg?.getAttribute('width')).toBe('20');
        expect(svg?.getAttribute('height')).toBe('20');
    });

    it('applies the provided wrapper className', () => {
        render(<RemoteProviderBadge normalizedUrl="github.com/acme/shortcuts" className="my-wrapper" testId="badge" />);
        expect(screen.getByTestId('badge').className).toBe('my-wrapper');
    });
});
