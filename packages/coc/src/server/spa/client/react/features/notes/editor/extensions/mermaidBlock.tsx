/**
 * MermaidBlock — TipTap node extension that renders Mermaid diagrams inline.
 *
 * Parses `<pre><code class="language-mermaid">` HTML (as emitted by marked)
 * into an atom block node with a React NodeView that supports preview/source toggle.
 */

import { useRef, useState, useEffect } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ensureMermaid } from '../../../../hooks/ui/useMermaid';

declare const mermaid: {
    run(opts: { nodes: NodeListOf<Element> | Element[] }): Promise<void>;
};

function escapeHtmlForMermaid(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── React NodeView Component ────────────────────────────────────────────────

function MermaidBlockView({ node, selected }: NodeViewProps) {
    const [mode, setMode] = useState<'preview' | 'source'>('preview');
    const [error, setError] = useState<string | null>(null);
    const preRef = useRef<HTMLPreElement>(null);

    useEffect(() => {
        if (mode !== 'preview') return;
        const el = preRef.current;
        if (!el) return;

        // Reset so mermaid re-renders on code change
        el.removeAttribute('data-processed');
        el.innerHTML = escapeHtmlForMermaid(node.attrs.code);

        ensureMermaid()
            .then(() => mermaid.run({ nodes: [el] }))
            .catch((err) => setError(err instanceof Error ? err.message : 'Render error'));
    }, [node.attrs.code, mode]);

    return (
        <NodeViewWrapper
            className={`mermaid-block-wrapper${selected ? ' mermaid-block-selected' : ''}`}
            data-drag-handle=""
        >
            <div className="mermaid-block-toolbar">
                <button onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}>
                    {mode === 'preview' ? 'Source' : 'Preview'}
                </button>
            </div>

            {error && <div className="mermaid-block-error">{error}</div>}

            {mode === 'preview' ? (
                <pre ref={preRef} className="mermaid" />
            ) : (
                <pre className="mermaid-block-source">
                    <code>{node.attrs.code}</code>
                </pre>
            )}
        </NodeViewWrapper>
    );
}

// ── TipTap Extension ────────────────────────────────────────────────────────

export const MermaidBlock = Node.create({
    name: 'mermaidBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            code: { default: '' },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'pre',
                getAttrs: (node: HTMLElement) => {
                    const code = node.querySelector('code.language-mermaid');
                    if (!code) return false;
                    return { code: code.textContent ?? '' };
                },
            },
        ];
    },

    renderHTML({ node }) {
        return ['pre', ['code', { class: 'language-mermaid' }, node.attrs.code]];
    },

    addNodeView() {
        return ReactNodeViewRenderer(MermaidBlockView);
    },
});
