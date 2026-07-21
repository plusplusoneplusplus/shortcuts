/**
 * @vitest-environment jsdom
 *
 * KustoView (AC-04) — query editor + run + result table + CSV export.
 * Covers the idle / success / error / truncated render states and the Run
 * dispatch path (overrides → client.canvases.run → onCanvasSaved).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), sendMessage: vi.fn() }));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => {
    const canvases = { run: mocks.run, save: mocks.save };
    const processes = { sendMessage: mocks.sendMessage };
    return {
        getSpaCocClient: () => ({ canvases, processes }),
        getCocClientFor: () => ({ canvases, processes }),
    };
});

import { KustoView, parseKustoContent, buildKustoAskAiMessage } from '../../../../../src/server/spa/client/react/features/canvas/KustoView';
import type { KustoCanvasState } from '@plusplusoneplusplus/coc-client';

function makeCanvas(state: Partial<KustoCanvasState>, overrides: Record<string, unknown> = {}) {
    const full: KustoCanvasState = {
        query: 'StormEvents | take 10',
        clusterUrl: 'https://help.kusto.windows.net',
        database: 'Samples',
        columns: [],
        rows: [],
        truncated: false,
        ...state,
    };
    return {
        id: 'expl-abc123',
        workspaceId: 'ws-1',
        title: 'My Kusto Query',
        type: 'kusto' as const,
        revision: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        lastEditor: 'ai' as const,
        content: JSON.stringify(full),
        ...overrides,
    };
}

const SUCCESS_STATE: Partial<KustoCanvasState> = {
    columns: [{ name: 'State', type: 'string' }, { name: 'Count', type: 'long' }],
    rows: [['Texas', 100], ['Kansas', 55]],
    lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 2 },
};

beforeEach(() => {
    mocks.run.mockReset();
    mocks.save.mockReset();
    mocks.sendMessage.mockReset();
});

describe('parseKustoContent', () => {
    it('parses valid state and falls back to empty on garbage', () => {
        const state = parseKustoContent(JSON.stringify(SUCCESS_STATE));
        expect(state.columns).toHaveLength(2);
        expect(state.rows[0]).toEqual(['Texas', 100]);

        const fallback = parseKustoContent('not json');
        expect(fallback).toMatchObject({ query: '', columns: [], rows: [], truncated: false });
    });
});

describe('KustoView render states', () => {
    it('idle: no run yet, prompts to run a query', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({})} />);
        expect(screen.getByTestId('kusto-status')).toHaveTextContent('Not run yet');
        expect(screen.getByTestId('kusto-empty')).toBeInTheDocument();
        // No CSV button until there are result columns.
        expect(screen.queryByTestId('kusto-csv')).toBeNull();
    });

    it('success: renders the table with headers, cells, and row count', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        expect(screen.getByTestId('kusto-status')).toHaveTextContent('2 rows');
        expect(screen.getByText('State')).toBeInTheDocument();
        expect(screen.getByText('Texas')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByTestId('kusto-csv')).toBeInTheDocument();
    });

    it('error: surfaces the stored run error and shows no table', () => {
        const canvas = makeCanvas({
            columns: [],
            rows: [],
            lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'error', error: 'Semantic error: bad query' },
        });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        expect(screen.getByTestId('kusto-error')).toHaveTextContent('Semantic error: bad query');
        expect(screen.getByTestId('kusto-empty')).toBeInTheDocument();
    });

    it('truncated: notes the 10,000-row cap', () => {
        const canvas = makeCanvas({
            ...SUCCESS_STATE,
            truncated: true,
            lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 25000 },
        });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        expect(screen.getByTestId('kusto-status')).toHaveTextContent('truncated to 10,000');
    });
});

describe('KustoView run', () => {
    it('runs the current query with overrides and calls onCanvasSaved', async () => {
        const saved = makeCanvas(SUCCESS_STATE, { revision: 2 });
        mocks.run.mockResolvedValue(saved);
        const onCanvasSaved = vi.fn();

        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({})} onCanvasSaved={onCanvasSaved} />);

        fireEvent.change(screen.getByTestId('kusto-query'), { target: { value: 'StormEvents | count' } });
        fireEvent.change(screen.getByTestId('kusto-database'), { target: { value: 'Other' } });
        fireEvent.click(screen.getByTestId('kusto-run'));

        await waitFor(() => expect(onCanvasSaved).toHaveBeenCalledWith(saved));
        expect(mocks.run).toHaveBeenCalledWith('ws-1', 'expl-abc123', {
            query: 'StormEvents | count',
            clusterUrl: 'https://help.kusto.windows.net',
            database: 'Other',
        });
    });

    it('shows a run error when the request rejects', async () => {
        mocks.run.mockRejectedValue(new Error('Network down'));
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({})} />);
        fireEvent.click(screen.getByTestId('kusto-run'));
        await waitFor(() => expect(screen.getByTestId('kusto-run-error')).toHaveTextContent('Network down'));
    });

    it('disables Run when the query is empty', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({ query: '' })} />);
        expect(screen.getByTestId('kusto-run')).toBeDisabled();
    });
});

describe('KustoView read-only (historical revision)', () => {
    it('renders the stored table but hides Run/Ask-AI and marks editors read-only', () => {
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-1', revision: 2 });
        render(<KustoView workspaceId="ws-1" canvas={canvas} readOnly />);
        // Saved rows still render through the table.
        expect(screen.getByText('Texas')).toBeInTheDocument();
        expect(screen.getByTestId('interactive-table-kusto-expl-abc123-2')).toBeInTheDocument();
        // No mutating affordances — even though the canvas is chat-linked.
        expect(screen.queryByTestId('kusto-run')).toBeNull();
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
        // Editors are read-only.
        expect(screen.getByTestId('kusto-query')).toHaveAttribute('readonly');
        expect(screen.getByTestId('kusto-cluster')).toHaveAttribute('readonly');
        expect(screen.getByTestId('kusto-database')).toHaveAttribute('readonly');
    });

    it('does not persist chart-config changes to the server in read-only mode', async () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE, { revision: 2 })} readOnly />);
        fireEvent.click(screen.getByTestId('kusto-view-chart'));
        fireEvent.change(screen.getByTestId('kusto-chart-type'), { target: { value: 'line' } });
        // The chart still toggles locally, but nothing is saved back to the snapshot.
        await waitFor(() => expect(screen.getByTestId('kusto-chart-view')).toBeInTheDocument());
        expect(mocks.save).not.toHaveBeenCalled();
    });
});

describe('KustoView charts (AC-05)', () => {
    it('defaults to the table view and toggles to the chart view', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        expect(screen.getByTestId('interactive-table-kusto-expl-abc123-1')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('kusto-view-chart'));
        expect(screen.getByTestId('kusto-chart-controls')).toBeInTheDocument();
    });

    it('offers only numeric columns in the Y picker', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        fireEvent.click(screen.getByTestId('kusto-view-chart'));
        // Count is a long → offered; State is a string → not offered.
        expect(screen.getByTestId('kusto-chart-y-Count')).toBeInTheDocument();
        expect(screen.queryByTestId('kusto-chart-y-State')).toBeNull();
    });

    it('persists a chart-config change via canvases.save', async () => {
        const saved = makeCanvas(SUCCESS_STATE, { revision: 2 });
        mocks.save.mockResolvedValue(saved);
        const onCanvasSaved = vi.fn();
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} onCanvasSaved={onCanvasSaved} />);
        fireEvent.click(screen.getByTestId('kusto-view-chart'));
        fireEvent.change(screen.getByTestId('kusto-chart-type'), { target: { value: 'line' } });

        await waitFor(() => expect(mocks.save).toHaveBeenCalled());
        const [, , req] = mocks.save.mock.calls[0];
        const state = JSON.parse(req.content);
        expect(state.chartConfig.type).toBe('line');
        expect(req.expectedRevision).toBe(1);
        await waitFor(() => expect(onCanvasSaved).toHaveBeenCalledWith(saved));
    });

    it('applies an AI-supplied initial chart config on first open', () => {
        const canvas = makeCanvas({
            ...SUCCESS_STATE,
            chartConfig: { type: 'bar', x: 'State', y: ['Count'] },
        });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        // Opens directly into the chart view because a config exists.
        expect(screen.getByTestId('kusto-chart-view')).toBeInTheDocument();
        expect(screen.getByTestId('kusto-chart-svg')).toBeInTheDocument();
        expect((screen.getByTestId('kusto-chart-type') as HTMLSelectElement).value).toBe('bar');
    });
});

describe('buildKustoAskAiMessage (AC-06)', () => {
    it('embeds the current query text and the target canvas id', () => {
        const msg = buildKustoAskAiMessage('StormEvents | take 10', 'add a 7-day rolling average', 'expl-abc123');
        expect(msg).toContain('StormEvents | take 10');
        expect(msg).toContain('add a 7-day rolling average');
        expect(msg).toContain('expl-abc123');
        expect(msg).toContain('kusto_query');
    });

    it('handles an empty query gracefully', () => {
        const msg = buildKustoAskAiMessage('', 'plot by day', 'expl-1');
        expect(msg).toContain('no query yet');
        expect(msg).toContain('plot by day');
    });
});

describe('KustoView Ask-AI loop (AC-06)', () => {
    it('is hidden when the canvas has no owning conversation', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
    });

    it('is hidden in compact (embed) mode even with a processId', () => {
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} compact />);
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
    });

    it('sends a follow-up containing the current query to the owning conversation', async () => {
        mocks.sendMessage.mockResolvedValue({});
        const canvas = makeCanvas({ ...SUCCESS_STATE, query: 'StormEvents | take 10' }, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);

        fireEvent.change(screen.getByTestId('kusto-ask-input'), { target: { value: 'add a 7-day rolling average' } });
        fireEvent.click(screen.getByTestId('kusto-ask-send'));

        await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
        const [processId, request, query] = mocks.sendMessage.mock.calls[0];
        expect(processId).toBe('proc-9');
        expect(request.content).toContain('StormEvents | take 10');
        expect(request.content).toContain('add a 7-day rolling average');
        expect(request.mode).toBe('autopilot');
        expect(query).toEqual({ workspace: 'ws-1' });
        // Confirmation shown and input cleared.
        await waitFor(() => expect(screen.getByTestId('kusto-ask-sent')).toBeInTheDocument());
        expect((screen.getByTestId('kusto-ask-input') as HTMLTextAreaElement).value).toBe('');
    });

    it('disables the Ask AI button until an instruction is typed', () => {
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        expect(screen.getByTestId('kusto-ask-send')).toBeDisabled();
    });

    it('shows an error when the follow-up rejects', async () => {
        mocks.sendMessage.mockRejectedValue(new Error('Session expired'));
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        fireEvent.change(screen.getByTestId('kusto-ask-input'), { target: { value: 'do the thing' } });
        fireEvent.click(screen.getByTestId('kusto-ask-send'));
        await waitFor(() => expect(screen.getByTestId('kusto-ask-error')).toHaveTextContent('Session expired'));
    });
});
