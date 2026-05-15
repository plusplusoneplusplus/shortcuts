/**
 * Tests for RepoSchedulesTab schedule template quick-starters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { SCHEDULE_TEMPLATES, describeCron, CRON_EXAMPLES } from '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab';

const { mockSchedulesClient, mockModelsClient, mockWorkflowClient } = vi.hoisted(() => ({
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
    mockWorkflowClient: {
        list: vi.fn(),
    },
}));

// Mock fetch and fetchApi so the component can render without a real server
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ schedules: [] }),
});
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn().mockResolvedValue({ schedules: [] });
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ schedules: mockSchedulesClient, models: mockModelsClient, workflow: mockWorkflowClient }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
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

// Lazy-import the component after mocks are set up
async function renderSchedulesTab() {
    const { RepoSchedulesTab } = await import(
        '../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab'
    );
    const result = render(
        <Wrap>
            <RepoSchedulesTab workspaceId="ws-1" />
        </Wrap>,
    );
    // Wait for loading state to resolve
    await waitFor(() => {
        expect(screen.queryByText('Loading schedules...')).toBeNull();
    });
    return result;
}

// ============================================================================
// SCHEDULE_TEMPLATES data shape tests
// ============================================================================

describe('SCHEDULE_TEMPLATES', () => {
    it('exports 3 templates', () => {
        expect(SCHEDULE_TEMPLATES).toHaveLength(3);
    });

    it('every template has required fields', () => {
        for (const tpl of SCHEDULE_TEMPLATES) {
            expect(tpl.id).toBeTruthy();
            expect(tpl.label).toBeTruthy();
            expect(tpl.emoji).toBeTruthy();
            expect(tpl.name).toBeTruthy();
            // Script templates intentionally have an empty target (user fills it in)
            if (tpl.targetType !== 'script') {
                expect(tpl.target).toBeTruthy();
            }
            expect(tpl.cronExpr).toBeTruthy();
            expect(tpl.hint).toBeTruthy();
            expect(['cron', 'interval']).toContain(tpl.mode);
            expect(tpl.intervalValue).toBeTruthy();
            expect(tpl.intervalUnit).toBeTruthy();
            expect(Array.isArray(tpl.params)).toBe(true);
        }
    });

    it('all template ids are unique', () => {
        const ids = SCHEDULE_TEMPLATES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every param has key and placeholder', () => {
        for (const tpl of SCHEDULE_TEMPLATES) {
            for (const p of tpl.params) {
                expect(p.key).toBeTruthy();
                expect(p.placeholder).toBeTruthy();
            }
        }
    });

    it('intervalUnit is a valid unit string', () => {
        const validUnits = ['minutes', 'hours', 'days'];
        for (const tpl of SCHEDULE_TEMPLATES) {
            expect(validUnits).toContain(tpl.intervalUnit);
        }
    });

    it('contains expected template ids', () => {
        const ids = SCHEDULE_TEMPLATES.map(t => t.id);
        expect(ids).toContain('run-workflow');
        expect(ids).toContain('run-script');
        expect(ids).toContain('notes-auto-commit');
        expect(ids).not.toContain('auto-commit');
        expect(ids).not.toContain('pull-sync');
        expect(ids).not.toContain('clean-outputs');
    });
});

// ============================================================================
// CreateScheduleForm action-card UI tests
// ============================================================================

describe('CreateScheduleForm action-card UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSchedulesClient.list.mockResolvedValue([]);
        mockSchedulesClient.history.mockResolvedValue([]);
        mockSchedulesClient.create.mockResolvedValue({});
        mockModelsClient.list.mockResolvedValue([]);
        mockFetchApi.mockResolvedValue({ schedules: [] });
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ schedules: [] }),
        });
    });

    it('renders action cards when form is open', async () => {
        await renderSchedulesTab();

        // Click "+ New" to open the form
        const newBtn = screen.getByText('+ New');
        fireEvent.click(newBtn);
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        expect(screen.getByTestId('schedule-action-cards')).toBeTruthy();
        expect(screen.getByTestId('schedule-action-workflow')).toBeTruthy();
        expect(screen.getByTestId('schedule-action-prompt')).toBeTruthy();
        expect(screen.getByTestId('schedule-action-script')).toBeTruthy();
        expect(screen.getByTestId('schedule-action-notes-auto-commit')).toBeTruthy();
    });

    it('clicking a Script action card pre-fills the schedule name', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-action-script'));

        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === 'run-script')!;

        // Check name input is pre-filled
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe(tpl.name);
    });

    it('run-workflow template starts with empty target for dropdown selection', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Run Workflow');
        // Target should start empty (prompting dropdown selection)
        // No plain target input should exist — it's replaced by a dropdown/loading
    });

    it('clicking a template shows dynamic params fields', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-action-script'));
        fireEvent.click(screen.getByTestId('advanced-options-toggle'));

        const paramsSection = screen.getByTestId('template-params');
        expect(paramsSection).toBeTruthy();

        // run-script has workingDirectory param
        expect(screen.getByTestId('param-workingDirectory')).toBeTruthy();
    });

    it('clicking a template shows the hint text', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === 'run-script')!;
        fireEvent.click(screen.getByTestId('schedule-action-script'));
        fireEvent.click(screen.getByTestId('advanced-options-toggle'));

        const hint = screen.getByTestId('template-hint');
        expect(hint.textContent).toBe(tpl.hint);
    });

    it('switching back to Prompt resets script-only fields', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-action-script'));
        expect(screen.getByTestId('working-directory-input')).toBeTruthy();

        fireEvent.click(screen.getByTestId('schedule-action-prompt'));

        expect(screen.queryByTestId('working-directory-input')).toBeNull();

        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Recurring Prompt');
    });

    it('switching between templates updates form fields', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        // Select run-script
        fireEvent.click(screen.getByTestId('schedule-action-script'));
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Run Script');

        // Switch to notes-auto-commit
        fireEvent.click(screen.getByTestId('schedule-action-notes-auto-commit'));
        expect(nameInput.value).toBe('Notes Auto-Commit');

        expect(screen.getByTestId('notes-auto-commit-info').textContent).toContain('Automatically commit notes');
    });

    it('script working directory is editable', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        fireEvent.click(screen.getByTestId('schedule-action-script'));

        const wdInput = screen.getByTestId('working-directory-input') as HTMLInputElement;
        fireEvent.change(wdInput, { target: { value: './lib' } });
        expect(wdInput.value).toBe('./lib');
    });

    it('Create button has type="submit" so it triggers form submission', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        const createBtn = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
        expect(createBtn.type).toBe('submit');
    });

    it('submitting with template sends params in the request body', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });

        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        fireEvent.click(screen.getByTestId('schedule-action-script'));

        // run-script has empty target — fill the script command input
        const targetInput = screen.getByTestId('target-input') as HTMLInputElement;
        fireEvent.change(targetInput, { target: { value: 'echo hello' } });

        // Submit by clicking the Create button (type="submit")
        const createBtn = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createBtn);

        // Wait for the POST call (form submits asynchronously)
        await waitFor(() => {
            expect(mockSchedulesClient.create).toHaveBeenCalled();
        });

        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body.params).toEqual({
            workingDirectory: '.',
        });
        expect(body.name).toBe('Run Script');
        expect(body.target).toBe('echo hello');
    });

    it('workflow action selects the daily preset', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        const dailyPreset = screen.getByTestId('schedule-preset-daily-9');
        expect(dailyPreset.className).toContain('border-[#0078d4]');
    });

    it('notes auto-commit action selects the 30-minute preset', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-action-notes-auto-commit'));

        const preset = screen.getByTestId('schedule-preset-every-30-minutes');
        expect(preset.className).toContain('border-[#0078d4]');
    });
});

// ============================================================================
// Workflow dropdown selector tests
// ============================================================================

describe('Workflow dropdown selector (target field)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSchedulesClient.list.mockResolvedValue([]);
        mockSchedulesClient.history.mockResolvedValue([]);
        mockSchedulesClient.create.mockResolvedValue({});
        mockModelsClient.list.mockResolvedValue([]);
        mockWorkflowClient.list.mockResolvedValue([]);
        mockFetchApi.mockResolvedValue({ schedules: [] });
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ schedules: [] }),
        });
    });

    async function openRunWorkflowTemplate() {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        // Set up workflow list mock to return two workflows
        mockWorkflowClient.list.mockResolvedValue([
            { name: 'daily-report', path: 'pipelines/daily-report/pipeline.yaml' },
            { name: 'data-sync', path: 'pipelines/data-sync/pipeline.yaml' },
        ]);
        fireEvent.click(screen.getByTestId('schedule-action-workflow'));
    }

    it('renders a <select> dropdown in the target position when workflows are available', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            const selectEl = screen.getByTestId('target-workflow-select');
            expect(selectEl.tagName).toBe('SELECT');
        });
    });

    it('dropdown contains discovered workflow options', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        const options = Array.from(select.options).map(o => o.textContent);
        expect(options).toContain('daily-report');
        expect(options).toContain('data-sync');
    });

    it('dropdown includes a disabled placeholder option', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        const placeholder = Array.from(select.options).find(o => o.disabled);
        expect(placeholder).toBeTruthy();
        expect(placeholder!.textContent).toContain('Select a workflow');
    });

    it('dropdown includes "Other (manual path)" option', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        const manualOpt = Array.from(select.options).find(o => o.value === '__manual__');
        expect(manualOpt).toBeTruthy();
        expect(manualOpt!.textContent).toContain('Other');
    });

    it('selecting a workflow sets the target value', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'pipelines/daily-report/pipeline.yaml' } });

        expect(select.value).toBe('pipelines/daily-report/pipeline.yaml');
    });

    it('selecting "Other" switches to manual text input for target', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '__manual__' } });

        // Should now be an input, not a select
        await waitFor(() => {
            const inputEl = screen.getByTestId('target-workflow-input');
            expect(inputEl.tagName).toBe('INPUT');
        });
    });

    it('falls back to text input when no workflows are found', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        // Return empty workflows list
        mockWorkflowClient.list.mockResolvedValue([]);

        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        await waitFor(() => {
            const inputEl = screen.getByTestId('target-workflow-input');
            expect(inputEl.tagName).toBe('INPUT');
        });
    });

    it('falls back to text input when workflow fetch fails', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        mockWorkflowClient.list.mockRejectedValue(new Error('Internal Server Error'));

        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        await waitFor(() => {
            const inputEl = screen.getByTestId('target-workflow-input');
            expect(inputEl.tagName).toBe('INPUT');
        });
    });

    it('shows loading indicator while fetching workflows', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        // Make workflow list hang indefinitely
        mockWorkflowClient.list.mockReturnValue(new Promise(() => {}));

        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        await waitFor(() => {
            expect(screen.getByTestId('workflow-loading')).toBeTruthy();
        });
    });

    it('deselecting run-workflow template resets manual mode', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        // Switch to manual
        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '__manual__' } });

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-input').tagName).toBe('INPUT');
        });

        // Deselect template
        fireEvent.click(screen.getByTestId('schedule-action-prompt'));

        // Re-select: should be back to dropdown (not stuck in manual)
        mockWorkflowClient.list.mockResolvedValue([
            { name: 'daily-report', path: 'pipelines/daily-report/pipeline.yaml' },
        ]);
        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });
    });

    it('no PARAMETERS section is shown for run-workflow template', async () => {
        await openRunWorkflowTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        // The template-params section should not exist since params is empty
        expect(screen.queryByTestId('template-params')).toBeNull();
    });

    it('params.pipeline is set when a workflow is selected from dropdown', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        mockWorkflowClient.list.mockResolvedValue([
            { name: 'daily-report', path: 'pipelines/daily-report/pipeline.yaml' },
        ]);

        fireEvent.click(screen.getByTestId('schedule-action-workflow'));

        await waitFor(() => {
            expect(screen.getByTestId('target-workflow-select').tagName).toBe('SELECT');
        });

        // Select a workflow
        const select = screen.getByTestId('target-workflow-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'pipelines/daily-report/pipeline.yaml' } });

        // Submit by clicking the Create button (type="submit")
        const createBtn = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createBtn);

        // Verify POST body contains params.pipeline
        await waitFor(() => {
            expect(mockSchedulesClient.create).toHaveBeenCalled();
        });

        const [, body] = mockSchedulesClient.create.mock.calls[0];
        expect(body.params.pipeline).toBe('pipelines/daily-report/pipeline.yaml');
        expect(body.target).toBe('pipelines/daily-report/pipeline.yaml');
    });
});

// ============================================================================
// Split-panel layout tests
// ============================================================================

const MOCK_SCHEDULE = {
    id: 'sched-1',
    name: 'Test Schedule',
    target: 'pipelines/test/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '0 */2 * * *',
    cronDescription: 'Every 2 hours',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 3600000).toISOString(),
    createdAt: new Date().toISOString(),
};

const MOCK_SCHEDULE_2 = {
    id: 'sched-2',
    name: 'Second Schedule',
    target: 'pipelines/other/pipeline.yaml',
    targetType: 'prompt' as const,
    cron: '*/5 * * * *',
    cronDescription: 'Every 5 minutes',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: new Date(Date.now() + 300000).toISOString(),
    createdAt: new Date().toISOString(),
};

async function renderWithSchedules(schedules = [MOCK_SCHEDULE]) {
    mockSchedulesClient.list.mockResolvedValue(schedules);
    mockSchedulesClient.history.mockResolvedValue([]);
    mockSchedulesClient.create.mockResolvedValue({});
    mockModelsClient.list.mockResolvedValue([]);
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
    return renderSchedulesTab();
}

describe('Split-panel layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('auto-selects first schedule on load and shows its detail in right panel', async () => {
        await renderWithSchedules();

        // No click performed — detail should auto-appear
        await waitFor(() => {
            expect(screen.getAllByText('Test Schedule').length).toBeGreaterThanOrEqual(1);
            expect(screen.getByText('pipelines/test/pipeline.yaml')).toBeTruthy();
        });
    });

    it('clicking a schedule row shows that schedule\'s detail in the right panel', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        // Click the second schedule row in the left panel
        fireEvent.click(screen.getByText(MOCK_SCHEDULE_2.name));

        await waitFor(() => {
            expect(screen.getByText(MOCK_SCHEDULE_2.target)).toBeTruthy();
        });
    });

    it('clicking "+ New" shows schedule form in the right panel while left list remains visible', async () => {
        await renderWithSchedules();

        fireEvent.click(screen.getByText('+ New'));

        await waitFor(() => {
            expect(screen.getByText('New Prompt Routine')).toBeTruthy();
            expect(screen.getByText(MOCK_SCHEDULE.name)).toBeTruthy();
        });
    });

    it('selected row gets the active highlight (bg + inset border)', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        // First schedule is auto-selected
        await waitFor(() => {
            const rows = screen.getAllByRole('option');
            const firstRow = rows.find(r => r.textContent?.includes(MOCK_SCHEDULE.name));
            expect(firstRow?.getAttribute('aria-selected')).toBe('true');
            expect(firstRow?.className).toContain('bg-[#ddf4ff]');
            expect(firstRow?.className).toContain('shadow-[inset_0_0_0_1px_#b6e3ff]');
        });

        // Click the second schedule; it should gain the class and first should lose it
        fireEvent.click(screen.getByText(MOCK_SCHEDULE_2.name));

        await waitFor(() => {
            const rows = screen.getAllByRole('option');
            const secondRow = rows.find(r => r.textContent?.includes(MOCK_SCHEDULE_2.name));
            expect(secondRow?.getAttribute('aria-selected')).toBe('true');
            expect(secondRow?.className).toContain('bg-[#ddf4ff]');

            const firstRow = rows.find(r => r.textContent?.includes(MOCK_SCHEDULE.name));
            expect(firstRow?.getAttribute('aria-selected')).toBe('false');
            expect(firstRow?.className).not.toContain('bg-[#ddf4ff]');
        });
    });

    it('clicking a different schedule replaces the right panel content', async () => {
        await renderWithSchedules([MOCK_SCHEDULE, MOCK_SCHEDULE_2]);

        // First schedule auto-selected — its detail is visible
        await waitFor(() => {
            expect(screen.getByText(MOCK_SCHEDULE.target)).toBeTruthy();
        });

        // Select the second schedule
        fireEvent.click(screen.getByText(MOCK_SCHEDULE_2.name));

        await waitFor(() => {
            expect(screen.getByText(MOCK_SCHEDULE_2.target)).toBeTruthy();
        });
    });

    it('detail panel shows Model field when schedule has a model set', async () => {
        const scheduleWithModel = { ...MOCK_SCHEDULE, model: 'claude-sonnet-4.6' };
        await renderWithSchedules([scheduleWithModel]);

        await waitFor(() => {
            expect(screen.getByTestId('schedule-model').textContent).toBe('claude-sonnet-4.6');
        });
    });

    it('detail panel does not show Model field when schedule has no model', async () => {
        await renderWithSchedules([MOCK_SCHEDULE]);

        await waitFor(() => {
            expect(screen.queryByTestId('schedule-model')).toBeNull();
        });
    });
});

// ============================================================================
// describeCron unit tests
// ============================================================================

describe('describeCron', () => {
    it('returns "Every minute" for * * * * *', () => {
        expect(describeCron('* * * * *')).toBe('Every minute');
    });

    it('returns "Every N minutes" for */N patterns', () => {
        expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
        expect(describeCron('*/1 * * * *')).toBe('Every 1 minute');
        expect(describeCron('*/30 * * * *')).toBe('Every 30 minutes');
    });

    it('returns "Every N hours" for 0 */N patterns', () => {
        expect(describeCron('0 */6 * * *')).toBe('Every 6 hours');
        expect(describeCron('0 */1 * * *')).toBe('Every 1 hour');
    });

    it('returns "Every hour" for 0 * * * *', () => {
        expect(describeCron('0 * * * *')).toBe('Every hour');
    });

    it('returns "Every day at HH:MM" for fixed time patterns', () => {
        expect(describeCron('0 9 * * *')).toBe('Every day at 09:00');
        expect(describeCron('30 14 * * *')).toBe('Every day at 14:30');
        expect(describeCron('0 0 * * *')).toBe('Every day at 00:00');
    });

    it('returns "Weekdays at HH:MM" for 1-5 dow', () => {
        expect(describeCron('0 9 * * 1-5')).toBe('Weekdays at 09:00');
    });

    it('returns weekday name for single dow', () => {
        expect(describeCron('0 0 * * 0')).toBe('Every Sunday at 00:00');
        expect(describeCron('0 8 * * 1')).toBe('Every Monday at 08:00');
        expect(describeCron('0 17 * * 5')).toBe('Every Friday at 17:00');
    });

    it('returns monthly description for fixed dom', () => {
        expect(describeCron('0 12 1 * *')).toBe('1st of every month at 12:00');
        expect(describeCron('0 0 2 * *')).toBe('2nd of every month at 00:00');
        expect(describeCron('0 0 3 * *')).toBe('3rd of every month at 00:00');
        expect(describeCron('0 9 15 * *')).toBe('15th of every month at 09:00');
    });

    it('returns empty string for unrecognized patterns', () => {
        expect(describeCron('0 9 * 1 *')).toBe('');
        expect(describeCron('5 */2 * * 1-5')).toBe('');
        expect(describeCron('invalid')).toBe('');
        expect(describeCron('')).toBe('');
    });

    it('handles extra whitespace in input', () => {
        expect(describeCron('  * * * * *  ')).toBe('Every minute');
        expect(describeCron('0  9  *  *  *')).toBe('Every day at 09:00');
    });
});

// ============================================================================
// CRON_EXAMPLES data shape tests
// ============================================================================

describe('CRON_EXAMPLES', () => {
    it('exports at least 6 examples', () => {
        expect(CRON_EXAMPLES.length).toBeGreaterThanOrEqual(6);
    });

    it('every example has label and expr', () => {
        for (const ex of CRON_EXAMPLES) {
            expect(ex.label).toBeTruthy();
            expect(ex.expr).toBeTruthy();
        }
    });

    it('every example expression has 5 fields', () => {
        for (const ex of CRON_EXAMPLES) {
            expect(ex.expr.trim().split(/\s+/).length).toBe(5);
        }
    });

    it('every example is described by describeCron (non-empty)', () => {
        for (const ex of CRON_EXAMPLES) {
            expect(describeCron(ex.expr)).not.toBe('');
        }
    });
});

// ============================================================================
// Cron hint panel integration tests
// ============================================================================

describe('Cron hint panel UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSchedulesClient.list.mockResolvedValue([]);
        mockSchedulesClient.history.mockResolvedValue([]);
        mockSchedulesClient.create.mockResolvedValue({});
        mockModelsClient.list.mockResolvedValue([]);
        mockFetchApi.mockResolvedValue({ schedules: [] });
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ schedules: [] }),
        });
    });

    it('shows cron hint panel when cron mode is active', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-preset-custom-interval'));
        fireEvent.click(screen.getByTestId('schedule-trigger-mode-cron'));

        expect(screen.getByTestId('cron-hint-panel')).toBeTruthy();
        expect(screen.getByTestId('cron-field-legend')).toBeTruthy();
        expect(screen.getByTestId('cron-examples')).toBeTruthy();
    });

    it('does not show cron hint panel in interval mode', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));

        fireEvent.click(screen.getByTestId('schedule-preset-custom-interval'));

        // Custom schedule starts in interval mode
        expect(screen.queryByTestId('cron-hint-panel')).toBeNull();
    });

    it('field legend displays all 5 cron field badges', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        fireEvent.click(screen.getByTestId('schedule-preset-custom-interval'));
        fireEvent.click(screen.getByTestId('schedule-trigger-mode-cron'));

        const legend = screen.getByTestId('cron-field-legend');
        expect(legend.textContent).toContain('min');
        expect(legend.textContent).toContain('hr');
        expect(legend.textContent).toContain('dom');
        expect(legend.textContent).toContain('mon');
        expect(legend.textContent).toContain('dow');
    });

    it('shows human-readable description for default cron value', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        fireEvent.click(screen.getByTestId('schedule-preset-custom-interval'));
        fireEvent.click(screen.getByTestId('schedule-trigger-mode-cron'));

        // Default cron is "0 * * * *" which should produce "Every hour"
        const desc = screen.getByTestId('cron-description');
        expect(desc.textContent).toBe('Every hour');
    });

    it('clicking an example populates the cron input', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        fireEvent.click(screen.getByTestId('schedule-preset-custom-interval'));
        fireEvent.click(screen.getByTestId('schedule-trigger-mode-cron'));

        // Click "Every 5 minutes" example
        const exBtn = screen.getByTestId('cron-example-*/5-*-*-*-*');
        fireEvent.click(exBtn);

        const input = screen.getByPlaceholderText('0 9 * * *') as HTMLInputElement;
        expect(input.value).toBe('*/5 * * * *');
    });

    it('renders example buttons for all CRON_EXAMPLES', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('switch-to-advanced'));
        fireEvent.click(screen.getByTestId('schedule-preset-custom-interval'));
        fireEvent.click(screen.getByTestId('schedule-trigger-mode-cron'));

        for (const ex of CRON_EXAMPLES) {
            expect(screen.getByRole('button', { name: ex.label })).toBeTruthy();
        }
    });
});
