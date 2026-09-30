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

import { KustoView, parseKustoContent, buildKustoAskAiMessage, isRunShortcut } from '../../../../../src/server/spa/client/react/features/canvas/KustoView';
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

    it('success: the result table owns its own scroll so the header can stick', () => {
        const { container } = render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        const table = container.querySelector('.interactive-table')!;
        expect(table).not.toBeNull();
        expect(table.classList.contains('interactive-table-fill')).toBe(true);
        // The wrapper around it must not scroll — otherwise the sticky header
        // never engages because the outer div is the scroller.
        const wrapper = table.parentElement!;
        expect(wrapper.className).toContain('overflow-hidden');
        expect(wrapper.className).not.toContain('overflow-auto');
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
        fireEvent.click(screen.getByTestId('kusto-chart-type-line'));
        // The chart still toggles locally, but nothing is saved back to the snapshot.
        await waitFor(() => expect(screen.getByTestId('kusto-chart-view')).toBeInTheDocument());
        expect(mocks.save).not.toHaveBeenCalled();
    });
});

describe('KustoView header connection slot (embed compaction)', () => {
    it('portals the cluster/database editors into the slot and omits the inline block', () => {
        const slot = document.createElement('div');
        document.body.appendChild(slot);
        render(
            <KustoView
                workspaceId="ws-1"
                canvas={makeCanvas(SUCCESS_STATE)}
                compact
                connectionInHeader
                connectionSlot={slot}
            />,
        );

        // Editors are mounted inside the header slot node...
        expect(slot.querySelector('[data-testid="kusto-cluster"]')).toBeTruthy();
        expect(slot.querySelector('[data-testid="kusto-database"]')).toBeTruthy();
        // ...exactly once (the inline labeled block is not also rendered).
        expect(screen.getAllByTestId('kusto-cluster')).toHaveLength(1);
        // The query editor and Run stay in the component body.
        expect(screen.getByTestId('kusto-query')).toBeInTheDocument();
        expect(screen.getByTestId('kusto-run')).toBeInTheDocument();

        slot.remove();
    });

    it('keeps the editors editable and feeds them into Run when slotted', async () => {
        const slot = document.createElement('div');
        document.body.appendChild(slot);
        const saved = makeCanvas(SUCCESS_STATE, { revision: 2 });
        mocks.run.mockResolvedValue(saved);

        render(
            <KustoView
                workspaceId="ws-1"
                canvas={makeCanvas({})}
                compact
                connectionInHeader
                connectionSlot={slot}
            />,
        );

        fireEvent.change(screen.getByTestId('kusto-database'), { target: { value: 'Other' } });
        fireEvent.click(screen.getByTestId('kusto-run'));

        await waitFor(() => expect(mocks.run).toHaveBeenCalledWith('ws-1', 'expl-abc123', {
            query: 'StormEvents | take 10',
            clusterUrl: 'https://help.kusto.windows.net',
            database: 'Other',
        }));

        slot.remove();
    });

    it('renders the labeled connection bar in the body when no header slot is used', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        // Default (standalone) layout keeps one connection bar in the body,
        // with accessible labels on both fields.
        const bar = screen.getByTestId('kusto-connection');
        expect(bar).toContainElement(screen.getByLabelText('Cluster URL'));
        expect(bar).toContainElement(screen.getByLabelText('Database'));
        expect(screen.getByLabelText('Cluster URL')).toHaveValue('https://help.kusto.windows.net');
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
        fireEvent.click(screen.getByTestId('kusto-chart-type-line'));

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
        expect(screen.getByTestId('kusto-chart')).toBeInTheDocument();
        expect(screen.getByTestId('kusto-chart-type-bar')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('kusto-chart-type-line')).toHaveAttribute('aria-pressed', 'false');
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
        expect(screen.queryByTestId('kusto-ask-toggle')).toBeNull();
    });

    it('is hidden in compact (embed) mode even with a processId', () => {
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} compact />);
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
        expect(screen.queryByTestId('kusto-ask-toggle')).toBeNull();
    });

    it('stays collapsed until the toolbar Ask AI toggle opens it', () => {
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        const toggle = screen.getByTestId('kusto-ask-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('kusto-ask-input')).toBeInTheDocument();
        fireEvent.click(toggle);
        expect(screen.queryByTestId('kusto-ask-ai')).toBeNull();
    });

    it('sends on Enter in the instruction input', async () => {
        mocks.sendMessage.mockResolvedValue({});
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        fireEvent.click(screen.getByTestId('kusto-ask-toggle'));
        fireEvent.change(screen.getByTestId('kusto-ask-input'), { target: { value: 'plot by day' } });
        fireEvent.keyDown(screen.getByTestId('kusto-ask-input'), { key: 'Enter' });
        await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
        expect(mocks.sendMessage.mock.calls[0][1].content).toContain('plot by day');
    });

    it('sends a follow-up containing the current query to the owning conversation', async () => {
        mocks.sendMessage.mockResolvedValue({});
        const canvas = makeCanvas({ ...SUCCESS_STATE, query: 'StormEvents | take 10' }, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        fireEvent.click(screen.getByTestId('kusto-ask-toggle'));

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
        fireEvent.click(screen.getByTestId('kusto-ask-toggle'));
        expect(screen.getByTestId('kusto-ask-send')).toBeDisabled();
    });

    it('shows an error when the follow-up rejects', async () => {
        mocks.sendMessage.mockRejectedValue(new Error('Session expired'));
        const canvas = makeCanvas(SUCCESS_STATE, { processId: 'proc-9' });
        render(<KustoView workspaceId="ws-1" canvas={canvas} />);
        fireEvent.click(screen.getByTestId('kusto-ask-toggle'));
        fireEvent.change(screen.getByTestId('kusto-ask-input'), { target: { value: 'do the thing' } });
        fireEvent.click(screen.getByTestId('kusto-ask-send'));
        await waitFor(() => expect(screen.getByTestId('kusto-ask-error')).toHaveTextContent('Session expired'));
    });
});

describe('KustoView run shortcut', () => {
    it('isRunShortcut accepts Shift/Ctrl/Cmd+Enter only', () => {
        const base = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false };
        expect(isRunShortcut(base)).toBe(false);
        expect(isRunShortcut({ ...base, shiftKey: true })).toBe(true);
        expect(isRunShortcut({ ...base, ctrlKey: true })).toBe(true);
        expect(isRunShortcut({ ...base, metaKey: true })).toBe(true);
        expect(isRunShortcut({ ...base, key: 'a', shiftKey: true })).toBe(false);
    });

    it('runs the query on Shift+Enter in the editor but not on plain Enter', async () => {
        mocks.run.mockResolvedValue(makeCanvas(SUCCESS_STATE, { revision: 2 }));
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({})} />);
        const editor = screen.getByTestId('kusto-query');
        fireEvent.keyDown(editor, { key: 'Enter' });
        expect(mocks.run).not.toHaveBeenCalled();
        fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
        await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    });

    it('ignores the shortcut in read-only history views and for an empty query', () => {
        const { unmount } = render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} readOnly />);
        fireEvent.keyDown(screen.getByTestId('kusto-query'), { key: 'Enter', ctrlKey: true });
        unmount();
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({ query: '   ' })} />);
        fireEvent.keyDown(screen.getByTestId('kusto-query'), { key: 'Enter', ctrlKey: true });
        expect(mocks.run).not.toHaveBeenCalled();
    });
});

describe('KustoView results header and chart controls', () => {
    it('summarizes the result shape in the results header', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas(SUCCESS_STATE)} />);
        expect(screen.getByTestId('kusto-result-summary')).toHaveTextContent('2 rows · 2 columns');
        expect(screen.getByTestId('kusto-view-table')).toHaveAttribute('aria-pressed', 'true');
    });

    it('omits the summary and view toggle before any result exists', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({})} />);
        expect(screen.queryByTestId('kusto-result-summary')).toBeNull();
        expect(screen.queryByTestId('kusto-view-chart')).toBeNull();
    });

    it('toggles a Y chip and persists the selection', async () => {
        mocks.save.mockResolvedValue(makeCanvas(SUCCESS_STATE, { revision: 2 }));
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({ ...SUCCESS_STATE, chartConfig: { type: 'bar', x: 'State', y: [] } })} />);
        const chip = screen.getByTestId('kusto-chart-y-Count');
        expect(chip).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(chip);
        expect(screen.getByTestId('kusto-chart-y-Count')).toHaveAttribute('aria-pressed', 'true');
        await waitFor(() => expect(mocks.save).toHaveBeenCalled());
        expect(JSON.parse(mocks.save.mock.calls[0][2].content).chartConfig.y).toEqual(['Count']);
    });

    it('marks exactly one chart type as pressed', () => {
        render(<KustoView workspaceId="ws-1" canvas={makeCanvas({ ...SUCCESS_STATE, chartConfig: { type: 'pie', y: ['Count'] } })} />);
        const pressed = screen.getByTestId('kusto-chart-type').querySelectorAll('[aria-pressed="true"]');
        expect(pressed).toHaveLength(1);
        expect(pressed[0]).toHaveAttribute('data-testid', 'kusto-chart-type-pie');
    });
});
