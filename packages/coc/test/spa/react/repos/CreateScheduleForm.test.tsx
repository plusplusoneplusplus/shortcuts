/**
 * Tests for CreateScheduleForm — progressive action cards, schedule presets,
 * advanced options, validation, payload compatibility, and edit pre-population.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockSchedulesClient, mockModelsClient, mockFeatureFlags } = vi.hoisted(() => ({
    mockSchedulesClient: {
        create: vi.fn(),
        update: vi.fn(),
    },
    mockModelsClient: {
        list: vi.fn(),
    },
    mockFeatureFlags: {
        workflowsEnabled: true,
    },
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ schedules: mockSchedulesClient, models: mockModelsClient }),
}));

vi.mock('../../../../src/server/spa/client/react/features/workflow/workflow-api', () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => mockFeatureFlags.workflowsEnabled,
}));

const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
});
global.fetch = mockFetch;

async function renderForm(overrides: Partial<Parameters<typeof import('../../../../src/server/spa/client/react/features/schedules/CreateScheduleForm').CreateScheduleForm>[0]> = {}) {
    const { CreateScheduleForm } = await import(
        '../../../../src/server/spa/client/react/features/schedules/CreateScheduleForm'
    );
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    const result = render(
        <CreateScheduleForm
            workspaceId="ws-test"
            onCreated={onCreated}
            onCancel={onCancel}
            {...overrides}
        />,
    );
    return { ...result, onCreated, onCancel };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockSchedulesClient.create.mockResolvedValue({});
    mockSchedulesClient.update.mockResolvedValue({});
    mockModelsClient.list.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    mockFeatureFlags.workflowsEnabled = true;
});

describe('CreateScheduleForm — default progressive UI', () => {
    it('shows action cards, schedule presets, summary, and collapsed advanced options', async () => {
        await renderForm();

        expect(screen.getByTestId('schedule-action-cards')).toBeTruthy();
        expect(screen.getByTestId('schedule-action-workflow')).toBeTruthy();
        expect(screen.getByTestId('schedule-action-prompt')).toBeTruthy();
        expect(screen.getByTestId('schedule-preset-picker')).toBeTruthy();
        expect(screen.getByTestId('schedule-summary')).toBeTruthy();
        expect(screen.getByTestId('advanced-options-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('advanced-options-panel')).toBeNull();
    });

    it('reveals custom cron controls from the Custom preset', async () => {
        const user = userEvent.setup();
        await renderForm();

        await user.click(screen.getByTestId('schedule-preset-custom-interval'));
        await user.click(screen.getByTestId('schedule-trigger-mode-cron'));

        expect(screen.getByTestId('cron-hint-panel')).toBeTruthy();
    });

    it('shows the workflow selector fallback when Workflow is selected', async () => {
        const user = userEvent.setup();
        await renderForm();

        await user.click(screen.getByTestId('schedule-action-workflow'));

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-input')).toBeTruthy();
        });
    });

    it('hides Workflow action and description text when workflows are disabled', async () => {
        mockFeatureFlags.workflowsEnabled = false;

        await renderForm();

        expect(screen.queryByTestId('schedule-action-workflow')).toBeNull();
        expect(screen.getByText('Automate a prompt, script, or notes task. Start simple; open Advanced for model, cron, output, and failure settings.')).toBeTruthy();
        expect(screen.queryByText(/Automate a prompt, workflow/i)).toBeNull();
    });

    it('falls back to Prompt when editing a workflow-backed schedule while workflows are disabled', async () => {
        mockFeatureFlags.workflowsEnabled = false;

        await renderForm({
            mode: 'edit',
            scheduleId: 'sched-workflow',
            initialValues: {
                name: 'Existing Workflow Schedule',
                target: 'workflows/daily-report/pipeline.yaml',
                targetType: 'prompt',
                cron: '0 9 * * *',
                params: { pipeline: 'workflows/daily-report/pipeline.yaml' },
            },
        });

        expect(screen.queryByTestId('schedule-action-workflow')).toBeNull();
        expect(screen.getByTestId('schedule-action-prompt').textContent).toContain('Selected');
        expect(screen.queryByTestId('target-workflow-input')).toBeNull();
        expect((screen.getByTestId('target-input') as HTMLTextAreaElement).value).toBe('');
    });

    it('shows prompt fields and hides script controls for Prompt', async () => {
        await renderForm();

        expect(screen.getByTestId('target-input').tagName).toBe('TEXTAREA');
        expect(screen.queryByTestId('working-directory-input')).toBeNull();
    });

    it('shows command and working directory fields for Script', async () => {
        const user = userEvent.setup();
        await renderForm();

        await user.click(screen.getByTestId('schedule-action-script'));

        expect(screen.getByTestId('target-input').tagName).toBe('INPUT');
        expect(screen.getByTestId('working-directory-input')).toBeTruthy();
    });

    it('shows notes auto-commit explanatory text', async () => {
        const user = userEvent.setup();
        await renderForm();

        await user.click(screen.getByTestId('schedule-action-notes-auto-commit'));

        expect(screen.getByTestId('notes-auto-commit-info').textContent).toContain('Automatically commit notes');
    });
});

describe('CreateScheduleForm — validation', () => {
    it('shows a specific prompt error and does not POST when prompt text is empty', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderForm();

        await user.click(screen.getByRole('button', { name: /create/i }));

        expect(screen.getByText(/Enter the prompt to run/i)).toBeTruthy();
        expect(onCreated).not.toHaveBeenCalled();
    });

    it('shows a specific script error when command is empty', async () => {
        const user = userEvent.setup();
        await renderForm();

        await user.click(screen.getByTestId('schedule-action-script'));
        await user.click(screen.getByRole('button', { name: /create/i }));

        expect(screen.getByText(/Enter the command to run/i)).toBeTruthy();
    });

    it('shows a specific cron error for invalid raw cron', async () => {
        const user = userEvent.setup();
        await renderForm({
            initialValues: {
                name: 'Bad cron',
                target: 'Do work',
                cron: '0 9 * * *',
            },
        });

        await user.click(screen.getByTestId('advanced-options-toggle'));
        const cronInput = screen.getByTestId('advanced-cron-input');
        await user.clear(cronInput);
        await user.type(cronInput, 'bad cron');
        await user.click(screen.getByRole('button', { name: /create/i }));

        expect(screen.getByText(/Enter a valid 5-field cron expression/i)).toBeTruthy();
    });
});

describe('CreateScheduleForm — payload compatibility', () => {
    it('submits a prompt schedule with the selected preset cron', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderForm();

        await user.clear(screen.getByPlaceholderText('Name (e.g., Daily Report)'));
        await user.type(screen.getByPlaceholderText('Name (e.g., Daily Report)'), 'Weekly Health');
        await user.type(screen.getByTestId('target-input'), 'Run the weekly repo health check');
        await user.click(screen.getByTestId('schedule-preset-weekdays-9'));
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => expect(onCreated).toHaveBeenCalled());
        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body).toMatchObject({
            name: 'Weekly Health',
            target: 'Run the weekly repo health check',
            targetType: 'prompt',
            cron: '0 9 * * 1-5',
            mode: 'autopilot',
        });
    });

    it('submits a script schedule with working directory params', async () => {
        const user = userEvent.setup();
        await renderForm();

        await user.click(screen.getByTestId('schedule-action-script'));
        await user.type(screen.getByTestId('target-input'), 'npm run report');
        const workingDirectory = screen.getByTestId('working-directory-input');
        await user.clear(workingDirectory);
        await user.type(workingDirectory, './reports');
        await user.click(screen.getByRole('button', { name: /create/i }));

        await waitFor(() => {
            expect(mockSchedulesClient.create).toHaveBeenCalled();
        });
        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body.targetType).toBe('script');
        expect(body.params).toEqual({ workingDirectory: './reports' });
        expect(body.mode).toBeUndefined();
    });
});

describe('CreateScheduleForm — advanced and edit mode', () => {
    it('keeps advanced collapsed for a new default schedule', async () => {
        await renderForm();
        expect(screen.getByTestId('advanced-options-toggle').getAttribute('aria-expanded')).toBe('false');
    });

    it('opens advanced by default for edit schedules with non-default values', async () => {
        await renderForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: {
                name: 'Existing Schedule',
                target: 'pipelines/test/pipeline.yaml',
                targetType: 'prompt',
                cron: '13 7 * * 2',
                params: { pipeline: 'pipelines/test/pipeline.yaml', custom: 'value' },
                onFailure: 'stop',
                outputFolder: '~/custom',
                model: 'gpt-test',
                chatMode: 'plan',
            },
        });

        expect(screen.getByText('Edit Schedule')).toBeTruthy();
        expect(screen.getByTestId('advanced-options-toggle').getAttribute('aria-expanded')).toBe('true');
        expect((screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement).value).toBe('Existing Schedule');
        expect((screen.getByTestId('advanced-cron-input') as HTMLInputElement).value).toBe('13 7 * * 2');
        expect((screen.getByTestId('param-custom') as HTMLInputElement).value).toBe('value');
    });
});
