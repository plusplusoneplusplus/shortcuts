/**
 * Tests for WorkflowResultCard — rendering pipeline-specific result content.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowResultCard } from '../../../src/server/spa/client/react/processes/WorkflowResultCard';

// Mock MarkdownView
vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

// Mock markdown renderer
vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

// Mock useMermaid
vi.mock('../../../src/server/spa/client/react/hooks/useMermaid', () => ({
    useMermaid: () => {},
}));

function makeProcess(overrides: Record<string, any> = {}) {
    return {
        id: 'proc-1',
        status: 'completed',
        result: '# Hello World',
        durationMs: 5000,
        metadata: {
            pipelineName: 'Bug Triage',
            executionStats: {
                totalItems: 10,
                successfulMaps: 8,
                failedMaps: 2,
                mapPhaseTimeMs: 3000,
                reducePhaseTimeMs: 500,
                maxConcurrency: 4,
            },
        },
        ...overrides,
    };
}

describe('WorkflowResultCard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders pipeline name from metadata', () => {
        render(<WorkflowResultCard process={makeProcess()} />);
        expect(screen.getByText('Bug Triage')).toBeDefined();
    });

    it('renders fallback title when pipelineName is missing', () => {
        render(<WorkflowResultCard process={makeProcess({ metadata: {} })} />);
        expect(screen.getByText('Workflow Execution')).toBeDefined();
    });

    it('renders execution stats grid when executionStats present', () => {
        render(<WorkflowResultCard process={makeProcess()} />);
        const statsGrid = screen.getByTestId('stats-grid');
        expect(statsGrid).toBeDefined();
        expect(statsGrid.textContent).toContain('10');
        expect(statsGrid.textContent).toContain('8');
        expect(statsGrid.textContent).toContain('2');
        expect(statsGrid.textContent).toContain('80%');
    });

    it('hides stats grid when executionStats is missing', () => {
        render(<WorkflowResultCard process={makeProcess({ metadata: { pipelineName: 'Test' } })} />);
        expect(screen.queryByTestId('stats-grid')).toBeNull();
    });

    it('renders result content via MarkdownView', () => {
        render(<WorkflowResultCard process={makeProcess()} />);
        const mdView = screen.getByTestId('markdown-view');
        expect(mdView).toBeDefined();
        expect(mdView.innerHTML).toContain('Hello World');
    });

    it('renders placeholder when result is empty', () => {
        render(<WorkflowResultCard process={makeProcess({ result: '' })} />);
        expect(screen.getByText('No output available.')).toBeDefined();
    });

    it('copy button copies result to clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        render(<WorkflowResultCard process={makeProcess()} />);
        const copyBtn = screen.getByTestId('copy-result-btn');
        fireEvent.click(copyBtn);
        expect(writeText).toHaveBeenCalledWith('# Hello World');
    });

    it('renders status badge', () => {
        const { container } = render(<WorkflowResultCard process={makeProcess()} />);
        // Badge renders the status text by default
        const badges = container.querySelectorAll('span');
        const badgeTexts = Array.from(badges).map(b => b.textContent);
        expect(badgeTexts.some(t => t === 'completed')).toBe(true);
    });

    it('does not render copy button when result is empty', () => {
        render(<WorkflowResultCard process={makeProcess({ result: '' })} />);
        expect(screen.queryByTestId('copy-result-btn')).toBeNull();
    });

    it('renders duration in header', () => {
        const { container } = render(<WorkflowResultCard process={makeProcess()} />);
        expect(container.textContent).toContain('5s');
    });

    it('renders success rate correctly for all successes', () => {
        const proc = makeProcess({
            metadata: {
                pipelineName: 'All Pass',
                executionStats: { totalItems: 5, successfulMaps: 5, failedMaps: 0 },
            },
        });
        render(<WorkflowResultCard process={proc} />);
        const statsGrid = screen.getByTestId('stats-grid');
        expect(statsGrid.textContent).toContain('100%');
    });
});
