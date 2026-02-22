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
    it('exports 4 templates', () => {
        expect(SCHEDULE_TEMPLATES).toHaveLength(4);
    });

    it('every template has required fields', () => {
        for (const tpl of SCHEDULE_TEMPLATES) {
            expect(tpl.id).toBeTruthy();
            expect(tpl.label).toBeTruthy();
            expect(tpl.emoji).toBeTruthy();
            expect(tpl.name).toBeTruthy();
            expect(tpl.target).toBeTruthy();
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

        // Switch to run-pipeline
        fireEvent.click(screen.getByTestId('template-run-pipeline'));
        expect(nameInput.value).toBe('Run Pipeline');

        // Hint should update
        const tpl = SCHEDULE_TEMPLATES.find(t => t.id === 'run-pipeline')!;
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

    it('submitting with template sends params in the request body', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });

        await renderSchedulesTab();
        fireEvent.click(screen.getByText('+ New'));
        fireEvent.click(screen.getByTestId('template-auto-commit'));

        // Submit the form directly (Button defaults to type="button")
        const form = screen.getByTestId('template-picker').closest('form')!;
        fireEvent.submit(form);

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
