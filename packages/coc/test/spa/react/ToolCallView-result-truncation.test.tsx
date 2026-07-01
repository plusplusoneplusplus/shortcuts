// @vitest-environment jsdom
/**
 * Tests for ToolCallView — when a long tool-call result is truncated for
 * display, the truncation notice reports the full result size so users can
 * see how large the complete output was.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

function getBody(container: HTMLElement) {
    return container.querySelector('.tool-call-body');
}

describe('ToolCallView — truncated result reports total size', () => {
    it('appends the rendered + total char counts when the result is truncated', () => {
        const result = 'x'.repeat(12345);
        const tc = {
            id: 'tc-big',
            toolName: 'get_conversation',
            args: { processId: 'queue_123' },
            status: 'completed',
            result,
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('output truncated');
        // Shows how much is rendered AND the full size, with thousands separators.
        expect(body.textContent).toContain('showing 4,900 of 12,345 chars');
        // The full result text is not rendered in full.
        expect(body.textContent!.length).toBeLessThan(result.length);
    });

    it('formats very large totals with thousands separators', () => {
        const result = 'y'.repeat(1234567);
        const tc = {
            id: 'tc-huge',
            toolName: 'get_conversation',
            status: 'completed',
            result,
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('showing 4,900 of 1,234,567 chars');
    });

    it('does not add a truncation notice for short results', () => {
        const tc = {
            id: 'tc-small',
            toolName: 'get_conversation',
            args: { processId: 'queue_123' },
            status: 'completed',
            result: 'short result',
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        expect(body.textContent).toContain('short result');
        expect(body.textContent).not.toContain('output truncated');
    });

    it('reports total size for the whisper-row variant too', () => {
        // The whisper-row variant shares the same visibleResult truncation logic.
        const result = 'z'.repeat(8000);
        const tc = {
            id: 'tc-whisper',
            toolName: 'get_conversation',
            status: 'completed',
            result,
        };
        const { container } = render(
            <ToolCallVariantProvider value="whisper-row">
                <ToolCallView toolCall={tc} />
            </ToolCallVariantProvider>
        );
        const header = container.querySelector('.tool-call-row-header');
        if (header) fireEvent.click(header);

        const body = container.querySelector('.tool-call-row-body')!;
        expect(body.textContent).toContain('showing 4,900 of 8,000 chars');
    });
});
