/**
 * Tests for tool-renderer.ts — edit and create tool rendering.
 *
 * Verifies that edit tool calls render as unified diffs and
 * create tool calls render file content as code blocks.
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import {
    renderToolCallHTML,
} from '../../../../src/server/spa/client/tool-renderer';

/* ── Helpers ──────────────────────────────────────────────── */

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'tc-1',
        toolName: overrides.toolName || 'edit',
        args: overrides.args || {},
        status: overrides.status || 'completed',
        startTime: overrides.startTime || '2024-01-01T00:00:00Z',
        endTime: overrides.endTime || '2024-01-01T00:00:01Z',
        ...overrides,
    };
}

function htmlToElement(html: string): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild as HTMLElement;
}

/* ── Edit tool rendering ──────────────────────────────────── */

describe('renderToolCallHTML — edit tool diff rendering', () => {
    it('renders diff lines with added/removed classes for edit tool', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/home/user/project/src/app.ts',
                old_str: 'const x = 1;',
                new_str: 'const x = 2;',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('diff-container');
        expect(html).toContain('diff-line-removed');
        expect(html).toContain('diff-line-added');
        expect(html).toContain('const x = 1;');
        expect(html).toContain('const x = 2;');
    });

    it('renders file path in the body', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/home/user/project/src/app.ts',
                old_str: 'a',
                new_str: 'b',
            },
        });
        const html = renderToolCallHTML(tc);
        // The path should be shortened and shown
        expect(html).toContain('app.ts');
    });

    it('renders context lines for unchanged parts', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: 'line1\nold\nline3',
                new_str: 'line1\nnew\nline3',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('diff-line-context');
        expect(html).toContain('diff-line-removed');
        expect(html).toContain('diff-line-added');
    });

    it('renders + prefix for added lines and − prefix for removed lines', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: 'old',
                new_str: 'new',
            },
        });
        const html = renderToolCallHTML(tc);
        // + prefix for added
        expect(html).toContain('>+</span>');
        // − (minus sign U+2212) prefix for removed
        expect(html).toContain('>\u2212</span>');
    });

    it('does NOT render raw JSON for edit tool calls', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: 'foo',
                new_str: 'bar',
            },
        });
        const html = renderToolCallHTML(tc);
        // Should not contain the generic "Arguments" label
        expect(html).not.toContain('>Arguments</div>');
        // Should not contain JSON-style keys
        expect(html).not.toContain('"old_str"');
        expect(html).not.toContain('"new_str"');
    });

    it('handles empty old_str (insertion)', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: '',
                new_str: 'new content',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('diff-line-added');
        expect(html).toContain('new content');
    });

    it('handles empty new_str (deletion)', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: 'removed content',
                new_str: '',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('diff-line-removed');
        expect(html).toContain('removed content');
    });

    it('falls back to raw display for very large diffs', () => {
        const longStr = Array(600).fill('line').join('\n');
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: longStr,
                new_str: 'short',
            },
        });
        const html = renderToolCallHTML(tc);
        // Should fall back to Old/New labels since diff is too large
        expect(html).toContain('>Old</div>');
        expect(html).toContain('>New</div>');
        expect(html).not.toContain('diff-container');
    });

    it('escapes HTML entities in diff content', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_str: '<div class="old">',
                new_str: '<div class="new">',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('&lt;div');
        expect(html).not.toContain('<div class="old">');
    });

    it('supports old_string alias', () => {
        const tc = makeToolCall({
            toolName: 'edit',
            args: {
                path: '/tmp/test.ts',
                old_string: 'alias old',
                new_str: 'alias new',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('diff-container');
        expect(html).toContain('alias old');
        expect(html).toContain('alias new');
    });
});

/* ── Create tool rendering ────────────────────────────────── */

describe('renderToolCallHTML — create tool rendering', () => {
    it('renders file content as a code block', () => {
        const tc = makeToolCall({
            toolName: 'create',
            args: {
                path: '/home/user/project/src/new-file.ts',
                file_text: 'export function hello() { return "world"; }',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('hello()');
        expect(html).toContain('new-file.ts');
    });

    it('renders file path as header', () => {
        const tc = makeToolCall({
            toolName: 'create',
            args: {
                path: '/home/user/project/src/new-file.ts',
                file_text: 'content',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('new-file.ts');
    });

    it('does NOT render raw JSON for create tool calls', () => {
        const tc = makeToolCall({
            toolName: 'create',
            args: {
                path: '/tmp/test.ts',
                file_text: 'content',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).not.toContain('>Arguments</div>');
        expect(html).not.toContain('"file_text"');
    });

    it('escapes HTML in file content', () => {
        const tc = makeToolCall({
            toolName: 'create',
            args: {
                path: '/tmp/test.html',
                file_text: '<script>alert("xss")</script>',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>alert');
    });

    it('handles empty file_text gracefully', () => {
        const tc = makeToolCall({
            toolName: 'create',
            args: {
                path: '/tmp/test.ts',
                file_text: '',
            },
        });
        const html = renderToolCallHTML(tc);
        // Should still render without error, path should be shown
        expect(html).toContain('test.ts');
    });
});

/* ── Other tools remain unchanged ─────────────────────────── */

describe('renderToolCallHTML — other tools unchanged', () => {
    it('bash tool still renders with command/description sections', () => {
        const tc = makeToolCall({
            toolName: 'bash',
            args: {
                command: 'echo hello',
                description: 'Print hello',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('>Description</div>');
        expect(html).toContain('>Command</div>');
        expect(html).toContain('echo hello');
    });

    it('view tool still renders generic JSON arguments', () => {
        const tc = makeToolCall({
            toolName: 'view',
            args: {
                path: '/tmp/test.ts',
                view_range: [1, 10],
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('>Arguments</div>');
    });

    it('grep tool still renders generic JSON arguments', () => {
        const tc = makeToolCall({
            toolName: 'grep',
            args: {
                pattern: 'TODO',
                path: '/tmp',
            },
        });
        const html = renderToolCallHTML(tc);
        expect(html).toContain('>Arguments</div>');
    });
});
