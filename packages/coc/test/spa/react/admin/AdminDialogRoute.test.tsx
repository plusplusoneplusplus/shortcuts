/**
 * AC-01/AC-02 — admin is an overlay dialog, not a page.
 *
 * Clicking the gear must open `#admin-dialog` over the current view without
 * unmounting it, and closing must restore the hash the user came from. The
 * underlying view is mocked with a mount counter so "stayed mounted" is
 * asserted directly rather than inferred from markup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';

import { mockViewport } from '../../helpers/viewport-mock';
import { renderWithProviders } from '../test-utils';

// ── Mocks: keep the test about wiring, not about the heavy real views ──

let reposMountCount = 0;

vi.mock('../../../../src/server/spa/client/react/repos', () => ({
    ReposView: () => {
        useEffect(() => {
            reposMountCount += 1;
        }, []);
        return <div data-testid="repos-view-stub">repos</div>;
    },
}));

vi.mock('../../../../src/server/spa/client/react/admin/AdminPanel', () => ({
    AdminPanel: () => <div id="view-admin">admin</div>,
}));

// The status dock only exists in the remote-first shell; turn it on so the
// AC-03 "exactly one dock" assertion has something to count.
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => true,
}));

// The cluster itself needs the full app-shell provider tree; this test is about
// how many docks are on screen, not what they contain.
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({
    StatusActions: () => <div data-testid="status-actions-stub" />,
}));

vi.mock('../../../../src/server/spa/client/react/wiki/WikiView', () => ({
    WikiView: () => <div data-testid="wiki-view-stub">wiki</div>,
}));

import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import { GlobalStatusDock } from '../../../../src/server/spa/client/react/layout/GlobalStatusDock';
import { AdminDialog } from '../../../../src/server/spa/client/react/admin/AdminDialog';
import { useAdminDialogRoute } from '../../../../src/server/spa/client/react/admin/useAdminDialogRoute';
import {
    ADMIN_SHELL_TABS,
    DEFAULT_NON_ADMIN_HASH,
    isAdminShellHash,
    isAdminShellTab,
    resolveAdminCloseHash,
} from '../../../../src/server/spa/client/react/admin/adminDialogRoute';

/** Minimal stand-in for App's shell: a gear, the router, and the dialog host. */
function Harness() {
    const admin = useAdminDialogRoute();
    return (
        <>
            <button data-testid="gear" onClick={() => { window.location.hash = '#admin'; }}>⚙</button>
            <Router />
            <AdminDialog open={admin.open} onClose={admin.close} />
        </>
    );
}

/**
 * Drive a hash change the way the browser does (assignment + hashchange).
 * Wrapped in `act` because the resulting router dispatch happens outside React's
 * event system, so without it the re-render hasn't flushed when we assert.
 */
function setHash(hash: string) {
    act(() => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
}

beforeEach(() => {
    reposMountCount = 0;
    window.location.hash = '';
    mockViewport(1280);
});

afterEach(() => {
    window.location.hash = '';
});

describe('adminDialogRoute (pure)', () => {
    it('claims admin plus every tool route the admin shell embeds', () => {
        expect([...ADMIN_SHELL_TABS].sort()).toEqual(
            ['admin', 'dreams-admin', 'logs', 'memory', 'servers', 'skills', 'stats'],
        );
    });

    it('isAdminShellTab only matches admin-shell tabs', () => {
        expect(isAdminShellTab('admin')).toBe(true);
        expect(isAdminShellTab('logs')).toBe(true);
        expect(isAdminShellTab('repos')).toBe(false);
        expect(isAdminShellTab(null)).toBe(false);
    });

    it('isAdminShellHash recognises admin deep links', () => {
        expect(isAdminShellHash('#admin')).toBe(true);
        expect(isAdminShellHash('#admin/settings/appearance')).toBe(true);
        expect(isAdminShellHash('#admin/database/processes?page=2')).toBe(true);
        expect(isAdminShellHash('#logs')).toBe(true);
        expect(isAdminShellHash('#repos/my-repo/chats')).toBe(false);
        expect(isAdminShellHash('')).toBe(false);
    });

    it('resolveAdminCloseHash restores the previous route, else the app default', () => {
        expect(resolveAdminCloseHash('#repos/my-repo/chats/t1')).toBe('#repos/my-repo/chats/t1');
        expect(resolveAdminCloseHash('repos/my-repo')).toBe('#repos/my-repo');
        // Cold deep link — nothing to go back to.
        expect(resolveAdminCloseHash('')).toBe(DEFAULT_NON_ADMIN_HASH);
        expect(resolveAdminCloseHash(null)).toBe(DEFAULT_NON_ADMIN_HASH);
        // Never bounce back into another admin hash.
        expect(resolveAdminCloseHash('#admin/settings')).toBe(DEFAULT_NON_ADMIN_HASH);
    });
});

describe('admin dialog routing', () => {
    it('gear click opens the dialog and leaves the underlying route mounted', () => {
        const { getByTestId, unmount } = renderWithProviders(<Harness />);

        expect(document.getElementById('admin-dialog')).toBeNull();
        expect(getByTestId('repos-view-stub')).toBeTruthy();
        expect(reposMountCount).toBe(1);

        fireEvent.click(getByTestId('gear'));
        act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });

        expect(document.getElementById('admin-dialog')).not.toBeNull();
        // AC-01: the page behind is still there, and was never remounted.
        expect(getByTestId('repos-view-stub')).toBeTruthy();
        expect(reposMountCount).toBe(1);

        unmount();
    });

    it('closing restores the hash the user came from', () => {
        setHash('#repos/my-repo/chats');
        const { getByTestId, unmount } = renderWithProviders(<Harness />);

        setHash('#admin/settings/appearance');
        expect(document.getElementById('admin-dialog')).not.toBeNull();

        fireEvent.click(getByTestId('dialog-close-btn'));
        expect(window.location.hash).toBe('#repos/my-repo/chats');

        unmount();
    });

    it('closing a cold deep link falls back to the default route', () => {
        setHash('#admin/database/processes?page=2');
        const { getByTestId, unmount } = renderWithProviders(<Harness />);

        expect(document.getElementById('admin-dialog')).not.toBeNull();
        // AC-02: no blank screen behind a cold deep link.
        expect(getByTestId('repos-view-stub')).toBeTruthy();

        fireEvent.click(getByTestId('dialog-close-btn'));
        expect(window.location.hash).toBe(DEFAULT_NON_ADMIN_HASH);

        unmount();
    });

    it('every admin-shell tool hash opens the dialog over the page', () => {
        const { getByTestId, unmount } = renderWithProviders(<Harness />);

        for (const hash of ['#memory', '#skills', '#logs', '#stats', '#servers', '#dreams-admin']) {
            setHash(hash);
            expect(document.getElementById('admin-dialog'), `${hash} should open the dialog`).not.toBeNull();
            expect(getByTestId('repos-view-stub')).toBeTruthy();
        }
        expect(reposMountCount).toBe(1);

        unmount();
    });

    it('Escape closes the dialog', () => {
        setHash('#repos/my-repo/chats');
        const { unmount } = renderWithProviders(<Harness />);

        setHash('#admin');
        expect(document.getElementById('admin-dialog')).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(window.location.hash).toBe('#repos/my-repo/chats');

        unmount();
    });

    it('keeps exactly one status dock on screen while the dialog is open (AC-03)', () => {
        // The page behind the dialog owns the dock now; the admin sidebar docks
        // none (see AdminPanel-status-footer). Standing the global dock down on
        // admin hashes — as it used to — would leave the page with none at all.
        setHash('#repos');
        const { queryAllByTestId, unmount } = renderWithProviders(
            <>
                <Harness />
                <GlobalStatusDock />
            </>,
        );

        expect(queryAllByTestId('global-status-dock')).toHaveLength(1);
        setHash('#admin/settings/appearance');
        expect(document.getElementById('admin-dialog')).not.toBeNull();
        expect(queryAllByTestId('global-status-dock')).toHaveLength(1);

        unmount();
    });

    it('the Router no longer renders the admin shell as a page', () => {
        setHash('#admin');
        const { unmount } = renderWithProviders(<Router />);

        expect(document.getElementById('view-admin')).toBeNull();
        expect(document.querySelector('[data-testid="repos-view-stub"]')).not.toBeNull();

        unmount();
    });
});
