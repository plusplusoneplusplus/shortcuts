/**
 * Tests for ToolCallView — start time display in the tool call header.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
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

/** Compute the expected local-time label for a given ISO string. */
function expectedLocalLabel(iso: string): string {
    const d = new Date(iso);
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    let hh = d.getHours();
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${MM}/${dd} ${hh}:${mm} ${ampm}`;
}

describe('ToolCallView — start time display', () => {
    it('shows local start time when startTime is present', () => {
        const iso = '2026-03-02T07:07:28Z';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: iso })} />
        );
        const header = getHeader(container);
        const expected = expectedLocalLabel(iso);
        expect(header.textContent).toContain(expected);
    });

    it('does not show start time when startTime is absent', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall()} />
        );
        const header = getHeader(container);
        // No AM/PM time pattern should appear
        expect(header.textContent).not.toMatch(/\d{1,2}:\d{2}\s*[AP]M/);
    });

    it('does not show start time when startTime is invalid', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: 'not-a-date' })} />
        );
        const header = getHeader(container);
        expect(header.textContent).not.toMatch(/\d{1,2}:\d{2}\s*[AP]M/);
    });

    it('formats midnight correctly in local time', () => {
        // Use a date where midnight local = the ISO string
        const localMidnight = new Date();
        localMidnight.setHours(0, 0, 0, 0);
        const iso = localMidnight.toISOString();
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: iso })} />
        );
        const header = getHeader(container);
        expect(header.textContent).toContain('12:00 AM');
    });

    it('formats time with leading zeros on minutes', () => {
        const iso = '2026-06-15T03:05:09Z';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: iso })} />
        );
        const header = getHeader(container);
        const expected = expectedLocalLabel(iso);
        expect(header.textContent).toContain(expected);
    });

    it('shows both start time and duration when both are present', () => {
        const iso = '2026-03-02T07:07:28Z';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({
                startTime: iso,
                endTime: '2026-03-02T07:07:28.066Z',
            })} />
        );
        const header = getHeader(container);
        const expected = expectedLocalLabel(iso);
        expect(header.textContent).toContain(expected);
        expect(header.textContent).toContain('ms');
    });

    it('start time span has ml-auto when startTime is present and duration is absent', () => {
        const iso = '2026-03-02T07:07:28Z';
        const expected = expectedLocalLabel(iso);
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: iso })} />
        );
        const header = getHeader(container);
        const spans = Array.from(header.querySelectorAll('span'));
        const startTimeSpan = spans.find(s => s.textContent === expected);
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

    it('uses local time, not UTC', () => {
        // Use a time that will differ between UTC and any non-UTC timezone
        const iso = '2026-01-01T23:30:00Z';
        const d = new Date(iso);
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ startTime: iso })} />
        );
        const header = getHeader(container);
        const expected = expectedLocalLabel(iso);
        expect(header.textContent).toContain(expected);
        // Should NOT contain the 'Z' UTC suffix
        expect(header.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}Z/);
    });
});
