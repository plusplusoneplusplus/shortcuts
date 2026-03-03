/**
 * Tests for RepoSchedulesTab schedule template quick-starters.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { SCHEDULE_TEMPLATES } from '../../../src/server/spa/client/react/repos/RepoSchedulesTab';

// Mock fetch and fetchApi so the component can render without a real server
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ schedules: [] }),
});
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ schedules: [] }),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
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
        '../../../src/server/spa/client/react/repos/RepoSchedulesTab'
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
    it('exports 5 templates', () => {
        expect(SCHEDULE_TEMPLATES).toHaveLength(5);
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
        expect(ids).toContain('auto-commit');
        expect(ids).toContain('run-pipeline');
        expect(ids).toContain('pull-sync');
        expect(ids).toContain('clean-outputs');
        expect(ids).toContain('run-script');
    });
});

// ============================================================================
// CreateScheduleForm template UI tests
// ============================================================================

describe('CreateScheduleForm template UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ schedules: [] }),
        });
    });

    it('renders template picker chips when form is open', async () => {
        await renderSchedulesTab();

        // Click "+ New" to open the form
        const newBtn = screen.getByText('+ New');
        fireEvent.click(newBtn);

        const picker = screen.getByTestId('template-picker');
        expect(picker).toBeTruthy();

        // Each template should be rendered as a chip
        for (const tpl of SCHEDULE_TEMPLATES) {
            expect(screen.getByTestId(`template-${tpl.id}`)).toBeTruthy();
        }
    });

    it('clicking a template chip pre-fills name and target fields', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        const chip = screen.getByTestId('template-auto-commit');
        fireEvent.click(chip);

        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === 'auto-commit')!;

        // Check name and target inputs are pre-filled
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        const targetInput = screen.getByPlaceholderText(/Target/) as HTMLInputElement;
        expect(nameInput.value).toBe(tpl.name);
        expect(targetInput.value).toBe(tpl.target);
    });

    it('run-pipeline template starts with empty target for dropdown selection', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Run Pipeline');
        // Target should start empty (prompting dropdown selection)
        // No plain target input should exist — it's replaced by a dropdown/loading
    });

    it('clicking a template shows dynamic params fields', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        fireEvent.click(screen.getByTestId('template-auto-commit'));

        const paramsSection = screen.getByTestId('template-params');
        expect(paramsSection).toBeTruthy();

        // Auto-commit has directory and message params
        expect(screen.getByTestId('param-directory')).toBeTruthy();
        expect(screen.getByTestId('param-message')).toBeTruthy();
    });

    it('clicking a template shows the hint text', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === 'auto-commit')!;
        fireEvent.click(screen.getByTestId('template-auto-commit'));

        const hint = screen.getByTestId('template-hint');
        expect(hint.textContent).toBe(tpl.hint);
    });

    it('clicking the same template chip again deselects and clears form', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        // Select
        fireEvent.click(screen.getByTestId('template-auto-commit'));
        expect(screen.getByTestId('template-hint')).toBeTruthy();

        // Deselect
        fireEvent.click(screen.getByTestId('template-auto-commit'));

        // Hint and params should be gone
        expect(screen.queryByTestId('template-hint')).toBeNull();
        expect(screen.queryByTestId('template-params')).toBeNull();

        // Name should be cleared
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('');
    });

    it('switching between templates updates form fields', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        // Select auto-commit
        fireEvent.click(screen.getByTestId('template-auto-commit'));
        const nameInput = screen.getByPlaceholderText('Name (e.g., Daily Report)') as HTMLInputElement;
        expect(nameInput.value).toBe('Auto-commit');

        // Switch to pull-sync (another non-pipeline template)
        fireEvent.click(screen.getByTestId('template-pull-sync'));
        expect(nameInput.value).toBe('Pull & Sync');

        // Hint should update
        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === 'pull-sync')!;
        expect(screen.getByTestId('template-hint').textContent).toBe(tpl.hint);
    });

    it('param inputs are editable', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('template-auto-commit'));

        const dirInput = screen.getByTestId('param-directory') as HTMLInputElement;
        fireEvent.change(dirInput, { target: { value: './lib' } });
        expect(dirInput.value).toBe('./lib');
    });

    it('Create button has type="submit" so it triggers form submission', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

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
        fireEvent.click(screen.getByTestId('template-auto-commit'));

        // Submit by clicking the Create button (type="submit")
        const createBtn = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createBtn);

        // Wait for the POST call (form submits asynchronously)
        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                (c: any[]) => c[1]?.method === 'POST' && (c[0] as string).includes('/schedules'),
            );
            expect(postCalls.length).toBeGreaterThan(0);
        });

        const postCall = mockFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST' && (c[0] as string).includes('/schedules'),
        );
        expect(postCall).toBeTruthy();
        const body = JSON.parse(postCall![1].body);
        expect(body.params).toEqual({
            directory: './src',
            message: 'chore: auto-save',
        });
        expect(body.name).toBe('Auto-commit');
        expect(body.target).toBe('.vscode/schedules/auto-commit.md');
    });

    it('cron mode template sets mode to cron', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        // run-pipeline is a cron mode template
        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        // The Cron button should be highlighted (active)
        const cronBtn = screen.getByText('Cron');
        expect(cronBtn.className).toContain('bg-[#0078d4]');
    });

    it('interval mode template sets mode to interval', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        // pull-sync is an interval mode template
        fireEvent.click(screen.getByTestId('template-pull-sync'));

        const intervalBtn = screen.getByText('Interval');
        expect(intervalBtn.className).toContain('bg-[#0078d4]');
    });
});

// ============================================================================
// Pipeline dropdown selector tests
// ============================================================================

describe('Pipeline dropdown selector (target field)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ schedules: [] }),
        });
    });

    async function openRunPipelineTemplate() {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        // Override fetch to return pipelines for the pipeline API call
        mockFetch.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/pipelines')) {
                return {
                    ok: true,
                    json: () => Promise.resolve({
                        pipelines: [
                            { name: 'daily-report', path: 'pipelines/daily-report/pipeline.yaml' },
                            { name: 'data-sync', path: 'pipelines/data-sync/pipeline.yaml' },
                        ],
                    }),
                };
            }
            return { ok: true, json: () => Promise.resolve({ schedules: [] }) };
        });
        fireEvent.click(screen.getByTestId('template-run-pipeline'));
    }

    it('renders a <select> dropdown in the target position when pipelines are available', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            const selectEl = screen.getByTestId('target-pipeline-select');
            expect(selectEl.tagName).toBe('SELECT');
        });
    });

    it('dropdown contains discovered pipeline options', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        const options = Array.from(select.options).map(o => o.textContent);
        expect(options).toContain('daily-report');
        expect(options).toContain('data-sync');
    });

    it('dropdown includes a disabled placeholder option', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        const placeholder = Array.from(select.options).find(o => o.disabled);
        expect(placeholder).toBeTruthy();
        expect(placeholder!.textContent).toContain('Select a pipeline');
    });

    it('dropdown includes "Other (manual path)" option', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        const manualOpt = Array.from(select.options).find(o => o.value === '__manual__');
        expect(manualOpt).toBeTruthy();
        expect(manualOpt!.textContent).toContain('Other');
    });

    it('selecting a pipeline sets the target value', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'pipelines/daily-report/pipeline.yaml' } });

        expect(select.value).toBe('pipelines/daily-report/pipeline.yaml');
    });

    it('selecting "Other" switches to manual text input for target', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '__manual__' } });

        // Should now be an input, not a select
        await waitFor(() => {
            const inputEl = screen.getByTestId('target-pipeline-input');
            expect(inputEl.tagName).toBe('INPUT');
        });
    });

    it('falls back to text input when no pipelines are found', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        // Return empty pipelines
        mockFetch.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/pipelines')) {
                return { ok: true, json: () => Promise.resolve({ pipelines: [] }) };
            }
            return { ok: true, json: () => Promise.resolve({ schedules: [] }) };
        });

        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        await waitFor(() => {
            const inputEl = screen.getByTestId('target-pipeline-input');
            expect(inputEl.tagName).toBe('INPUT');
        });
    });

    it('falls back to text input when pipeline fetch fails', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        mockFetch.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/pipelines')) {
                return { ok: false, status: 500, statusText: 'Internal Server Error' };
            }
            return { ok: true, json: () => Promise.resolve({ schedules: [] }) };
        });

        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        await waitFor(() => {
            const inputEl = screen.getByTestId('target-pipeline-input');
            expect(inputEl.tagName).toBe('INPUT');
        });
    });

    it('shows loading indicator while fetching pipelines', async () => {
        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        // Make fetch hang indefinitely
        mockFetch.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/pipelines')) {
                return new Promise(() => {}); // never resolves
            }
            return { ok: true, json: () => Promise.resolve({ schedules: [] }) };
        });

        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        await waitFor(() => {
            expect(screen.getByTestId('pipeline-loading')).toBeTruthy();
        });
    });

    it('deselecting run-pipeline template resets manual mode', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        // Switch to manual
        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '__manual__' } });

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-input').tagName).toBe('INPUT');
        });

        // Deselect template
        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        // Re-select: should be back to dropdown (not stuck in manual)
        mockFetch.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/pipelines')) {
                return {
                    ok: true,
                    json: () => Promise.resolve({
                        pipelines: [
                            { name: 'daily-report', path: 'pipelines/daily-report/pipeline.yaml' },
                        ],
                    }),
                };
            }
            return { ok: true, json: () => Promise.resolve({ schedules: [] }) };
        });
        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });
    });

    it('no PARAMETERS section is shown for run-pipeline template', async () => {
        await openRunPipelineTemplate();

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        // The template-params section should not exist since params is empty
        expect(screen.queryByTestId('template-params')).toBeNull();
    });

    it('params.pipeline is set when a pipeline is selected from dropdown', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ schedules: [] }),
        });

        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));

        mockFetch.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/pipelines')) {
                return {
                    ok: true,
                    json: () => Promise.resolve({
                        pipelines: [
                            { name: 'daily-report', path: 'pipelines/daily-report/pipeline.yaml' },
                        ],
                    }),
                };
            }
            // Accept POST for schedule creation
            return { ok: true, json: () => Promise.resolve({}) };
        });

        fireEvent.click(screen.getByTestId('template-run-pipeline'));

        await waitFor(() => {
            expect(screen.getByTestId('target-pipeline-select').tagName).toBe('SELECT');
        });

        // Select a pipeline
        const select = screen.getByTestId('target-pipeline-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'pipelines/daily-report/pipeline.yaml' } });

        // Submit by clicking the Create button (type="submit")
        const createBtn = screen.getByRole('button', { name: 'Create' });
        fireEvent.click(createBtn);

        // Verify POST body contains params.pipeline
        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                (c: any[]) => c[1]?.method === 'POST' && (c[0] as string).includes('/schedules'),
            );
            expect(postCalls.length).toBeGreaterThan(0);
        });

        const postCall = mockFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST' && (c[0] as string).includes('/schedules'),
        );
        const body = JSON.parse(postCall![1].body);
        expect(body.params.pipeline).toBe('pipelines/daily-report/pipeline.yaml');
        expect(body.target).toBe('pipelines/daily-report/pipeline.yaml');
    });
});
