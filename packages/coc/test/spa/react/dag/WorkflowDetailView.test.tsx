/**
 * Tests for WorkflowDetailView component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { WorkflowDetailView } from '../../../../src/server/spa/client/react/processes/dag/WorkflowDetailView';

function makeProcessResponse(overrides: Record<string, any> = {}) {
    return {
        process: {
            id: 'proc-1',
            status: 'completed',
            durationMs: 5000,
            metadata: {
                pipelineName: 'Bug Triage',
                executionStats: {
                    totalItems: 3,
                    successfulMaps: 2,
                    failedMaps: 1,
                    mapPhaseTimeMs: 3000,
                    reducePhaseTimeMs: 500,
                },
                pipelineConfig: {
                    input: { type: 'csv' },
                    map: { concurrency: 2, model: 'gpt-4' },
                    reduce: { type: 'ai' },
                },
            },
            ...overrides,
        },
    };
}

function makeChildrenResponse() {
    return [
        { id: 'proc-1-m0', status: 'completed', metadata: { itemIndex: 0, promptPreview: 'Item 0' }, durationMs: 1000 },
        { id: 'proc-1-m1', status: 'completed', metadata: { itemIndex: 1, promptPreview: 'Item 1' }, durationMs: 1500 },
        { id: 'proc-1-m2', status: 'failed', metadata: { itemIndex: 2, promptPreview: 'Item 2', error: 'AI error' }, durationMs: 500 },
    ];
}

describe('WorkflowDetailView', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Mock global fetch
        fetchMock = vi.fn();
        global.fetch = fetchMock;

        // Mock window.__DASHBOARD_CONFIG__
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('shows loading state initially', () => {
        fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
        render(<WorkflowDetailView processId="proc-1" />);
        expect(screen.getByTestId('workflow-detail-loading')).toBeDefined();
    });

    it('shows error state when fetch fails', async () => {
        fetchMock.mockRejectedValue(new Error('Network error'));
        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('workflow-detail-error')).toBeDefined();
        });
    });

    it('renders DAG chart after successful fetch', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('workflow-detail-view')).toBeDefined();
        });

        expect(screen.getByTestId('dag-chart-container')).toBeDefined();
    });

    it('renders correct pipeline status caption', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('workflow-detail-view')).toBeDefined();
        });

        expect(screen.getByText(/Pipeline completed/)).toBeDefined();
    });

    it('renders failed status caption', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(makeProcessResponse({ status: 'failed' })),
            });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('workflow-detail-view')).toBeDefined();
        });

        expect(screen.getByText(/Pipeline failed/)).toBeDefined();
    });

    it('clicking map node reveals MapItemGrid', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('dag-chart-container')).toBeDefined();
        });

        // Find the map node and click it
        const mapNode = screen.getByTestId('dag-node-map');
        fireEvent.click(mapNode);

        // The grid wrapper should now have maxHeight > 0
        const gridWrapper = screen.getByTestId('map-item-grid-wrapper');
        expect(gridWrapper.style.maxHeight).toBe('2000px');

        // Item grid should be rendered
        expect(screen.getByTestId('map-item-grid')).toBeDefined();
    });

    it('clicking map node again hides MapItemGrid', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('dag-chart-container')).toBeDefined();
        });

        // Click to expand
        const mapNode = screen.getByTestId('dag-node-map');
        fireEvent.click(mapNode);
        expect(screen.getByTestId('map-item-grid-wrapper').style.maxHeight).toBe('2000px');

        // Click again to collapse
        fireEvent.click(mapNode);
        expect(screen.getByTestId('map-item-grid-wrapper').style.maxHeight).toBe('0');
    });

    it('renders correct number of children in expanded grid', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('dag-chart-container')).toBeDefined();
        });

        // Expand map node
        fireEvent.click(screen.getByTestId('dag-node-map'));

        expect(screen.getByTestId('map-item-card-proc-1-m0')).toBeDefined();
        expect(screen.getByTestId('map-item-card-proc-1-m1')).toBeDefined();
        expect(screen.getByTestId('map-item-card-proc-1-m2')).toBeDefined();
    });

    it('clicking item card opens conversation panel instead of navigating', async () => {
        const onNavigate = vi.fn();
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            if (url.includes('proc-1-m0') && !url.includes('/children')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        process: {
                            id: 'proc-1-m0', status: 'completed', durationMs: 1000,
                            metadata: { itemIndex: 0 }, conversationTurns: [],
                        },
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" onNavigateToProcess={onNavigate} />);

        await waitFor(() => {
            expect(screen.getByTestId('dag-chart-container')).toBeDefined();
        });

        // Expand map node
        fireEvent.click(screen.getByTestId('dag-node-map'));

        // Click first item card
        fireEvent.click(screen.getByTestId('map-item-card-proc-1-m0'));

        // Should open conversation panel, not navigate
        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-panel')).toBeDefined();
        });
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('shows empty state when no DAG data available', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ process: { id: 'proc-1', status: 'completed', metadata: {} } }),
            });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('workflow-detail-empty')).toBeDefined();
        });
    });
});
