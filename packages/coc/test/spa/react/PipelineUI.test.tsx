/**
 * Tests for Pipeline UI components: WorkflowDetail, AddWorkflowDialog, WorkflowsTab interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { WorkflowDetail } from '../../../src/server/spa/client/react/repos/WorkflowDetail';
import { AddWorkflowDialog } from '../../../src/server/spa/client/react/repos/AddWorkflowDialog';
import { WorkflowsTab } from '../../../src/server/spa/client/react/repos/WorkflowsTab';
import type { RepoData, WorkflowInfo } from '../../../src/server/spa/client/react/repos/repoGrouping';
import * as pipelineApi from '../../../src/server/spa/client/react/repos/workflow-api';

// Mock fetchApi used by WorkflowRunHistory (rendered inside WorkflowDetail)
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ history: [] }),
}));

const mockAddToast = vi.fn();

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

function makeRepo(overrides: Partial<RepoData> & { workspace: any }): RepoData {
    return {
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true },
        workflows: [],
        stats: { success: 0, failed: 0, running: 0 },
        taskCount: 0,
        ...overrides,
    };
}

const samplePipeline: WorkflowInfo = {
    name: 'my-pipeline',
    path: '.vscode/workflows/my-pipeline/pipeline.yaml',
    description: 'Test pipeline',
    isValid: true,
    validationErrors: [],
};

const sampleYaml = 'name: my-pipeline\ndescription: Test\ninput:\n  type: csv\n  path: data.csv';

beforeEach(() => {
    vi.restoreAllMocks();
    mockAddToast.mockClear();
});

// ============================================================================
// WorkflowDetail
// ============================================================================

describe('WorkflowDetail', () => {
    beforeEach(() => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
    });

    it('renders pipeline name and path after loading', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('my-pipeline')).toBeDefined();
        });
        expect(screen.getByText(samplePipeline.path)).toBeDefined();
    });

    it('renders YAML content in a pre element in view mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText(/name: my-pipeline/)).toBeDefined();
        });
        const pre = document.querySelector('pre');
        expect(pre).not.toBeNull();
    });

    it('shows valid badge when isValid is true', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('✅ Valid')).toBeDefined();
        });
    });

    it('shows invalid badge when isValid is false', async () => {
        const invalidPipeline = { ...samplePipeline, isValid: false, validationErrors: ['Missing input'] };
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={invalidPipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('⚠️ Invalid')).toBeDefined();
        });
    });

    it('shows Edit and Delete buttons in view mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Edit')).toBeDefined();
            expect(screen.getByText('Delete')).toBeDefined();
        });
    });

    it('action buttons are in the header row, not a footer', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        // The Run button and pipeline name should share the same top-level header container
        const runBtn = screen.getByTestId('workflow-run-btn');
        const nameEl = screen.getByText('my-pipeline');
        // Both live inside the header div (direct child of the root flex-col)
        const headerDiv = nameEl.parentElement!;
        expect(headerDiv.contains(runBtn)).toBe(true);
        // No border-t footer div should exist (footer was removed)
        const root = document.querySelector('[class*="flex-col"]')!;
        const allDivs = root.querySelectorAll('div');
        const footerDivs = Array.from(allDivs).filter(d => d.className.includes('border-t'));
        expect(footerDivs.length).toBe(0);
    });

    it('edit mode Cancel/Save buttons are in the header row', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        const saveBtn = screen.getByText('Save');
        const cancelBtn = screen.getByText('Cancel');
        // Both should be inside the header div that contains the pipeline name
        const headerDiv = screen.getByText('my-pipeline').parentElement!;
        expect(headerDiv.contains(saveBtn)).toBe(true);
        expect(headerDiv.contains(cancelBtn)).toBe(true);
    });

    it('switches to edit mode with textarea when Edit is clicked', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        const textarea = document.querySelector('textarea');
        expect(textarea).not.toBeNull();
        expect(textarea!.value).toBe(sampleYaml);
    });

    it('shows Save and Cancel buttons in edit mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByText('Save')).toBeDefined();
        expect(screen.getByText('Cancel')).toBeDefined();
    });

    it('Cancel returns to view mode without saving', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'saveWorkflowContent');
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Cancel'));
        // Back to view mode — pre should reappear
        expect(document.querySelector('pre')).not.toBeNull();
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('shows inline error on empty content save', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: '   ' } });
        fireEvent.click(screen.getByText('Save'));
        expect(screen.getByText('Workflow content cannot be empty')).toBeDefined();
    });

    it('Save calls saveWorkflowContent and shows success toast', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'saveWorkflowContent').mockResolvedValue();
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'name: updated' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Save'));
        });
        expect(saveSpy).toHaveBeenCalledWith('ws-1', 'my-pipeline', 'name: updated');
        expect(mockAddToast).toHaveBeenCalledWith('Workflow saved', 'success');
    });

    it('Save shows inline error on API failure', async () => {
        vi.spyOn(pipelineApi, 'saveWorkflowContent').mockRejectedValue(new Error('Bad YAML'));
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        await act(async () => {
            fireEvent.click(screen.getByText('Save'));
        });
        expect(screen.getByText('Bad YAML')).toBeDefined();
    });

    it('Delete button opens confirmation dialog', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Delete'));
        fireEvent.click(screen.getByText('Delete'));
        expect(screen.getByText('Delete Workflow')).toBeDefined();
        expect(screen.getByText(/Are you sure you want to delete/)).toBeDefined();
    });

    it('confirming delete calls deleteWorkflow and onDeleted', async () => {
        const deleteSpy = vi.spyOn(pipelineApi, 'deleteWorkflow').mockResolvedValue();
        const onDeleted = vi.fn();
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={onDeleted} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Delete'));
        fireEvent.click(screen.getByText('Delete'));
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm'));
        });
        expect(deleteSpy).toHaveBeenCalledWith('ws-1', 'my-pipeline');
        expect(mockAddToast).toHaveBeenCalledWith('Workflow deleted', 'success');
        expect(onDeleted).toHaveBeenCalled();
    });

    it('cancelling delete dialog leaves panel open', async () => {
        const onDeleted = vi.fn();
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={onDeleted} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Delete'));
        fireEvent.click(screen.getByText('Delete'));
        // Find Cancel inside the dialog (there may be multiple Cancel buttons)
        const cancelButtons = screen.getAllByText('Cancel');
        fireEvent.click(cancelButtons[cancelButtons.length - 1]);
        // Panel should still be open
        expect(screen.getByText('my-pipeline')).toBeDefined();
        expect(onDeleted).not.toHaveBeenCalled();
    });

    it('Close button calls onClose', async () => {
        const onClose = vi.fn();
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={onClose} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Close'));
        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalled();
    });

    // ---- ▶ Run button tests ----

    it('renders ▶ Run button in view mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        expect(screen.getByTestId('workflow-run-btn')).toBeDefined();
        expect(screen.getByTestId('workflow-run-btn').textContent).toContain('Run');
    });

    it('▶ Run button is not disabled when pipeline.isValid is true', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        const btn = screen.getByTestId('workflow-run-btn');
        expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('▶ Run button is not disabled when pipeline.isValid is undefined', async () => {
        const undefinedValidPipeline = { ...samplePipeline, isValid: undefined };
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={undefinedValidPipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        const btn = screen.getByTestId('workflow-run-btn');
        expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('▶ Run button is disabled when pipeline.isValid is false', async () => {
        const invalidPipeline = { ...samplePipeline, isValid: false, validationErrors: ['missing input'] };
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={invalidPipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        const btn = screen.getByTestId('workflow-run-btn');
        expect(btn.getAttribute('disabled')).not.toBeNull();
        expect(btn.getAttribute('title')).toBe('Fix validation errors before running');
    });

    it('▶ Run button is not shown in edit mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.queryByTestId('workflow-run-btn')).toBeNull();
    });

    it('clicking ▶ Run calls runWorkflow and shows success toast', async () => {
        const onRunSuccess = vi.fn();
        vi.spyOn(pipelineApi, 'runWorkflow').mockResolvedValue({ task: { id: 'abcdef1234567890' } });
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} onRunSuccess={onRunSuccess} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        fireEvent.click(screen.getByTestId('workflow-run-btn'));
        await waitFor(() => {
            expect(pipelineApi.runWorkflow).toHaveBeenCalledWith('ws-1', 'my-pipeline');
            expect(mockAddToast).toHaveBeenCalledWith('Workflow queued (abcdef12)', 'success');
            expect(onRunSuccess).toHaveBeenCalled();
        });
    });

    it('clicking ▶ Run shows error toast on failure', async () => {
        vi.spyOn(pipelineApi, 'runWorkflow').mockRejectedValue(new Error('AI unavailable'));
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        fireEvent.click(screen.getByTestId('workflow-run-btn'));
        await waitFor(() => {
            expect(mockAddToast).toHaveBeenCalledWith('Failed to run workflow: AI unavailable', 'error');
        });
    });

    it('▶ Run shows toast without task ID when response has no id', async () => {
        vi.spyOn(pipelineApi, 'runWorkflow').mockResolvedValue({ task: {} });
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('my-pipeline'));
        fireEvent.click(screen.getByTestId('workflow-run-btn'));
        await waitFor(() => {
            expect(mockAddToast).toHaveBeenCalledWith('Workflow queued', 'success');
        });
    });

    // ---- Tab bar tests ----

    it('tab bar renders with Workflow and Run History tabs in view mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByTestId('workflow-tab-bar'));
        expect(screen.getByText('Workflow')).toBeDefined();
        expect(screen.getByText('Run History')).toBeDefined();
    });

    it('default active tab is Workflow, showing YAML content', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText(/name: my-pipeline/));
        const pre = document.querySelector('pre');
        expect(pre).not.toBeNull();
        // Run History component not shown on default tab
        expect(screen.queryByTestId('pipeline-run-history')).toBeNull();
    });

    it('clicking Run History tab shows WorkflowRunHistory component', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByTestId('workflow-tab-bar'));
        fireEvent.click(screen.getByText('Run History'));
        await waitFor(() => {
            expect(screen.getByTestId('pipeline-run-history')).toBeDefined();
        });
        expect(document.querySelector('pre')).toBeNull();
    });

    it('tab bar is hidden in edit mode', async () => {
        render(
            <Wrap>
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.queryByTestId('workflow-tab-bar')).toBeNull();
    });

    it('active-task badge shows on Run History tab when tasks are running', async () => {
        const { useQueue } = await import('../../../src/server/spa/client/react/context/QueueContext');
        const activeTask = {
            id: 'task-1',
            type: 'run-workflow',
            status: 'running',
            metadata: { pipelineName: 'my-pipeline' },
        };

        function SeedQueue() {
            const { dispatch } = useQueue();
            // eslint-disable-next-line react-hooks/exhaustive-deps
            const { useLayoutEffect } = require('react');
            useLayoutEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-1',
                    queue: { running: [activeTask], queued: [], history: [], stats: { total: 1, queued: 0, running: 1, completed: 0, failed: 0 } },
                });
            }, []);
            return null;
        }

        render(
            <Wrap>
                <SeedQueue />
                <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByTestId('workflow-tab-bar'));
        await waitFor(() => {
            expect(screen.getByTestId('active-task-badge')).toBeDefined();
            expect(screen.getByTestId('active-task-badge').textContent).toBe('1');
        });
    });
});

// ============================================================================
// AddWorkflowDialog
// ============================================================================

describe('AddWorkflowDialog', () => {
    it('renders dialog with title and inputs', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        expect(screen.getByText('New Workflow')).toBeDefined();
        expect(screen.getByText('Name')).toBeDefined();
        expect(screen.getByText('Template')).toBeDefined();
    });

    it('shows error on empty name submit', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        fireEvent.change(document.querySelector('select')!, { target: { value: 'custom' } });
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText('Name is required')).toBeDefined();
    });

    it('shows error on invalid name with special chars', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        fireEvent.change(document.querySelector('select')!, { target: { value: 'custom' } });
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: '-bad-name' } });
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText(/must start with a letter or number/)).toBeDefined();
    });

    it('does not call API on invalid name', () => {
        const createSpy = vi.spyOn(pipelineApi, 'createWorkflow');
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        fireEvent.change(document.querySelector('select')!, { target: { value: 'custom' } });
        fireEvent.click(screen.getByText('Create'));
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('calls createWorkflow with valid name and template', async () => {
        const createSpy = vi.spyOn(pipelineApi, 'createWorkflow').mockResolvedValue();
        const onCreated = vi.fn();
        const onClose = vi.fn();
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={onCreated} onClose={onClose} />
            </Wrap>
        );
        fireEvent.change(document.querySelector('select')!, { target: { value: 'custom' } });
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'test-pipeline' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        expect(createSpy).toHaveBeenCalledWith('ws-1', 'test-pipeline', 'custom');
        expect(mockAddToast).toHaveBeenCalledWith('Workflow created', 'success');
        expect(onCreated).toHaveBeenCalledWith('test-pipeline');
        expect(onClose).toHaveBeenCalled();
    });

    it('includes selected template in API call', async () => {
        const createSpy = vi.spyOn(pipelineApi, 'createWorkflow').mockResolvedValue();
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        const select = document.querySelector('select')!;
        fireEvent.change(input, { target: { value: 'new-pipe' } });
        fireEvent.change(select, { target: { value: 'data-fanout' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        expect(createSpy).toHaveBeenCalledWith('ws-1', 'new-pipe', 'data-fanout');
    });

    it('shows error on API failure', async () => {
        vi.spyOn(pipelineApi, 'createWorkflow').mockRejectedValue(new Error('Already exists'));
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        fireEvent.change(document.querySelector('select')!, { target: { value: 'custom' } });
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'test' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        expect(screen.getByText('Already exists')).toBeDefined();
    });

    it('has all four template options', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
        expect(options).toContain('Custom (blank)');
        expect(options).toContain('Data Fan-out');
        expect(options).toContain('Model Fan-out');
        expect(options).toContain('AI Generated (describe in natural language)');
    });

    it('Cancel button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={onClose} />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    // --- AI Generation Flow ---

    it('selecting "AI Generated" template shows textarea and tip block', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        expect(document.querySelector('textarea')).not.toBeNull();
        expect(screen.getByText(/Tip: Mention your data source/)).toBeDefined();
    });

    it('non-AI templates do NOT show textarea', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'custom' } });
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('"Generate Pipeline ✨" button disabled when description < 10 chars', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'short' } });
        const btn = screen.getByText('Generate Workflow ✨');
        expect(btn.closest('button')!.disabled).toBe(true);
    });

    it('"Generate Pipeline ✨" button enabled when description ≥ 10 chars', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        const btn = screen.getByText('Generate Workflow ✨');
        expect(btn.closest('button')!.disabled).toBe(false);
    });

    it('character counter displays current length and turns red near limit', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'hello world' } });
        expect(screen.getByText('11 / 2000 characters')).toBeDefined();

        // Near limit — text turns red
        fireEvent.change(textarea, { target: { value: 'x'.repeat(1950) } });
        const counter = screen.getByText('1950 / 2000 characters');
        expect(counter.className).toContain('text-red-500');
    });

    it('clicking "Generate Pipeline ✨" calls generateWorkflow API', async () => {
        const genSpy = vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        expect(genSpy).toHaveBeenCalledWith('ws-1', 'my-pipe', 'classify tickets by urgency', expect.any(Object));
    });

    it('generating phase shows spinner and cancel button', async () => {
        let resolveGen: (v: any) => void;
        vi.spyOn(pipelineApi, 'generateWorkflow').mockImplementation(() =>
            new Promise(resolve => { resolveGen = resolve; })
        );
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        expect(screen.getByText('Generating workflow YAML...')).toBeDefined();
        expect(screen.getByText('Cancel')).toBeDefined();
        expect(document.querySelector('[aria-label="Loading"]')).not.toBeNull();
        // Clean up
        await act(async () => { resolveGen!({ yaml: 'x', valid: true }); });
    });

    it('cancel during generation returns to input with description preserved', async () => {
        let resolveGen: (v: any) => void;
        vi.spyOn(pipelineApi, 'generateWorkflow').mockImplementation((_ws, _n, _d, signal) =>
            new Promise((resolve, reject) => {
                resolveGen = resolve;
                signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            })
        );
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Now in generating phase — click Cancel
        await act(async () => {
            fireEvent.click(screen.getByText('Cancel'));
        });
        // Back to input phase with description preserved
        const ta = document.querySelector('textarea') as HTMLTextAreaElement;
        expect(ta).not.toBeNull();
        expect(ta.value).toBe('classify tickets by urgency');
    });

    it('successful generation transitions to preview with YAML and valid badge', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: generated\ninput:\n  type: csv',
            valid: true,
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        expect(screen.getByText('Review Generated Workflow')).toBeDefined();
        expect(document.querySelector('pre')!.textContent).toContain('name: generated');
        expect(screen.getByText('✅ Valid workflow')).toBeDefined();
    });

    it('invalid generation shows warning badge and collapsible errors', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: bad',
            valid: false,
            validationError: 'Missing input',
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        expect(screen.getByText('⚠️ Invalid workflow')).toBeDefined();
        expect(screen.getByText('Validation errors (1)')).toBeDefined();
    });

    it('"← Back" returns to input with description preserved', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Now in preview — click Back
        fireEvent.click(screen.getByText('← Back'));
        const ta = document.querySelector('textarea') as HTMLTextAreaElement;
        expect(ta).not.toBeNull();
        expect(ta.value).toBe('classify tickets by urgency');
    });

    it('"Regenerate 🔄" re-calls generateWorkflow', async () => {
        const genSpy = vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        genSpy.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByText('Regenerate 🔄'));
        });
        expect(genSpy).toHaveBeenCalledTimes(1);
    });

    it('"Save Pipeline ✓" calls createWorkflow with content and triggers onCreated with name', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: generated-yaml', valid: true,
        });
        const createSpy = vi.spyOn(pipelineApi, 'createWorkflow').mockResolvedValue();
        const onCreated = vi.fn();
        const onClose = vi.fn();
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={onCreated} onClose={onClose} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Workflow ✓'));
        });
        expect(createSpy).toHaveBeenCalledWith('ws-1', 'my-pipe', undefined, 'name: generated-yaml');
        expect(onCreated).toHaveBeenCalledWith('my-pipe');
        expect(onClose).toHaveBeenCalled();
    });

    it('API error during generation returns to input with error message', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockRejectedValue(new Error('AI service down'));
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Back to input with error
        expect(screen.getByText('AI service down')).toBeDefined();
        expect(document.querySelector('textarea')).not.toBeNull();
    });

    it('API error during save shows inline error in preview phase', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        vi.spyOn(pipelineApi, 'createWorkflow').mockRejectedValue(new Error('Disk full'));
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Workflow ✓'));
        });
        expect(screen.getByText('Disk full')).toBeDefined();
        // Still in preview phase
        expect(document.querySelector('pre')).not.toBeNull();
    });

    it('AI mode allows empty name — no error on generate', async () => {
        const genSpy = vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: suggested-name\ninput:\n  type: csv',
            valid: true,
            suggestedName: 'suggested-name',
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Should succeed and transition to preview
        expect(screen.getByText('Review Generated Workflow')).toBeDefined();
        expect(genSpy).toHaveBeenCalledWith('ws-1', undefined, 'classify tickets by urgency', expect.any(Object));
    });

    it('AI mode with empty name uses suggestedName in preview', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: bug-classifier\ninput:\n  type: csv',
            valid: true,
            suggestedName: 'bug-classifier',
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify bugs by category' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Preview should show editable name input pre-filled with suggestedName
        const nameInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        expect(nameInput).not.toBeNull();
        expect(nameInput.value).toBe('bug-classifier');
    });

    it('AI mode with user-provided name preserves it (not overridden by suggestedName)', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: ai-suggested\ninput:\n  type: csv',
            valid: true,
            suggestedName: 'ai-suggested',
        });
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'user-chosen-name' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Preview name should still be the user-provided name
        const nameInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        expect(nameInput.value).toBe('user-chosen-name');
    });

    it('preview phase name input is editable and used by Save', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: generated-yaml',
            valid: true,
            suggestedName: 'generated-yaml',
        });
        const createSpy = vi.spyOn(pipelineApi, 'createWorkflow').mockResolvedValue();
        const onCreated = vi.fn();
        const onClose = vi.fn();
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={onCreated} onClose={onClose} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Edit the name in preview
        const nameInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: 'edited-name' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Workflow ✓'));
        });
        expect(createSpy).toHaveBeenCalledWith('ws-1', 'edited-name', undefined, 'name: generated-yaml');
        expect(onCreated).toHaveBeenCalledWith('edited-name');
    });

    it('save in preview requires a name — shows error when empty', async () => {
        vi.spyOn(pipelineApi, 'generateWorkflow').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        const createSpy = vi.spyOn(pipelineApi, 'createWorkflow');
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Workflow ✨'));
        });
        // Name is empty (no suggestedName returned), try to save
        await act(async () => {
            fireEvent.click(screen.getByText('Save Workflow ✓'));
        });
        expect(screen.getByText('Name is required')).toBeDefined();
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('AI mode name input shows placeholder hint', () => {
        render(
            <Wrap>
                <AddWorkflowDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const input = document.querySelector('input[type="text"]') as HTMLInputElement;
        expect(input.placeholder).toBe('Leave blank for AI suggestion');
    });
});

// ============================================================================
// WorkflowsTab split-panel layout
// ============================================================================

describe('WorkflowsTab (split-panel layout)', () => {
    beforeEach(() => {
        location.hash = '';
    });

    it('renders both left list and right placeholder simultaneously', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        // Left panel has the pipeline name
        expect(screen.getByText(/my-pipeline/)).toBeDefined();
        // Right panel shows placeholder
        expect(screen.getByText('Select a workflow or template')).toBeDefined();
    });

    it('clicking a workflow row selects it and renders WorkflowDetail', async () => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        // Click the pipeline row (not a View button — row is clickable)
        const row = screen.getByRole('option');
        fireEvent.click(row);
        await waitFor(() => {
            expect(screen.getByText(/name: my-pipeline/)).toBeDefined();
        });
        // URL updated
        expect(location.hash).toBe('#repos/ws-1/workflows/my-pipeline');
    });

    it('updates location.hash on workflow selection', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getByRole('option'));
        expect(location.hash).toBe('#repos/ws-1/workflows/my-pipeline');
    });

    it('Close button clears selection and resets hash', async () => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        // Select pipeline
        fireEvent.click(screen.getByRole('option'));
        await waitFor(() => screen.getByText('Close'));
        // Close detail
        fireEvent.click(screen.getByText('Close'));
        // Placeholder returns
        expect(screen.getByText('Select a workflow or template')).toBeDefined();
        expect(location.hash).toBe('#repos/ws-1/workflows');
    });

    it('onDeleted clears selection and resets hash', async () => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        vi.spyOn(pipelineApi, 'deleteWorkflow').mockResolvedValue();
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        // Select pipeline
        fireEvent.click(screen.getByRole('option'));
        await waitFor(() => screen.getByText('Delete'));
        // Delete pipeline
        fireEvent.click(screen.getByText('Delete'));
        await waitFor(() => screen.getByText('Confirm'));
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm'));
        });
        // Selection cleared
        expect(screen.getByText('Select a workflow or template')).toBeDefined();
        expect(location.hash).toBe('#repos/ws-1/workflows');
    });

    it('shows "New Workflow" button when workflows exist', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        expect(screen.getAllByText('+ New')[0]).toBeDefined();
    });

    it('shows "New Workflow" button in empty state', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        expect(screen.getAllByText('+ New')[0]).toBeDefined();
    });

    it('"New Workflow" click opens AddWorkflowDialog', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getAllByText('+ New')[0]);
        expect(screen.getByText('New Workflow')).toBeDefined();
        expect(screen.getByText('Name')).toBeDefined();
    });

    it('shows workflow count', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline, { name: 'other', path: 'other.yaml' }],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        expect(screen.getByText('(2)')).toBeDefined();
    });

    it('empty state renders within split layout without collapsing', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        // Empty state message in left panel
        expect(screen.getByText('No workflows found')).toBeDefined();
        // Placeholder still visible in right panel
        expect(screen.getByText('Select a workflow or template')).toBeDefined();
        // + New button visible in section header
        expect(screen.getAllByText('+ New')[0]).toBeDefined();
    });

    it('workflow list remains visible when detail is shown', async () => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const secondPipeline: WorkflowInfo = { name: 'second-pipe', path: 'second.yaml' };
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline, secondPipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        const rows = screen.getAllByRole('option');
        fireEvent.click(rows[0]);
        await waitFor(() => {
            expect(screen.getByText(/name: my-pipeline/)).toBeDefined();
        });
        // Both pipelines still visible in the list
        expect(screen.getByText(/second-pipe/)).toBeDefined();
        expect(screen.getByText('(2)')).toBeDefined();
    });

    it('active row has aria-selected true', () => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        const row = screen.getByRole('option');
        expect(row.getAttribute('aria-selected')).toBe('false');
        fireEvent.click(row);
        expect(row.getAttribute('aria-selected')).toBe('true');
    });

    it('encodes special chars in URL hash', () => {
        const specialPipeline: WorkflowInfo = { name: 'my pipeline', path: 'pipe.yaml' };
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [specialPipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getByRole('option'));
        expect(location.hash).toBe('#repos/ws-1/workflows/my%20pipeline');
    });

    it('onCreated with name auto-selects the workflow and updates hash', async () => {
        vi.spyOn(pipelineApi, 'createWorkflow').mockResolvedValue();
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getAllByText('+ New')[0]);
        fireEvent.change(document.querySelector('select')!, { target: { value: 'custom' } });
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'new-created' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        expect(location.hash).toBe('#repos/ws-1/workflows/new-created');
    });

    it('empty state includes natural language discoverability text', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        expect(screen.getByText(/Add YAML files to .vscode\/workflows\//)).toBeDefined();
    });

    it('successful ▶ Run stays on Workflows tab (no auto-navigation to queue)', async () => {
        vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        vi.spyOn(pipelineApi, 'runWorkflow').mockResolvedValue({ task: { id: 'task-abc123' } });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            workflows: [samplePipeline],
        });
        render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
        // Select the pipeline
        fireEvent.click(screen.getAllByText(/my-pipeline/)[0]);
        await waitFor(() => screen.getByTestId('workflow-run-btn'));
        fireEvent.click(screen.getByTestId('workflow-run-btn'));
        await waitFor(() => {
            expect(pipelineApi.runWorkflow).toHaveBeenCalledWith('ws-1', 'my-pipeline');
            // Hash stays on pipelines (no auto-switch to queue tab)
            expect(location.hash).toBe('#repos/ws-1/workflows/my-pipeline');
        });
    });
});
