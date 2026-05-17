/**
 * @vitest-environment jsdom
 *
 * Tests for SecurityBanner — exposed-binding security warning shown
 * above the TopBar when the CoC server is bound to all interfaces.
 *
 * Covers:
 *   - isExposedBinding() / getBindAddress() helpers
 *   - Banner visibility for safe vs exposed bindings
 *   - Acknowledge dismisses the banner and persists in sessionStorage
 *   - sessionStorage acknowledgment is read on mount (simulates reload)
 *   - Copy button writes the safe restart command to the clipboard
 *   - Displays the configured bind address and current port
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

const ACK_KEY = 'coc:security-ack';

function setConfig(config: Record<string, unknown> | undefined): void {
    if (config === undefined) {
        delete (window as any).__DASHBOARD_CONFIG__;
    } else {
        (window as any).__DASHBOARD_CONFIG__ = config;
    }
}

async function importFresh() {
    vi.resetModules();
    const config = await import('../../../src/server/spa/client/react/utils/config');
    const banner = await import('../../../src/server/spa/client/react/layout/SecurityBanner');
    return { config, banner };
}

describe('config helpers — bindAddress / isExposedBinding', () => {
    beforeEach(() => {
        setConfig(undefined);
        window.sessionStorage.clear();
    });

    it('returns undefined and false when no bindAddress is provided', async () => {
        setConfig({ apiBasePath: '/api', wsPath: '/ws' });
        const { config } = await importFresh();
        expect(config.getBindAddress()).toBeUndefined();
        expect(config.isExposedBinding()).toBe(false);
    });

    it('treats 127.0.0.1 / localhost / specific IPs as safe', async () => {
        for (const addr of ['127.0.0.1', 'localhost', '192.168.1.5']) {
            setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: addr });
            const { config } = await importFresh();
            expect(config.isExposedBinding()).toBe(false);
        }
    });

    it('flags 0.0.0.0, ::, and [::] as exposed', async () => {
        for (const addr of ['0.0.0.0', '::', '[::]']) {
            setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: addr });
            const { config } = await importFresh();
            expect(config.isExposedBinding()).toBe(true);
            expect(config.getBindAddress()).toBe(addr);
        }
    });
});

describe('SecurityBanner component', () => {
    beforeEach(() => {
        setConfig(undefined);
        window.sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders nothing when binding is safe', async () => {
        setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: '127.0.0.1' });
        const { banner } = await importFresh();
        const { container } = render(<banner.SecurityBanner />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the alert when binding is exposed', async () => {
        setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: '0.0.0.0' });
        const { banner } = await importFresh();
        render(<banner.SecurityBanner />);
        const el = screen.getByTestId('security-banner');
        expect(el.getAttribute('role')).toBe('alert');
        expect(el.getAttribute('aria-live')).toBe('assertive');
        expect(el.textContent).toContain('Security Warning');
        expect(el.textContent).toContain('0.0.0.0');
    });

    it('hides after the user acknowledges and persists the choice', async () => {
        setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: '0.0.0.0' });
        const { banner } = await importFresh();
        const { container } = render(<banner.SecurityBanner />);
        fireEvent.click(screen.getByTestId('security-banner-ack'));
        expect(container.firstChild).toBeNull();
        expect(window.sessionStorage.getItem(ACK_KEY)).toBe('1');
    });

    it('does not render when sessionStorage already acknowledges (simulated reload)', async () => {
        window.sessionStorage.setItem(ACK_KEY, '1');
        setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: '0.0.0.0' });
        const { banner } = await importFresh();
        const { container } = render(<banner.SecurityBanner />);
        expect(container.firstChild).toBeNull();
    });

    it('re-renders the banner if sessionStorage is cleared (full reload after close)', async () => {
        window.sessionStorage.setItem(ACK_KEY, '1');
        setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: '0.0.0.0' });
        let mod = await importFresh();
        let result = render(<mod.banner.SecurityBanner />);
        expect(result.container.firstChild).toBeNull();
        result.unmount();

        window.sessionStorage.clear();
        mod = await importFresh();
        render(<mod.banner.SecurityBanner />);
        expect(screen.getByTestId('security-banner')).toBeTruthy();
    });

    it('copies the safe restart command to the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        setConfig({ apiBasePath: '/api', wsPath: '/ws', bindAddress: '0.0.0.0' });
        const { banner } = await importFresh();
        render(<banner.SecurityBanner />);
        const btn = screen.getByTestId('security-banner-copy');
        await act(async () => {
            fireEvent.click(btn);
        });
        expect(writeText).toHaveBeenCalledWith('coc serve --host 127.0.0.1');
        expect(btn.textContent).toContain('Copied');
    });
});
