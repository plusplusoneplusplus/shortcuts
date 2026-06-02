/**
 * Tests for PromptScheduleForm — simplified prompt-first schedule creation.
 * Covers default form rendering, required fields, preset payload generation,
 * mode/model selection, edit prefill, duplicate prefill, and advanced fallback.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockSchedulesClient, mockModelsClient, mockAgentProvidersClient } = vi.hoisted(() => ({
    mockSchedulesClient: {
        create: vi.fn(),
        update: vi.fn(),
        disable: vi.fn(),
    },
    mockModelsClient: {
        list: vi.fn(),
    },
    mockAgentProvidersClient: {
        listModels: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    getActiveProvider: () => 'copilot' as const,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ schedules: mockSchedulesClient, models: mockModelsClient, agentProviders: mockAgentProvidersClient }),
}));

async function renderPromptForm(overrides: Partial<Parameters<typeof import('../../../../src/server/spa/client/react/features/schedules/PromptScheduleForm').PromptScheduleForm>[0]> = {}) {
    const { PromptScheduleForm } = await import(
        '../../../../src/server/spa/client/react/features/schedules/PromptScheduleForm'
    );
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    const onAdvanced = vi.fn();
    const result = render(
        <PromptScheduleForm
            workspaceId="ws-test"
            onCreated={onCreated}
            onCancel={onCancel}
            onAdvanced={onAdvanced}
            {...overrides}
        />,
    );
    return { ...result, onCreated, onCancel, onAdvanced };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockSchedulesClient.create.mockResolvedValue({ id: 'new-sched-1' });
    mockSchedulesClient.update.mockResolvedValue({});
    mockSchedulesClient.disable.mockResolvedValue({});
    mockModelsClient.list.mockResolvedValue([]);
    mockAgentProvidersClient.listModels.mockResolvedValue({ models: [] });
});

describe('PromptScheduleForm — default rendering', () => {
    it('renders the prompt form with name, instructions, schedule chips, and summary', async () => {
        await renderPromptForm();

        expect(screen.getByTestId('prompt-schedule-form')).toBeTruthy();
        expect(screen.getByTestId('local-notice')).toBeTruthy();
        expect(screen.getByTestId('prompt-name-input')).toBeTruthy();
        expect(screen.getByTestId('prompt-instructions-input')).toBeTruthy();
        expect(screen.getByTestId('prompt-schedule-chips')).toBeTruthy();
        expect(screen.getByTestId('prompt-schedule-summary')).toBeTruthy();
    });

    it('defaults to Daily preset with time picker', async () => {
        await renderPromptForm();

        expect(screen.getByTestId('prompt-preset-daily').className).toContain('border-[#0078d4]');
        expect(screen.getByTestId('prompt-time-picker')).toBeTruthy();
    });

    it('defaults to Ask mode', async () => {
        await renderPromptForm();

        expect(screen.getByTestId('prompt-mode-ask').className).toContain('bg-[#0078d4]');
        expect(screen.queryByTestId('prompt-mode-plan')).toBeNull();
    });

    it('shows the "Other automation" link', async () => {
        await renderPromptForm();

        expect(screen.getByTestId('switch-to-advanced')).toBeTruthy();
    });

    it('hides "Other automation" in edit mode', async () => {
        await renderPromptForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: { name: 'Test', target: 'Do work', cron: '0 9 * * *' },
        });

        expect(screen.queryByTestId('switch-to-advanced')).toBeNull();
    });

    it('shows the local-only notice bar', async () => {
        await renderPromptForm();

        expect(screen.getByTestId('local-notice').textContent).toContain('Local schedules only run');
    });
});

describe('PromptScheduleForm — schedule presets', () => {
    it('shows time picker for Daily', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-preset-daily'));
        expect(screen.getByTestId('prompt-time-picker')).toBeTruthy();
        expect(screen.queryByTestId('prompt-day-picker')).toBeNull();
    });

    it('shows time picker for Weekdays', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-preset-weekdays'));
        expect(screen.getByTestId('prompt-time-picker')).toBeTruthy();
        expect(screen.queryByTestId('prompt-day-picker')).toBeNull();
    });

    it('shows time and day picker for Weekly', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-preset-weekly'));
        expect(screen.getByTestId('prompt-time-picker')).toBeTruthy();
        expect(screen.getByTestId('prompt-day-picker')).toBeTruthy();
    });

    it('shows minute picker for Hourly', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-preset-hourly'));
        expect(screen.getByTestId('prompt-minute-picker')).toBeTruthy();
        expect(screen.queryByTestId('prompt-time-picker')).toBeNull();
    });

    it('hides time/day pickers for Manual', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-preset-manual'));
        expect(screen.queryByTestId('prompt-time-picker')).toBeNull();
        expect(screen.queryByTestId('prompt-day-picker')).toBeNull();
        expect(screen.queryByTestId('prompt-minute-picker')).toBeNull();
    });

    it('shows custom schedule panel for Custom', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-preset-custom'));
        expect(screen.getByTestId('prompt-custom-schedule')).toBeTruthy();
    });

    it('updates summary text on preset change', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        expect(screen.getByTestId('prompt-schedule-summary').textContent).toContain('Runs daily');

        await user.click(screen.getByTestId('prompt-preset-weekdays'));
        expect(screen.getByTestId('prompt-schedule-summary').textContent).toContain('Runs weekdays');

        await user.click(screen.getByTestId('prompt-preset-manual'));
        expect(screen.getByTestId('prompt-schedule-summary').textContent).toContain('manually');
    });
});

describe('PromptScheduleForm — validation', () => {
    it('disables Create button when name is empty', async () => {
        await renderPromptForm();

        const submitBtn = screen.getByTestId('prompt-submit-btn');
        expect(submitBtn.hasAttribute('disabled')).toBe(true);
    });

    it('disables Create button when instructions are empty', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'My Routine');
        const submitBtn = screen.getByTestId('prompt-submit-btn');
        expect(submitBtn.hasAttribute('disabled')).toBe(true);
    });

    it('enables Create button when name and instructions are filled', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'My Routine');
        await user.type(screen.getByTestId('prompt-instructions-input'), 'Do the thing');
        const submitBtn = screen.getByTestId('prompt-submit-btn');
        expect(submitBtn.hasAttribute('disabled')).toBe(false);
    });
});

describe('PromptScheduleForm — payload generation', () => {
    it('submits a daily prompt schedule with correct cron', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'Daily Review');
        await user.type(screen.getByTestId('prompt-instructions-input'), 'Review all open PRs');
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body).toMatchObject({
            name: 'Daily Review',
            target: 'Review all open PRs',
            targetType: 'prompt',
            cron: '0 9 * * *',
            mode: 'ask',
        });
    });

    it('submits a weekdays prompt with correct cron', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'Weekday Check');
        await user.type(screen.getByTestId('prompt-instructions-input'), 'Run health check');
        await user.click(screen.getByTestId('prompt-preset-weekdays'));
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body.cron).toBe('0 9 * * 1-5');
    });

    it('submits a weekly prompt with selected day', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'Weekly Summary');
        await user.type(screen.getByTestId('prompt-instructions-input'), 'Summarize the week');
        await user.click(screen.getByTestId('prompt-preset-weekly'));
        await user.click(screen.getByTestId('prompt-day-fri'));
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body.cron).toBe('0 9 * * 5');
    });

    it('submits a manual prompt and pauses it', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'Manual Task');
        await user.type(screen.getByTestId('prompt-instructions-input'), 'On-demand review');
        await user.click(screen.getByTestId('prompt-preset-manual'));
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        expect(mockSchedulesClient.create).toHaveBeenCalled();
        expect(mockSchedulesClient.disable).toHaveBeenCalledWith('ws-test', 'new-sched-1');
    });

    it('submits with Autopilot mode when selected', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderPromptForm();

        await user.type(screen.getByTestId('prompt-name-input'), 'Autopilot Routine');
        await user.type(screen.getByTestId('prompt-instructions-input'), 'Run the work');
        await user.click(screen.getByTestId('prompt-mode-autopilot'));
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body.mode).toBe('autopilot');
    });
});

describe('PromptScheduleForm — edit mode', () => {
    it('pre-fills name, instructions, and infers preset from cron', async () => {
        await renderPromptForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: {
                name: 'Existing Routine',
                target: 'Check for stale PRs',
                cron: '0 9 * * 1-5',
                chatMode: 'plan',
            } as any,
        });

        expect((screen.getByTestId('prompt-name-input') as HTMLInputElement).value).toBe('Existing Routine');
        expect((screen.getByTestId('prompt-instructions-input') as HTMLTextAreaElement).value).toBe('Check for stale PRs');
        expect(screen.getByTestId('prompt-preset-weekdays').className).toContain('border-[#0078d4]');
        expect(screen.getByTestId('prompt-mode-ask').className).toContain('bg-[#0078d4]');
        expect(screen.queryByTestId('prompt-mode-plan')).toBeNull();
        expect(screen.getByText('Edit Prompt Routine')).toBeTruthy();
    });

    it('calls update API in edit mode', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderPromptForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: {
                name: 'Existing',
                target: 'Do work',
                cron: '0 9 * * *',
            },
        });

        await user.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        expect(mockSchedulesClient.update).toHaveBeenCalledWith('ws-test', 'sched-1', expect.objectContaining({
            name: 'Existing',
            target: 'Do work',
        }));
        expect(mockSchedulesClient.create).not.toHaveBeenCalled();
    });

    it('infers weekly preset from single-day cron', async () => {
        await renderPromptForm({
            mode: 'edit',
            scheduleId: 'sched-2',
            initialValues: {
                name: 'Friday Summary',
                target: 'Summarize week',
                cron: '30 14 * * 5',
            },
        });

        expect(screen.getByTestId('prompt-preset-weekly').className).toContain('border-[#0078d4]');
        expect(screen.getByTestId('prompt-day-fri').className).toContain('border-[#0078d4]');
        expect((screen.getByTestId('prompt-hour-select') as HTMLSelectElement).value).toBe('14');
        expect((screen.getByTestId('prompt-minute-select') as HTMLSelectElement).value).toBe('30');
    });
});

describe('PromptScheduleForm — advanced fallback', () => {
    it('calls onAdvanced when "Other automation" is clicked', async () => {
        const user = userEvent.setup();
        const { onAdvanced } = await renderPromptForm();

        await user.click(screen.getByTestId('switch-to-advanced'));
        expect(onAdvanced).toHaveBeenCalled();
    });
});

describe('PromptScheduleForm — additional options', () => {
    it('keeps additional options collapsed by default', async () => {
        await renderPromptForm();

        expect(screen.getByTestId('prompt-options-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('prompt-options-panel')).toBeNull();
    });

    it('expands to show output folder and failure behavior', async () => {
        const user = userEvent.setup();
        await renderPromptForm();

        await user.click(screen.getByTestId('prompt-options-toggle'));
        expect(screen.getByTestId('prompt-options-panel')).toBeTruthy();
        expect(screen.getByTestId('prompt-output-folder')).toBeTruthy();
        expect(screen.getByTestId('prompt-on-failure')).toBeTruthy();
    });

    it('opens options by default when non-default values are present', async () => {
        await renderPromptForm({
            initialValues: {
                name: 'Test',
                target: 'Do work',
                cron: '0 9 * * *',
                outputFolder: '~/custom',
            },
        });

        expect(screen.getByTestId('prompt-options-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('prompt-options-panel')).toBeTruthy();
    });
});
