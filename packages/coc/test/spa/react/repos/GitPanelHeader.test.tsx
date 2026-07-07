/**
 * Tests for GitPanelHeader — split action dropdown button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GitPanelHeader } from '../../../../src/server/spa/client/react/features/git/GitPanelHeader';

const defaultProps = {
    branch: 'main',
    ahead: 0,
    behind: 0,
    refreshing: false,
    onRefresh: vi.fn(),
};

function renderHeader(overrides: Partial<Parameters<typeof GitPanelHeader>[0]> = {}) {
    return render(<GitPanelHeader {...defaultProps} {...overrides} />);
}

// ── Basic rendering ────────────────────────────────────────────────────────────

describe('basic rendering', () => {
    it('renders branch pill with branch name', () => {
        renderHeader();
        expect(screen.getByTestId('git-branch-pill').textContent).toContain('main');
    });

    it('renders refresh button', () => {
        renderHeader();
        expect(screen.getByTestId('git-refresh-btn')).toBeTruthy();
    });

    it('does NOT render split button when no action handlers provided', () => {
        renderHeader();
        expect(screen.queryByTestId('git-sync-split-btn')).toBeNull();
    });

    it('renders split button when onPull is provided', () => {
        renderHeader({ onPull: vi.fn() });
        expect(screen.getByTestId('git-sync-split-btn')).toBeTruthy();
    });

    it('renders split button when only onFetch is provided', () => {
        renderHeader({ onFetch: vi.fn() });
        expect(screen.getByTestId('git-sync-split-btn')).toBeTruthy();
    });
});

// ── Redesigned layout (card-style split button + bordered branch pill) ────────

describe('redesigned layout', () => {
    it('branch pill uses bordered card styling', () => {
        renderHeader();
        const pill = screen.getByTestId('git-branch-pill');
        const cls = pill.className;
        expect(cls).toContain('rounded-full');
        expect(cls).toContain('border');
        expect(cls).toContain('font-mono');
    });

    it('sync-split renders a single bordered container around primary + chevron', () => {
        renderHeader({ onPull: vi.fn(), onFetch: vi.fn(), onPush: vi.fn() });
        const split = screen.getByTestId('git-sync-split-btn');
        const inner = split.querySelector('div');
        expect(inner).toBeTruthy();
        const innerCls = inner!.className;
        expect(innerCls).toContain('border');
        expect(innerCls).toContain('rounded-md');
        expect(innerCls).toContain('overflow-hidden');
        // Both action buttons sit inside the bordered shell, not stacked separately
        expect(inner!.querySelector('[data-testid="git-sync-primary-btn"]')).toBeTruthy();
        expect(inner!.querySelector('[data-testid="git-sync-dropdown-toggle"]')).toBeTruthy();
    });

    it('chevron toggle has an internal vertical separator (border-l)', () => {
        renderHeader({ onPull: vi.fn() });
        const chevron = screen.getByTestId('git-sync-dropdown-toggle');
        expect(chevron.className).toContain('border-l');
    });

    it('dropdown menu renders outside the overflow-hidden shell so it is not clipped', () => {
        renderHeader({ onPull: vi.fn(), onFetch: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        const dropdown = screen.getByTestId('git-sync-dropdown');
        const split = screen.getByTestId('git-sync-split-btn');
        // The dropdown is a child of the positioning wrapper, NOT of the overflow-hidden shell.
        const shell = split.querySelector('.overflow-hidden');
        expect(shell).toBeTruthy();
        expect(shell!.contains(dropdown)).toBe(false);
        expect(split.contains(dropdown)).toBe(true);
    });

    it('refresh button keeps its 24x24 icon-button styling', () => {
        renderHeader();
        const btn = screen.getByTestId('git-refresh-btn');
        const cls = btn.className;
        expect(cls).toContain('w-6');
        expect(cls).toContain('h-6');
        expect(cls).toContain('rounded-md');
    });
});

// ── Ahead/behind badge ─────────────────────────────────────────────────────────

describe('ahead/behind badge', () => {
    it('hides badge when both are 0', () => {
        renderHeader();
        expect(screen.queryByTestId('git-ahead-behind-badge')).toBeNull();
    });

    it('shows ahead count when ahead > 0', () => {
        renderHeader({ ahead: 3 });
        expect(screen.getByTestId('git-ahead-count').textContent).toBe('↑3');
    });

    it('shows behind count when behind > 0', () => {
        renderHeader({ behind: 2 });
        expect(screen.getByTestId('git-behind-count').textContent).toBe('↓2');
    });
});

// ── Dropdown toggle ────────────────────────────────────────────────────────────

describe('dropdown toggle', () => {
    it('dropdown is closed by default', () => {
        renderHeader({ onFetch: vi.fn(), onPull: vi.fn(), onPush: vi.fn() });
        expect(screen.queryByTestId('git-sync-dropdown')).toBeNull();
    });

    it('opens dropdown when chevron is clicked', () => {
        renderHeader({ onFetch: vi.fn(), onPull: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.getByTestId('git-sync-dropdown')).toBeTruthy();
    });

    it('closes dropdown on second chevron click', () => {
        renderHeader({ onFetch: vi.fn(), onPull: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.queryByTestId('git-sync-dropdown')).toBeNull();
    });

    it('closes dropdown on outside click', () => {
        renderHeader({ onFetch: vi.fn(), onPull: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.getByTestId('git-sync-dropdown')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('git-sync-dropdown')).toBeNull();
    });
});

// ── Dropdown items ─────────────────────────────────────────────────────────────

describe('dropdown items', () => {
    it('shows fetch, pull, push items when all handlers provided', () => {
        renderHeader({ onFetch: vi.fn(), onPull: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.getByTestId('git-fetch-btn')).toBeTruthy();
        expect(screen.getByTestId('git-pull-btn')).toBeTruthy();
        expect(screen.getByTestId('git-push-btn')).toBeTruthy();
    });

    it('omits fetch item when onFetch is not provided', () => {
        renderHeader({ onPull: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.queryByTestId('git-fetch-btn')).toBeNull();
        expect(screen.getByTestId('git-pull-btn')).toBeTruthy();
        expect(screen.getByTestId('git-push-btn')).toBeTruthy();
    });

    it('omits push item when onPush is not provided', () => {
        renderHeader({ onFetch: vi.fn(), onPull: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.getByTestId('git-fetch-btn')).toBeTruthy();
        expect(screen.getByTestId('git-pull-btn')).toBeTruthy();
        expect(screen.queryByTestId('git-push-btn')).toBeNull();
    });
});

// ── Action invocation ──────────────────────────────────────────────────────────

describe('action invocation', () => {
    it('primary button triggers onPull', () => {
        const onPull = vi.fn();
        renderHeader({ onPull });
        fireEvent.click(screen.getByTestId('git-sync-primary-btn'));
        expect(onPull).toHaveBeenCalledOnce();
    });

    it('clicking fetch in dropdown triggers onFetch and closes dropdown', () => {
        const onFetch = vi.fn();
        renderHeader({ onFetch, onPull: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        fireEvent.click(screen.getByTestId('git-fetch-btn'));
        expect(onFetch).toHaveBeenCalledOnce();
        expect(screen.queryByTestId('git-sync-dropdown')).toBeNull();
    });

    it('clicking pull in dropdown triggers onPull and closes dropdown', () => {
        const onPull = vi.fn();
        renderHeader({ onPull });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        fireEvent.click(screen.getByTestId('git-pull-btn'));
        expect(onPull).toHaveBeenCalledOnce();
        expect(screen.queryByTestId('git-sync-dropdown')).toBeNull();
    });

    it('clicking push in dropdown triggers onPush and closes dropdown', () => {
        const onPush = vi.fn();
        renderHeader({ onPull: vi.fn(), onPush });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        fireEvent.click(screen.getByTestId('git-push-btn'));
        expect(onPush).toHaveBeenCalledOnce();
        expect(screen.queryByTestId('git-sync-dropdown')).toBeNull();
    });
});

// ── Disabled state during operation ───────────────────────────────────────────

describe('disabled state', () => {
    it('disables primary button while fetching', () => {
        renderHeader({ onPull: vi.fn(), fetching: true });
        expect((screen.getByTestId('git-sync-primary-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables primary button while pulling', () => {
        renderHeader({ onPull: vi.fn(), pulling: true });
        expect((screen.getByTestId('git-sync-primary-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables primary button while pushing', () => {
        renderHeader({ onPull: vi.fn(), pushing: true });
        expect((screen.getByTestId('git-sync-primary-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables chevron button while actioning', () => {
        renderHeader({ onPull: vi.fn(), pulling: true });
        expect((screen.getByTestId('git-sync-dropdown-toggle') as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows spinner icon while actioning', () => {
        renderHeader({ onPull: vi.fn(), pulling: true });
        const primaryBtn = screen.getByTestId('git-sync-primary-btn');
        expect(primaryBtn.querySelector('.git-refresh-spin')).toBeTruthy();
    });

    it('disables refresh button while refreshing', () => {
        renderHeader({ refreshing: true });
        expect((screen.getByTestId('git-refresh-btn') as HTMLButtonElement).disabled).toBe(true);
    });

    it('spins refresh icon while refreshing', () => {
        renderHeader({ refreshing: true });
        const icon = screen.getByTestId('git-refresh-icon');
        expect(icon.getAttribute('class')).toContain('git-refresh-spin');
    });
});

// ── Last refreshed timestamp ──────────────────────────────────────────────────

describe('last refreshed timestamp', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does NOT render timestamp when lastRefreshedAt is null', () => {
        renderHeader({ lastRefreshedAt: null });
        expect(screen.queryByTestId('git-last-refreshed')).toBeNull();
    });

    it('does NOT render timestamp when lastRefreshedAt is undefined', () => {
        renderHeader();
        expect(screen.queryByTestId('git-last-refreshed')).toBeNull();
    });

    it('renders "just now" when lastRefreshedAt is recent', () => {
        vi.setSystemTime(new Date('2026-04-02T12:00:00Z'));
        renderHeader({ lastRefreshedAt: Date.now() - 5_000 });
        const el = screen.getByTestId('git-last-refreshed');
        expect(el.textContent).toBe('just now');
    });

    it('renders relative time for older timestamps', () => {
        vi.setSystemTime(new Date('2026-04-02T12:00:00Z'));
        renderHeader({ lastRefreshedAt: Date.now() - 5 * 60_000 });
        const el = screen.getByTestId('git-last-refreshed');
        expect(el.textContent).toBe('5m ago');
    });

    it('shows full datetime as tooltip', () => {
        const ts = Date.now();
        renderHeader({ lastRefreshedAt: ts });
        const el = screen.getByTestId('git-last-refreshed');
        expect(el.getAttribute('title')).toBe(new Date(ts).toLocaleString());
    });

    it('live-updates the displayed text every 30 seconds', () => {
        vi.setSystemTime(new Date('2026-04-02T12:00:00Z'));
        const ts = Date.now();
        renderHeader({ lastRefreshedAt: ts });
        const el = screen.getByTestId('git-last-refreshed');
        expect(el.textContent).toBe('just now');

        // Advance 2 minutes
        act(() => { vi.advanceTimersByTime(2 * 60_000); });
        expect(el.textContent).toBe('2m ago');

        // Advance another 3 minutes (total 5m)
        act(() => { vi.advanceTimersByTime(3 * 60_000); });
        expect(el.textContent).toBe('5m ago');
    });
});

// ── Compact variant (toolbar hoisted into the split-workspace header) ─────────

describe('compact variant', () => {
    it('root swaps the strip chrome for the slim single-row skin', () => {
        renderHeader({ compact: true });
        const root = screen.getByTestId('git-panel-header');
        expect(root.className).toContain('git-panel-header--compact');
        expect(root.className).not.toContain('sticky');
        expect(root.className).not.toContain('min-h-[38px]');
        expect(root.className).not.toContain('border-b');
    });

    it('default rendering keeps the full strip chrome (regression)', () => {
        renderHeader();
        const root = screen.getByTestId('git-panel-header');
        expect(root.className).not.toContain('git-panel-header--compact');
        expect(root.className).toContain('sticky');
        expect(root.className).toContain('min-h-[38px]');
    });

    it('keeps every control reachable in compact: pill, ahead badge, sync split, refresh', () => {
        renderHeader({ compact: true, ahead: 8, onPull: vi.fn(), onFetch: vi.fn() });
        expect(screen.getByTestId('git-branch-pill').textContent).toContain('main');
        expect(screen.getByTestId('git-ahead-count').textContent).toBe('↑8');
        expect(screen.getByTestId('git-sync-split-btn')).toBeTruthy();
        expect(screen.getByTestId('git-refresh-btn')).toBeTruthy();
    });

    it('shortens the relative timestamp in compact ("5m", not "5m ago"), tooltip keeps the full datetime', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-04-02T12:00:00Z'));
            const ts = Date.now() - 5 * 60_000;
            renderHeader({ compact: true, lastRefreshedAt: ts });
            const el = screen.getByTestId('git-last-refreshed');
            expect(el.textContent).toBe('5m');
            expect(el.getAttribute('title')).toBe(new Date(ts).toLocaleString());
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves non-suffixed relative times ("just now") untouched in compact', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-04-02T12:00:00Z'));
            renderHeader({ compact: true, lastRefreshedAt: Date.now() - 5_000 });
            expect(screen.getByTestId('git-last-refreshed').textContent).toBe('just now');
        } finally {
            vi.useRealTimers();
        }
    });

    it('dropdown still opens from the compact split button', () => {
        renderHeader({ compact: true, onPull: vi.fn(), onFetch: vi.fn(), onPush: vi.fn() });
        fireEvent.click(screen.getByTestId('git-sync-dropdown-toggle'));
        expect(screen.getByTestId('git-sync-dropdown')).toBeTruthy();
        expect(screen.getByTestId('git-fetch-btn')).toBeTruthy();
        expect(screen.getByTestId('git-push-btn')).toBeTruthy();
    });
});
