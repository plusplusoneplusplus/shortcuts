import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DAGHoverTooltip } from '../../../../src/server/spa/client/react/processes/dag/DAGHoverTooltip';
import type { PipelineConfig } from '@plusplusoneplusplus/pipeline-core';

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
    return {
        name: 'test-pipeline',
        ...overrides,
    };
}

const noop = () => {};

describe('DAGHoverTooltip', () => {
    describe('input phase', () => {
        it('renders source type and file path from CSV config', () => {
            const config = makeConfig({
                input: {
                    from: { type: 'csv', path: 'data/items.csv' },
                },
            });
            render(
                <DAGHoverTooltip phase="input" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            expect(screen.getByTestId('dag-hover-tooltip')).toBeDefined();
            expect(screen.getByTestId('hover-tooltip-input-content').textContent).toContain('csv');
            expect(screen.getByTestId('hover-tooltip-input-content').textContent).toContain('data/items.csv');
        });

        it('renders inline source type with item count', () => {
            const config = makeConfig({
                input: {
                    items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
                },
            });
            render(
                <DAGHoverTooltip phase="input" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-input-content').textContent!;
            expect(content).toContain('inline');
            expect(content).toContain('3');
        });

        it('renders limit when present', () => {
            const config = makeConfig({
                input: {
                    items: [{ name: 'a' }],
                    limit: 5,
                },
            });
            render(
                <DAGHoverTooltip phase="input" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            expect(screen.getByTestId('hover-tooltip-input-content').textContent).toContain('5');
        });

        it('renders mini data preview for inline items (first 3 rows)', () => {
            const config = makeConfig({
                input: {
                    items: [
                        { name: 'Alice', age: '30' },
                        { name: 'Bob', age: '25' },
                        { name: 'Charlie', age: '35' },
                        { name: 'Diana', age: '28' },
                    ],
                },
            });
            render(
                <DAGHoverTooltip phase="input" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const preview = screen.getByTestId('hover-tooltip-input-preview');
            expect(preview).toBeDefined();
            expect(preview.textContent).toContain('Alice');
            expect(preview.textContent).toContain('Bob');
            expect(preview.textContent).toContain('Charlie');
            // 4th item should not appear in preview
            expect(preview.textContent).not.toContain('Diana');
        });

        it('renders list source type with item count for from array', () => {
            const config = makeConfig({
                input: {
                    from: [{ model: 'gpt-4' }, { model: 'claude' }],
                },
            });
            render(
                <DAGHoverTooltip phase="input" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-input-content').textContent!;
            expect(content).toContain('list');
            expect(content).toContain('2');
        });
    });

    describe('filter phase', () => {
        it('renders filter type and rule summary', () => {
            const config = makeConfig({
                filter: {
                    type: 'rule',
                    rule: {
                        rules: [{ field: 'status', operator: 'equals', value: 'active' }],
                    },
                },
            });
            render(
                <DAGHoverTooltip phase="filter" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-filter-content').textContent!;
            expect(content).toContain('rule');
            expect(content).toContain('status');
            expect(content).toContain('equals');
            expect(content).toContain('active');
        });

        it('renders AI prompt snippet for ai filter', () => {
            const config = makeConfig({
                filter: {
                    type: 'ai',
                    ai: {
                        prompt: 'Determine if this item is relevant to the current topic being discussed',
                    },
                },
            });
            render(
                <DAGHoverTooltip phase="filter" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-filter-content').textContent!;
            expect(content).toContain('ai');
            expect(content).toContain('Determine if this item is relevant');
        });
    });

    describe('map phase', () => {
        it('renders prompt snippet truncated at 100 chars, model, parallel, output fields', () => {
            const longPrompt = 'A'.repeat(120);
            const config = makeConfig({
                map: {
                    prompt: longPrompt,
                    model: 'gpt-4',
                    parallel: 8,
                    output: ['summary', 'score'],
                },
            });
            render(
                <DAGHoverTooltip phase="map" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-map-content').textContent!;
            // Truncated at 100 + ellipsis
            expect(content).toContain('A'.repeat(100) + '…');
            expect(content).toContain('gpt-4');
            expect(content).toContain('8');
            expect(content).toContain('summary, score');
        });

        it('renders promptFile reference', () => {
            const config = makeConfig({
                map: {
                    promptFile: 'prompts/analyze.md',
                    model: 'claude-sonnet',
                },
            });
            render(
                <DAGHoverTooltip phase="map" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-map-content').textContent!;
            expect(content).toContain('File: prompts/analyze.md');
            expect(content).toContain('claude-sonnet');
        });

        it('renders batch size when provided', () => {
            const config = makeConfig({
                map: {
                    prompt: 'Analyze {{item}}',
                    batchSize: 10,
                },
            });
            render(
                <DAGHoverTooltip phase="map" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            expect(screen.getByTestId('hover-tooltip-map-content').textContent).toContain('10');
        });
    });

    describe('reduce phase', () => {
        it('renders reduce type and prompt snippet', () => {
            const config = makeConfig({
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize all the results into a coherent report',
                    model: 'gpt-4',
                },
            });
            render(
                <DAGHoverTooltip phase="reduce" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-reduce-content').textContent!;
            expect(content).toContain('ai');
            expect(content).toContain('Summarize all the results');
            expect(content).toContain('gpt-4');
        });

        it('renders promptFile reference for reduce', () => {
            const config = makeConfig({
                reduce: {
                    type: 'markdown',
                    promptFile: 'reduce.prompt.md',
                },
            });
            render(
                <DAGHoverTooltip phase="reduce" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-reduce-content').textContent!;
            expect(content).toContain('markdown');
            expect(content).toContain('File: reduce.prompt.md');
        });
    });

    describe('job phase', () => {
        it('renders prompt snippet and model', () => {
            const config = makeConfig({
                job: {
                    prompt: 'Generate a comprehensive test plan for the authentication module',
                    model: 'gpt-4',
                    output: ['plan', 'risks'],
                },
            });
            render(
                <DAGHoverTooltip phase="job" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const content = screen.getByTestId('hover-tooltip-job-content').textContent!;
            expect(content).toContain('Generate a comprehensive test plan');
            expect(content).toContain('gpt-4');
            expect(content).toContain('plan, risks');
        });

        it('renders promptFile reference for job', () => {
            const config = makeConfig({
                job: {
                    promptFile: 'job-prompt.md',
                },
            });
            render(
                <DAGHoverTooltip phase="job" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            expect(screen.getByTestId('hover-tooltip-job-content').textContent).toContain('File: job-prompt.md');
        });
    });

    describe('missing config', () => {
        it('renders fallback when config section for the phase is missing', () => {
            const config = makeConfig({});
            render(
                <DAGHoverTooltip phase="map" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const tooltip = screen.getByTestId('dag-hover-tooltip');
            expect(tooltip).toBeDefined();
            // Should show phase label as fallback
            expect(tooltip.textContent).toContain('Map');
        });

        it('renders fallback for input when no input config', () => {
            const config = makeConfig({});
            render(
                <DAGHoverTooltip phase="input" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            expect(screen.getByTestId('dag-hover-tooltip').textContent).toContain('Input');
        });
    });

    describe('positioning', () => {
        it('is positioned absolutely using anchor coordinates', () => {
            const config = makeConfig({ map: { prompt: 'test' } });
            render(
                <DAGHoverTooltip phase="map" config={config} anchor={{ x: 200, y: 80 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            const tooltip = screen.getByTestId('dag-hover-tooltip');
            expect(tooltip.style.left).toBe('200px');
            expect(tooltip.style.top).toBe('80px');
            expect(tooltip.style.transform).toContain('translate(-50%, -100%)');
        });
    });

    describe('phase label', () => {
        it('shows correct phase label in header', () => {
            const config = makeConfig({ filter: { type: 'rule' } });
            render(
                <DAGHoverTooltip phase="filter" config={config} anchor={{ x: 100, y: 50 }} onMouseEnter={noop} onMouseLeave={noop} />
            );
            expect(screen.getByTestId('dag-hover-tooltip').textContent).toContain('Filter Phase');
        });
    });
});
