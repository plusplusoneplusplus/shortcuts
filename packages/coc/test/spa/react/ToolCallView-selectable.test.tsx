/**
 * Regression tests: tool-call-body and ToolResultPopover content must be
 * mouse-selectable (user-select: text) so users can copy output.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolResultPopover } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolResultPopover';

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-sel-1',
        toolName: 'bash',
        args: { command: 'echo hello', description: 'Test' },
        result: 'hello',
        status: 'completed',
        ...overrides,
    };
}

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

describe('ToolCallView — body selectability', () => {
    it('tool-call-body has select-text class so code/result text is mouse-selectable', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall()} />
        );
        expandToolCall(container);

        const body = container.querySelector('.tool-call-body');
        expect(body).not.toBeNull();
        expect(body!.className).toContain('select-text');
    });

    it('tool-call-body does NOT have select-none (which would block selection)', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall()} />
        );
        expandToolCall(container);

        const body = container.querySelector('.tool-call-body');
        expect(body).not.toBeNull();
        expect(body!.className).not.toContain('select-none');
    });

    it('tool-call-header retains select-none (intentional for click targets)', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall()} />
        );
        const header = container.querySelector('.tool-call-header');
        expect(header).not.toBeNull();
        expect(header!.className).toContain('select-none');
    });

    it('select-text applies when rendering view tool with line-numbered content', () => {
        const result = '1. const x = 1;\n2. const y = 2;';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ toolName: 'view', args: { path: '/src/index.ts' }, result })} />
        );
        expandToolCall(container);

        const body = container.querySelector('.tool-call-body');
        expect(body!.className).toContain('select-text');
    });

    it('select-text applies when rendering diff (edit tool)', () => {
        const args = { path: '/src/foo.ts', old_str: 'old line', new_str: 'new line' };
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ toolName: 'edit', args, result: 'ok' })} />
        );
        expandToolCall(container);

        const body = container.querySelector('.tool-call-body');
        expect(body!.className).toContain('select-text');
    });
});

describe('ToolResultPopover — content selectability', () => {
    const noop = () => {};
    const anchorRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;

    it('desktop popover root has select-text class', () => {
        const { getByTestId } = render(
            <ToolResultPopover
                result="hello world"
                toolName="bash"
                args={{ command: 'echo hello' }}
                anchorRect={anchorRect}
                onMouseEnter={noop}
                onMouseLeave={noop}
            />
        );
        const popover = getByTestId('tool-result-popover');
        expect(popover.className).toContain('select-text');
    });

    it('popover does NOT have select-none on the root container', () => {
        const { getByTestId } = render(
            <ToolResultPopover
                result="some output"
                toolName="bash"
                args={{ command: 'ls' }}
                anchorRect={anchorRect}
                onMouseEnter={noop}
                onMouseLeave={noop}
            />
        );
        const popover = getByTestId('tool-result-popover');
        expect(popover.className).not.toContain('select-none');
    });

    it('view popover root has select-text', () => {
        const result = '1. import React from "react";';
        const { getByTestId } = render(
            <ToolResultPopover
                result={result}
                toolName="view"
                args={{ path: '/src/App.tsx' }}
                anchorRect={anchorRect}
                onMouseEnter={noop}
                onMouseLeave={noop}
            />
        );
        const popover = getByTestId('tool-result-popover');
        expect(popover.className).toContain('select-text');
    });
});
