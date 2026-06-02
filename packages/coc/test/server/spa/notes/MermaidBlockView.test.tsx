// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({
    ensureMermaid: vi.fn(() => Promise.resolve()),
}));

import { MermaidBlockView } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mermaidBlock';

function renderMermaidBlock(code = 'graph TD\n  A --> B') {
    return render(
        <MermaidBlockView
            node={{ attrs: { code } }}
        /> as any,
    );
}

function getCanvas(container: HTMLElement): HTMLElement {
    const canvas = container.querySelector<HTMLElement>('.mermaid-node-view-canvas');
    if (!canvas) throw new Error('Expected mermaid canvas');
    return canvas;
}

function getPreview(container: HTMLElement): HTMLElement {
    const preview = container.querySelector<HTMLElement>('.mermaid-node-view-preview');
    if (!preview) throw new Error('Expected mermaid preview');
    return preview;
}

describe('MermaidBlockView zoom controls', () => {
    beforeEach(() => {
        (globalThis as any).mermaid = {
            run: vi.fn(async ({ nodes }: { nodes: Element[] }) => {
                for (const node of nodes) {
                    node.innerHTML = '<svg role="img"><text>diagram</text></svg>';
                    node.setAttribute('data-processed', 'true');
                }
            }),
        };
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        delete (globalThis as any).mermaid;
    });

    it('renders zoom controls for note Mermaid previews', async () => {
        renderMermaidBlock();

        expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
        expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
        expect(screen.getByLabelText('Reset zoom')).toBeInTheDocument();
        expect(screen.getByText('100%')).toBeInTheDocument();
        await waitFor(() => expect((globalThis as any).mermaid.run).toHaveBeenCalledTimes(1));
    });

    it('zooms in, zooms out, and resets the preview transform', () => {
        const { container } = renderMermaidBlock();
        const canvas = getCanvas(container);

        fireEvent.click(screen.getByLabelText('Zoom in'));
        expect(screen.getByText('125%')).toBeInTheDocument();
        expect(canvas.style.transform).toContain('scale(1.25)');

        fireEvent.click(screen.getByLabelText('Zoom out'));
        expect(screen.getByText('100%')).toBeInTheDocument();
        expect(canvas.style.transform).toContain('scale(1)');

        fireEvent.click(screen.getByLabelText('Zoom in'));
        fireEvent.click(screen.getByLabelText('Zoom in'));
        expect(screen.getByText('150%')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Reset zoom'));
        expect(screen.getByText('100%')).toBeInTheDocument();
        expect(canvas.style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('supports ctrl-wheel zooming in the preview', () => {
        const { container } = renderMermaidBlock();
        const preview = getPreview(container);
        const canvas = getCanvas(container);

        fireEvent.wheel(preview, {
            ctrlKey: true,
            deltaY: -100,
            clientX: 20,
            clientY: 20,
        });

        expect(screen.getByText('125%')).toBeInTheDocument();
        expect(canvas.style.transform).toContain('scale(1.25)');
    });

    it('supports drag panning without changing zoom', () => {
        const { container } = renderMermaidBlock();
        const preview = getPreview(container);
        const canvas = getCanvas(container);

        fireEvent.mouseDown(preview, { button: 0, clientX: 10, clientY: 20 });
        fireEvent.mouseMove(document, { clientX: 35, clientY: 55 });
        fireEvent.mouseUp(document);

        expect(canvas.style.transform).toBe('translate(25px, 35px) scale(1)');
        expect(preview).not.toHaveClass('mermaid-node-view-dragging');
    });

    it('hides zoom controls in source mode and restores them in preview mode', () => {
        renderMermaidBlock('sequenceDiagram\n  Alice->>Bob: Hi');

        fireEvent.click(screen.getByText('</> Source'));
        expect(screen.queryByLabelText('Zoom in')).not.toBeInTheDocument();
        expect(screen.getByText('sequenceDiagram', { exact: false })).toBeInTheDocument();

        fireEvent.click(screen.getByText('▶ Preview'));
        expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    });
});
