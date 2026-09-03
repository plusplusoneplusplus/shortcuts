/**
 * @vitest-environment jsdom
 *
 * Regression: MarkdownView re-highlights `pre code` on mount. Forge's
 * renderCodeBlock already highlights at render time and wraps every line in a
 * `.code-line` span with a `.line-number` gutter, joined without newlines — so
 * letting hljs.highlightElement() run over those blocks flattens the whole
 * block onto one line with the gutter numbers baked into the code text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ExcalidrawPreview', () => ({
    ExcalidrawPreview: () => null,
}));

import { MarkdownView } from '../../../../../src/server/spa/client/react/shared/MarkdownView';
import { renderMarkdownToHtml } from '../../../../../src/server/spa/client/diff/markdown-renderer';

const PYTHON_BLOCK = [
    '```python',
    'x = torch.arange(12).reshape(3, 4)',
    'y = x.T',
    '',
    'y.view(12)',
    '```',
].join('\n');

/**
 * Stand-in for highlight.js: like the real `highlightElement`, it reads
 * textContent and overwrites innerHTML, which destroys any pre-rendered
 * per-line structure inside the element.
 */
function stubHljs() {
    const highlightElement = vi.fn((block: Element) => {
        block.innerHTML = `<span class="hljs-stub">${block.textContent}</span>`;
    });
    (window as any).hljs = { highlightElement };
    return highlightElement;
}

afterEach(() => {
    cleanup();
    delete (window as any).hljs;
    vi.restoreAllMocks();
});

describe('MarkdownView code-block re-highlighting', () => {
    it('leaves forge-rendered code blocks alone so their line structure survives', () => {
        const highlightElement = stubHljs();
        const html = renderMarkdownToHtml(PYTHON_BLOCK);
        expect(html).toContain('code-block-container');

        const { container } = render(<MarkdownView html={html} />);

        const lines = container.querySelectorAll('.code-line');
        expect(lines.length).toBe(4);
        expect(container.querySelectorAll('.line-number').length).toBe(4);
        // Gutter numbers stay in their own spans instead of being folded into
        // the code text of a single collapsed line. (Line breaks come from the
        // CSS `.code-line { display: block }` rule, not from newlines in the
        // markup, so structure — not textContent — is what has to survive.)
        expect(lines[0].querySelector('.line-number')?.textContent).toBe('1');
        expect(lines[0].textContent).toContain('x = torch.arange(12).reshape(3, 4)');
        expect(container.querySelector('.hljs-stub')).toBeNull();

        expect(highlightElement).not.toHaveBeenCalled();
    });

    it('still highlights code blocks that were not pre-rendered by forge', () => {
        const highlightElement = stubHljs();

        render(<MarkdownView html={'<pre><code class="language-js">const a = 1;</code></pre>'} />);

        expect(highlightElement).toHaveBeenCalledTimes(1);
    });
});
