/**
 * Tests for useMarkdownPreview shared hook.
 *
 * Verifies:
 * - HTML rendering via renderMarkdownToHtml
 * - stripFrontmatter option forwarding
 * - Loading state suppresses rendering
 * - Empty content returns empty HTML
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMarkdownPreview } from '../../../src/server/spa/client/react/hooks/useMarkdownPreview';
import { useCodeBlockActions } from '../../../src/server/spa/client/react/hooks/useCodeBlockActions';

// Mock useMermaid since it requires DOM manipulation
vi.mock('../../../src/server/spa/client/react/hooks/useMermaid', () => ({
    useMermaid: vi.fn(),
}));

// Mock useCodeBlockActions since it requires DOM event delegation
vi.mock('../../../src/server/spa/client/react/hooks/useCodeBlockActions', () => ({
    useCodeBlockActions: vi.fn(),
}));

describe('useMarkdownPreview', () => {
    const createRef = (el?: HTMLElement) => ({
        current: el ?? null,
    });

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders markdown content to HTML', () => {
        const containerRef = createRef();
        const { result } = renderHook(() =>
            useMarkdownPreview({
                content: '# Hello\n\nWorld',
                containerRef,
            })
        );

        expect(result.current.html).toContain('Hello');
        expect(result.current.html).toContain('data-line=');
    });

    it('returns empty HTML when content is empty', () => {
        const containerRef = createRef();
        const { result } = renderHook(() =>
            useMarkdownPreview({
                content: '',
                containerRef,
            })
        );

        expect(result.current.html).toBe('');
    });

    it('returns empty HTML when loading is true', () => {
        const containerRef = createRef();
        const { result } = renderHook(() =>
            useMarkdownPreview({
                content: '# Hello',
                containerRef,
                loading: true,
            })
        );

        expect(result.current.html).toBe('');
    });

    it('strips frontmatter when option is set', () => {
        const containerRef = createRef();
        const content = '---\ntitle: Test\n---\n\n# Hello';
        const { result } = renderHook(() =>
            useMarkdownPreview({
                content,
                containerRef,
                stripFrontmatter: true,
            })
        );

        expect(result.current.html).toContain('Hello');
        expect(result.current.html).not.toContain('title: Test');
    });

    it('preserves frontmatter when option is not set', () => {
        const containerRef = createRef();
        const content = '---\ntitle: Test\n---\n\n# Hello';
        const { result } = renderHook(() =>
            useMarkdownPreview({
                content,
                containerRef,
                stripFrontmatter: false,
            })
        );

        expect(result.current.html).toContain('title: Test');
    });

    it('updates HTML when content changes', () => {
        const containerRef = createRef();
        const { result, rerender } = renderHook(
            ({ content }) =>
                useMarkdownPreview({
                    content,
                    containerRef,
                }),
            { initialProps: { content: '# First' } }
        );

        const firstHtml = result.current.html;
        expect(firstHtml).toContain('First');

        rerender({ content: '# Second' });
        expect(result.current.html).toContain('Second');
        expect(result.current.html).not.toContain('First');
    });

    it('transitions from loading to rendered when loading becomes false', () => {
        const containerRef = createRef();
        const { result, rerender } = renderHook(
            ({ loading }) =>
                useMarkdownPreview({
                    content: '# Hello',
                    containerRef,
                    loading,
                }),
            { initialProps: { loading: true } }
        );

        expect(result.current.html).toBe('');

        rerender({ loading: false });
        expect(result.current.html).toContain('Hello');
    });

    it('renders code blocks in markdown', () => {
        const containerRef = createRef();
        const content = '```js\nconst x = 1;\n```';
        const { result } = renderHook(() =>
            useMarkdownPreview({
                content,
                containerRef,
            })
        );

        expect(result.current.html).toContain('const x = 1;');
    });

    it('does not call hljs.highlightElement on code blocks inside .code-block-container', () => {
        const highlightElementSpy = vi.fn();
        (window as any).hljs = {
            highlight: vi.fn((_code: string) => ({ value: _code })),
            highlightAuto: vi.fn((_code: string) => ({ value: _code, language: 'js' })),
            highlightElement: highlightElementSpy,
        };

        const container = document.createElement('div');
        const codeBlockContainer = document.createElement('div');
        codeBlockContainer.className = 'code-block-container';
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        pre.appendChild(code);
        codeBlockContainer.appendChild(pre);
        container.appendChild(codeBlockContainer);

        const containerRef = createRef(container);
        const content = '```yaml\n- name: test\n  description: hello\n```';

        renderHook(() =>
            useMarkdownPreview({ content, containerRef })
        );

        expect(highlightElementSpy).not.toHaveBeenCalled();

        delete (window as any).hljs;
    });

    it('calls hljs.highlightElement on code blocks NOT inside .code-block-container', () => {
        const highlightElementSpy = vi.fn();
        (window as any).hljs = {
            highlight: vi.fn((_code: string) => ({ value: _code })),
            highlightAuto: vi.fn((_code: string) => ({ value: _code, language: 'js' })),
            highlightElement: highlightElementSpy,
        };

        const container = document.createElement('div');
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        pre.appendChild(code);
        container.appendChild(pre);

        const containerRef = createRef(container);
        const content = '# Hello';

        renderHook(() =>
            useMarkdownPreview({ content, containerRef })
        );

        expect(highlightElementSpy).toHaveBeenCalledWith(code);

        delete (window as any).hljs;
    });

    it('calls useCodeBlockActions with containerRef', () => {
        const containerRef = createRef();
        const content = '```js\nconst x = 1;\n```';
        renderHook(() =>
            useMarkdownPreview({ content, containerRef })
        );

        expect(useCodeBlockActions).toHaveBeenCalled();
        const calls = (useCodeBlockActions as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(containerRef);
    });

    it('preserves code-line structure in rendered code blocks', () => {
        const containerRef = createRef();
        const content = '```yaml\n- name: test\n  description: hello\n```';
        const { result } = renderHook(() =>
            useMarkdownPreview({ content, containerRef })
        );

        expect(result.current.html).toContain('class="code-line"');
        expect(result.current.html).toContain('class="line-number"');
        expect(result.current.html).toContain('data-line="1"');
        expect(result.current.html).toContain('data-line="2"');
    });
});
