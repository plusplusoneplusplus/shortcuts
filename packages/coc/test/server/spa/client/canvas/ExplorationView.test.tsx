/**
 * @vitest-environment jsdom
 *
 * ExplorationView (AC-04) — query editor + run + result table + CSV export.
 * Covers the idle / success / error / truncated render states and the Run
 * dispatch path (overrides → client.canvases.run → onCanvasSaved).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => {
    const canvases = { run: mocks.run };
    return {
        getSpaCocClient: () => ({ canvases }),
        getCocClientFor: () => ({ canvases }),
    };
});

import { ExplorationView, parseExplorationContent } from '../../../../../src/server/spa/client/react/features/canvas/ExplorationView';
import type { ExplorationState } from '@plusplusoneplusplus/coc-client';

function makeCanvas(state: Partial<ExplorationState>, overrides: Record<string, unknown> = {}) {
    const full: ExplorationState = {
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
        title: 'My Exploration',
        type: 'exploration' as const,
        revision: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        lastEditor: 'ai' as const,
        content: JSON.stringify(full),
        ...overrides,
    };
}

const SUCCESS_STATE: Partial<ExplorationState> = {
    columns: [{ name: 'State', type: 'string' }, { name: 'Count', type: 'long' }],
    rows: [['Texas', 100], ['Kansas', 55]],
    lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 2 },
};

beforeEach(() => {
    mocks.run.mockReset();
});

describe('parseExplorationContent', () => {
    it('parses valid state and falls back to empty on garbage', () => {
        const state = parseExplorationContent(JSON.stringify(SUCCESS_STATE));
        expect(state.columns).toHaveLength(2);
        expect(state.rows[0]).toEqual(['Texas', 100]);

        const fallback = parseExplorationContent('not json');
        expect(fallback).toMatchObject({ query: '', columns: [], rows: [], truncated: false });
    });
});

describe('ExplorationView render states', () => {
    it('idle: no run yet, prompts to run a query', () => {
        render(<ExplorationView workspaceId="ws-1" canvas={makeCanvas({})} />);
        expect(screen.getByTestId('exploration-status')).toHaveTextContent('Not run yet');
        expect(screen.getByTestId('exploration-empty')).toBeInTheDocument();
        // No CSV button until there are result columns.
        expect(screen.queryByTestId('exploration-csv')).toBeNull();
    });

    it('success: renders the table with headers, cells, and row count', () => {
        render(<ExplorationView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        expect(screen.getByTestId('exploration-status')).toHaveTextContent('2 rows');
        expect(screen.getByText('State')).toBeInTheDocument();
        expect(screen.getByText('Texas')).toBeInTheDocument();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByTestId('exploration-csv')).toBeInTheDocument();
    });

    it('error: surfaces the stored run error and shows no table', () => {
        const canvas = makeCanvas({
            columns: [],
            rows: [],
            lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'error', error: 'Semantic error: bad query' },
        });
        render(<ExplorationView workspaceId="ws-1" canvas={canvas} />);
        expect(screen.getByTestId('exploration-error')).toHaveTextContent('Semantic error: bad query');
        expect(screen.getByTestId('exploration-empty')).toBeInTheDocument();
    });

    it('truncated: notes the 10,000-row cap', () => {
        const canvas = makeCanvas({
            ...SUCCESS_STATE,
            truncated: true,
            lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 25000 },
        });
        render(<ExplorationView workspaceId="ws-1" canvas={canvas} />);
        expect(screen.getByTestId('exploration-status')).toHaveTextContent('truncated to 10,000');
    });
});

describe('ExplorationView run', () => {
    it('runs the current query with overrides and calls onCanvasSaved', async () => {
        const saved = makeCanvas(SUCCESS_STATE, { revision: 2 });
        mocks.run.mockResolvedValue(saved);
        const onCanvasSaved = vi.fn();

        render(<ExplorationView workspaceId="ws-1" canvas={makeCanvas({})} onCanvasSaved={onCanvasSaved} />);

        fireEvent.change(screen.getByTestId('exploration-query'), { target: { value: 'StormEvents | count' } });
        fireEvent.change(screen.getByTestId('exploration-database'), { target: { value: 'Other' } });
        fireEvent.click(screen.getByTestId('exploration-run'));

        await waitFor(() => expect(onCanvasSaved).toHaveBeenCalledWith(saved));
        expect(mocks.run).toHaveBeenCalledWith('ws-1', 'expl-abc123', {
            query: 'StormEvents | count',
            clusterUrl: 'https://help.kusto.windows.net',
            database: 'Other',
        });
    });

    it('shows a run error when the request rejects', async () => {
        mocks.run.mockRejectedValue(new Error('Network down'));
        render(<ExplorationView workspaceId="ws-1" canvas={makeCanvas({})} />);
        fireEvent.click(screen.getByTestId('exploration-run'));
        await waitFor(() => expect(screen.getByTestId('exploration-run-error')).toHaveTextContent('Network down'));
    });

    it('disables Run when the query is empty', () => {
        render(<ExplorationView workspaceId="ws-1" canvas={makeCanvas({ query: '' })} />);
        expect(screen.getByTestId('exploration-run')).toBeDisabled();
    });
});
