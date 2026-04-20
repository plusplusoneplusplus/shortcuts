/**
 * Tests for shell command copyability:
 * - Popover command div uses select-text (not select-none)
 * - Expanded ToolCallView has a copy button for the command
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/chat/ToolCallView';
import { ToolResultPopover } from '../../../src/server/spa/client/react/chat/ToolResultPopover';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('../../../src/server/spa/client/react/utils/format', async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    return {
        ...original,
        copyToClipboard: vi.fn().mockResolvedValue(undefined),
    };
});

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-cmd-1',
        toolName: 'powershell',
        args: { command: 'npm run build', description: 'Build project' },
        result: 'Build succeeded',
        status: 'completed',
        ...overrides,
    };
}

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

describe('ToolResultPopover — command selectability', () => {
    const noop = () => {};
    const anchorRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;

    it('popover bash command div has select-text, not select-none', () => {
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
        const terminal = getByTestId('popover-terminal');
        const cmdDiv = terminal.querySelector('div');
        expect(cmdDiv).not.toBeNull();
        expect(cmdDiv!.className).toContain('select-text');
        expect(cmdDiv!.className).not.toContain('select-none');
    });

    it('popover powershell command div has select-text', () => {
        const { getByTestId } = render(
            <ToolResultPopover
                result="output"
                toolName="powershell"
                args={{ command: 'Get-Process' }}
                anchorRect={anchorRect}
                onMouseEnter={noop}
                onMouseLeave={noop}
            />
        );
        const terminal = getByTestId('popover-terminal');
        const cmdDiv = terminal.querySelector('div');
        expect(cmdDiv).not.toBeNull();
        expect(cmdDiv!.className).toContain('select-text');
    });
});

describe('ToolCallView — command copy button', () => {
    it('renders a copy button with data-testid="command-copy-btn" in expanded shell tool', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall()} />
        );
        expandToolCall(container);

        const btn = container.querySelector('[data-testid="command-copy-btn"]');
        expect(btn).not.toBeNull();
    });

    it('copy button is not rendered for non-shell tools', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ toolName: 'view', args: { path: '/src/index.ts' } })} />
        );
        expandToolCall(container);

        const btn = container.querySelector('[data-testid="command-copy-btn"]');
        expect(btn).toBeNull();
    });

    it('clicking copy button calls copyToClipboard with raw command (no $ prefix)', async () => {
        const { copyToClipboard } = await import('../../../src/server/spa/client/react/utils/format');

        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ args: { command: 'npm run build' } })} />
        );
        expandToolCall(container);

        const btn = container.querySelector('[data-testid="command-copy-btn"]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        fireEvent.click(btn);

        expect(copyToClipboard).toHaveBeenCalledWith('npm run build');
    });

    it('copy button renders for bash tool as well', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ toolName: 'bash', args: { command: 'ls -la' } })} />
        );
        expandToolCall(container);

        const btn = container.querySelector('[data-testid="command-copy-btn"]');
        expect(btn).not.toBeNull();
    });
});
