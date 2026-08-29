/**
 * Tests for the timing line in the expanded tool-call detail body.
 *
 * The compact whisper row only shows `duration` in its collapsed header and the
 * card only shows the start time on non-mobile, so the start time is rendered
 * once in the shared detail body — available from both variants.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider, type ToolCallVariant } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';

const START = new Date(2026, 0, 2, 15, 4, 5);

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-1',
        toolName: 'bash',
        args: { command: 'ls -la' },
        result: 'ok',
        status: 'completed',
        startTime: START.toISOString(),
        endTime: new Date(START.getTime() + 1500).toISOString(),
        ...overrides,
    };
}

function renderRow(toolCall: any, variant: ToolCallVariant = 'card') {
    const out = render(
        <ToolCallVariantProvider value={variant}>
            <ToolCallView toolCall={toolCall} />
        </ToolCallVariantProvider>
    );
    const header = out.container.querySelector('.tool-call-header, .tool-call-row-header');
    if (header) fireEvent.click(header);
    return out;
}

describe('ToolCallView — expanded timing line', () => {
    afterEach(() => cleanup());

    it('renders the start time with seconds and the duration on the card variant', () => {
        renderRow(makeToolCall(), 'card');
        const timing = screen.getByTestId('tool-call-timing');
        expect(timing.textContent).toBe('Started 01/02 3:04:05 PM · 1.5s');
    });

    it('renders the same timing line on the compact whisper-row variant', () => {
        renderRow(makeToolCall(), 'whisper-row');
        expect(screen.getByTestId('tool-call-timing').textContent).toBe('Started 01/02 3:04:05 PM · 1.5s');
    });

    it('omits the timing line entirely when there is no start time', () => {
        renderRow(makeToolCall({ startTime: undefined, endTime: undefined }), 'card');
        expect(screen.queryByTestId('tool-call-timing')).toBeNull();
    });

    it('omits the timing line when the start time is unparseable', () => {
        renderRow(makeToolCall({ startTime: 'not-a-date', endTime: undefined }), 'card');
        expect(screen.queryByTestId('tool-call-timing')).toBeNull();
    });

    it('still shows the start time for a synthesized call whose duration is 0ms', () => {
        const iso = START.toISOString();
        renderRow(makeToolCall({ startTime: iso, endTime: iso }), 'card');
        expect(screen.getByTestId('tool-call-timing').textContent).toBe('Started 01/02 3:04:05 PM · 0ms');
    });

    it('shows the start time alone when the duration is unavailable', () => {
        // A running call with an end time before the start yields no duration.
        renderRow(makeToolCall({ endTime: new Date(START.getTime() - 1000).toISOString() }), 'card');
        expect(screen.getByTestId('tool-call-timing').textContent).toBe('Started 01/02 3:04:05 PM');
    });
});
