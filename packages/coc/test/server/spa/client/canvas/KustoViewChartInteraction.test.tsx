/**
 * @vitest-environment jsdom
 *
 * AC-07 — the Kusto chart's interactions must be live in every host surface,
 * including a read-only historical revision, and must never write anything
 * back. `KustoChart.test.tsx` covers the panel and the compact embed against
 * the component directly; this file drives the whole `KustoView` host in
 * read-only mode, which is the surface where a stray save would be a real bug.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import type { KustoCanvasState, KustoCellValue } from '@plusplusoneplusplus/coc-client';
import * as Recharts from 'recharts';

const mocks = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), sendMessage: vi.fn() }));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => {
    const canvases = { run: mocks.run, save: mocks.save };
    const processes = { sendMessage: mocks.sendMessage };
    return {
        getSpaCocClient: () => ({ canvases, processes }),
        getCocClientFor: () => ({ canvases, processes }),
    };
});

// The vendored recharts bundle is injected at runtime in the browser; tests
// hand the component the npm copy instead.
vi.mock('../../../../../src/server/spa/client/react/features/canvas/rechartsLoader', () => ({
    loadRecharts: () => Promise.resolve(Recharts),
    RECHARTS_VENDOR_URL: '/canvas-vendor/recharts.js',
    resetRechartsLoaderForTests: () => {},
}));

import { KustoView } from '../../../../../src/server/spa/client/react/features/canvas/KustoView';

/** jsdom has no layout engine — see the same block in KustoChart.test.tsx. */
beforeAll(() => {
    const define = (prop: 'offsetWidth' | 'offsetHeight', value: number) =>
        Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
    define('offsetWidth', 640);
    define('offsetHeight', 360);
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            width: 640, height: 360, top: 0, left: 0, bottom: 360, right: 640, x: 0, y: 0,
            toJSON() { return this; },
        }),
    });
    class SizedResizeObserver {
        constructor(private cb: ResizeObserverCallback) {}
        observe(target: Element) {
            const entry = {
                target,
                contentRect: { width: 640, height: 360, top: 0, left: 0, bottom: 360, right: 640, x: 0, y: 0 },
            } as unknown as ResizeObserverEntry;
            this.cb([entry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
    }
    globalThis.ResizeObserver = SizedResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
    cleanup();
    mocks.run.mockReset();
    mocks.save.mockReset();
    mocks.sendMessage.mockReset();
});

const rows: KustoCellValue[][] = Array.from({ length: 12 }, (_, i) => [
    `t${String(i + 1).padStart(2, '0')}`,
    100 + i * 10,
    9120.7043 + i,
]);

function makeCanvas() {
    const state: KustoCanvasState = {
        query: 'Latency | summarize p95 by bin(Timestamp, 1h)',
        clusterUrl: 'https://help.kusto.windows.net',
        database: 'Samples',
        columns: [
            { name: 'Bucket', type: 'string' },
            { name: 'api-gateway', type: 'long' },
            { name: 'inference', type: 'real' },
        ],
        rows,
        truncated: false,
        chartConfig: { type: 'line', x: 'Bucket', y: ['api-gateway', 'inference'] },
    };
    return {
        id: 'expl-abc123',
        workspaceId: 'ws-1',
        title: 'Latency percentiles',
        type: 'kusto' as const,
        revision: 3,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        lastEditor: 'ai' as const,
        content: JSON.stringify(state),
    };
}

/** Render an older revision of the canvas — the read-only host surface. */
async function renderReadOnly() {
    const view = render(<KustoView workspaceId="ws-1" canvas={makeCanvas()} readOnly />);
    await waitFor(() => expect(view.container.querySelector('.recharts-surface')).toBeTruthy());
    const wrapper = view.container.querySelector('.recharts-wrapper') as HTMLElement;
    return { container: view.container, wrapper };
}

/**
 * Recharts defers external mouse handlers through a requestAnimationFrame and
 * captures the handler closure at dispatch time, so each event has to settle
 * before the next one is fired.
 */
async function flush() {
    await act(async () => {
        await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

async function drag(wrapper: HTMLElement, fromX: number, toX: number) {
    const at = (clientX: number) => ({ clientX, clientY: 100, pointerId: 1, pointerType: 'mouse', bubbles: true });
    fireEvent.mouseMove(wrapper, at(fromX));
    await flush();
    fireEvent.mouseDown(wrapper, at(fromX));
    await flush();
    fireEvent.mouseMove(wrapper, at(toX));
    await flush();
    fireEvent.mouseUp(wrapper, at(toX));
    await flush();
}

function pointCount(container: HTMLElement) {
    const d = container.querySelector('.recharts-line .recharts-curve')?.getAttribute('d') ?? '';
    return d.split(',').length - 1;
}

describe('KustoView read-only chart interactivity (AC-07)', () => {
    it('renders the interactive recharts chart for a historical revision', async () => {
        const { container } = await renderReadOnly();
        expect(screen.getByTestId('kusto-chart-view')).toBeInTheDocument();
        expect(container.querySelectorAll('.recharts-line')).toHaveLength(2);
        // Interaction is deliberately not gated behind readOnly, so the legend
        // entries are still real toggle buttons.
        expect(screen.getByTitle('Hide api-gateway')).toBeInTheDocument();
    });

    it('shows the shared full-precision tooltip on hover', async () => {
        const { wrapper } = await renderReadOnly();
        fireEvent.mouseMove(wrapper, { clientX: 320, clientY: 100, pointerId: 1, pointerType: 'mouse', bubbles: true });
        const tooltip = await screen.findByTestId('kusto-chart-tooltip');
        expect(tooltip).toHaveTextContent('api-gateway');
        expect(tooltip).toHaveTextContent('inference');
        // Unrounded — the whole point of AC-03.
        expect(tooltip.textContent).toMatch(/9\d{3}\.7043/);
    });

    it('toggles a series off and on from the legend', async () => {
        const { container } = await renderReadOnly();
        fireEvent.click(screen.getByTitle('Hide api-gateway'));
        await waitFor(() => expect(container.querySelectorAll('.recharts-line')).toHaveLength(1));
        fireEvent.click(screen.getByTitle('Show api-gateway'));
        await waitFor(() => expect(container.querySelectorAll('.recharts-line')).toHaveLength(2));
    });

    it('zooms the x range on drag and restores it from the reset control', async () => {
        const { container, wrapper } = await renderReadOnly();
        expect(pointCount(container)).toBe(12);
        await drag(wrapper, 120, 320);
        await waitFor(() => {
            const after = pointCount(container);
            expect(after).toBeGreaterThan(1);
            expect(after).toBeLessThan(12);
        });
        fireEvent.click(screen.getByTestId('kusto-chart-reset-zoom'));
        await waitFor(() => expect(pointCount(container)).toBe(12));
    });

    it('never saves or re-runs the query while the user interacts', async () => {
        const { container, wrapper } = await renderReadOnly();
        fireEvent.mouseMove(wrapper, { clientX: 320, clientY: 100, pointerId: 1, pointerType: 'mouse', bubbles: true });
        await screen.findByTestId('kusto-chart-tooltip');
        fireEvent.click(screen.getByTitle('Hide api-gateway'));
        await waitFor(() => expect(container.querySelectorAll('.recharts-line')).toHaveLength(1));
        await drag(wrapper, 120, 320);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.run).not.toHaveBeenCalled();
    });
});
