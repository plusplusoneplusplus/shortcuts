/**
 * Tests for ToolCallView — start time display in the tool call header.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

import { vi } from 'vitest';

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-1',
        toolName: 'grep',
        args: { pattern: 'foo' },
        status: 'completed',
        result: 'match found',
        ...overrides,
    };
}

function getHeader(container: HTMLElement) {
    return container.querySelector('.tool-call-header')!;
}

describe('ToolCallView — start time display', () => {
    it('shows UTC start time when startTime is present', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: '2026-03-02T07:07:28Z' })} />
        );
        const header = getHeader(container);
        expect(header.textContent).toContain('07:07:28Z');
    });

    it('does not show start time when startTime is absent', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall()} />
        );
        const header = getHeader(container);
        expect(header.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}Z/);
    });

    it('does not show start time when startTime is invalid', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: 'not-a-date' })} />
        );
        const header = getHeader(container);
        expect(header.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}Z/);
    });

    it('formats midnight correctly as 00:00:00Z', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: '2026-01-01T00:00:00Z' })} />
        );
        const header = getHeader(container);
        expect(header.textContent).toContain('00:00:00Z');
    });

    it('formats time with single-digit h/m/s with leading zeros', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: '2026-06-15T03:05:09Z' })} />
        );
        const header = getHeader(container);
        expect(header.textContent).toContain('03:05:09Z');
    });

    it('shows both start time and duration when both are present', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({
                startTime: '2026-03-02T07:07:28Z',
                endTime: '2026-03-02T07:07:28.066Z',
            })} />
        );
        const header = getHeader(container);
        expect(header.textContent).toContain('07:07:28Z');
        expect(header.textContent).toContain('ms');
    });

    it('start time span has ml-auto when startTime is present and duration is absent', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: '2026-03-02T07:07:28Z' })} />
        );
        const header = getHeader(container);
        const spans = Array.from(header.querySelectorAll('span'));
        const startTimeSpan = spans.find(s => s.textContent === '03/02 07:07:28Z');
        expect(startTimeSpan).toBeDefined();
        expect(startTimeSpan!.className).toContain('ml-auto');
    });

    it('duration span does not have ml-auto when startTime is also present', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({
                startTime: '2026-03-02T07:07:28Z',
                endTime: '2026-03-02T07:07:28.500Z',
            })} />
        );
        const header = getHeader(container);
        const spans = Array.from(header.querySelectorAll('span'));
        const durationSpan = spans.find(s => s.textContent?.endsWith('ms') || s.textContent?.endsWith('s'));
        expect(durationSpan).toBeDefined();
        expect(durationSpan!.className).not.toContain('ml-auto');
    });
});
