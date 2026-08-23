/**
 * RemoteServerBadge — the tiny cloud marker shown on a picker group row whose
 * collection includes a clone from another CoC server.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RemoteServerBadge, remoteServerBadgeLabel } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteServerBadge';

afterEach(cleanup);

describe('remoteServerBadgeLabel', () => {
    it('names a single server', () => {
        expect(remoteServerBadgeLabel(['Dev Box'])).toBe('Includes a repo from remote server Dev Box');
    });

    it('joins several servers', () => {
        expect(remoteServerBadgeLabel(['alpha', 'zeta'])).toBe('Includes a repo from remote server alpha, zeta');
    });

    it('degrades to a generic label when no name is known', () => {
        expect(remoteServerBadgeLabel([])).toBe('Includes a repo from a remote server');
        expect(remoteServerBadgeLabel(['  '])).toBe('Includes a repo from a remote server');
    });
});

describe('RemoteServerBadge', () => {
    it('renders a glyph carrying the label as hover + accessible text', () => {
        render(<RemoteServerBadge servers={['devbox']} />);

        const badge = screen.getByTestId('remote-server-badge');
        expect(badge.getAttribute('title')).toBe('Includes a repo from remote server devbox');
        expect(badge.getAttribute('aria-label')).toBe('Includes a repo from remote server devbox');
        expect(badge.querySelector('svg')).toBeTruthy();
    });

    it('keeps the server name out of the visible row text', () => {
        render(<RemoteServerBadge servers={['devbox']} />);

        expect(screen.getByTestId('remote-server-badge').textContent).toBe('');
    });

    it('honors a testId override', () => {
        render(<RemoteServerBadge servers={[]} testId="custom-badge" />);

        expect(screen.getByTestId('custom-badge')).toBeTruthy();
    });
});
