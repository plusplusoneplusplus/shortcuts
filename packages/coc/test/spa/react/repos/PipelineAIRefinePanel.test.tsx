/**
 * Tests for PipelineAIRefinePanel — the AI pipeline refinement UI component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// Mock refinePipeline
const mockRefinePipeline = vi.fn();
vi.mock('../../../../src/server/spa/client/react/repos/pipeline-api', () => ({
    refinePipeline: (...args: any[]) => mockRefinePipeline(...args),
}));

// Mock UnifiedDiffViewer
vi.mock('../../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, 'data-testid': testId }: any) => (
        <div data-testid={testId}>{diff}</div>
    ),
}));

// Mock generateUnifiedDiff
vi.mock('../../../../src/server/spa/client/react/repos/unifiedDiffUtils', () => ({
    generateUnifiedDiff: (oldText: string, newText: string, fileName: string) =>
        `--- a/${fileName}\n+++ b/${fileName}\n@@ mock diff @@\n-old\n+new`,
}));

import { PipelineAIRefinePanel } from '../../../../src/server/spa/client/react/repos/PipelineAIRefinePanel';

const defaultProps = {
    workspaceId: 'ws-1',
    pipelineName: 'test-pipeline',
    currentYaml: 'name: test\nsteps: []',
    onApply: vi.fn(),
    onCancel: vi.fn(),
};

beforeEach(() => {
    vi.restoreAllMocks();
    defaultProps.onApply = vi.fn();
    defaultProps.onCancel = vi.fn();
    mockRefinePipeline.mockReset();
});

// ── Input Phase ──────────────────────────────────────────────────────────────

describe('input phase', () => {
    it('renders textarea and "Edit with AI" title by default', () => {
        render(<PipelineAIRefinePanel {...defaultProps} />);
        expect(screen.getByText('Edit with AI')).toBeTruthy();
        expect(screen.getByTestId('refine-instruction')).toBeTruthy();
        expect(screen.getByText('Refine with AI ✨')).toBeTruthy();
    });

    it('disables "Refine with AI" when instruction is less than 10 chars', () => {
        render(<PipelineAIRefinePanel {...defaultProps} />);
        const btn = screen.getByTestId('refine-submit');
        expect(btn).toBeDisabled();

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'short' },
        });
        expect(btn).toBeDisabled();
    });

    it('enables "Refine with AI" when instruction has 10+ chars', () => {
        render(<PipelineAIRefinePanel {...defaultProps} />);
        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });
        expect(screen.getByTestId('refine-submit')).not.toBeDisabled();
    });

    it('calls onCancel when Cancel button is clicked in input phase', () => {
        render(<PipelineAIRefinePanel {...defaultProps} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    });

    it('shows character count', () => {
        render(<PipelineAIRefinePanel {...defaultProps} />);
        expect(screen.getByText('0 / 2000 characters')).toBeTruthy();

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'hello world' },
        });
        expect(screen.getByText('11 / 2000 characters')).toBeTruthy();
    });
});

// ── Refining Phase ───────────────────────────────────────────────────────────

describe('refining phase', () => {
    it('shows spinner and refining message after submitting', async () => {
        let resolveRefine!: (v: any) => void;
        mockRefinePipeline.mockReturnValue(new Promise(r => { resolveRefine = r; }));

        render(<PipelineAIRefinePanel {...defaultProps} />);

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-submit'));
        });

        expect(screen.getByText('Refining...')).toBeTruthy();
        expect(screen.getByText('Refining pipeline...')).toBeTruthy();
        expect(screen.getByText(/This usually takes/)).toBeTruthy();

        // Resolve to prevent lingering promise
        resolveRefine({ yaml: 'name: test' });
    });

    it('cancel during refining aborts and returns to input', async () => {
        let resolveRefine!: (v: any) => void;
        mockRefinePipeline.mockReturnValue(new Promise(r => { resolveRefine = r; }));

        render(<PipelineAIRefinePanel {...defaultProps} />);

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-submit'));
        });

        // Now in refining phase — click cancel
        await act(async () => {
            fireEvent.click(screen.getByText('Cancel'));
        });

        // Should be back to input
        expect(screen.getByText('Edit with AI')).toBeTruthy();
        expect(screen.getByTestId('refine-instruction')).toBeTruthy();
        // onCancel should NOT have been called — cancel during refining just resets phase
        expect(defaultProps.onCancel).not.toHaveBeenCalled();

        // Resolve to prevent lingering promise
        resolveRefine({ yaml: 'name: test' });
    });
});

// ── Preview Phase ────────────────────────────────────────────────────────────

describe('preview phase', () => {
    async function goToPreview() {
        mockRefinePipeline.mockResolvedValue({ yaml: 'name: refined\nsteps: [retry]' });
        render(<PipelineAIRefinePanel {...defaultProps} />);

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-submit'));
        });
    }

    it('shows diff viewer after successful refine', async () => {
        await goToPreview();

        expect(screen.getByText('Review Changes')).toBeTruthy();
        expect(screen.getByTestId('refine-diff')).toBeTruthy();
        expect(screen.getByText('Apply Changes ✓')).toBeTruthy();
        expect(screen.getByText('← Back')).toBeTruthy();
        expect(screen.getByText('Re-refine 🔄')).toBeTruthy();
    });

    it('"← Back" returns to input phase without clearing instruction', async () => {
        await goToPreview();

        fireEvent.click(screen.getByText('← Back'));

        expect(screen.getByText('Edit with AI')).toBeTruthy();
        // Instruction should still be populated
        const textarea = screen.getByTestId('refine-instruction') as HTMLTextAreaElement;
        expect(textarea.value).toBe('add retry logic to the pipeline');
    });

    it('"Apply Changes" calls onApply with refined YAML', async () => {
        await goToPreview();

        fireEvent.click(screen.getByTestId('refine-apply'));

        expect(defaultProps.onApply).toHaveBeenCalledWith('name: refined\nsteps: [retry]');
    });

    it('"Apply Changes" resets to input phase after successful apply', async () => {
        await goToPreview();

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-apply'));
        });

        // Should be back in input phase with empty instruction
        expect(screen.getByText('Edit with AI')).toBeTruthy();
        expect(screen.getByTestId('refine-instruction')).toBeTruthy();
        const textarea = screen.getByTestId('refine-instruction') as HTMLTextAreaElement;
        expect(textarea.value).toBe('');
    });

    it('"Apply Changes" shows error and stays in preview on failure', async () => {
        defaultProps.onApply = vi.fn().mockRejectedValue(new Error('Save failed'));
        await goToPreview();

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-apply'));
        });

        // Should stay in preview phase
        expect(screen.getByText('Review Changes')).toBeTruthy();
        // Error should be shown
        expect(screen.getByTestId('refine-error')).toBeTruthy();
        expect(screen.getByText('Save failed')).toBeTruthy();
    });

    it('"Re-refine" re-submits the instruction', async () => {
        mockRefinePipeline
            .mockResolvedValueOnce({ yaml: 'name: first' })
            .mockResolvedValueOnce({ yaml: 'name: second' });

        render(<PipelineAIRefinePanel {...defaultProps} />);

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-submit'));
        });

        // Now in preview — click re-refine
        await act(async () => {
            fireEvent.click(screen.getByText('Re-refine 🔄'));
        });

        // refinePipeline called twice
        expect(mockRefinePipeline).toHaveBeenCalledTimes(2);
        // Back in preview with new result
        expect(screen.getByText('Review Changes')).toBeTruthy();
    });
});

// ── Error Handling ───────────────────────────────────────────────────────────

describe('error handling', () => {
    it('shows error banner on API failure and returns to input', async () => {
        mockRefinePipeline.mockRejectedValue(new Error('Server exploded'));

        render(<PipelineAIRefinePanel {...defaultProps} />);

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-submit'));
        });

        expect(screen.getByText('Edit with AI')).toBeTruthy();
        expect(screen.getByTestId('refine-error')).toBeTruthy();
        expect(screen.getByText('Server exploded')).toBeTruthy();
    });

    it('returns to input silently on AbortError', async () => {
        const abortError = new DOMException('Aborted', 'AbortError');
        mockRefinePipeline.mockRejectedValue(abortError);

        render(<PipelineAIRefinePanel {...defaultProps} />);

        fireEvent.change(screen.getByTestId('refine-instruction'), {
            target: { value: 'add retry logic to the pipeline' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('refine-submit'));
        });

        expect(screen.getByText('Edit with AI')).toBeTruthy();
        // No error banner
        expect(screen.queryByTestId('refine-error')).toBeNull();
    });
});
