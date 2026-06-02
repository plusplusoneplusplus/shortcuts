/**
 * Tests for ServerCard component and its uptime/timeAgo helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
    ServerCard,
    formatUptime,
    timeAgo,
    type ServerCardHealth,
} from '../../../../../src/server/spa/client/react/features/servers/ServerCard';

const REMOTE_BASE: ServerCardHealth = {
    server: { id: 'r1', kind: 'url', label: 'dev-vm', url: 'https://dev.example.com', addedAt: 1, updatedAt: 1 },
    status: 'online',
    version: '1.2.3',
    uptime: 3661,
    processCount: 5,
    serverName: 'dev-host',
    lastChecked: Date.now(),
};

const LOCAL_BASE: ServerCardHealth = {
    server: { id: 'local', label: 'This Server', url: '' },
    status: 'online',
    uptime: 60,
    processCount: 1,
    version: '1.2.3',
};

const DEVTUNNEL_BASE: ServerCardHealth = {
    server: {
        id: 'd1',
        kind: 'devtunnel',
        label: 'remote-vm',
        tunnelId: 'my-remote-coc',
        effectiveUrl: 'http://127.0.0.1:4000',
        localPort: 4000,
        addedAt: 1,
        updatedAt: 1,
    },
    status: 'online',
    effectiveUrl: 'http://127.0.0.1:4000',
    localPort: 4000,
};

const DEVTUNNEL_WITH_PUBLIC_URL: ServerCardHealth = {
    server: {
        id: 'd2',
        kind: 'devtunnel',
        label: 'remote-vm-public',
        tunnelId: 'my-remote-coc',
        effectiveUrl: 'http://127.0.0.1:4000',
        localPort: 4000,
        addedAt: 1,
        updatedAt: 1,
    },
    status: 'online',
    effectiveUrl: 'http://127.0.0.1:4000',
    localPort: 4000,
    publicUrl: 'https://my-remote-coc-4000.usw2.devtunnels.ms',
};

const SSH_BASE: ServerCardHealth = {
    server: {
        id: 's1',
        kind: 'ssh',
        label: 'ubuntu-arm',
        host: 'ubuntu-arm',
        localPort: 4000,
        addedAt: 1,
        updatedAt: 1,
    },
    status: 'online',
    effectiveUrl: 'http://127.0.0.1:4000',
    localPort: 4000,
};

afterEach(() => {
    cleanup();
});

describe('formatUptime', () => {
    it('renders 1d 1h 1m for 90061 seconds', () => {
        expect(formatUptime(90061)).toBe('1d 1h 1m');
    });

    it('renders only minutes when below an hour', () => {
        expect(formatUptime(540)).toBe('9m');
    });

    it('renders hours and minutes when below a day', () => {
        expect(formatUptime(3661)).toBe('1h 1m');
    });

    it('shows 0m for zero seconds', () => {
        expect(formatUptime(0)).toBe('0m');
    });

    it('clamps negative input to 0m', () => {
        expect(formatUptime(-5)).toBe('0m');
    });
});

describe('timeAgo', () => {
    const NOW = 1_700_000_000_000;

    it('formats seconds when below a minute', () => {
        expect(timeAgo(NOW - 30_000, NOW)).toBe('30s ago');
    });

    it('formats minutes when below an hour', () => {
        expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    });

    it('formats hours otherwise', () => {
        expect(timeAgo(NOW - 3 * 60 * 60_000, NOW)).toBe('3h ago');
    });

    it('clamps negative diffs to 0s ago', () => {
        expect(timeAgo(NOW + 1000, NOW)).toBe('0s ago');
    });
});

describe('ServerCard — status dot', () => {
    it('renders green dot when online', () => {
        render(<ServerCard health={{ ...REMOTE_BASE, status: 'online' }} isLocal={false} />);
        const dot = screen.getByTestId('server-status-dot');
        expect(dot.className).toContain('bg-[#16c060]');
    });

    it('renders red dot when offline', () => {
        render(<ServerCard health={{ ...REMOTE_BASE, status: 'offline' }} isLocal={false} />);
        const dot = screen.getByTestId('server-status-dot');
        expect(dot.className).toContain('bg-[#f14c4c]');
    });

    it('renders yellow pulsing dot when checking', () => {
        render(<ServerCard health={{ ...REMOTE_BASE, status: 'checking' }} isLocal={false} />);
        const dot = screen.getByTestId('server-status-dot');
        expect(dot.className).toContain('bg-[#e5a92b]');
        expect(dot.className).toContain('animate-pulse');
    });
});

describe('ServerCard — local vs remote footer', () => {
    it('local card shows "Current — You\'re here" and no menu button', () => {
        render(<ServerCard health={LOCAL_BASE} isLocal={true} />);
        expect(screen.getByTestId('server-card-current-label').textContent).toContain("Current");
        expect(screen.queryByTestId('server-card-menu-btn')).toBeNull();
        expect(screen.queryByTestId('server-card-open-link')).toBeNull();
    });

    it('remote card shows "Open Dashboard →" link with correct href', () => {
        render(<ServerCard health={REMOTE_BASE} isLocal={false} />);
        const link = screen.getByTestId('server-card-open-link') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('https://dev.example.com');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('DevTunnel card opens the effective local endpoint', () => {
        render(<ServerCard health={DEVTUNNEL_BASE} isLocal={false} />);
        const link = screen.getByTestId('server-card-open-link') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('http://127.0.0.1:4000');
    });

    it('DevTunnel card disables Open Dashboard when no endpoint is available', () => {
        render(<ServerCard health={{
            ...DEVTUNNEL_BASE,
            effectiveUrl: undefined,
            server: {
                id: 'd1',
                kind: 'devtunnel',
                label: 'remote-vm',
                tunnelId: 'my-remote-coc',
                addedAt: 1,
                updatedAt: 1,
            },
        }} isLocal={false} />);
        expect(screen.queryByTestId('server-card-open-link')).toBeNull();
        expect(screen.getByTestId('server-card-open-unavailable').textContent).toContain('Endpoint unavailable');
    });

    it('remote card renders ⋮ button which toggles menu', () => {
        render(<ServerCard health={REMOTE_BASE} isLocal={false} />);
        const btn = screen.getByTestId('server-card-menu-btn');
        expect(screen.queryByTestId('server-card-menu')).toBeNull();
        fireEvent.click(btn);
        expect(screen.getByTestId('server-card-menu')).toBeTruthy();
        expect(screen.getByText('Edit server')).toBeTruthy();
        expect(screen.getByText('Copy URL')).toBeTruthy();
        expect(screen.getByText('Remove')).toBeTruthy();
    });
});

describe('ServerCard — menu actions', () => {
    it('Remove menu item calls onRemove with the server id and closes the menu', () => {
        const onRemove = vi.fn();
        render(<ServerCard health={REMOTE_BASE} isLocal={false} onRemove={onRemove} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-remove'));
        expect(onRemove).toHaveBeenCalledWith('r1');
        expect(screen.queryByTestId('server-card-menu')).toBeNull();
    });

    it('Edit menu item calls onEdit with the server id and closes the menu', () => {
        const onEdit = vi.fn();
        render(<ServerCard health={REMOTE_BASE} isLocal={false} onEdit={onEdit} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-edit'));
        expect(onEdit).toHaveBeenCalledWith('r1');
        expect(screen.queryByTestId('server-card-menu')).toBeNull();
    });

    it('Copy URL menu item writes the URL to navigator.clipboard', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const original = (navigator as any).clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
            writable: true,
        });
        try {
            render(<ServerCard health={REMOTE_BASE} isLocal={false} />);
            fireEvent.click(screen.getByTestId('server-card-menu-btn'));
            fireEvent.click(screen.getByTestId('server-card-menu-copy'));
            expect(writeText).toHaveBeenCalledWith('https://dev.example.com');
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                value: original,
                configurable: true,
                writable: true,
            });
        }
    });

    it('does not throw when clipboard is unavailable', () => {
        const original = (navigator as any).clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined,
            configurable: true,
            writable: true,
        });
        try {
            render(<ServerCard health={REMOTE_BASE} isLocal={false} />);
            fireEvent.click(screen.getByTestId('server-card-menu-btn'));
            expect(() => fireEvent.click(screen.getByTestId('server-card-menu-copy'))).not.toThrow();
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                value: original,
                configurable: true,
                writable: true,
            });
        }
    });

    it('shows Reconnect menu item for SSH servers and calls onReconnect', () => {
        const onReconnect = vi.fn();
        render(<ServerCard health={SSH_BASE} isLocal={false} onReconnect={onReconnect} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        fireEvent.click(screen.getByTestId('server-card-menu-reconnect'));
        expect(onReconnect).toHaveBeenCalledWith('s1');
        expect(screen.queryByTestId('server-card-menu')).toBeNull();
    });

    it('shows Reconnect menu item for DevTunnel servers', () => {
        const onReconnect = vi.fn();
        render(<ServerCard health={DEVTUNNEL_BASE} isLocal={false} onReconnect={onReconnect} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        expect(screen.getByTestId('server-card-menu-reconnect')).toBeTruthy();
    });

    it('does not show Reconnect menu item for URL servers', () => {
        const onReconnect = vi.fn();
        render(<ServerCard health={REMOTE_BASE} isLocal={false} onReconnect={onReconnect} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        expect(screen.queryByTestId('server-card-menu-reconnect')).toBeNull();
    });

    it('disables the SSH Reconnect menu item while reconnecting', () => {
        render(<ServerCard health={SSH_BASE} isLocal={false} onReconnect={vi.fn()} reconnecting />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        const btn = screen.getByTestId('server-card-menu-reconnect') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toContain('Reconnecting');
    });

    it('closes menu on outside mousedown', () => {        render(
            <div>
                <button data-testid="outside">outside</button>
                <ServerCard health={REMOTE_BASE} isLocal={false} />
            </div>
        );
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        expect(screen.getByTestId('server-card-menu')).toBeTruthy();
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(screen.queryByTestId('server-card-menu')).toBeNull();
    });
});

describe('ServerCard — stats rendering', () => {
    it('renders process count, uptime, and version when defined', () => {
        render(<ServerCard health={REMOTE_BASE} isLocal={false} />);
        expect(screen.getByTestId('server-card-process-count').textContent).toContain('5');
        expect(screen.getByTestId('server-card-process-count').textContent).toContain('processes');
        expect(screen.getByTestId('server-card-uptime').textContent).toContain('1h 1m');
        expect(screen.getByTestId('server-card-version').textContent).toContain('v1.2.3');
        expect(screen.getByTestId('server-card-hostname').textContent).toContain('CoC @ dev-host');
    });

    it('uses singular "process" when count is exactly 1', () => {
        render(<ServerCard health={{ ...REMOTE_BASE, processCount: 1 }} isLocal={false} />);
        const text = screen.getByTestId('server-card-process-count').textContent ?? '';
        expect(text).toContain('1 process');
        expect(text).not.toContain('processes');
    });

    it('omits stats rows when corresponding fields are undefined', () => {
        const minimal: ServerCardHealth = {
            server: { id: 'm', kind: 'url', label: 'Minimal', url: 'https://m.example.com', addedAt: 1, updatedAt: 1 },
            status: 'checking',
        };
        render(<ServerCard health={minimal} isLocal={false} />);
        expect(screen.queryByTestId('server-card-process-count')).toBeNull();
        expect(screen.queryByTestId('server-card-uptime')).toBeNull();
        expect(screen.queryByTestId('server-card-version')).toBeNull();
        expect(screen.queryByTestId('server-card-hostname')).toBeNull();
    });

    it('renders direct URL and DevTunnel metadata', () => {
        render(<ServerCard health={REMOTE_BASE} isLocal={false} />);
        expect(screen.getByTestId('server-card-url').textContent).toContain('https://dev.example.com');
        cleanup();

        render(<ServerCard health={DEVTUNNEL_BASE} isLocal={false} />);
        expect(screen.getByTestId('server-card-tunnel-id').textContent).toContain('my-remote-coc');
        expect(screen.getByTestId('server-card-local-port').textContent).toContain('localhost:4000');
        expect(screen.getByTestId('server-card-effective-url').textContent).toContain('http://127.0.0.1:4000');
    });

    it('shows "Last seen" only when offline with a lastChecked timestamp', () => {
        const offline: ServerCardHealth = {
            ...REMOTE_BASE,
            status: 'offline',
            lastChecked: Date.now() - 90_000,
        };
        render(<ServerCard health={offline} isLocal={false} />);
        expect(screen.getByTestId('server-card-last-seen').textContent).toContain('Last seen');

        cleanup();
        const online: ServerCardHealth = { ...REMOTE_BASE, status: 'online' };
        render(<ServerCard health={online} isLocal={false} />);
        expect(screen.queryByTestId('server-card-last-seen')).toBeNull();
    });
});

describe('ServerCard — public URL', () => {
    it('renders public URL row with link when publicUrl is present', () => {
        render(<ServerCard health={DEVTUNNEL_WITH_PUBLIC_URL} isLocal={false} />);
        const row = screen.getByTestId('server-card-public-url');
        expect(row.textContent).toContain('Public:');
        const link = row.querySelector('a') as HTMLAnchorElement;
        expect(link).toBeTruthy();
        expect(link.getAttribute('href')).toBe('https://my-remote-coc-4000.usw2.devtunnels.ms');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('does not render public URL row when publicUrl is absent', () => {
        render(<ServerCard health={DEVTUNNEL_BASE} isLocal={false} />);
        expect(screen.queryByTestId('server-card-public-url')).toBeNull();
    });

    it('shows "Copy public URL" menu item when publicUrl is present', () => {
        render(<ServerCard health={DEVTUNNEL_WITH_PUBLIC_URL} isLocal={false} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        expect(screen.getByTestId('server-card-menu-copy-public')).toBeTruthy();
        expect(screen.getByTestId('server-card-menu-copy-public').textContent).toBe('Copy public URL');
    });

    it('hides "Copy public URL" menu item when publicUrl is absent', () => {
        render(<ServerCard health={DEVTUNNEL_BASE} isLocal={false} />);
        fireEvent.click(screen.getByTestId('server-card-menu-btn'));
        expect(screen.queryByTestId('server-card-menu-copy-public')).toBeNull();
    });

    it('Copy public URL writes the public URL to navigator.clipboard', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const original = (navigator as any).clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
            writable: true,
        });
        try {
            render(<ServerCard health={DEVTUNNEL_WITH_PUBLIC_URL} isLocal={false} />);
            fireEvent.click(screen.getByTestId('server-card-menu-btn'));
            fireEvent.click(screen.getByTestId('server-card-menu-copy-public'));
            expect(writeText).toHaveBeenCalledWith('https://my-remote-coc-4000.usw2.devtunnels.ms');
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                value: original,
                configurable: true,
                writable: true,
            });
        }
    });
});

beforeEach(() => {
    cleanup();
});
