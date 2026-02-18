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

// Mock useMermaid since it requires DOM manipulation
vi.mock('../../../src/server/spa/client/react/hooks/useMermaid', () => ({
    useMermaid: vi.fn(),
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
});
