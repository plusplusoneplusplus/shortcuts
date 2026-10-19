/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Canvas, CocClient } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => {
    const local = { canvases: { get: vi.fn(), run: vi.fn(), save: vi.fn() } };
    const remote = { canvases: { get: vi.fn(), run: vi.fn(), save: vi.fn() } };
    return { local, remote };
});
vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mocks.local,
    getCocClientFor: () => mocks.remote,
}));
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => null,
}));
vi.mock('../../../../../src/server/spa/client/react/features/canvas/ExtensionCanvasView', () => ({
    ExtensionCanvasView: () => null,
}));
vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: () => null }));
vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({ useMermaid: () => {} }));

import { CanvasBodyRenderer } from '../../../../../src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer';
import { canvasKind } from '../../../../../src/server/spa/client/react/features/canvas/canvas-panel-model';
import { WorkspaceOwnerContext } from '../../../../../src/server/spa/client/react/repos/workspaceOwnerContext';

function document(content: string, id = 'report'): Canvas {
    return {
        id, workspaceId: 'ws-owner', title: 'Report', type: 'markdown', content,
        revision: 1, lastEditor: 'ai', createdAt: '', updatedAt: '',
    };
}
const chart: Canvas = {
    ...document(''), id: 'chart-1', title: 'Saved chart', type: 'kusto',
    content: JSON.stringify({
        query: 'Events | summarize Count=count() by State',
        clusterUrl: 'https://help.kusto.windows.net', database: 'Samples',
        columns: [{ name: 'State', type: 'string' }, { name: 'Count', type: 'long' }],
        rows: [['Texas', 10]], truncated: false,
        chartConfig: { type: 'bar', x: 'State', y: ['Count'] },
    }),
};
function body(content: string, mode: 'preview' | 'edit' = 'preview') {
    const canvas = document(content);
    return <CanvasBodyRenderer
        workspaceId={canvas.workspaceId} canvasId={canvas.id} canvas={canvas} kind={canvasKind(canvas, content)}
        loading={false} loadError={null} viewingVersion={null} viewingRevision={1}
        displayedContent={content} draft={content} mode={mode}
        onDraftChange={() => {}} onCanvasSaved={() => {}} onSelectionChange={() => {}}
        onImageMenu={() => {}} notify={() => {}}
    />;
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.local.canvases.get.mockResolvedValue(chart);
    mocks.remote.canvases.get.mockResolvedValue(chart);
});
afterEach(cleanup);

it.each(['canvas://chart-1', '[Chart](canvas://chart-1)', '**canvas://chart-1**.'])('renders %s through the real Markdown canvas preview without a transcript', async marker => {
    render(body(`# Report\n\n${marker}`));
    await screen.findByTestId('canvas-embed-kusto');
    expect(mocks.local.canvases.get).toHaveBeenCalledExactlyOnceWith('ws-owner', 'chart-1');
    expect(screen.getByTestId('kusto-chart-view')).toBeInTheDocument();
    expect(screen.getByTestId('kusto-chart')).toBeInTheDocument();
    expect(screen.getByTestId('kusto-connection-header').parentElement).toBe(screen.getByTestId('canvas-embed-kusto-connection-slot'));
    expect(screen.getByTestId('kusto-chart-view').closest('.h-\\[420px\\]')).toHaveClass('overflow-hidden');
    fireEvent.click(screen.getByTestId('canvas-embed-kusto-toggle'));
    expect(screen.getByTestId('canvas-embed-body')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('canvas-embed-kusto-toggle'));
    expect(screen.getByTestId('canvas-embed-body')).toBeVisible();
    expect(mocks.local.canvases.run).not.toHaveBeenCalled();
    expect(mocks.local.canvases.save).not.toHaveBeenCalled();
});

it('keeps inline/fenced examples, attributes, invalid IDs and edit text literal', () => {
    const content = '`canvas://chart-1`\n\n```text\ncanvas://chart-1\n```\n\ncanvas://invalid_id\n\ncanvas://' + 'a'.repeat(129)
        + '\n\n[Example](https://example.com "canvas://chart-1")';
    const { container, rerender } = render(body(content));
    expect(container.querySelectorAll('.md-canvas-embed')).toHaveLength(0);
    expect(container.querySelectorAll('code')).toHaveLength(2);
    expect(mocks.local.canvases.get).not.toHaveBeenCalled();
    rerender(body('canvas://chart-1', 'edit'));
    expect(screen.getByTestId('canvas-panel-editor')).toHaveValue('canvas://chart-1');
    expect(mocks.local.canvases.get).not.toHaveBeenCalled();
});

it('uses the explicit remote owner even when the same workspace exists locally', async () => {
    render(<WorkspaceOwnerContext.Provider value={{
        workspaceId: 'ws-owner', selectionId: 'remote:ws-owner', baseUrl: 'https://owner.example',
        client: mocks.remote as unknown as CocClient,
    }}>{body('canvas://chart-1')}</WorkspaceOwnerContext.Provider>);
    await screen.findByTestId('canvas-embed-kusto');
    expect(mocks.remote.canvases.get).toHaveBeenCalledExactlyOnceWith('ws-owner', 'chart-1');
    expect(mocks.local.canvases.get).not.toHaveBeenCalled();
    expect(mocks.remote.canvases.run).not.toHaveBeenCalled();
});

it('shows an unavailable ID without retrying or running a query', async () => {
    mocks.local.canvases.get.mockRejectedValue(new Error('Canvas not found'));
    render(body('canvas://missing'));
    expect(await screen.findByTestId('canvas-embed-error')).toHaveTextContent('Canvas not found');
    expect(mocks.local.canvases.get).toHaveBeenCalledTimes(1);
    expect(mocks.local.canvases.run).not.toHaveBeenCalled();
});

it.each(['report', 'child'])('bounds document references, including self/cyclic markers (%s)', async id => {
    mocks.local.canvases.get.mockResolvedValue(document('canvas://report\n\ncanvas://child', id));
    render(body(`canvas://${id}`));
    await screen.findByTestId('canvas-embed-document');
    await waitFor(() => expect(mocks.local.canvases.get).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('canvas-embed-document')).toHaveTextContent('canvas://report');
    expect(screen.getAllByTestId('canvas-embed')).toHaveLength(1);
});
