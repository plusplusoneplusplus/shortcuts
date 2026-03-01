/**
 * Tests for ToolCallView — hover popover for task and view tool call results.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

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

function makeViewToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-view-1',
        toolName: 'view',
        args: { path: '/project/src/index.ts' },
        status: 'completed',
        result: '1. const x = 1;\n2. const y = 2;',
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:01Z',
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

function makeBashToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-bash-1',
        toolName: 'bash',
        args: { command: 'ls -la', description: 'List files' },
        status: 'completed',
        result: 'total 42\ndrwxr-xr-x  5 user staff  160 Jan  1 00:00 .\ndrwxr-xr-x  3 user staff   96 Jan  1 00:00 ..',
        startTime: '2026-01-01T00:00:00Z',
        endTime: '2026-01-01T00:00:02Z',
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

describe('ToolCallView — view tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a view tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('File Preview');
    });

    it('shows code preview popover for .ts view tool call', () => {
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const codeEl = document.querySelector('[data-testid="popover-code"]');
        expect(codeEl).toBeTruthy();
        expect(codeEl!.textContent).toContain('const x = 1;');
    });

    it('shows markdown popover for .md view tool call', () => {
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({
                args: { path: '/project/README.md' },
                result: '1. # Hello World\n2. Some text',
            })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const mdEl = document.querySelector('[data-testid="popover-markdown"]');
        expect(mdEl).toBeTruthy();
        expect(mdEl!.classList.contains('markdown-body')).toBe(true);
    });

    it('does not show popover for view tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={makeViewToolCall({ result: '' })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('does not show popover for edit tool calls', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-1',
                toolName: 'edit',
                args: { path: '/project/foo.ts', old_str: 'a', new_str: 'b' },
                status: 'completed',
                result: 'File edited',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('does not show popover for grep tool calls', () => {
        const { container } = render(
            <ToolCallView toolCall={makeNonTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });
});

describe('ToolCallView — bash tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a bash tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={makeBashToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Shell Output');
    });

    it('renders terminal-style preview with command header for bash tool call', () => {
        const { container } = render(
            <ToolCallView toolCall={makeBashToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('$ ls -la');
        expect(terminalEl!.textContent).toContain('total 42');
    });

    it('does not show popover for bash tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={makeBashToolCall({ result: '' })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('strips ANSI escape codes from bash result in popover', () => {
        const ansiResult = '\x1b[32mSuccess\x1b[0m: build completed\n\x1b[1mDone\x1b[0m';
        const { container } = render(
            <ToolCallView toolCall={makeBashToolCall({ result: ansiResult })} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('Success: build completed');
        expect(terminalEl!.textContent).toContain('Done');
        expect(terminalEl!.textContent).not.toContain('\x1b');
    });
});
