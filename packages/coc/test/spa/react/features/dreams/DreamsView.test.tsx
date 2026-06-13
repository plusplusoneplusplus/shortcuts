/**
 * Mock-based tests for the admin Dreams tab (`DreamsView`).
 *
 * AC-05: the "Dreams provider activity" queue + history section was relocated
 * here from the AI Provider page. These tests assert the section renders inside
 * the Dreams tab, attributes runs to provider/model/timeout, and that the
 * Refresh control is preserved.
 *
 * AC-03: the global `dreams.enabled` toggle now lives in this tab (removed from
 * the general Settings → Features grid). These tests assert the toggle renders,
 * reflects the passed config, and drives the change/save/cancel callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// `shared/providerActivity` pulls in the SPA CoC client at module load; stub it
// so importing DreamsView does not require a live client. DreamsView itself only
// renders the data passed in as props, so no client method is exercised here.
vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({}),
}));

const { DreamsView } = await import('../../../../../src/server/spa/client/react/features/dreams/DreamsView');
import type { AgentProviderWorkActivity } from '../../../../../src/server/spa/client/react/shared/providerActivity';

describe('DreamsView', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('renders the Dreams page shell with title and restart-aware badge', () => {
        render(<DreamsView />);
        expect(screen.getByTestId('dreams-admin-page')).toBeDefined();
        expect(screen.getByRole('heading', { level: 2, name: 'Dreams' })).toBeDefined();
        expect(screen.getByText('Restart-aware')).toBeDefined();
    });

    // ── AC-03: global dreams.enabled toggle lives in the tab ──
    it('renders the dreams.enabled toggle reflecting the passed config', () => {
        const { rerender } = render(<DreamsView config={{ enabled: false }} />);
        const toggle = screen.getByTestId('toggle-dreams-enabled') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        rerender(<DreamsView config={{ enabled: true }} />);
        expect((screen.getByTestId('toggle-dreams-enabled') as HTMLInputElement).checked).toBe(true);
    });

    it('invokes onConfigChange with the new enabled value when toggled', () => {
        const onConfigChange = vi.fn();
        render(<DreamsView config={{ enabled: false }} onConfigChange={onConfigChange} />);
        fireEvent.click(screen.getByTestId('toggle-dreams-enabled'));
        expect(onConfigChange).toHaveBeenCalledWith({ enabled: true });
    });

    it('wires the settings card Save/Cancel footer to the config handlers when dirty', () => {
        const onSaveConfig = vi.fn();
        const onCancelConfig = vi.fn();
        render(
            <DreamsView
                config={{ enabled: true }}
                configDirty
                onSaveConfig={onSaveConfig}
                onCancelConfig={onCancelConfig}
            />,
        );
        fireEvent.click(screen.getByTestId('dreams-settings-save'));
        expect(onSaveConfig).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByTestId('dreams-settings-cancel'));
        expect(onCancelConfig).toHaveBeenCalledOnce();
    });

    it('renders the relocated Dreams provider activity section with provider/model/timeout attribution', () => {
        const activity: AgentProviderWorkActivity[] = [{
            id: 'dream-task-1',
            provider: 'claude',
            kind: 'dream-run',
            trigger: 'manual',
            status: 'running',
            label: 'Dream Run: Manual',
            model: 'claude-sonnet-4.6',
            timeoutMs: 3_600_000,
        }];
        render(<DreamsView providerActivity={activity} />);

        const section = screen.getByTestId('provider-dream-activity');
        expect(within(section).getByText('Dreams provider activity')).toBeDefined();
        const row = within(section).getByTestId('provider-dream-activity-dream-task-1');
        expect(row.textContent).toContain('Dream Run: Manual');
        expect(row.textContent).toContain('Claude');
        expect(row.textContent).toContain('claude-sonnet-4.6');
        expect(row.textContent).toContain('1h timeout');
    });

    it('shows the empty state when there is no Dreams activity', () => {
        render(<DreamsView providerActivity={[]} />);
        expect(screen.getByTestId('provider-dream-activity-empty')).toBeDefined();
    });

    it('renders the error banner instead of rows when activity fetch failed', () => {
        render(<DreamsView providerActivity={[]} providerActivityError="boom" />);
        const banner = screen.getByTestId('provider-dream-activity-error');
        expect(banner.textContent).toContain('boom');
        expect(screen.queryByTestId('provider-dream-activity-empty')).toBeNull();
    });

    it('preserves the Refresh control and invokes the handler on click', () => {
        const onRefreshProviderActivity = vi.fn();
        render(<DreamsView providerActivity={[]} onRefreshProviderActivity={onRefreshProviderActivity} />);
        fireEvent.click(screen.getByTestId('provider-dream-activity-refresh'));
        expect(onRefreshProviderActivity).toHaveBeenCalledOnce();
    });

    it('omits the Refresh control when no handler is provided', () => {
        render(<DreamsView providerActivity={[]} />);
        expect(screen.queryByTestId('provider-dream-activity-refresh')).toBeNull();
    });
});
