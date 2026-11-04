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
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/ExcalidrawPreview', () => ({
    ExcalidrawPreview: () => null,
}));

import { ChatRenderContextProvider } from '../../../../../src/server/spa/client/react/features/chat/conversation/ChatRenderContext';
import { MarkdownView } from '../../../../../src/server/spa/client/react/shared/MarkdownView';
import { chatMarkdownToHtml } from '../../../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';
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


describe('MarkdownView Copy all', () => {
    function clipboard() {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
        return writeText;
    }

    afterEach(() => vi.unstubAllGlobals());

    it.each([
        ['chat', {}],
        ['Markdown canvas', { svgFenceEnabled: true, canvasEmbedEnabled: true }],
    ])('copies the entire highlighted block in %s, beyond both scroll bounds', async (_host, options) => {
        const writeText = clipboard();
        const highlightElement = stubHljs();
        const source = [
            '  <div title="quoted">&lt; &#10; &amp;</div>',
            '    indented line  ',
            '',
            'x'.repeat(4000),
            ...Array.from({ length: 100 }, (_, i) => `  line ${i}`),
            '',
        ].join('\n');
        const html = chatMarkdownToHtml(`Prose before\n\n\`\`\`markdown\n${source}\n\`\`\`\n\nProse after`, 'workspace-a', options);
        const { container } = render(<MarkdownView html={html} tableWrapToggle />);
        const button = screen.getByRole('button', { name: 'Copy all' });
        const block = container.querySelector('.code-block-container')!;
        const pre = block.querySelector('pre')!;
        pre.style.maxHeight = '40px';
        pre.style.width = '100px';
        pre.scrollLeft = 200;
        pre.scrollTop = 300;
        expect(button.getAttribute('type')).toBe('button');
        expect(button.tabIndex).toBe(0);
        expect(button.getAttribute('aria-live')).toBe('polite');
        expect(block.querySelector('.code-block-header')?.contains(button)).toBe(true);
        expect(pre.contains(button)).toBe(false);
        expect(highlightElement).toHaveBeenCalledTimes(1);
        fireEvent.click(button);
        await waitFor(() => expect(button.textContent).toBe('Copied!'));
        expect(writeText).toHaveBeenCalledExactlyOnceWith(source);
        expect(screen.getByRole('button', { name: 'Copied!' })).toBe(button);
    });

    it('copies multiple blocks independently and reuses the existing forge copy button', async () => {
        const writeText = clipboard();
        const html = chatMarkdownToHtml('```js\nfirst\n```\n\n```\nsecond\n```') +
            renderMarkdownToHtml('```html\n&lt;literal&gt;\n\n  last\n```');
        const { container } = render(<MarkdownView html={html} />);
        const buttons = screen.getAllByRole('button', { name: 'Copy all' });
        expect(buttons).toHaveLength(3);
        expect(container.querySelectorAll('.code-block-copy')).toHaveLength(3);
        fireEvent.click(buttons[1]);
        await waitFor(() => expect(buttons[1].textContent).toBe('Copied!'));
        expect(buttons[0].textContent).toBe('Copy all');
        fireEvent.click(buttons[2]);
        await waitFor(() => expect(buttons[2].textContent).toBe('Copied!'));
        expect(writeText.mock.calls).toEqual([['second'], ['&lt;literal&gt;\n\n  last']]);
        expect(container.querySelectorAll('.line-number')).toHaveLength(3);
    });

    it('shows clipboard failure and permits retry without false success', async () => {
        const writeText = clipboard();
        writeText.mockRejectedValueOnce(new Error('Permission denied'));
        render(<MarkdownView html={chatMarkdownToHtml('```\nretry me\n```')} />);
        const button = screen.getByRole('button', { name: 'Copy all' });
        fireEvent.click(button);
        await screen.findByRole('button', { name: 'Copy failed. Try again' });
        expect(button.textContent).toBe('Copy failed');
        expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
        fireEvent.click(button);
        await screen.findByRole('button', { name: 'Copied!' });
        expect(writeText).toHaveBeenCalledTimes(2);
    });

    it('copies empty blocks through the shared clipboard fallback and reports fallback failure', async () => {
        vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: undefined }));
        const execCommand = vi.fn().mockReturnValue(false);
        Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
        render(<MarkdownView html={chatMarkdownToHtml('```\n\n```')} />);
        fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
        await screen.findByRole('button', { name: 'Copy failed. Try again' });
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
        delete (document as any).execCommand;
    });

    it('discards late copy feedback after content changes', async () => {
        const writeText = clipboard();
        let resolve!: () => void;
        writeText.mockReturnValueOnce(new Promise<void>(done => { resolve = done; }));
        const { rerender } = render(<MarkdownView html={chatMarkdownToHtml('```\nold owner\n```')} />);
        fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
        rerender(<MarkdownView html={chatMarkdownToHtml('```\nnew owner\n```')} />);
        resolve();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Copy all' }).textContent).toBe('Copy all'));
        fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
        await screen.findByRole('button', { name: 'Copied!' });
        expect(writeText.mock.calls).toEqual([['old owner'], ['new owner']]);
    });
});


describe('MarkdownView Copy all keyboard and ownership', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('activates by keyboard and keeps identical HTML in separate owners independent', async () => {
        const user = userEvent.setup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const html = chatMarkdownToHtml('```\ncomplete block\n```');
        render(<>
            <ChatRenderContextProvider value={{ conversationOwnerKey: 'server-a/workspace-a', wsId: 'workspace-a', chatId: 'chat-a' }}>
                <MarkdownView html={html} />
            </ChatRenderContextProvider>
            <ChatRenderContextProvider value={{ conversationOwnerKey: 'server-b/workspace-b', wsId: 'workspace-b', chatId: 'chat-b' }}>
                <MarkdownView html={html} />
            </ChatRenderContextProvider>
        </>);
        const buttons = screen.getAllByRole('button', { name: 'Copy all' });
        await user.tab();
        expect(document.activeElement).toBe(buttons[0]);
        await user.keyboard('{Enter}');
        await screen.findByRole('button', { name: 'Copied!' });
        expect(buttons[1].textContent).toBe('Copy all');
        await user.tab();
        expect(document.activeElement).toBe(buttons[1]);
        await user.keyboard(' ');
        await waitFor(() => expect(buttons[1].textContent).toBe('Copied!'));
        expect(writeText.mock.calls).toEqual([['complete block'], ['complete block']]);
    });
});
