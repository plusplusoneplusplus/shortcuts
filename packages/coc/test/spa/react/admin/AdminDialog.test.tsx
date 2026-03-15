/**
 * Regression tests for AdminDialog scrollability.
 *
 * Before the fix, AdminDialog wrapped AdminPanel in a custom
 * `overflow-y-auto max-h-[80vh]` div, which failed to scroll when
 * AdminPanel's content grew beyond 80vh because the Dialog's desktop
 * panel had no height constraint. The fix moves scroll responsibility
 * to the Dialog component itself (max-h-[90vh] overflow-hidden panel +
 * flex-1 min-h-0 overflow-y-auto content wrapper).
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AdminDialog } from '../../../../src/server/spa/client/react/admin/AdminDialog';
import { mockViewport } from '../../helpers/viewport-mock';

// Stub out all the fetch calls AdminPanel makes on mount
beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AdminDialog scrollability regression', () => {
    it('renders the dialog when open=true', () => {
        mockViewport(1280);
        const { unmount } = render(<AdminDialog open={true} onClose={vi.fn()} />);
        const dialog = document.getElementById('admin-dialog');
        expect(dialog).not.toBeNull();
        unmount();
    });

    it('does NOT render when open=false', () => {
        mockViewport(1280);
        const { unmount } = render(<AdminDialog open={false} onClose={vi.fn()} />);
        const dialog = document.getElementById('admin-dialog');
        expect(dialog).toBeNull();
        unmount();
    });

    it('AdminPanel is a direct child of the Dialog content wrapper (no extra scroll div wrapper)', () => {
        mockViewport(1280);
        const { unmount } = render(<AdminDialog open={true} onClose={vi.fn()} />);

        // The admin page content div rendered by AdminPanel
        const adminContent = document.getElementById('admin-page-content');
        expect(adminContent).not.toBeNull();

        // Walk up: adminContent → view-admin div → Dialog content wrapper
        // There should NOT be an intermediate "overflow-y-auto max-h-[80vh]" div between
        // the Dialog content wrapper and the AdminPanel root.
        const viewAdmin = adminContent!.parentElement;
        expect(viewAdmin).not.toBeNull();
        expect(viewAdmin!.id).toBe('view-admin');

        const contentWrapper = viewAdmin!.parentElement;
        expect(contentWrapper).not.toBeNull();
        // Content wrapper should be the Dialog's own content wrapper (has flex-1 min-h-0 overflow-y-auto)
        expect(contentWrapper!.className).toContain('overflow-y-auto');
        expect(contentWrapper!.className).toContain('flex-1');
        expect(contentWrapper!.className).toContain('min-h-0');

        unmount();
    });

    it('Dialog panel has max-h-[90vh] and overflow-hidden to constrain tall content', () => {
        mockViewport(1280);
        const { unmount } = render(<AdminDialog open={true} onClose={vi.fn()} />);

        const overlay = document.getElementById('admin-dialog') as HTMLElement;
        expect(overlay).not.toBeNull();
        const panel = overlay.querySelector(':scope > div') as HTMLElement;
        expect(panel).not.toBeNull();
        expect(panel.className).toContain('max-h-[90vh]');
        expect(panel.className).toContain('overflow-hidden');

        unmount();
    });

    it('Dialog content wrapper is the scroll container (overflow-y-auto) — regression: was missing on desktop', () => {
        // This is the specific regression that was introduced in commit 1c4b9b1e
        // when ProviderTokensSection was added and AdminPanel grew beyond 80vh.
        // Previously Dialog's desktop content wrapper lacked overflow-y-auto + flex-1 + min-h-0,
        // making the admin page unscrollable.
        mockViewport(1280);
        const { unmount } = render(<AdminDialog open={true} onClose={vi.fn()} />);

        const adminContent = document.getElementById('admin-page-content');
        expect(adminContent).not.toBeNull();
        // The scroll container is the Dialog content wrapper (grandparent of admin-page-content)
        const scrollContainer = adminContent!.parentElement!.parentElement as HTMLElement;
        expect(scrollContainer).not.toBeNull();
        expect(scrollContainer.className).toContain('overflow-y-auto');

        unmount();
    });
});
