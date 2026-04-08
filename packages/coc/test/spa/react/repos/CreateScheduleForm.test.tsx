/**
 * Tests for CreateScheduleForm — cron/interval toggle, template application,
 * validation, edit mode pre-population, cron description update.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock getApiBase so fetch URLs are predictable.
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

// Mock fetchWorkflows — no pipelines by default.
vi.mock('../../../../src/server/spa/client/react/repos/workflow-api', () => ({
    fetchWorkflows: vi.fn().mockResolvedValue([]),
}));

// Mock global fetch for /api/models.
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
});
global.fetch = mockFetch;

async function renderForm(overrides: Partial<Parameters<typeof import('../../../../src/server/spa/client/react/repos/CreateScheduleForm').CreateScheduleForm>[0]> = {}) {
    const { CreateScheduleForm } = await import(
        '../../../../src/server/spa/client/react/repos/CreateScheduleForm'
    );
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    const result = render(
        <CreateScheduleForm
            workspaceId="ws-test"
            onCreated={onCreated}
            onCancel={onCancel}
            {...overrides}
        />
    );
    return { ...result, onCreated, onCancel };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
});

describe('CreateScheduleForm — default mode', () => {
    it('defaults to interval mode with interval fields visible', async () => {
        await renderForm();
        expect(screen.getByText('Run every')).toBeTruthy();
        expect(screen.queryByTestId('cron-hint-panel')).toBeNull();
    });

    it('shows cron input when Cron button is clicked', async () => {
        const user = userEvent.setup();
        await renderForm();
        await user.click(screen.getByRole('button', { name: /Cron/i }));
        expect(screen.getByTestId('cron-hint-panel')).toBeTruthy();
    });
});

describe('CreateScheduleForm — cron description', () => {
    it('shows cron description preview when expression is valid', async () => {
        const user = userEvent.setup();
        await renderForm();
        await user.click(screen.getByRole('button', { name: /Cron/i }));
        const cronInput = screen.getByPlaceholderText('0 9 * * *');
        await user.clear(cronInput);
        await user.type(cronInput, '0 8 * * 1');
        await waitFor(() => {
            expect(screen.getByTestId('cron-description')).toBeTruthy();
        });
    });
});

describe('CreateScheduleForm — validation', () => {
    it('shows error and does not POST when name is empty', async () => {
        const user = userEvent.setup();
        const { onCreated } = await renderForm();
        // Submit without filling name/target
        await user.click(screen.getByRole('button', { name: /create/i }));
        expect(screen.getByText(/Name and target are required/i)).toBeTruthy();
        expect(onCreated).not.toHaveBeenCalled();
    });
});

describe('CreateScheduleForm — template application', () => {
    it('applies a template and populates name field', async () => {
        const user = userEvent.setup();
        await renderForm();
        const templateBtn = screen.getByTestId('template-run-script');
        await user.click(templateBtn);
        // After applying template, name field should be populated
        const nameInput = screen.getByPlaceholderText(/Name/i) as HTMLInputElement;
        expect(nameInput.value).not.toBe('');
    });
});

describe('CreateScheduleForm — edit mode', () => {
    it('shows "Edit Job" heading in edit mode', async () => {
        await renderForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: {
                name: 'My Schedule',
                target: 'echo hello',
                targetType: 'script',
                cron: '0 9 * * *',
            },
        });
        expect(screen.getByText('Edit Job')).toBeTruthy();
    });

    it('pre-populates name from initialValues in edit mode', async () => {
        await renderForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: { name: 'Existing Schedule', target: 'echo hi', targetType: 'script' },
        });
        const nameInput = screen.getByPlaceholderText(/Name/i) as HTMLInputElement;
        expect(nameInput.value).toBe('Existing Schedule');
    });

    it('does not render template picker in edit mode', async () => {
        await renderForm({
            mode: 'edit',
            scheduleId: 'sched-1',
            initialValues: { name: 'X', target: 'Y' },
        });
        expect(screen.queryByTestId('template-picker')).toBeNull();
    });
});
