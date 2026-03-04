/**
 * Tests for the "Edit with AI" mode wired into PipelineDetail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/context/ToastContext';
import { PipelineDetail } from '../../../../src/server/spa/client/react/repos/PipelineDetail';
import type { PipelineInfo } from '../../../../src/server/spa/client/react/repos/repoGrouping';
import * as pipelineApi from '../../../../src/server/spa/client/react/repos/pipeline-api';

// Mock fetchApi used by PipelineRunHistory
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ history: [] }),
}));

// Mock PipelineAIRefinePanel to expose onApply/onCancel via testids
let capturedOnApply: ((yaml: string) => void) | undefined;
let capturedOnCancel: (() => void) | undefined;
vi.mock('../../../../src/server/spa/client/react/repos/PipelineAIRefinePanel', () => ({
    PipelineAIRefinePanel: (props: any) => {
        capturedOnApply = props.onApply;
        capturedOnCancel = props.onCancel;
        return (
            <div data-testid="pipeline-ai-refine-panel">
                <span data-testid="refine-workspace">{props.workspaceId}</span>
                <span data-testid="refine-pipeline">{props.pipelineName}</span>
                <span data-testid="refine-yaml">{props.currentYaml}</span>
                <button data-testid="mock-apply" onClick={() => props.onApply('name: refined\nsteps: [new]')}>Apply</button>
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

const samplePipeline: PipelineInfo = {
    name: 'my-pipeline',
    path: '.vscode/pipelines/my-pipeline/pipeline.yaml',
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
    vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
        content: sampleYaml,
        path: samplePipeline.path,
    });
});

async function renderAndWaitForLoad() {
    render(
        <Wrap>
            <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
        </Wrap>
    );
    await waitFor(() => {
        expect(screen.getByText('my-pipeline')).toBeDefined();
    });
}

describe('PipelineDetail — ai-edit mode', () => {
    it('"Edit with AI ✨" button is present in view mode', async () => {
        await renderAndWaitForLoad();
        expect(screen.getByText('Edit with AI ✨')).toBeDefined();
    });

    it('clicking "Edit with AI ✨" switches to ai-edit mode', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        // Panel is rendered
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();
        // Textarea (manual edit) is NOT rendered
        expect(document.querySelector('textarea')).toBeNull();
        // Tab bar is NOT rendered
        expect(screen.queryByTestId('pipeline-tab-bar')).toBeNull();
        // No Save/Cancel toolbar buttons (those are only for manual edit)
        expect(screen.queryByText('Save')).toBeNull();
    });

    it('ai-edit panel receives correct props', async () => {
        await renderAndWaitForLoad();
        fireEvent.click(screen.getByText('Edit with AI ✨'));

        expect(screen.getByTestId('refine-workspace').textContent).toBe('ws-1');
        expect(screen.getByTestId('refine-pipeline').textContent).toBe('my-pipeline');
        expect(screen.getByTestId('refine-yaml').textContent).toBe(sampleYaml);
    });

    it('onApply saves and returns to view mode', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'savePipelineContent').mockResolvedValue(undefined as any);
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();

        // Trigger apply via the mock button
        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        // savePipelineContent called with new YAML
        expect(saveSpy).toHaveBeenCalledWith('ws-1', 'my-pipeline', 'name: refined\nsteps: [new]');
        // Returns to view mode — tab bar is back
        await waitFor(() => {
            expect(screen.getByTestId('pipeline-tab-bar')).toBeDefined();
        });
        // AI panel is gone
        expect(screen.queryByTestId('pipeline-ai-refine-panel')).toBeNull();
        // Success toast
        expect(mockAddToast).toHaveBeenCalledWith('Pipeline saved', 'success');
    });

    it('onApply shows error on save failure', async () => {
        vi.spyOn(pipelineApi, 'savePipelineContent').mockRejectedValue(new Error('Network error'));
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));

        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        // Panel stays rendered (mode stays ai-edit)
        await waitFor(() => {
            expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();
        });
    });

    it('onCancel returns to view mode without saving', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'savePipelineContent');
        await renderAndWaitForLoad();

        fireEvent.click(screen.getByText('Edit with AI ✨'));
        expect(screen.getByTestId('pipeline-ai-refine-panel')).toBeDefined();

        fireEvent.click(screen.getByTestId('mock-cancel'));

        // View mode restored
        await waitFor(() => {
            expect(screen.getByTestId('pipeline-tab-bar')).toBeDefined();
        });
        expect(screen.queryByTestId('pipeline-ai-refine-panel')).toBeNull();
        // No save triggered
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it('after AI apply, switching to manual Edit shows updated content', async () => {
        vi.spyOn(pipelineApi, 'savePipelineContent').mockResolvedValue(undefined as any);
        await renderAndWaitForLoad();

        // AI apply
        fireEvent.click(screen.getByText('Edit with AI ✨'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-apply'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('pipeline-tab-bar')).toBeDefined();
        });

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
