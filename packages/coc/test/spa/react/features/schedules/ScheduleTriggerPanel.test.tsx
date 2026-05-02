/**
 * Tests for ScheduleTriggerPanel — mode toggle, interval inputs, cron panel,
 * cron examples, and cron description.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function makeProps(overrides: Partial<Parameters<typeof import('../../../../../src/server/spa/client/react/features/schedules/ScheduleTriggerPanel').ScheduleTriggerPanel>[0]> = {}) {
    return {
        mode: 'interval' as const,
        onModeChange: vi.fn(),
        intervalValue: '1',
        onIntervalValueChange: vi.fn(),
        intervalUnit: 'hours',
        onIntervalUnitChange: vi.fn(),
        cron: '0 9 * * *',
        onCronChange: vi.fn(),
        ...overrides,
    };
}

async function renderPanel(overrides: Parameters<typeof makeProps>[0] = {}) {
    const { ScheduleTriggerPanel } = await import(
        '../../../../../src/server/spa/client/react/features/schedules/ScheduleTriggerPanel'
    );
    const props = makeProps(overrides);
    const result = render(<ScheduleTriggerPanel {...props} />);
    return { ...result, props };
}

describe('ScheduleTriggerPanel — interval mode', () => {
    it('shows interval inputs by default', async () => {
        await renderPanel();
        expect(screen.getByText('Run every')).toBeTruthy();
        expect(screen.queryByTestId('cron-hint-panel')).toBeNull();
    });

    it('calls onModeChange when Cron button is clicked', async () => {
        const user = userEvent.setup();
        const { props } = await renderPanel();
        await user.click(screen.getByRole('button', { name: /Cron/i }));
        expect(props.onModeChange).toHaveBeenCalledWith('cron');
    });

    it('calls onIntervalValueChange on number input change', async () => {
        const user = userEvent.setup();
        const { props } = await renderPanel();
        const numInput = screen.getByRole('spinbutton');
        await user.clear(numInput);
        await user.type(numInput, '5');
        expect(props.onIntervalValueChange).toHaveBeenCalled();
    });

    it('calls onIntervalUnitChange when unit select changes', async () => {
        const user = userEvent.setup();
        const { props } = await renderPanel();
        const selects = screen.getAllByRole('combobox');
        await user.selectOptions(selects[0], 'minutes');
        expect(props.onIntervalUnitChange).toHaveBeenCalledWith('minutes');
    });
});

describe('ScheduleTriggerPanel — cron mode', () => {
    it('shows cron panel when mode is cron', async () => {
        await renderPanel({ mode: 'cron' });
        expect(screen.getByTestId('cron-hint-panel')).toBeTruthy();
        expect(screen.queryByText('Run every')).toBeNull();
    });

    it('shows simplified field legend', async () => {
        await renderPanel({ mode: 'cron' });
        const legend = screen.getByTestId('cron-field-legend');
        expect(legend.textContent).toContain('min · hr · dom · mon · dow');
    });

    it('shows cron description for a known expression', async () => {
        await renderPanel({ mode: 'cron', cron: '0 9 * * *' });
        expect(screen.getByTestId('cron-description').textContent).toBeTruthy();
    });

    it('hides cron description when cron is empty', async () => {
        await renderPanel({ mode: 'cron', cron: '' });
        expect(screen.queryByTestId('cron-description')).toBeNull();
    });

    it('calls onCronChange when an example button is clicked', async () => {
        const user = userEvent.setup();
        const { props } = await renderPanel({ mode: 'cron' });
        const exampleBtn = screen.getByTestId('cron-example-0-9-*-*-*');
        await user.click(exampleBtn);
        expect(props.onCronChange).toHaveBeenCalledWith('0 9 * * *');
    });

    it('calls onCronChange on direct input', async () => {
        const user = userEvent.setup();
        const { props } = await renderPanel({ mode: 'cron', cron: '' });
        const cronInput = screen.getByPlaceholderText('0 9 * * *');
        await user.type(cronInput, '* * * * *');
        expect(props.onCronChange).toHaveBeenCalled();
    });
});
