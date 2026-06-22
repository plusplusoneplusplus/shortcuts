/**
 * Tests for ScheduleInstructionsRefinePanel — the AI prompt-instruction
 * refinement UI used by the New/Edit Prompt Routine form.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock the diff viewer + diff generator so the test stays focused on the panel.
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, 'data-testid': testId }: any) => (
        <div data-testid={testId}>{diff}</div>
    ),
    HunkNavButtons: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/unifiedDiffUtils', () => ({
    generateUnifiedDiff: (oldText: string, newText: string, fileName: string) =>
        `--- a/${fileName}\n+++ b/${fileName}\n@@ mock diff @@\n-${oldText}\n+${newText}`,
}));

import { ScheduleInstructionsRefinePanel } from '../../../../src/server/spa/client/react/features/schedules/ScheduleInstructionsRefinePanel';

function makeProps(overrides: Partial<React.ComponentProps<typeof ScheduleInstructionsRefinePanel>> = {}) {
    return {
        currentInstructions: 'check prs and tell me whats broken',
        refine: vi.fn().mockResolvedValue('Review open PRs and report blockers.'),
        onApply: vi.fn(),
        onCancel: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ── Input phase ──────────────────────────────────────────────────────────────

describe('input phase', () => {
    it('renders the hint textarea and refine button', () => {
        render(<ScheduleInstructionsRefinePanel {...makeProps()} />);
        expect(screen.getByTestId('schedule-refine-panel')).toBeTruthy();
        expect(screen.getByTestId('schedule-refine-hint')).toBeTruthy();
        expect(screen.getByTestId('schedule-refine-submit')).toBeTruthy();
        expect(screen.getByText('Refine Instructions with AI')).toBeTruthy();
    });

    it('calls onCancel when Cancel is clicked', () => {
        const props = makeProps();
        render(<ScheduleInstructionsRefinePanel {...props} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(props.onCancel).toHaveBeenCalledTimes(1);
    });

    it('passes the current instructions and trimmed hint to refine', async () => {
        const props = makeProps();
        render(<ScheduleInstructionsRefinePanel {...props} />);

        fireEvent.change(screen.getByTestId('schedule-refine-hint'), {
            target: { value: '  make it specific  ' },
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });

        expect(props.refine).toHaveBeenCalledTimes(1);
        expect(props.refine.mock.calls[0][0]).toBe('make it specific');
        expect(props.refine.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    });
});

// ── Refining phase ───────────────────────────────────────────────────────────

describe('refining phase', () => {
    it('shows the spinner/refining message after submitting', async () => {
        let resolveRefine!: (v: string) => void;
        const props = makeProps({ refine: vi.fn().mockReturnValue(new Promise<string>(r => { resolveRefine = r; })) });
        render(<ScheduleInstructionsRefinePanel {...props} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });

        expect(screen.getByText('Refining...')).toBeTruthy();
        expect(screen.getByText('Refining instructions...')).toBeTruthy();

        resolveRefine('done');
    });

    it('cancel during refining returns to input without calling onCancel', async () => {
        let resolveRefine!: (v: string) => void;
        const props = makeProps({ refine: vi.fn().mockReturnValue(new Promise<string>(r => { resolveRefine = r; })) });
        render(<ScheduleInstructionsRefinePanel {...props} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('Cancel'));
        });

        expect(screen.getByTestId('schedule-refine-hint')).toBeTruthy();
        expect(props.onCancel).not.toHaveBeenCalled();

        resolveRefine('done');
    });
});

// ── Preview phase ────────────────────────────────────────────────────────────

describe('preview phase', () => {
    async function goToPreview(props = makeProps()) {
        render(<ScheduleInstructionsRefinePanel {...props} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });
        return props;
    }

    it('shows the diff and action buttons after a successful refine', async () => {
        await goToPreview();
        expect(screen.getByText('Review Changes')).toBeTruthy();
        expect(screen.getByTestId('schedule-refine-diff')).toBeTruthy();
        expect(screen.getByTestId('schedule-refine-apply')).toBeTruthy();
        expect(screen.getByText('← Back')).toBeTruthy();
        expect(screen.getByText('Re-refine 🔄')).toBeTruthy();
    });

    it('Apply calls onApply with the refined text', async () => {
        const props = await goToPreview();
        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-apply'));
        });
        expect(props.onApply).toHaveBeenCalledWith('Review open PRs and report blockers.');
    });

    it('Apply shows an error and stays in preview on failure', async () => {
        const props = makeProps({ onApply: vi.fn().mockRejectedValue(new Error('apply boom')) });
        await goToPreview(props);
        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-apply'));
        });
        expect(screen.getByText('Review Changes')).toBeTruthy();
        expect(screen.getByTestId('schedule-refine-error')).toBeTruthy();
        expect(screen.getByText('apply boom')).toBeTruthy();
    });

    it('Re-refine re-runs the refine request', async () => {
        const refine = vi.fn()
            .mockResolvedValueOnce('first refinement')
            .mockResolvedValueOnce('second refinement');
        await goToPreview(makeProps({ refine }));

        await act(async () => {
            fireEvent.click(screen.getByText('Re-refine 🔄'));
        });

        expect(refine).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Review Changes')).toBeTruthy();
    });

    it('Back returns to the input phase', async () => {
        await goToPreview();
        fireEvent.click(screen.getByText('← Back'));
        expect(screen.getByTestId('schedule-refine-hint')).toBeTruthy();
    });
});

// ── Error handling ───────────────────────────────────────────────────────────

describe('error handling', () => {
    it('shows an error banner and returns to input on failure', async () => {
        const props = makeProps({ refine: vi.fn().mockRejectedValue(new Error('server exploded')) });
        render(<ScheduleInstructionsRefinePanel {...props} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });

        expect(screen.getByTestId('schedule-refine-hint')).toBeTruthy();
        expect(screen.getByTestId('schedule-refine-error')).toBeTruthy();
        expect(screen.getByText('server exploded')).toBeTruthy();
    });

    it('returns to input silently on an aborted request (code ABORTED)', async () => {
        const abortErr = Object.assign(new Error('CoC API request was aborted'), { code: 'ABORTED' });
        const props = makeProps({ refine: vi.fn().mockRejectedValue(abortErr) });
        render(<ScheduleInstructionsRefinePanel {...props} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });

        expect(screen.getByTestId('schedule-refine-hint')).toBeTruthy();
        expect(screen.queryByTestId('schedule-refine-error')).toBeNull();
    });

    it('returns to input silently on a DOMException AbortError', async () => {
        const abortErr = new DOMException('Aborted', 'AbortError');
        const props = makeProps({ refine: vi.fn().mockRejectedValue(abortErr) });
        render(<ScheduleInstructionsRefinePanel {...props} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('schedule-refine-submit'));
        });

        expect(screen.getByTestId('schedule-refine-hint')).toBeTruthy();
        expect(screen.queryByTestId('schedule-refine-error')).toBeNull();
    });
});
