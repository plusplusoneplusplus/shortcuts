/**
 * Tests for Run Script Templates selection + detail view in TemplatesTab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';
import type { ScriptTemplate } from '../../../../src/server/spa/client/react/features/templates/hooks/useScriptTemplates';

// ── Global stubs ──

vi.stubGlobal('confirm', () => true);

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
vi.stubGlobal('fetch', mockFetch);

const mockAddToast = vi.fn();
const mockEnqueueTask = vi.fn().mockResolvedValue({ task: { id: 'enqueued-1' } });
const mockQueueList = vi.fn().mockResolvedValue({ queued: [], running: [], stats: {} });

// ── Module mocks ──

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueueTask, list: mockQueueList },
        templates: {
            list: vi.fn().mockResolvedValue([]),
            detail: vi.fn().mockResolvedValue({}),
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
            replicate: vi.fn().mockResolvedValue({}),
        },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

const mockFetchApi = vi.fn().mockResolvedValue({ templates: [] });
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d || 'unknown',
}));

const mockDeleteScriptTemplate = vi.fn();
const mockUpdateScriptTemplate = vi.fn();
const mockUseScriptTemplates = vi.fn().mockReturnValue({
    templates: [],
    saveTemplate: vi.fn(),
    updateTemplate: mockUpdateScriptTemplate,
    deleteTemplate: mockDeleteScriptTemplate,
    loaded: true,
});
vi.mock('../../../../src/server/spa/client/react/features/templates/hooks/useScriptTemplates', () => ({
    useScriptTemplates: (...args: any[]) => mockUseScriptTemplates(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/templates/hooks/useSkillTemplates', () => ({
    useSkillTemplates: vi.fn().mockReturnValue({
        templates: [],
        deleteTemplate: vi.fn(),
        loaded: true,
    }),
}));

// ── Wrapper ──

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

// ── Sample data ──

const SCRIPT_TEMPLATES: ScriptTemplate[] = [
    {
        id: 'st-1',
        name: 'Build Project',
        scriptPath: './build.sh',
        args: '--release',
        workingDirectory: '/workspace/project',
        model: 'gpt-4o',
        pauseOnFailure: true,
    },
    {
        id: 'st-2',
        name: 'Run Tests',
        scriptPath: './test.sh',
    },
];

// ── Helpers ──

function makeRepo() {
    return {
        workspace: { id: 'ws-1' },
        workflows: [],
    } as any;
}

async function renderTemplatesTab(scriptTemplateOverride: ScriptTemplate[] = SCRIPT_TEMPLATES) {
    mockUseScriptTemplates.mockReturnValue({
        templates: scriptTemplateOverride,
        saveTemplate: vi.fn(),
        updateTemplate: mockUpdateScriptTemplate,
        deleteTemplate: mockDeleteScriptTemplate,
        loaded: true,
    });
    const { TemplatesTab } = await import('../../../../src/server/spa/client/react/features/templates/TemplatesTab');
    const repo = makeRepo();
    render(<Wrap><TemplatesTab repo={repo} /></Wrap>);
    await waitFor(() => expect(screen.getByTestId('script-templates-section')).toBeDefined());
}

// ── Tests ──

describe('Run Script Templates — selection and detail view', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDeleteScriptTemplate.mockReset();
        mockUpdateScriptTemplate.mockReset();
        mockAddToast.mockReset();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ templates: [] });
    });

    it('renders list items with unique test IDs', async () => {
        await renderTemplatesTab();
        expect(screen.getByTestId('script-template-item-st-1')).toBeDefined();
        expect(screen.getByTestId('script-template-item-st-2')).toBeDefined();
    });

    it('clicking a script template shows detail view in right panel', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const detail = screen.getByTestId('script-template-detail');
            expect(detail).toBeDefined();
            expect(detail.textContent).toContain('Build Project');
        });
    });

    it('detail view displays script path in code block', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const scriptVal = screen.getByTestId('script-template-script-value');
            expect(scriptVal.textContent).toBe('./build.sh');
        });
    });

    it('detail view displays args when present', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const argsVal = screen.getByTestId('script-template-args-value');
            expect(argsVal.textContent).toBe('--release');
        });
    });

    it('detail view hides args when not present', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-2'));
        await waitFor(() => {
            expect(screen.getByTestId('script-template-detail')).toBeDefined();
        });
        expect(screen.queryByTestId('script-template-args-value')).toBeNull();
    });

    it('detail view displays working directory when present', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const cwdVal = screen.getByTestId('script-template-cwd-value');
            expect(cwdVal.textContent).toBe('/workspace/project');
        });
    });

    it('detail view hides working directory when not present', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-2'));
        await waitFor(() => {
            expect(screen.getByTestId('script-template-detail')).toBeDefined();
        });
        expect(screen.queryByTestId('script-template-cwd-value')).toBeNull();
    });

    it('detail view displays model value', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const modelVal = screen.getByTestId('script-template-model-value');
            expect(modelVal.textContent).toBe('gpt-4o');
        });
    });

    it('detail view shows "default" when no model', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-2'));
        await waitFor(() => {
            const modelVal = screen.getByTestId('script-template-model-value');
            expect(modelVal.textContent).toBe('default');
        });
    });

    it('detail view displays pause on failure badge', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const pauseVal = screen.getByTestId('script-template-pause-value');
            expect(pauseVal.textContent).toBe('Yes');
        });
    });

    it('detail view shows "No" for pause on failure when disabled', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-2'));
        await waitFor(() => {
            const pauseVal = screen.getByTestId('script-template-pause-value');
            expect(pauseVal.textContent).toBe('No');
        });
    });

    it('detail view has Delete button', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            expect(screen.getByTestId('script-template-delete-btn')).toBeDefined();
        });
    });

    it('detail view has Enqueue button', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const btn = screen.getByTestId('script-template-enqueue-btn');
            expect(btn).toBeDefined();
            expect(btn.textContent).toContain('Enqueue');
        });
    });

    it('Enqueue button sends correct API payload', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-enqueue-btn'));

        fireEvent.click(screen.getByTestId('script-template-enqueue-btn'));

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledTimes(1);

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.type).toBe('run-script');
            expect(body.displayName).toBe('build.sh');
            expect(body.payload.script).toBe('./build.sh --release');
            expect(body.payload.workingDirectory).toBe('/workspace/project');
            expect(body.config.model).toBe('gpt-4o');
            expect(body.config.pauseOnFailure).toBe(true);
            expect(body.repoId).toBe('ws-1');
        });
    });

    it('Enqueue button sends correct payload for template without optional fields', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-2'));
        await waitFor(() => screen.getByTestId('script-template-enqueue-btn'));

        fireEvent.click(screen.getByTestId('script-template-enqueue-btn'));

        await waitFor(() => {
            expect(mockEnqueueTask).toHaveBeenCalledTimes(1);

            const body = mockEnqueueTask.mock.calls[0][0];
            expect(body.type).toBe('run-script');
            expect(body.payload.script).toBe('./test.sh');
            expect(body.payload.workingDirectory).toBeUndefined();
            expect(body.config).toEqual({});
        });
    });

    it('selecting a script template updates location hash', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            expect(location.hash).toContain('script-template/st-1');
        });
    });

    it('selecting a script template clears empty-state placeholder', async () => {
        await renderTemplatesTab();
        // Initially empty state should show
        expect(screen.getByTestId('templates-empty-detail')).toBeDefined();

        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            expect(screen.queryByTestId('templates-empty-detail')).toBeNull();
        });
    });

    it('deleting a script template via context menu calls deleteTemplate', async () => {
        await renderTemplatesTab();
        const item = screen.getByTestId('script-template-item-st-1');
        fireEvent.contextMenu(item);
        await waitFor(() => {
            expect(screen.getByText('Delete')).toBeDefined();
        });
        fireEvent.click(screen.getByText('Delete'));
        expect(mockDeleteScriptTemplate).toHaveBeenCalledWith('st-1');
    });

    it('deleting selected script template clears right panel', async () => {
        await renderTemplatesTab();
        // Select st-1
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => expect(screen.getByTestId('script-template-detail')).toBeDefined());

        // Delete via detail view Delete button
        fireEvent.click(screen.getByTestId('script-template-delete-btn'));

        await waitFor(() => {
            expect(screen.queryByTestId('script-template-detail')).toBeNull();
        });
    });

    it('selection highlight is applied to selected item', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            const item = screen.getByTestId('script-template-item-st-1');
            expect(item.className).toContain('border-l-[#0078d4]');
        });
    });

    it('selecting a different item deselects the previous one', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-detail'));

        fireEvent.click(screen.getByTestId('script-template-item-st-2'));
        await waitFor(() => {
            const detail = screen.getByTestId('script-template-detail');
            expect(detail.textContent).toContain('Run Tests');
        });
        // First item should no longer have selection highlight
        const item1 = screen.getByTestId('script-template-item-st-1');
        expect(item1.className).not.toContain('border-l-[#0078d4]');
    });

    it('empty state shows when nothing is selected', async () => {
        await renderTemplatesTab();
        expect(screen.getByTestId('templates-empty-detail').textContent).toContain('Select a workflow or template');
    });

    it('section collapses on header click', async () => {
        await renderTemplatesTab();
        expect(screen.getByTestId('script-templates-list')).toBeDefined();

        const section = screen.getByTestId('script-templates-section');
        const header = section.querySelector('[class*="cursor-pointer"]') as HTMLElement;
        fireEvent.click(header);

        await waitFor(() => {
            expect(screen.queryByTestId('script-templates-list')).toBeNull();
        });
    });
});

describe('Run Script Templates — edit mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDeleteScriptTemplate.mockReset();
        mockUpdateScriptTemplate.mockReset();
        mockAddToast.mockReset();
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        mockFetchApi.mockResolvedValue({ templates: [] });
    });

    it('detail view has Edit button in view mode', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => {
            expect(screen.getByTestId('script-template-edit-btn')).toBeDefined();
        });
    });

    it('clicking Edit button switches to edit mode with form inputs', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));

        fireEvent.click(screen.getByTestId('script-template-edit-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('script-template-edit-name')).toBeDefined();
            expect(screen.getByTestId('script-template-edit-script')).toBeDefined();
            expect(screen.getByTestId('script-template-edit-args')).toBeDefined();
            expect(screen.getByTestId('script-template-edit-cwd')).toBeDefined();
            expect(screen.getByTestId('script-template-edit-model')).toBeDefined();
            expect(screen.getByTestId('script-template-edit-pause')).toBeDefined();
        });
    });

    it('edit mode pre-populates form with current values', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));

        await waitFor(() => {
            expect((screen.getByTestId('script-template-edit-name') as HTMLInputElement).value).toBe('Build Project');
            expect((screen.getByTestId('script-template-edit-script') as HTMLInputElement).value).toBe('./build.sh');
            expect((screen.getByTestId('script-template-edit-args') as HTMLInputElement).value).toBe('--release');
            expect((screen.getByTestId('script-template-edit-cwd') as HTMLInputElement).value).toBe('/workspace/project');
            expect((screen.getByTestId('script-template-edit-model') as HTMLInputElement).value).toBe('gpt-4o');
            expect((screen.getByTestId('script-template-edit-pause') as HTMLInputElement).checked).toBe(true);
        });
    });

    it('edit mode hides Enqueue and Delete buttons, shows Save and Cancel', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('script-template-save-btn')).toBeDefined();
            expect(screen.getByTestId('script-template-cancel-btn')).toBeDefined();
            expect(screen.queryByTestId('script-template-enqueue-btn')).toBeNull();
            expect(screen.queryByTestId('script-template-delete-btn')).toBeNull();
        });
    });

    it('Cancel button discards changes and returns to view mode', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-name'));

        // Modify a field
        fireEvent.change(screen.getByTestId('script-template-edit-name'), { target: { value: 'Changed Name' } });

        // Click Cancel
        fireEvent.click(screen.getByTestId('script-template-cancel-btn'));

        await waitFor(() => {
            // Should be back in view mode with original name
            expect(screen.queryByTestId('script-template-edit-name')).toBeNull();
            expect(screen.getByTestId('script-template-detail').textContent).toContain('Build Project');
        });
    });

    it('Save button calls updateTemplate with edited values', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-name'));

        // Edit fields
        fireEvent.change(screen.getByTestId('script-template-edit-name'), { target: { value: 'New Name' } });
        fireEvent.change(screen.getByTestId('script-template-edit-script'), { target: { value: './new-script.sh' } });
        fireEvent.change(screen.getByTestId('script-template-edit-args'), { target: { value: '--debug' } });
        fireEvent.change(screen.getByTestId('script-template-edit-cwd'), { target: { value: '/new/dir' } });
        fireEvent.change(screen.getByTestId('script-template-edit-model'), { target: { value: 'claude-sonnet' } });
        fireEvent.click(screen.getByTestId('script-template-edit-pause'));

        // Save
        fireEvent.click(screen.getByTestId('script-template-save-btn'));

        await waitFor(() => {
            expect(mockUpdateScriptTemplate).toHaveBeenCalledWith('st-1', {
                name: 'New Name',
                scriptPath: './new-script.sh',
                args: '--debug',
                workingDirectory: '/new/dir',
                model: 'claude-sonnet',
                pauseOnFailure: undefined,
            });
        });
    });

    it('Save returns to view mode after successful save', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-save-btn'));

        fireEvent.click(screen.getByTestId('script-template-save-btn'));

        await waitFor(() => {
            expect(screen.queryByTestId('script-template-edit-name')).toBeNull();
            expect(screen.getByTestId('script-template-enqueue-btn')).toBeDefined();
        });
    });

    it('Save trims whitespace from field values', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-name'));

        fireEvent.change(screen.getByTestId('script-template-edit-name'), { target: { value: '  Trimmed Name  ' } });
        fireEvent.change(screen.getByTestId('script-template-edit-script'), { target: { value: '  ./script.sh  ' } });
        fireEvent.click(screen.getByTestId('script-template-save-btn'));

        await waitFor(() => {
            expect(mockUpdateScriptTemplate).toHaveBeenCalledWith('st-1', expect.objectContaining({
                name: 'Trimmed Name',
                scriptPath: './script.sh',
            }));
        });
    });

    it('Save does not call updateTemplate when name is empty', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-name'));

        fireEvent.change(screen.getByTestId('script-template-edit-name'), { target: { value: '' } });
        fireEvent.click(screen.getByTestId('script-template-save-btn'));

        expect(mockUpdateScriptTemplate).not.toHaveBeenCalled();
    });

    it('Save does not call updateTemplate when scriptPath is empty', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-script'));

        fireEvent.change(screen.getByTestId('script-template-edit-script'), { target: { value: '   ' } });
        fireEvent.click(screen.getByTestId('script-template-save-btn'));

        expect(mockUpdateScriptTemplate).not.toHaveBeenCalled();
    });

    it('Save clears optional fields to undefined when emptied', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-args'));

        fireEvent.change(screen.getByTestId('script-template-edit-args'), { target: { value: '' } });
        fireEvent.change(screen.getByTestId('script-template-edit-cwd'), { target: { value: '' } });
        fireEvent.change(screen.getByTestId('script-template-edit-model'), { target: { value: '' } });
        fireEvent.click(screen.getByTestId('script-template-save-btn'));

        await waitFor(() => {
            expect(mockUpdateScriptTemplate).toHaveBeenCalledWith('st-1', expect.objectContaining({
                args: undefined,
                workingDirectory: undefined,
                model: undefined,
            }));
        });
    });

    it('context menu shows Edit option for script templates', async () => {
        await renderTemplatesTab();
        const item = screen.getByTestId('script-template-item-st-1');
        fireEvent.contextMenu(item);
        await waitFor(() => {
            expect(screen.getByText('Edit')).toBeDefined();
            expect(screen.getByText('Delete')).toBeDefined();
        });
    });

    it('context menu Edit triggers edit mode', async () => {
        await renderTemplatesTab();
        const item = screen.getByTestId('script-template-item-st-1');
        fireEvent.contextMenu(item);
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));

        await waitFor(() => {
            expect(screen.getByTestId('script-template-edit-name')).toBeDefined();
            expect(screen.getByTestId('script-template-save-btn')).toBeDefined();
        });
    });

    it('selecting a different template exits edit mode', async () => {
        await renderTemplatesTab();
        fireEvent.click(screen.getByTestId('script-template-item-st-1'));
        await waitFor(() => screen.getByTestId('script-template-edit-btn'));
        fireEvent.click(screen.getByTestId('script-template-edit-btn'));
        await waitFor(() => screen.getByTestId('script-template-edit-name'));

        // Select a different template
        fireEvent.click(screen.getByTestId('script-template-item-st-2'));

        await waitFor(() => {
            expect(screen.queryByTestId('script-template-edit-name')).toBeNull();
            expect(screen.getByTestId('script-template-detail').textContent).toContain('Run Tests');
        });
    });
});
