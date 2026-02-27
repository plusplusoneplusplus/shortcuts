/**
 * Tests for Pipeline UI components: PipelineDetail, AddPipelineDialog, PipelinesTab interactions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { PipelineDetail } from '../../../src/server/spa/client/react/repos/PipelineDetail';
import { AddPipelineDialog } from '../../../src/server/spa/client/react/repos/AddPipelineDialog';
import { PipelinesTab } from '../../../src/server/spa/client/react/repos/PipelinesTab';
import type { RepoData, PipelineInfo } from '../../../src/server/spa/client/react/repos/repoGrouping';
import * as pipelineApi from '../../../src/server/spa/client/react/repos/pipeline-api';

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
        pipelines: [],
        stats: { success: 0, failed: 0, running: 0 },
        taskCount: 0,
        ...overrides,
    };
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
});

// ============================================================================
// PipelineDetail
// ============================================================================

describe('PipelineDetail', () => {
    beforeEach(() => {
        vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
    });

    it('renders pipeline name and path after loading', async () => {
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={invalidPipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('⚠️ Invalid')).toBeDefined();
        });
    });

    it('shows Edit and Delete buttons in view mode', async () => {
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Edit')).toBeDefined();
            expect(screen.getByText('Delete')).toBeDefined();
        });
    });

    it('switches to edit mode with textarea when Edit is clicked', async () => {
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        expect(screen.getByText('Save')).toBeDefined();
        expect(screen.getByText('Cancel')).toBeDefined();
    });

    it('Cancel returns to view mode without saving', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'savePipelineContent');
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Edit'));
        fireEvent.click(screen.getByText('Edit'));
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: '   ' } });
        fireEvent.click(screen.getByText('Save'));
        expect(screen.getByText('Pipeline content cannot be empty')).toBeDefined();
    });

    it('Save calls savePipelineContent and shows success toast', async () => {
        const saveSpy = vi.spyOn(pipelineApi, 'savePipelineContent').mockResolvedValue();
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
        expect(mockAddToast).toHaveBeenCalledWith('Pipeline saved', 'success');
    });

    it('Save shows inline error on API failure', async () => {
        vi.spyOn(pipelineApi, 'savePipelineContent').mockRejectedValue(new Error('Bad YAML'));
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Delete'));
        fireEvent.click(screen.getByText('Delete'));
        expect(screen.getByText('Delete Pipeline')).toBeDefined();
        expect(screen.getByText(/Are you sure you want to delete/)).toBeDefined();
    });

    it('confirming delete calls deletePipeline and onDeleted', async () => {
        const deleteSpy = vi.spyOn(pipelineApi, 'deletePipeline').mockResolvedValue();
        const onDeleted = vi.fn();
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={onDeleted} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Delete'));
        fireEvent.click(screen.getByText('Delete'));
        await act(async () => {
            fireEvent.click(screen.getByText('Confirm'));
        });
        expect(deleteSpy).toHaveBeenCalledWith('ws-1', 'my-pipeline');
        expect(mockAddToast).toHaveBeenCalledWith('Pipeline deleted', 'success');
        expect(onDeleted).toHaveBeenCalled();
    });

    it('cancelling delete dialog leaves panel open', async () => {
        const onDeleted = vi.fn();
        render(
            <Wrap>
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={vi.fn()} onDeleted={onDeleted} />
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
                <PipelineDetail workspaceId="ws-1" pipeline={samplePipeline} onClose={onClose} onDeleted={vi.fn()} />
            </Wrap>
        );
        await waitFor(() => screen.getByText('Close'));
        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalled();
    });
});

// ============================================================================
// AddPipelineDialog
// ============================================================================

describe('AddPipelineDialog', () => {
    it('renders dialog with title and inputs', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        expect(screen.getByText('New Pipeline')).toBeDefined();
        expect(screen.getByText('Name')).toBeDefined();
        expect(screen.getByText('Template')).toBeDefined();
    });

    it('shows error on empty name submit', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText('Name is required')).toBeDefined();
    });

    it('shows error on invalid name with special chars', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: '-bad-name' } });
        fireEvent.click(screen.getByText('Create'));
        expect(screen.getByText(/must start with a letter or number/)).toBeDefined();
    });

    it('does not call API on invalid name', () => {
        const createSpy = vi.spyOn(pipelineApi, 'createPipeline');
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Create'));
        expect(createSpy).not.toHaveBeenCalled();
    });

    it('calls createPipeline with valid name and template', async () => {
        const createSpy = vi.spyOn(pipelineApi, 'createPipeline').mockResolvedValue();
        const onCreated = vi.fn();
        const onClose = vi.fn();
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={onCreated} onClose={onClose} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'test-pipeline' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        expect(createSpy).toHaveBeenCalledWith('ws-1', 'test-pipeline', 'custom');
        expect(mockAddToast).toHaveBeenCalledWith('Pipeline created', 'success');
        expect(onCreated).toHaveBeenCalledWith('test-pipeline');
        expect(onClose).toHaveBeenCalled();
    });

    it('includes selected template in API call', async () => {
        const createSpy = vi.spyOn(pipelineApi, 'createPipeline').mockResolvedValue();
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
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
        vi.spyOn(pipelineApi, 'createPipeline').mockRejectedValue(new Error('Already exists'));
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
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
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
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
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={onClose} />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    // --- AI Generation Flow ---

    it('selecting "AI Generated" template shows textarea and tip block', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
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
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'custom' } });
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('"Generate Pipeline ✨" button disabled when description < 10 chars', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'short' } });
        const btn = screen.getByText('Generate Pipeline ✨');
        expect(btn.closest('button')!.disabled).toBe(true);
    });

    it('"Generate Pipeline ✨" button enabled when description ≥ 10 chars', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        const btn = screen.getByText('Generate Pipeline ✨');
        expect(btn.closest('button')!.disabled).toBe(false);
    });

    it('character counter displays current length and turns red near limit', () => {
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
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

    it('clicking "Generate Pipeline ✨" calls generatePipeline API', async () => {
        const genSpy = vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        expect(genSpy).toHaveBeenCalledWith('ws-1', 'my-pipe', 'classify tickets by urgency', expect.any(Object));
    });

    it('generating phase shows spinner and cancel button', async () => {
        let resolveGen: (v: any) => void;
        vi.spyOn(pipelineApi, 'generatePipeline').mockImplementation(() =>
            new Promise(resolve => { resolveGen = resolve; })
        );
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        expect(screen.getByText('Generating pipeline YAML...')).toBeDefined();
        expect(screen.getByText('Cancel')).toBeDefined();
        expect(document.querySelector('[aria-label="Loading"]')).not.toBeNull();
        // Clean up
        await act(async () => { resolveGen!({ yaml: 'x', valid: true }); });
    });

    it('cancel during generation returns to input with description preserved', async () => {
        let resolveGen: (v: any) => void;
        vi.spyOn(pipelineApi, 'generatePipeline').mockImplementation((_ws, _n, _d, signal) =>
            new Promise((resolve, reject) => {
                resolveGen = resolve;
                signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            })
        );
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
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
        vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: generated\ninput:\n  type: csv',
            valid: true,
        });
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        expect(screen.getByText('Review Generated Pipeline')).toBeDefined();
        expect(document.querySelector('pre')!.textContent).toContain('name: generated');
        expect(screen.getByText('✅ Valid pipeline')).toBeDefined();
    });

    it('invalid generation shows warning badge and collapsible errors', async () => {
        vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: bad',
            valid: false,
            errors: ['Missing input', 'Invalid type'],
        });
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        expect(screen.getByText('⚠️ Invalid pipeline')).toBeDefined();
        expect(screen.getByText('Validation errors (2)')).toBeDefined();
    });

    it('"← Back" returns to input with description preserved', async () => {
        vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        // Now in preview — click Back
        fireEvent.click(screen.getByText('← Back'));
        const ta = document.querySelector('textarea') as HTMLTextAreaElement;
        expect(ta).not.toBeNull();
        expect(ta.value).toBe('classify tickets by urgency');
    });

    it('"Regenerate 🔄" re-calls generatePipeline', async () => {
        const genSpy = vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        genSpy.mockClear();
        await act(async () => {
            fireEvent.click(screen.getByText('Regenerate 🔄'));
        });
        expect(genSpy).toHaveBeenCalledTimes(1);
    });

    it('"Save Pipeline ✓" calls createPipeline with content and triggers onCreated with name', async () => {
        vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: generated-yaml', valid: true,
        });
        const createSpy = vi.spyOn(pipelineApi, 'createPipeline').mockResolvedValue();
        const onCreated = vi.fn();
        const onClose = vi.fn();
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={onCreated} onClose={onClose} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Pipeline ✓'));
        });
        expect(createSpy).toHaveBeenCalledWith('ws-1', 'my-pipe', undefined, 'name: generated-yaml');
        expect(onCreated).toHaveBeenCalledWith('my-pipe');
        expect(onClose).toHaveBeenCalled();
    });

    it('API error during generation returns to input with error message', async () => {
        vi.spyOn(pipelineApi, 'generatePipeline').mockRejectedValue(new Error('AI service down'));
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        // Back to input with error
        expect(screen.getByText('AI service down')).toBeDefined();
        expect(document.querySelector('textarea')).not.toBeNull();
    });

    it('API error during save shows inline error in preview phase', async () => {
        vi.spyOn(pipelineApi, 'generatePipeline').mockResolvedValue({
            yaml: 'name: test', valid: true,
        });
        vi.spyOn(pipelineApi, 'createPipeline').mockRejectedValue(new Error('Disk full'));
        render(
            <Wrap>
                <AddPipelineDialog workspaceId="ws-1" onCreated={vi.fn()} onClose={vi.fn()} />
            </Wrap>
        );
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'my-pipe' } });
        const select = document.querySelector('select')!;
        fireEvent.change(select, { target: { value: 'ai-generated' } });
        const textarea = document.querySelector('textarea')!;
        fireEvent.change(textarea, { target: { value: 'classify tickets by urgency' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Generate Pipeline ✨'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Pipeline ✓'));
        });
        expect(screen.getByText('Disk full')).toBeDefined();
        // Still in preview phase
        expect(document.querySelector('pre')).not.toBeNull();
    });
});

// ============================================================================
// PipelinesTab split-panel layout
// ============================================================================

describe('PipelinesTab (split-panel layout)', () => {
    beforeEach(() => {
        location.hash = '';
    });

    it('renders both left list and right placeholder simultaneously', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        // Left panel has the pipeline name
        expect(screen.getByText(/my-pipeline/)).toBeDefined();
        // Right panel shows placeholder
        expect(screen.getByText('Select a pipeline')).toBeDefined();
    });

    it('clicking a pipeline row selects it and renders PipelineDetail', async () => {
        vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        // Click the pipeline row (not a View button — row is clickable)
        const row = screen.getByRole('option');
        fireEvent.click(row);
        await waitFor(() => {
            expect(screen.getByText(/name: my-pipeline/)).toBeDefined();
        });
        // URL updated
        expect(location.hash).toBe('#repos/ws-1/pipelines/my-pipeline');
    });

    it('updates location.hash on pipeline selection', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getByRole('option'));
        expect(location.hash).toBe('#repos/ws-1/pipelines/my-pipeline');
    });

    it('Close button clears selection and resets hash', async () => {
        vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        // Select pipeline
        fireEvent.click(screen.getByRole('option'));
        await waitFor(() => screen.getByText('Close'));
        // Close detail
        fireEvent.click(screen.getByText('Close'));
        // Placeholder returns
        expect(screen.getByText('Select a pipeline')).toBeDefined();
        expect(location.hash).toBe('#repos/ws-1/pipelines');
    });

    it('onDeleted clears selection and resets hash', async () => {
        vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        vi.spyOn(pipelineApi, 'deletePipeline').mockResolvedValue();
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
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
        expect(screen.getByText('Select a pipeline')).toBeDefined();
        expect(location.hash).toBe('#repos/ws-1/pipelines');
    });

    it('shows "New Pipeline" button when pipelines exist', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        expect(screen.getByText('+ New Pipeline')).toBeDefined();
    });

    it('shows "New Pipeline" button in empty state', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        expect(screen.getByText('+ New Pipeline')).toBeDefined();
    });

    it('"New Pipeline" click opens AddPipelineDialog', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getByText('+ New Pipeline'));
        expect(screen.getByText('New Pipeline')).toBeDefined();
        expect(screen.getByText('Name')).toBeDefined();
    });

    it('shows pipeline count', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline, { name: 'other', path: 'other.yaml' }],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        expect(screen.getByText('2 pipelines')).toBeDefined();
    });

    it('empty state renders within split layout without collapsing', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        // Empty state message in left panel
        expect(screen.getByText('No pipelines found')).toBeDefined();
        // Placeholder still visible in right panel
        expect(screen.getByText('Select a pipeline')).toBeDefined();
        // + New Pipeline visible
        expect(screen.getByText('+ New Pipeline')).toBeDefined();
    });

    it('pipeline list remains visible when detail is shown', async () => {
        vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const secondPipeline: PipelineInfo = { name: 'second-pipe', path: 'second.yaml' };
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline, secondPipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        const rows = screen.getAllByRole('option');
        fireEvent.click(rows[0]);
        await waitFor(() => {
            expect(screen.getByText(/name: my-pipeline/)).toBeDefined();
        });
        // Both pipelines still visible in the list
        expect(screen.getByText(/second-pipe/)).toBeDefined();
        expect(screen.getByText('2 pipelines')).toBeDefined();
    });

    it('active row has aria-selected true', () => {
        vi.spyOn(pipelineApi, 'fetchPipelineContent').mockResolvedValue({
            content: sampleYaml,
            path: samplePipeline.path,
        });
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        const row = screen.getByRole('option');
        expect(row.getAttribute('aria-selected')).toBe('false');
        fireEvent.click(row);
        expect(row.getAttribute('aria-selected')).toBe('true');
    });

    it('encodes special chars in URL hash', () => {
        const specialPipeline: PipelineInfo = { name: 'my pipeline', path: 'pipe.yaml' };
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [specialPipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getByRole('option'));
        expect(location.hash).toBe('#repos/ws-1/pipelines/my%20pipeline');
    });

    it('onCreated with name auto-selects the pipeline and updates hash', async () => {
        vi.spyOn(pipelineApi, 'createPipeline').mockResolvedValue();
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [samplePipeline],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        fireEvent.click(screen.getByText('+ New Pipeline'));
        const input = document.querySelector('input[type="text"]')!;
        fireEvent.change(input, { target: { value: 'new-created' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Create'));
        });
        expect(location.hash).toBe('#repos/ws-1/pipelines/new-created');
    });

    it('empty state includes natural language discoverability text', () => {
        const repo = makeRepo({
            workspace: { id: 'ws-1', name: 'Test', rootPath: '/test' },
            pipelines: [],
        });
        render(<Wrap><PipelinesTab repo={repo} /></Wrap>);
        expect(screen.getByText(/Create your first pipeline by describing what it should do/)).toBeDefined();
    });
});
