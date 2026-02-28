/**
 * Tests for ToolCallView — hover popover for task tool call results.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

function makeTaskToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-task-1',
        toolName: 'task',
        args: { agent_type: 'explore', description: 'Explore codebase' },
        status: 'completed',
        result: 'Found 3 files matching the pattern.',
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:05Z',
        ...overrides,
    };
}

function makeNonTaskToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-grep-1',
        toolName: 'grep',
        args: { pattern: 'foo' },
        status: 'completed',
        result: 'src/index.ts: foo bar',
        ...overrides,
    };
}

describe('ToolCallView — task result hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a task tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);

        // Not visible yet (before 300ms)
        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();

        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Found 3 files matching the pattern.');
    });

    it('does not show popover before 300ms delay', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);

        act(() => { vi.advanceTimersByTime(200); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('hides popover on mouse leave from header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeTruthy();

        fireEvent.mouseLeave(header);
        act(() => { vi.advanceTimersByTime(100); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('does not show popover for non-task tool calls', () => {
        const { container } = render(
            <ToolCallView toolCall={makeNonTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('does not show popover for task tool calls with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall({ result: '' })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('does not show popover for task tool calls with no result', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall({ result: undefined })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('truncates long results in the popover', () => {
        const longResult = 'x'.repeat(2500);
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall({ result: longResult })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('… (truncated — click to see full)');
        // Should not contain the full 2500 chars
        expect(popover!.textContent!.length).toBeLessThan(2500);
    });

    it('keeps popover open when mouse moves into the popover', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]')!;
        expect(popover).toBeTruthy();

        // Leave header — starts grace period
        fireEvent.mouseLeave(header);
        // Enter popover — cancels grace period
        fireEvent.mouseEnter(popover);
        act(() => { vi.advanceTimersByTime(200); });

        // Should still be visible
        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeTruthy();
    });

    it('hides popover when mouse leaves the popover', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]')!;
        fireEvent.mouseLeave(header);
        fireEvent.mouseEnter(popover);
        fireEvent.mouseLeave(popover);

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('cancels pending hover when mouse leaves before 300ms', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(150); });
        fireEvent.mouseLeave(header);
        act(() => { vi.advanceTimersByTime(300); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('renders the "Result Preview" label inside the popover', () => {
        const { container } = render(
            <ToolCallView toolCall={makeTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover!.textContent).toContain('Result Preview');
    });
});
