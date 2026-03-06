/**
 * Tests for the "Edit with AI" sidebar wired into WorkflowDetail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/context/ToastContext';
import { WorkflowDetail } from '../../../../src/server/spa/client/react/repos/WorkflowDetail';
import type { WorkflowInfo } from '../../../../src/server/spa/client/react/repos/repoGrouping';
import * as pipelineApi from '../../../../src/server/spa/client/react/repos/workflow-api';

// Mock fetchApi used by WorkflowRunHistory
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ history: [] }),
}));

// Mock WorkflowAIRefinePanel to expose onApply/onCancel via testids
let capturedOnApply: ((yaml: string) => void | Promise<void>) | undefined;
let capturedOnCancel: (() => void) | undefined;
vi.mock('../../../../src/server/spa/client/react/repos/WorkflowAIRefinePanel', () => ({
    WorkflowAIRefinePanel: (props: any) => {
        capturedOnApply = props.onApply;
        capturedOnCancel = props.onCancel;
        return (
            <div data-testid="pipeline-ai-refine-panel">
                <span data-testid="refine-workspace">{props.workspaceId}</span>
                <span data-testid="refine-pipeline">{props.pipelineName}</span>
                <span data-testid="refine-yaml">{props.currentYaml}</span>
                <button data-testid="mock-apply" onClick={() => Promise.resolve(props.onApply('name: refined\nsteps: [new]')).catch(() => {})}>Apply</button>
                <button data-testid="mock-cancel" onClick={props.onCancel}>Cancel</button>
            </div>
        );
    },
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
    capturedOnApply = undefined;
    capturedOnCancel = undefined;
    vi.spyOn(pipelineApi, 'fetchWorkflowContent').mockResolvedValue({
        content: sampleYaml,
        path: samplePipeline.path,
    });
});

async function renderAndWaitForLoad() {
    render(
        <Wrap>
            <WorkflowDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
        </Wrap>
    );
    await waitFor(() => {
        expect(screen.getByText('my-pipeline')).toBeDefined();
    });
}

describe('WorkflowDetail — AI sidebar', () => {
    it('"Edit with AI ✨" button is present in view mode', async () => {
        await renderAndWaitForLoad();
        expect(screen.getByText('Edit with AI ✨')).toBeDefined();
    });

    it('clicking "Edit with AI ✨" opens the AI sidebar', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        // Sidebar is rendered
        expect(screen.getByTestId('ai-sidebar')).toBeDefined();
        // Panel is rendered inside sidebar
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();
        // Textarea (manual edit) is NOT rendered
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('tab bar remains visible when sidebar is open', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        expect(screen.getByTestId('workflow-tab-bar')).toBeDefined();
    });

    it('YAML content remains visible alongside the sidebar', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        // The YAML content should still be visible in the left panel (inside a <pre>)
        const pre = document.querySelector('pre');
        expect(pre).not.toBeNull();
        expect(pre!.textContent).toContain('name: my-pipeline');
    });

    it('button text changes to "Close AI ✨" when sidebar is open', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        expect(screen.getByText('Close AI ✨')).toBeDefined();
        expect(screen.queryByText('Edit with AI ✨')).toBeNull();
    });

    it('clicking toggle button again closes the sidebar', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('ai-sidebar')).toBeDefined();

        fireEvent.click(screen.getByText('Close AI ✨'));
        expect(screen.queryByTestId('ai-sidebar')).toBeNull();
        expect(screen.queryByTestId('pipeline-ai-refine-panel')).toBeNull();
    });

    it('sidebar has header with title, pipeline name, and close button', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        expect(screen.getByTestId('ai-sidebar-close')).toBeDefined();
        // Pipeline name appears in sidebar header
        const sidebar = screen.getByTestId('ai-sidebar');
        expect(sidebar.textContent).toContain('✨ Edit with AI');
        expect(sidebar.textContent).toContain('my-pipeline');
    });

    it('clicking × close button closes the sidebar', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('ai-sidebar')).toBeDefined();

        fireEvent.click(screen.getByTestId('ai-sidebar-close'));
        expect(screen.queryByTestId('ai-sidebar')).toBeNull();
    });

    it('ai-edit panel receives correct props', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        expect(screen.getByTestId('refine-workspace').textContent).toBe('ws-1');
        expect(screen.getByTestId('refine-pipeline').textContent).toBe('my-pipeline');
        expect(screen.getByTestId('refine-yaml').textContent).toBe(sampleYaml);
    });

    it('onApply saves content and sidebar stays open', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'saveWorkflowContent').mockResolvedValue(undefined as any);
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();

        // Trigger apply via the mock button
        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        // saveWorkflowContent called with new YAML
        expect(saveSpy).toHaveBeenCalledWith('ws-1', 'my-pipeline', 'name: refined\nsteps: [new]');
        // Sidebar stays open
        expect(screen.getByTestId('ai-sidebar')).toBeDefined();
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();
        // Success toast
        expect(mockAddToast).toHaveBeenCalledWith('Workflow updated ✓', 'success');
    });

    it('onApply shows error on save failure and sidebar stays open', async () => {
        vi.spyOn(pipelineApi, 'saveWorkflowContent').mockRejectedValue(new Error('Network error'));
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));

        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        // Sidebar stays open
        await waitFor(() => {
            expect(screen.getByTestId('ai-sidebar')).toBeDefined();
            expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();
        });
    });

    it('onCancel from panel closes the sidebar', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'saveWorkflowContent');
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();

        fireEvent.click(screen.getByTestId('mock-cancel'));

        // Sidebar closes
        expect(screen.queryByTestId('ai-sidebar')).toBeNull();
        expect(screen.queryByTestId('pipeline-ai-refine-panel')).toBeNull();
        // Tab bar still visible
        expect(screen.getByTestId('workflow-tab-bar')).toBeDefined();
        // No save triggered
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('switching to manual Edit closes the sidebar', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('ai-sidebar')).toBeDefined();

        fireEvent.click(screen.getByText('Edit'));

        // Sidebar is closed
        expect(screen.queryByTestId('ai-sidebar')).toBeNull();
        // Manual edit textarea is visible
        const textarea = document.querySelector('textarea');
        expect(textarea).not.toBeNull();
    });

    it('after AI apply, content updates in left panel', async () => {
        vi.spyOn(pipelineApi, 'saveWorkflowContent').mockResolvedValue(undefined as any);
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        // Updated YAML passed to panel
        await waitFor(() => {
            expect(screen.getByTestId('refine-yaml').textContent).toBe('name: refined\nsteps: [new]');
        });
    });

    it('after AI apply, closing sidebar and opening manual Edit shows updated content', async () => {
        vi.spyOn(pipelineApi, 'saveWorkflowContent').mockResolvedValue(undefined as any);
        await renderAndWaitForLoad();

        // Open sidebar and apply
        fireEvent.click(screen.getByText('Edit with AI ✨'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        // Close sidebar
        fireEvent.click(screen.getByText('Close AI ✨'));

        // Switch to manual edit
        fireEvent.click(screen.getByText('Edit'));
        const textarea = document.querySelector('textarea');
        expect(textarea).not.toBeNull();
        expect(textarea!.value).toBe('name: refined\nsteps: [new]');
    });

    it('existing Edit → textarea flow is unaffected', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit'));
        const textarea = document.querySelector('textarea');
        expect(textarea).not.toBeNull();
        expect(textarea!.value).toBe(sampleYaml);
        expect(screen.getByText('Save')).toBeDefined();
        expect(screen.getByText('Cancel')).toBeDefined();
    });
});
