import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelinePhasePopover } from '../../../../src/server/spa/client/react/processes/dag/PipelinePhasePopover';
import type { PhaseDetail } from '../../../../src/server/spa/client/react/processes/dag/PipelinePhasePopover';

function makeDetail(overrides: Partial<PhaseDetail> = {}): PhaseDetail {
    return {
        phase: 'map',
        status: 'completed',
        ...overrides,
    };
}

describe('PipelinePhasePopover', () => {
    it('renders nothing when phase is null', () => {
        const { container } = render(
            <PipelinePhasePopover phase={null} onClose={() => {}} />
        );
        expect(container.querySelector('[data-testid="phase-popover"]')).toBeNull();
    });

    it('renders input phase details: source type, item count, parameters', () => {
        const detail = makeDetail({
            phase: 'input',
            sourceType: 'CSV',
            itemCount: 42,
            parameters: { file: 'data.csv', delimiter: ',' },
        });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        expect(popover.textContent).toContain('Input Phase');
        expect(popover.textContent).toContain('CSV');
        expect(popover.textContent).toContain('42');
        expect(popover.textContent).toContain('file:');
        expect(popover.textContent).toContain('data.csv');
        expect(popover.textContent).toContain('delimiter:');
    });

    it('renders filter phase details: filter type, included/excluded counts', () => {
        const detail = makeDetail({
            phase: 'filter',
            filterType: 'rule',
            rulesSummary: 'severity > 3',
            includedCount: 8,
            excludedCount: 2,
            durationMs: 1500,
        });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        expect(popover.textContent).toContain('Filter Phase');
        expect(popover.textContent).toContain('rule');
        expect(popover.textContent).toContain('severity > 3');
        expect(popover.textContent).toContain('8');
        expect(popover.textContent).toContain('2');
        expect(popover.textContent).toContain('1.5s');
    });

    it('renders map phase details: concurrency, batch size, model, per-item status table', () => {
        const detail = makeDetail({
            phase: 'map',
            concurrency: 4,
            batchSize: 5,
            model: 'gpt-4',
            items: [
                { label: 'Item 1', status: 'completed', durationMs: 200 },
                { label: 'Item 2', status: 'failed', durationMs: 100 },
            ],
        });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        expect(popover.textContent).toContain('Map Phase');
        expect(popover.textContent).toContain('4');
        expect(popover.textContent).toContain('5');
        expect(popover.textContent).toContain('gpt-4');
        const table = screen.getByTestId('map-items-table');
        expect(table.textContent).toContain('Item 1');
        expect(table.textContent).toContain('completed');
        expect(table.textContent).toContain('Item 2');
        expect(table.textContent).toContain('failed');
    });

    it('caps map items table at 20 rows with overflow text', () => {
        const items = Array.from({ length: 25 }, (_, i) => ({
            label: `Item ${i + 1}`,
            status: 'completed',
        }));
        const detail = makeDetail({ phase: 'map', items });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        const table = screen.getByTestId('map-items-table');
        const rows = table.querySelectorAll('tbody tr');
        expect(rows.length).toBe(20);
        expect(popover.textContent).toContain('and 5 more');
    });

    it('renders reduce phase details: reduce type, model, output preview truncated at 200 chars', () => {
        const longOutput = 'x'.repeat(250);
        const detail = makeDetail({
            phase: 'reduce',
            reduceType: 'ai',
            model: 'gpt-4',
            outputPreview: longOutput,
        });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        expect(popover.textContent).toContain('Reduce Phase');
        expect(popover.textContent).toContain('ai');
        expect(popover.textContent).toContain('gpt-4');
        // Should be truncated to 200 + ellipsis
        expect(popover.textContent).toContain('…');
        expect(popover.textContent).not.toContain('x'.repeat(250));
    });

    it('renders job phase details: model, prompt preview, duration', () => {
        const detail = makeDetail({
            phase: 'job',
            model: 'claude-3',
            promptPreview: 'Analyze this code...',
            durationMs: 3200,
        });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        expect(popover.textContent).toContain('Job Phase');
        expect(popover.textContent).toContain('claude-3');
        expect(popover.textContent).toContain('Analyze this code...');
        expect(popover.textContent).toContain('3.2s');
    });

    it('shows error message in red for failed phase', () => {
        const detail = makeDetail({
            status: 'failed',
            error: 'Model rate limited',
        });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        const popover = screen.getByTestId('phase-popover');
        expect(popover.textContent).toContain('Error');
        expect(popover.textContent).toContain('Model rate limited');
        const pre = popover.querySelector('pre');
        expect(pre).not.toBeNull();
        expect(pre!.className).toContain('text-[#f14c4c]');
    });

    it('shows "View in Conversation ↓" link for failed phase when onScrollToConversation provided', () => {
        const onScroll = vi.fn();
        const detail = makeDetail({ status: 'failed', error: 'timeout' });
        render(
            <PipelinePhasePopover phase={detail} onClose={() => {}} onScrollToConversation={onScroll} />
        );
        const link = screen.getByTestId('scroll-to-conversation');
        expect(link.textContent).toContain('View in Conversation');
    });

    it('does not show "View in Conversation ↓" when onScrollToConversation is not provided', () => {
        const detail = makeDetail({ status: 'failed', error: 'timeout' });
        render(<PipelinePhasePopover phase={detail} onClose={() => {}} />);
        expect(screen.queryByTestId('scroll-to-conversation')).toBeNull();
    });

    it('does not show "View in Conversation ↓" for non-failed phases', () => {
        const onScroll = vi.fn();
        const detail = makeDetail({ status: 'completed' });
        render(
            <PipelinePhasePopover phase={detail} onClose={() => {}} onScrollToConversation={onScroll} />
        );
        expect(screen.queryByTestId('scroll-to-conversation')).toBeNull();
    });

    it('calls onClose when close button (×) is clicked', () => {
        const onClose = vi.fn();
        render(<PipelinePhasePopover phase={makeDetail()} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('phase-popover-close'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onScrollToConversation when the link is clicked', () => {
        const onScroll = vi.fn();
        const detail = makeDetail({ status: 'failed', error: 'err' });
        render(
            <PipelinePhasePopover phase={detail} onClose={() => {}} onScrollToConversation={onScroll} />
        );
        fireEvent.click(screen.getByTestId('scroll-to-conversation'));
        expect(onScroll).toHaveBeenCalledOnce();
    });
});
