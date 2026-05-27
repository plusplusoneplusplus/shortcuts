/**
 * Tests for RepoSchedulesTab edit, duplicate, and parseCronToInterval features.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { parseCronToInterval } from '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab';

const { mockSchedulesClient, mockModelsClient, mockAgentProvidersClient } = vi.hoisted(() => ({
    mockSchedulesClient: {
        list: vi.fn(),
        history: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        disable: vi.fn(),
        enable: vi.fn(),
        delete: vi.fn(),
        move: vi.fn(),
        run: vi.fn(),
    },
    mockModelsClient: {
        list: vi.fn(),
    },
    mockAgentProvidersClient: {
        listModels: vi.fn(),
    },
}));

const MOCK_SCHEDULE = {
    id: 'sched-1',
    name: 'Test Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */2 * * *',
    cronDescription: 'Every 2 hours',
    params: { pipeline: 'pipelines/test/pipeline.yaml' },
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
};

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ schedules: mockSchedulesClient, models: mockModelsClient, agentProviders: mockAgentProvidersClient }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
    getActiveProvider: () => 'copilot' as const,
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../src/server/spa/client/react/hooks/feature-flags/useWorkflowsEnabled', () => ({
    useWorkflowsEnabled: () => true,
}));

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

async function renderWithSchedules(schedules = [MOCK_SCHEDULE]) {
    mockSchedulesClient.list.mockResolvedValue(schedules);
    mockSchedulesClient.history.mockResolvedValue([]);
    mockSchedulesClient.create.mockResolvedValue({});
    mockSchedulesClient.update.mockResolvedValue({});
    mockSchedulesClient.disable.mockResolvedValue({});
    mockSchedulesClient.enable.mockResolvedValue({});
    mockSchedulesClient.delete.mockResolvedValue({ deleted: true });
    mockSchedulesClient.move.mockResolvedValue({});
    mockSchedulesClient.run.mockResolvedValue({ run: {} });
    mockModelsClient.list.mockResolvedValue([]);
    mockAgentProvidersClient.listModels.mockResolvedValue({ models: [] });
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/history')) return Promise.resolve({ history: [] });
        return Promise.resolve({ schedules });
    });
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('/schedules') && url.includes('/history')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ history: [] }) });
        }
        if (url.includes('/schedules') && (!url.includes('/schedules/') || url.endsWith('/schedules'))) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ schedules }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { RepoSchedulesTab } = await import(
        '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
    );
    const result = render(
        <Wrap>
            <RepoSchedulesTab workspaceId="ws-1" />
        </Wrap>,
    );
    await waitFor(() => {
        expect(screen.queryByText('Loading schedules...')).toBeNull();
    });
    return result;
}

// ============================================================================
// parseCronToInterval unit tests
// ============================================================================

describe('parseCronToInterval', () => {
    it('parses minutes interval: */5 * * * *', () => {
        expect(parseCronToInterval('*/5 * * * *')).toEqual({ mode: 'interval', value: '5', unit: 'minutes' });
    });

    it('parses hours interval: 0 */2 * * *', () => {
        expect(parseCronToInterval('0 */2 * * *')).toEqual({ mode: 'interval', value: '2', unit: 'hours' });
    });

    it('parses days interval: 0 0 */3 * *', () => {
        expect(parseCronToInterval('0 0 */3 * *')).toEqual({ mode: 'interval', value: '3', unit: 'days' });
    });

    it('returns cron mode for complex expressions', () => {
        expect(parseCronToInterval('0 9 * * 1-5')).toEqual({ mode: 'cron' });
    });

    it('returns cron mode for non-interval patterns', () => {
        expect(parseCronToInterval('30 8 1 * *')).toEqual({ mode: 'cron' });
    });

    it('returns cron mode for malformed cron (wrong field count)', () => {
        expect(parseCronToInterval('* * *')).toEqual({ mode: 'cron' });
    });

    it('returns cron mode for 6-field cron', () => {
        expect(parseCronToInterval('0 0 */1 * * *')).toEqual({ mode: 'cron' });
    });

    it('handles */1 for single-unit intervals', () => {
        expect(parseCronToInterval('*/1 * * * *')).toEqual({ mode: 'interval', value: '1', unit: 'minutes' });
        expect(parseCronToInterval('0 */1 * * *')).toEqual({ mode: 'interval', value: '1', unit: 'hours' });
        expect(parseCronToInterval('0 0 */1 * *')).toEqual({ mode: 'interval', value: '1', unit: 'days' });
    });

    it('handles extra whitespace', () => {
        expect(parseCronToInterval('  */10  *  *  *  *  ')).toEqual({ mode: 'interval', value: '10', unit: 'minutes' });
    });

    it('returns cron mode for weekly schedule: 0 0 * * 0', () => {
        expect(parseCronToInterval('0 0 * * 0')).toEqual({ mode: 'cron' });
    });
});

// ============================================================================
// Edit button and edit mode tests
// ============================================================================

describe('Schedule edit mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows Edit and Duplicate buttons in expanded detail', async () => {
        await renderWithSchedules();

        // Detail auto-visible via auto-select on load
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
            expect(screen.getByTestId('duplicate-btn')).toBeTruthy();
        });
    });

    it('Edit button is disabled when schedule is running', async () => {
        const running = { ...MOCK_SCHEDULE, isRunning: true };
        await renderWithSchedules([running]);

        await waitFor(() => {
            const editBtn = screen.getByTestId('edit-btn');
            expect(editBtn).toBeTruthy();
            expect((editBtn as HTMLButtonElement).disabled).toBe(true);
        });
    });

    it('Edit shows the edit form with pre-populated fields', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy());

        fireEvent.click(screen.getByTestId('edit-btn'));

        await waitFor(() => {
            expect(screen.getByText('Edit Schedule')).toBeTruthy();
        });

        // Name should be pre-populated
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Test Schedule');

        // Custom interval mode should be detected from cron (0 */2 * * *)
        expect(screen.getByTestId('custom-schedule-panel')).toBeTruthy();
        const intervalBtn = screen.getByText('Interval');
        expect(intervalBtn.className).toContain('bg-[#0078d4]');
    });

    it('edit form shows action cards instead of the old template picker', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-btn'));

        await waitFor(() => {
            expect(screen.getByText('Edit Schedule')).toBeTruthy();
        });
        expect(screen.queryByTestId('template-picker')).toBeNull();
        expect(screen.getByTestId('schedule-action-cards')).toBeTruthy();
    });

    it('Cancel returns to read-only detail view', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-btn'));

        await waitFor(() => expect(screen.getByText('Edit Schedule')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        await waitFor(() => {
            expect(screen.queryByText('Edit Schedule')).toBeNull();
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });
    });

    it('Save updates the schedule through the typed client with updated fields', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-btn'));

        await waitFor(() => expect(screen.getByText('Edit Schedule')).toBeTruthy());

        // Change the name
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: 'Updated Schedule' } });

        // Click Save
        const saveBtn = screen.getByRole('button', { name: 'Save' });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockSchedulesClient.update).toHaveBeenCalled();
        });

        const [, scheduleId, body] = mockSchedulesClient.update.mock.calls[0];
        expect(scheduleId).toBe('sched-1');
        expect(body.name).toBe('Updated Schedule');
        expect(body.target).toBe('pipelines/test/pipeline.yaml');
    });

    it('edit form shows params in advanced options', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('template-params')).toBeTruthy();
            expect(screen.getByTestId('param-pipeline')).toBeTruthy();
        });
    });

    it('cron expression that is not an interval shows cron mode in edit', async () => {
        const cronSchedule = { ...MOCK_SCHEDULE, cron: '0 9 * * 1-5', cronDescription: 'Weekdays at 9am' };
        await renderWithSchedules([cronSchedule]);

        await waitFor(() => expect(screen.getByTestId('edit-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('edit-btn'));

        await waitFor(() => expect(screen.getByText('Edit Schedule')).toBeTruthy());

        const weekdayPreset = screen.getByTestId('schedule-preset-weekdays-9');
        expect(weekdayPreset.className).toContain('border-[#0078d4]');
    });
});

// ============================================================================
// Duplicate tests
// ============================================================================

describe('Schedule duplicate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Duplicate button opens create form with "Copy of" prefix', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('duplicate-btn')).toBeTruthy());

        fireEvent.click(screen.getByTestId('duplicate-btn'));

        await waitFor(() => {
            expect(screen.getByText('New Schedule')).toBeTruthy();
        });

        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Copy of Test Schedule');
    });

    it('Duplicate pre-populates target and onFailure', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('duplicate-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('duplicate-btn'));

        await waitFor(() => expect(screen.getByText('New Schedule')).toBeTruthy());

        // Target should be pre-populated as an inferred workflow path.
        const targetInput = screen.getByTestId('target-workflow-input') as HTMLInputElement;
        expect(targetInput.value).toBe('pipelines/test/pipeline.yaml');
    });

    it('Duplicate shows action cards (create mode)', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('duplicate-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('duplicate-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('schedule-action-cards')).toBeTruthy();
        });
    });

    it('Duplicate pre-populates params', async () => {
        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('duplicate-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('duplicate-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('template-params')).toBeTruthy();
            const paramInput = screen.getByTestId('param-pipeline') as HTMLInputElement;
            expect(paramInput.value).toBe('pipelines/test/pipeline.yaml');
        });
    });

    it('Duplicate submits through create, not update', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

        await renderWithSchedules();

        await waitFor(() => expect(screen.getByTestId('duplicate-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('duplicate-btn'));

        await waitFor(() => expect(screen.getByText('New Schedule')).toBeTruthy());

        const createBtn = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createBtn);

        await waitFor(() => {
            expect(mockSchedulesClient.create).toHaveBeenCalled();
        });
        expect(mockSchedulesClient.update).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Selection state refactor tests
// ============================================================================

const MOCK_SCHEDULE_2 = {
    id: 'sched-2',
    name: 'Second Schedule',
    target: 'pipelines/other/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */4 * * *',
    cronDescription: 'Every 4 hours',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 7200000).toISOString(),
    createdAt: new Date().toISOString(),
};

describe('Schedule selection state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('auto-selects first schedule on load', async () => {
        await renderWithSchedules();

        // Detail should be visible without any explicit click
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });
    });

    it('clicking same schedule does not collapse', async () => {
        await renderWithSchedules();

        // Wait for auto-select
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });

        // Click the already-selected schedule (target the list row, not the detail header)
        fireEvent.click(screen.getByRole('option', { selected: true }));

        // Detail should still be visible
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });
    });

    it('switching selection clears editingId', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        // Wait for auto-select of sched-1
        await waitFor(() => {
            expect(screen.getByTestId('edit-btn')).toBeTruthy();
        });

        // Click Edit on the first schedule
        fireEvent.click(screen.getByTestId('edit-btn'));
        await waitFor(() => {
            expect(screen.getByText('Edit Schedule')).toBeTruthy();
        });

        // Click second schedule row
        fireEvent.click(screen.getByText('Second Schedule'));

        // Edit form should be gone
        await waitFor(() => {
            expect(screen.queryByText('Edit Schedule')).toBeNull();
        });
    });
});
