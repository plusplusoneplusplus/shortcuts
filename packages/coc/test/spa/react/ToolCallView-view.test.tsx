/**
 * Tests for ToolCallView — ViewToolView specialized rendering for the `view` tool.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

function makeViewToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-view-1',
        toolName: 'view',
        args: { path: '/home/user/project/src/index.ts' },
        status: 'completed',
        ...overrides,
    };
}

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

function getBody(container: HTMLElement) {
    return container.querySelector('.tool-call-body');
}

describe('ToolCallView — ViewToolView rendering', () => {
    it('renders line-numbered content with a gutter', () => {
        const result = '1. import { foo } from "bar";\n2. import { baz } from "qux";';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({ result })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        // Should have gutter spans with line numbers
        const gutterSpans = body.querySelectorAll('.select-none');
        expect(gutterSpans.length).toBe(2);
        expect(gutterSpans[0].textContent).toBe('1');
        expect(gutterSpans[1].textContent).toBe('2');

        // Should have code content
        expect(body.textContent).toContain('import { foo } from "bar";');
        expect(body.textContent).toContain('import { baz } from "qux";');
    });

    it('renders file path badge with shortened path', () => {
        const result = '10. const x = 1;';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/home/user/project/src/utils.ts' },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('~/project/src/utils.ts');
    });

    it('renders view_range badge', () => {
        const result = '22. import {\n23.     QueueExecutor,';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/home/user/project/src/file.ts', view_range: [22, 47] },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('L22');
        expect(body.textContent).toContain('L47');
    });

    it('renders EOF for view_range ending with -1', () => {
        const result = '10. const x = 1;';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/tmp/file.ts', view_range: [10, -1] },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('EOF');
    });

    it('renders language extension tag', () => {
        const result = '1. hello';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/tmp/file.tsx' },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        // The extension tag should appear
        expect(body.textContent).toContain('tsx');
    });

    it('falls back to plain pre block for directory listings (no line numbers)', () => {
        const result = 'src/\n  index.ts\n  utils.ts\npackage.json';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/home/user/project' },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        const pre = body.querySelector('pre code');
        expect(pre).toBeTruthy();
        expect(pre!.textContent).toContain('src/');
        expect(pre!.textContent).toContain('package.json');
    });

    it('does not render generic ARGUMENTS section for view tool', () => {
        const result = '1. const x = 1;';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/tmp/file.ts', view_range: [1, 5] },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        const labels = Array.from(body.querySelectorAll('div')).map(d => d.textContent);
        const hasArgumentsLabel = labels.some(t => t === 'Arguments');
        expect(hasArgumentsLabel).toBe(false);
    });

    it('does not render generic RESULT section for view tool', () => {
        const result = '1. hello world';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({ result })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        const labels = Array.from(body.querySelectorAll('div'))
            .filter(d => d.classList.contains('uppercase'))
            .map(d => d.textContent?.trim());
        expect(labels).not.toContain('Result');
    });

    it('renders image result for view tool with image data URL', () => {
        const imgDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/tmp/image.png' },
                result: imgDataUrl,
            })} />
        );
        expandToolCall(container);

        const img = container.querySelector('[data-testid="tool-result-image"]');
        expect(img).toBeTruthy();
        expect(img?.getAttribute('src')).toBe(imgDataUrl);
    });

    it('handles empty result gracefully', () => {
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({ result: '' })} />
        );
        expandToolCall(container);
        // Should not crash; body may be minimal
        expect(container.querySelector('.tool-call-card')).toBeTruthy();
    });

    it('handles lines with high line numbers correctly', () => {
        const result = '999. line 999\n1000. line 1000\n1001. line 1001';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({ result })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        const gutterSpans = body.querySelectorAll('.select-none');
        expect(gutterSpans.length).toBe(3);
        expect(gutterSpans[0].textContent).toBe('999');
        expect(gutterSpans[1].textContent).toBe('1000');
        expect(gutterSpans[2].textContent).toBe('1001');
    });

    it('handles mixed numbered and non-numbered lines (truncation suffix)', () => {
        const result = '1. first line\n2. second line\n... (output truncated)';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({ result })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        // First line has a number, so hasLineNumbers is true
        const gutterSpans = body.querySelectorAll('.select-none');
        expect(gutterSpans.length).toBe(3);
        expect(gutterSpans[0].textContent).toBe('1');
        expect(gutterSpans[1].textContent).toBe('2');
        // Truncation line has no line number
        expect(gutterSpans[2].textContent).toBe('');

        expect(body.textContent).toContain('... (output truncated)');
    });

    it('uses filePath arg as fallback when path is not present', () => {
        const result = '1. test';
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { filePath: '/home/user/project/alt.ts' },
                result,
            })} />
        );
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('~/project/alt.ts');
    });
});
