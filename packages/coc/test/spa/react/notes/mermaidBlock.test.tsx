import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@tiptap/core', () => ({
    Node: { create: (config: unknown) => config },
}));

vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({
        children,
        ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
    ReactNodeViewRenderer: (component: unknown) => component,
}));

const mockEnsureMermaid = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock(
    '../../../../src/server/spa/client/react/hooks/ui/useMermaid',
    () => ({ ensureMermaid: mockEnsureMermaid }),
);

const mockMermaidRun = vi.fn(() => Promise.resolve());
vi.stubGlobal('mermaid', {
    initialize: vi.fn(),
    run: mockMermaidRun,
});

import {
    MermaidBlock,
    computeAutoFitWidth,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/mermaidBlock';

// ── Helpers ──────────────────────────────────────────────────────────────────

type ExtensionConfig = {
    parseHTML(): Array<{ tag: string; getAttrs: (el: HTMLElement) => false | { code: string } }>;
    renderHTML(args: { node: { attrs: { code: string; indent?: number } } }): unknown[];
};

const config = MermaidBlock as unknown as ExtensionConfig;

// Build a <NodeViewProps>-like stub
function makeProps(code: string, selected = false) {
    return { node: { attrs: { code } }, selected } as any;
}

// ── parseHTML ────────────────────────────────────────────────────────────────

describe('MermaidBlock parseHTML', () => {
    it('matches <pre><code class="language-mermaid"> and extracts code', () => {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = 'language-mermaid';
        code.textContent = 'graph TD\n  A --> B';
        pre.appendChild(code);

        const [rule] = config.parseHTML();
        expect(rule.tag).toBe('pre');
        expect(rule.getAttrs(pre)).toEqual({ code: 'graph TD\n  A --> B' });
    });

    it('rejects <pre><code class="language-js">', () => {
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.className = 'language-js';
        code.textContent = 'const x = 1;';
        pre.appendChild(code);

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(pre)).toBe(false);
    });

    it('rejects <pre> with no <code> child', () => {
        const pre = document.createElement('pre');
        pre.textContent = 'plain text';

        const [rule] = config.parseHTML();
        expect(rule.getAttrs(pre)).toBe(false);
    });
});

// ── renderHTML ───────────────────────────────────────────────────────────────

describe('MermaidBlock renderHTML', () => {
    it('round-trips to the marked output structure (no indent → empty pre attrs)', () => {
        const result = config.renderHTML({
            node: { attrs: { code: 'flowchart LR\n  X-->Y' } },
        });
        expect(result).toEqual([
            'pre',
            {},
            ['code', { class: 'language-mermaid' }, 'flowchart LR\n  X-->Y'],
        ]);
    });

    it('adds data-indent to the <pre> for an indented diagram', () => {
        const result = config.renderHTML({
            node: { attrs: { code: 'graph TD\nA-->B', indent: 3 } },
        });
        expect(result).toEqual([
            'pre',
            { 'data-indent': '3' },
            ['code', { class: 'language-mermaid' }, 'graph TD\nA-->B'],
        ]);
    });
});

// ── computeAutoFitWidth ──────────────────────────────────────────────────────

describe('computeAutoFitWidth', () => {
    it('enlarges a small diagram to fill the available width', () => {
        // 620px diagram in 1600px editor → capped at 3x (1860 > 1600) → fills width
        expect(computeAutoFitWidth(1600, 620)).toBe(1600);
    });

    it('scales up proportionally when below the cap', () => {
        // 400px diagram in 800px editor → 2x → 800
        expect(computeAutoFitWidth(800, 400)).toBe(800);
    });

    it('caps the upscale so a trivial diagram does not balloon', () => {
        // 150px diagram in 1600px editor → would be ~10.6x, capped to 3x → 450
        expect(computeAutoFitWidth(1600, 150)).toBe(450);
    });

    it('returns null when the diagram already fills the width', () => {
        expect(computeAutoFitWidth(800, 800)).toBeNull();
    });

    it('returns null when the diagram is wider than available (CSS shrinks it)', () => {
        expect(computeAutoFitWidth(800, 1200)).toBeNull();
    });

    it('returns null for unmeasurable (zero) dimensions', () => {
        expect(computeAutoFitWidth(0, 400)).toBeNull();
        expect(computeAutoFitWidth(800, 0)).toBeNull();
    });

    it('honours a custom max scale', () => {
        expect(computeAutoFitWidth(1600, 400, 2)).toBe(800);
    });
});

// ── MermaidBlockView component ───────────────────────────────────────────────

// Import the component via the module-level mock of Node.create which returns the config object.
// The component is not exported directly, so we render the node by using the ReactNodeViewRenderer
// mock (identity fn) and accessing addNodeView from the config.

type NodeViewConfig = ExtensionConfig & {
    addNodeView(): React.FC<any>;
};

const nodeViewConfig = MermaidBlock as unknown as NodeViewConfig;
const MermaidBlockView = nodeViewConfig.addNodeView() as React.FC<any>;

describe('MermaidBlockView', () => {
    beforeEach(() => {
        mockEnsureMermaid.mockReset();
        mockEnsureMermaid.mockReturnValue(Promise.resolve());
        mockMermaidRun.mockReset();
        mockMermaidRun.mockReturnValue(Promise.resolve());
    });

    afterEach(() => {
        cleanup();
    });

    it('renders in preview mode by default', () => {
        render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        expect(document.querySelector('pre.mermaid')).not.toBeNull();
        expect(document.querySelector('pre.mermaid-node-view-source')).toBeNull();
    });

    it('calls ensureMermaid on mount', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });
        expect(mockEnsureMermaid).toHaveBeenCalledTimes(1);
    });

    it('calls mermaid.run after ensureMermaid resolves', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });
        expect(mockMermaidRun).toHaveBeenCalledTimes(1);
    });

    it('toggle button switches from preview to source mode', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const btn = screen.getByRole('button', { name: /Source/ });
        await act(async () => {
            btn.click();
        });

        expect(document.querySelector('pre.mermaid-node-view-source')).not.toBeNull();
        expect(document.querySelector('pre.mermaid')).toBeNull();
        expect(screen.getByRole('button', { name: /Preview/ })).not.toBeNull();
    });

    it('toggle button switches back from source to preview mode', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const sourceBtn = screen.getByRole('button', { name: /Source/ });
        await act(async () => {
            sourceBtn.click();
        });

        const previewBtn = screen.getByRole('button', { name: /Preview/ });
        await act(async () => {
            previewBtn.click();
        });

        expect(document.querySelector('pre.mermaid')).not.toBeNull();
        expect(document.querySelector('pre.mermaid-node-view-source')).toBeNull();
    });

    it('shows error state when ensureMermaid rejects', async () => {
        mockEnsureMermaid.mockReturnValue(Promise.reject(new Error('CDN load failed')));

        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const errorDiv = document.querySelector('.mermaid-node-view-error');
        expect(errorDiv).not.toBeNull();
        expect(errorDiv?.textContent).toBe('CDN load failed');
    });

    it('has data-drag-handle on the root wrapper', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const wrapper = document.querySelector('.mermaid-node-view');
        expect(wrapper?.hasAttribute('data-drag-handle')).toBe(true);
    });

    it('removes data-processed before calling mermaid.run', async () => {
        let preEl: HTMLPreElement | null = null;

        mockMermaidRun.mockImplementation(({ nodes }: { nodes: Element[] }) => {
            preEl = nodes[0] as HTMLPreElement;
            return Promise.resolve();
        });

        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        // The pre element must NOT have data-processed at the time mermaid.run was called
        // (we check that the attribute was absent when run was invoked)
        expect(preEl).not.toBeNull();
        expect((preEl as HTMLPreElement | null)?.hasAttribute('data-processed')).toBe(false);
    });

    it('enlarges a small rendered SVG to fill the preview width', async () => {
        // Simulate mermaid rendering a small (400px) SVG into the pre element.
        mockMermaidRun.mockImplementation(({ nodes }: { nodes: Element[] }) => {
            const pre = nodes[0] as HTMLElement;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.getBoundingClientRect = () => ({ width: 400, height: 200 }) as DOMRect;
            pre.innerHTML = '';
            pre.appendChild(svg);
            return Promise.resolve();
        });

        // Give the preview container a definite width (jsdom reports 0 otherwise).
        const proto = Object.getPrototypeOf(document.createElement('div'));
        const clientWidthSpy = vi
            .spyOn(proto, 'clientWidth', 'get')
            .mockReturnValue(1000);

        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const svg = document.querySelector('pre.mermaid svg') as SVGElement;
        expect(svg).not.toBeNull();
        // 1000px available (padding is 0 in jsdom) / 400px intrinsic = 2.5x → 1000px
        expect(svg.style.width).toBe('1000px');
        expect(svg.style.height).toBe('auto');

        clientWidthSpy.mockRestore();
    });

    it('source view shows the raw diagram code', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        await act(async () => {
            screen.getByRole('button', { name: /Source/ }).click();
        });

        const codeEl = document.querySelector('pre.mermaid-node-view-source code');
        expect(codeEl?.textContent).toBe('graph TD\n  A-->B');
    });

    it('wraps preview in mermaid-node-view-preview div', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const previewWrapper = document.querySelector('.mermaid-node-view-preview');
        expect(previewWrapper).not.toBeNull();
        expect(previewWrapper?.querySelector('pre.mermaid')).not.toBeNull();
    });

    it('button label includes icon prefix in preview mode', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        const btn = screen.getByRole('button', { name: /Source/ });
        expect(btn.textContent).toContain('</>');
    });

    it('button label includes icon prefix in source mode', async () => {
        await act(async () => {
            render(<MermaidBlockView {...makeProps('graph TD\n  A-->B')} />);
        });

        await act(async () => {
            screen.getByRole('button', { name: /Source/ }).click();
        });

        const btn = screen.getByRole('button', { name: /Preview/ });
        expect(btn.textContent).toContain('▶');
    });
});
