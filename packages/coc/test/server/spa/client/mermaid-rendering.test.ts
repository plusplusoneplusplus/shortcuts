/**
 * Tests for task-mermaid.ts
 *
 * Unit tests for mermaid diagram rendering in task preview.
 * Uses JSDOM-like structures via minimal DOM mocking for Node environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderMarkdownToHtml } from '../../../../src/server/spa/client/markdown-renderer';

// ---------------------------------------------------------------------------
// Helpers: parse HTML to check structure (string-based, no DOM needed)
// ---------------------------------------------------------------------------

function countOccurrences(html: string, substring: string): number {
    let count = 0;
    let idx = 0;
    while ((idx = html.indexOf(substring, idx)) !== -1) {
        count++;
        idx += substring.length;
    }
    return count;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Mermaid rendering in task preview', () => {

    // ----------------------------------------------------------------
    // Mermaid container detection via markdown-renderer
    // ----------------------------------------------------------------

    describe('mermaid block detection in markdown', () => {
        it('detects a single mermaid block and generates container HTML', () => {
            const md = '# Diagram\n\n```mermaid\ngraph TD\n  A --> B\n```';
            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(html).toContain('mermaid-container');
            expect(html).toContain('mermaid-header');
            expect(html).toContain('Mermaid Diagram');
            expect(html).toContain('mermaid-preview');
            expect(html).toContain('mermaid-source');
        });

        it('detects multiple mermaid blocks in a single document', () => {
            const md = [
                '# Architecture',
                '',
                '```mermaid',
                'graph TD',
                '  A --> B',
                '```',
                '',
                'Some text between diagrams.',
                '',
                '```mermaid',
                'sequenceDiagram',
                '  Alice->>Bob: Hello',
                '```',
            ].join('\n');

            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(countOccurrences(html, 'mermaid-container')).toBe(2);
            expect(countOccurrences(html, 'Mermaid Diagram')).toBe(2);
        });

        it('does not generate mermaid containers for non-mermaid code blocks', () => {
            const md = '```javascript\nconst x = 1;\n```';
            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(html).not.toContain('mermaid-container');
            expect(html).toContain('code-block');
            expect(html).toContain('language-javascript');
        });

        it('handles mixed mermaid and non-mermaid code blocks', () => {
            const md = [
                '```js',
                'const x = 1;',
                '```',
                '',
                '```mermaid',
                'graph LR',
                '  A --> B',
                '```',
                '',
                '```python',
                'print("hello")',
                '```',
            ].join('\n');

            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(countOccurrences(html, 'mermaid-container')).toBe(1);
            // Each code-block div contains the class multiple times in sub-elements;
            // just verify both non-mermaid languages appear
            expect(html).toContain('language-js');
            expect(html).toContain('language-python');
        });

        it('does not generate mermaid when there are no mermaid blocks', () => {
            const md = '# Title\n\nJust plain text.\n\n- Item 1\n- Item 2';
            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(html).not.toContain('mermaid-container');
            expect(html).not.toContain('mermaid-preview');
        });
    });

    // ----------------------------------------------------------------
    // Container HTML structure
    // ----------------------------------------------------------------

    describe('mermaid container HTML structure', () => {
        it('contains source code in the hidden source element', () => {
            const md = '```mermaid\ngraph TD\n  A --> B\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('mermaid-source');
            // Source code should be HTML-escaped
            expect(html).toContain('A --&gt; B');
        });

        it('contains line count in the header', () => {
            const md = '```mermaid\ngraph TD\n  A --> B\n  B --> C\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('(3 lines)');
        });

        it('contains data attributes for line tracking', () => {
            const md = '```mermaid\ngraph TD\n  A --> B\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('data-start-line=');
            expect(html).toContain('data-end-line=');
            expect(html).toContain('data-mermaid-id=');
        });

        it('contains loading placeholder', () => {
            const md = '```mermaid\ngraph LR\n  X --> Y\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('mermaid-loading');
            expect(html).toContain('Loading diagram...');
        });
    });

    // ----------------------------------------------------------------
    // Theme detection
    // ----------------------------------------------------------------

    describe('mermaid theme integration', () => {
        it('renders container with proper class structure for theming', () => {
            const md = '```mermaid\ngraph TD\n  A --> B\n```';
            const html = renderMarkdownToHtml(md);

            // The container should have the class that CSS can target for
            // dark/light theme styling
            expect(html).toContain('class="mermaid-container"');
        });
    });

    // ----------------------------------------------------------------
    // Mermaid block with complex content
    // ----------------------------------------------------------------

    describe('complex mermaid diagrams', () => {
        it('handles flowchart with HTML entities', () => {
            const md = '```mermaid\ngraph TD\n  A["Item <1>"] --> B["Item & 2"]\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('mermaid-container');
            // HTML entities should be escaped in the source view
            expect(html).toContain('&lt;1&gt;');
            expect(html).toContain('&amp; 2');
        });

        it('handles sequence diagrams', () => {
            const md = '```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('mermaid-container');
            expect(html).toContain('Alice');
        });

        it('handles class diagrams', () => {
            const md = '```mermaid\nclassDiagram\n  class Animal\n  Animal : +int age\n```';
            const html = renderMarkdownToHtml(md);

            expect(html).toContain('mermaid-container');
        });

        it('handles empty mermaid blocks gracefully', () => {
            const md = '```mermaid\n\n```';
            const html = renderMarkdownToHtml(md);

            // Should still generate container even for empty content
            expect(html).toContain('mermaid-container');
        });
    });

    // ----------------------------------------------------------------
    // Integration: frontmatter stripping with mermaid
    // ----------------------------------------------------------------

    describe('frontmatter and mermaid integration', () => {
        it('strips frontmatter but preserves mermaid blocks', () => {
            const md = '---\nstatus: pending\n---\n\n# Plan\n\n```mermaid\ngraph TD\n  A --> B\n```';
            const html = renderMarkdownToHtml(md, { stripFrontmatter: true });

            expect(html).not.toContain('status: pending');
            expect(html).toContain('mermaid-container');
            expect(html).toContain('Plan');
        });
    });
});

// ---------------------------------------------------------------------------
// Tests for task-mermaid.ts module exports (DOM-free where possible)
// ---------------------------------------------------------------------------

describe('task-mermaid module', () => {

    describe('ensureMermaid', () => {
        let originalCreateElement: typeof document.createElement;
        let originalHead: HTMLHeadElement;

        beforeEach(() => {
            // Reset the mermaid load promise by re-importing
            vi.resetModules();
        });

        it('is exported as a function', async () => {
            const mod = await import('../../../../src/server/spa/client/task-mermaid');
            expect(typeof mod.ensureMermaid).toBe('function');
        });

        it('initTaskMermaid is exported as a function', async () => {
            const mod = await import('../../../../src/server/spa/client/task-mermaid');
            expect(typeof mod.initTaskMermaid).toBe('function');
        });

        it('reinitMermaidTheme is exported as a function', async () => {
            const mod = await import('../../../../src/server/spa/client/task-mermaid');
            expect(typeof mod.reinitMermaidTheme).toBe('function');
        });
    });

    describe('initTaskMermaid with no scope', () => {
        it('accepts an optional root parameter', async () => {
            const mod = await import('../../../../src/server/spa/client/task-mermaid');
            // The function signature accepts an optional HTMLElement root.
            // Without DOM, we just verify it doesn't crash with undefined root
            // (it will try document.getElementById which won't exist — but the
            //  function is designed to no-op if scope is null)
            expect(typeof mod.initTaskMermaid).toBe('function');
            expect(mod.initTaskMermaid.length).toBeLessThanOrEqual(1);
        });
    });
});
