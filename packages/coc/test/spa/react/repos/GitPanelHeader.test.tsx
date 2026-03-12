/**
 * Tests for GitPanelHeader — split action dropdown button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitPanelHeader } from '../../../../src/server/spa/client/react/repos/GitPanelHeader';

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
