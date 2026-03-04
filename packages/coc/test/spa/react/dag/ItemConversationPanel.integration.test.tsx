/**
 * Integration tests for ItemConversationPanel with WorkflowDetailView and MapItemGrid.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkflowDetailView } from '../../../../src/server/spa/client/react/processes/dag/WorkflowDetailView';
import { MapItemGrid } from '../../../../src/server/spa/client/react/processes/dag/MapItemGrid';

function makeProcessResponse(overrides: Record<string, any> = {}) {
    return {
        process: {
            id: 'proc-1',
            status: 'completed',
            durationMs: 5000,
            metadata: {
                pipelineName: 'Bug Triage',
                executionStats: {
                    totalItems: 2,
                    successfulMaps: 2,
                    failedMaps: 0,
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
        {
            id: 'proc-1-m0',
            status: 'completed',
            metadata: { itemIndex: 0, promptPreview: 'Item 0' },
            durationMs: 1000,
        },
        {
            id: 'proc-1-m1',
            status: 'completed',
            metadata: { itemIndex: 1, promptPreview: 'Item 1' },
            durationMs: 1500,
        },
    ];
}

function makeChildProcessResponse() {
    return {
        process: {
            id: 'proc-1-m0',
            status: 'completed',
            durationMs: 1000,
            metadata: { itemIndex: 0, promptPreview: 'Item 0' },
            conversationTurns: [
                { role: 'user', content: 'Process item 0', timeline: [] },
                { role: 'assistant', content: 'Item 0 processed.', timeline: [] },
            ],
        },
    };
}

describe('WorkflowDetailView + ItemConversationPanel integration', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock;
        (window as any).__DASHBOARD_CONFIG__ = { apiBasePath: '/api', wsPath: '/ws' };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('click item card → selectedItemProcessId set → panel opens → shows conversation', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            if (url.includes('proc-1-m0') && !url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildProcessResponse()) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('dag-chart-container')).toBeDefined();
        });

        // Expand map node
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('map-item-grid')).toBeDefined();

        // Click the first item card
        fireEvent.click(screen.getByTestId('map-item-card-proc-1-m0'));

        // Conversation panel should open
        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-panel')).toBeDefined();
        });

        // Panel should show conversation content
        await waitFor(() => {
            const body = screen.getByTestId('item-conversation-body');
            expect(body.textContent).toContain('Process item 0');
            expect(body.textContent).toContain('Item 0 processed.');
        });
    });

    it('closing conversation panel clears selectedItemProcessId', async () => {
        fetchMock.mockImplementation((url: string) => {
            if (url.includes('/children')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildrenResponse()) });
            }
            if (url.includes('proc-1-m0')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(makeChildProcessResponse()) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(makeProcessResponse()) });
        });

        render(<WorkflowDetailView processId="proc-1" />);

        await waitFor(() => {
            expect(screen.getByTestId('dag-chart-container')).toBeDefined();
        });

        // Expand map, click item
        fireEvent.click(screen.getByTestId('dag-node-map'));
        fireEvent.click(screen.getByTestId('map-item-card-proc-1-m0'));

        await waitFor(() => {
            expect(screen.getByTestId('item-conversation-panel')).toBeDefined();
        });

        // Close via X button
        fireEvent.click(screen.getByTestId('item-conversation-close'));

        await waitFor(() => {
            expect(screen.queryByTestId('item-conversation-panel')).toBeNull();
        });
    });
});

describe('MapItemGrid highlights selected card', () => {
    it('applies ring styling to selected card', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
            { processId: 'b', itemIndex: 1, status: 'completed' },
        ];
        const onItemClick = vi.fn();

        render(
            <MapItemGrid
                items={items}
                onItemClick={onItemClick}
                isLive={false}
                selectedProcessId="a"
            />
        );

        const selectedCard = screen.getByTestId('map-item-card-a');
        const unselectedCard = screen.getByTestId('map-item-card-b');

        // Selected card should have ring classes
        expect(selectedCard.className).toContain('ring-2');
        expect(selectedCard.className).toContain('ring-[#0078d4]');

        // Unselected card should NOT have ring classes
        expect(unselectedCard.className).not.toContain('ring-2');
    });

    it('applies dark mode ring styling when isDark', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
        ];
        const onItemClick = vi.fn();

        render(
            <MapItemGrid
                items={items}
                onItemClick={onItemClick}
                isLive={false}
                isDark={true}
                selectedProcessId="a"
            />
        );

        const selectedCard = screen.getByTestId('map-item-card-a');
        expect(selectedCard.className).toContain('ring-2');
        expect(selectedCard.className).toContain('ring-[#3794ff]');
    });

    it('no ring when selectedProcessId is undefined', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
        ];
        const onItemClick = vi.fn();

        render(
            <MapItemGrid
                items={items}
                onItemClick={onItemClick}
                isLive={false}
            />
        );

        const card = screen.getByTestId('map-item-card-a');
        expect(card.className).not.toContain('ring-2');
    });
});
