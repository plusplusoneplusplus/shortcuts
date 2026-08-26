/**
 * Tests for SourceCanvasBody — AC-04 content rendering + AC-05 line highlight.
 *
 * The source path renders through the shared read-only Monaco viewer, which
 * cannot run under jsdom — so `MonacoFileEditor` is module-mocked (the pattern
 * from `repos/explorer/PreviewPane.readOnly.test.tsx`) and the assertions are
 * about the props the viewer receives, not about DOM rows.
 *
 * Covers:
 * - `.md`/`.markdown` → formatted markdown with a working Rendered ⇄ Raw toggle
 * - markdown detection via the server `language` hint (extension-agnostic)
 * - source files → read-only Monaco with the right language, no onSave/onChange
 * - unknown extensions → `plaintext`
 * - AC-05: `:line` and `:start-end` become a `highlightRange`; no line → none;
 *   out-of-range clamps; a changed range re-applies without a remount;
 *   rendered markdown still highlights the matching `.md-line` row
 */
/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SourceCanvasBody } from '../../../src/server/spa/client/react/features/chat/source-canvas/SourceCanvasBody';

const HIGHLIGHT = 'source-canvas-line-highlight';

/**
 * jsdom cannot run Monaco. Stand in a plain element that records the props the
 * canvas passed, so the tests assert the contract rather than the editor.
 * `mount-id` is stable across rerenders, which is how "no remount" is proven.
 */
const mountState = vi.hoisted(() => ({ count: 0 }));
vi.mock(
    '../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor',
    async () => {
        const { useRef } = await import('react');
        return {
            MonacoFileEditor: ({ value, language, readOnly, onChange, onSave, highlightRange }: any) => {
                const id = useRef<number | null>(null);
                if (id.current === null) { id.current = ++mountState.count; }
                return (
                    <div
                        data-testid="mock-monaco-editor"
                        data-mount-id={String(id.current)}
                        data-language={language}
                        data-value={value}
                        data-read-only={String(!!readOnly)}
                        data-has-on-change={String(!!onChange)}
                        data-has-on-save={String(!!onSave)}
                        data-highlight-start={highlightRange ? String(highlightRange.start) : ''}
                        data-highlight-end={highlightRange ? String(highlightRange.end) : ''}
                    />
                );
            },
            getMonacoLanguage: (name: string) => {
                const parts = String(name).split('.');
                if (parts.length < 2) { return 'plaintext'; }
                const map: Record<string, string> = {
                    ts: 'typescript', tsx: 'typescript', js: 'javascript', md: 'markdown', py: 'python',
                };
                return map[parts[parts.length - 1].toLowerCase()] ?? 'plaintext';
            },
            EXPLORER_EDITOR_OPTIONS: {},
            revealEditorLine: () => {},
            buildHighlightDecorations: () => [],
            EDITOR_HIGHLIGHT_CLASS: 'source-canvas-line-highlight',
        };
    },
);

/** Build N source lines: "line 1\nline 2\n…\nline N\n". */
function makeLines(n: number): string {
    return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
}

describe('SourceCanvasBody (AC-04)', () => {
    describe('markdown rendering', () => {
        it('renders a .md file as formatted markdown with a toggle to raw', () => {
            const md = '# Heading\n\nsome **bold** text\n';
            const { getByTestId, queryByTestId } = render(
                <SourceCanvasBody fileName="README.md" content={md} />,
            );

            // Default: rendered markdown (not the code viewer).
            const body = getByTestId('source-canvas-markdown');
            expect(body.classList.contains('markdown-body')).toBe(true);
            // renderMarkdownToHtml emits styled md-line/md-h1/md-bold spans.
            expect(body.querySelector('.md-h1')).not.toBeNull();
            expect(body.querySelector('.md-bold')).not.toBeNull();
            expect(queryByTestId('source-canvas-source')).toBeNull();

            // Toggle exists and starts in "show Raw" state.
            const toggle = getByTestId('source-canvas-md-toggle');
            expect(toggle.textContent).toBe('Raw');
            expect(toggle.getAttribute('aria-pressed')).toBe('false');

            // Toggle → raw view mounts the code viewer with the markdown source.
            fireEvent.click(toggle);
            expect(queryByTestId('source-canvas-markdown')).toBeNull();
            expect(getByTestId('source-canvas-source')).not.toBeNull();
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-value')).toBe(md);
            expect(editor.getAttribute('data-language')).toBe('markdown');
            expect(editor.getAttribute('data-read-only')).toBe('true');
            expect(toggle.textContent).toBe('Rendered');
            expect(toggle.getAttribute('aria-pressed')).toBe('true');

            // Toggle back → rendered markdown again.
            fireEvent.click(toggle);
            expect(getByTestId('source-canvas-markdown')).not.toBeNull();
            expect(queryByTestId('source-canvas-source')).toBeNull();
        });

        it('treats a non-.md file as markdown when the language hint says so', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="notes.txt" content={'# Hi\n'} language="markdown" />,
            );
            expect(getByTestId('source-canvas-markdown').querySelector('.md-h1')).not.toBeNull();
        });
    });

    describe('source rendering', () => {
        it('renders a .ts file in the read-only Monaco viewer with no save/change handlers', () => {
            const ts = 'const x = 1;\nfunction f() {\n  return x;\n}\n';
            const { getByTestId, queryByTestId } = render(
                <SourceCanvasBody fileName="app.ts" content={ts} />,
            );

            expect(queryByTestId('source-canvas-markdown')).toBeNull();
            // The wrapper testid is the external contract for "viewer mounted".
            const wrapper = getByTestId('source-canvas-source');
            const editor = getByTestId('mock-monaco-editor');
            expect(wrapper.contains(editor)).toBe(true);

            expect(editor.getAttribute('data-value')).toBe(ts);
            expect(editor.getAttribute('data-language')).toBe('typescript');
            expect(editor.getAttribute('data-read-only')).toBe('true');
            expect(editor.getAttribute('data-has-on-save')).toBe('false');
            expect(editor.getAttribute('data-has-on-change')).toBe('false');
        });

        it('falls back to plaintext for an unknown extension', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="data.unknownext" content={'alpha\nbeta\n'} />,
            );
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-language')).toBe('plaintext');
            expect(editor.getAttribute('data-value')).toBe('alpha\nbeta\n');
        });
    });

    describe('line highlight + scroll (AC-05)', () => {
        let scrollIntoView: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            scrollIntoView = vi.fn();
            // jsdom does not implement scrollIntoView — stub it so the canvas
            // can call it and the test can assert the auto-scroll happened.
            (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
                scrollIntoView;
        });

        afterEach(() => {
            delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
        });

        it('passes a single referenced line as a one-line highlight range (foo.ts:42)', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(50)} line={42} />,
            );
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-highlight-start')).toBe('42');
            expect(editor.getAttribute('data-highlight-end')).toBe('42');
        });

        it('passes an inclusive range (foo.ts:42-44)', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(50)} line={42} endLine={44} />,
            );
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-highlight-start')).toBe('42');
            expect(editor.getAttribute('data-highlight-end')).toBe('44');
        });

        it('passes no range when no line is given (opens at the top)', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(10)} />,
            );
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-highlight-start')).toBe('');
            expect(editor.getAttribute('data-highlight-end')).toBe('');
        });

        it('clamps an out-of-range line to the last line', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(5)} line={99} />,
            );
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-highlight-start')).toBe('5');
            expect(editor.getAttribute('data-highlight-end')).toBe('5');
        });

        it('clamps an out-of-range range end to the last line', () => {
            const { getByTestId } = render(
                <SourceCanvasBody fileName="foo.ts" content={makeLines(5)} line={3} endLine={99} />,
            );
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-highlight-start')).toBe('3');
            expect(editor.getAttribute('data-highlight-end')).toBe('5');
        });

        it('moves the range on an already-mounted editor without remounting', () => {
            const content = makeLines(200);
            const { getByTestId, rerender } = render(
                <SourceCanvasBody fileName="foo.ts" content={content} line={71} endLine={78} />,
            );
            const mountId = getByTestId('mock-monaco-editor').getAttribute('data-mount-id');
            expect(getByTestId('mock-monaco-editor').getAttribute('data-highlight-start')).toBe('71');

            // Same file, second reference — the editor instance must survive.
            rerender(<SourceCanvasBody fileName="foo.ts" content={content} line={120} />);
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-mount-id')).toBe(mountId);
            expect(editor.getAttribute('data-highlight-start')).toBe('120');
            expect(editor.getAttribute('data-highlight-end')).toBe('120');

            // Navigating to a ref with no line clears the highlight.
            rerender(<SourceCanvasBody fileName="foo.ts" content={content} />);
            expect(getByTestId('mock-monaco-editor').getAttribute('data-mount-id')).toBe(mountId);
            expect(getByTestId('mock-monaco-editor').getAttribute('data-highlight-start')).toBe('');
        });

        it('highlights the matching .md-line row in rendered markdown', () => {
            const md = '# Title\n\nAlpha line\nBravo line\n';
            const { getByTestId } = render(
                <SourceCanvasBody fileName="notes.md" content={md} line={3} />,
            );
            const body = getByTestId('source-canvas-markdown');
            const row = body.querySelector('.md-line[data-line="3"]') as HTMLElement;
            expect(row).not.toBeNull();
            expect(row.classList.contains(HIGHLIGHT)).toBe(true);
            expect(row.textContent).toContain('Alpha line');
            // Other lines are not highlighted.
            const otherHighlighted = Array.from(
                body.querySelectorAll('.md-line'),
            ).filter((r) => r.classList.contains(HIGHLIGHT));
            expect(otherHighlighted).toHaveLength(1);
            expect(scrollIntoView).toHaveBeenCalled();
        });

        it('passes the referenced line to the markdown raw view too', () => {
            const md = '# Title\n\nAlpha line\nBravo line\n';
            const { getByTestId } = render(
                <SourceCanvasBody fileName="notes.md" content={md} line={3} />,
            );
            // Toggle to raw source view.
            fireEvent.click(getByTestId('source-canvas-md-toggle'));
            const editor = getByTestId('mock-monaco-editor');
            expect(editor.getAttribute('data-language')).toBe('markdown');
            expect(editor.getAttribute('data-highlight-start')).toBe('3');
            expect(editor.getAttribute('data-highlight-end')).toBe('3');
        });
    });
});
