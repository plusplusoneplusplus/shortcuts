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

    it('shows popover for edit tool calls with result', () => {
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
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Edit Preview');
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

    it('shows popover for edit tool calls', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-1',
                toolName: 'edit',
                args: { path: '/project/foo.ts', old_str: 'const a = 1;', new_str: 'const b = 2;' },
                status: 'completed',
                result: 'File edited',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Edit Preview');
    });

    it('shows popover for grep tool calls', () => {
        const { container } = render(
            <ToolCallView toolCall={makeNonTaskToolCall()} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeTruthy();
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

describe('ToolCallView — shell tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a shell tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-shell-1',
                toolName: 'shell',
                args: { command: 'echo hello', description: 'Print greeting' },
                status: 'completed',
                result: 'hello',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:01Z',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Shell Output');
    });

    it('renders terminal-style preview with command header for shell tool call', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-shell-2',
                toolName: 'shell',
                args: { command: 'cat /etc/hostname', description: 'Get hostname' },
                status: 'completed',
                result: 'my-server',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:01Z',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('$ cat /etc/hostname');
        expect(terminalEl!.textContent).toContain('my-server');
    });

    it('does not show popover for shell tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-shell-3',
                toolName: 'shell',
                args: { command: 'true' },
                status: 'completed',
                result: '',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });
});

describe('ToolCallView — powershell tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a powershell tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-ps-1',
                toolName: 'powershell',
                args: { command: 'New-Item -ItemType Directory -Force -Path "D:\\projects"', description: 'Ensure directory exists' },
                status: 'completed',
                result: 'done\n<exited with exit code 0>',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:00.841Z',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Shell Output');
    });

    it('renders terminal-style preview with command header for powershell tool call', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-ps-2',
                toolName: 'powershell',
                args: { command: 'Get-Process | Select-Object -First 5', description: 'List processes' },
                status: 'completed',
                result: 'Handles  NPM(K)    PM(K)      WS(K) CPU(s)\n-------  ------    -----      ----- ------',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:02Z',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('$ Get-Process | Select-Object -First 5');
        expect(terminalEl!.textContent).toContain('Handles');
    });

    it('does not show popover for powershell tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-ps-3',
                toolName: 'powershell',
                args: { command: 'Write-Host ""' },
                status: 'completed',
                result: '',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('strips ANSI escape codes from powershell result in popover', () => {
        const ansiResult = '\x1b[32mSuccess\x1b[0m: operation completed';
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-ps-4',
                toolName: 'powershell',
                args: { command: 'Write-Host "Success"', description: 'Test output' },
                status: 'completed',
                result: ansiResult,
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:01Z',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const terminalEl = document.querySelector('[data-testid="popover-terminal"]');
        expect(terminalEl).toBeTruthy();
        expect(terminalEl!.textContent).toContain('Success: operation completed');
        expect(terminalEl!.textContent).not.toContain('\x1b');
    });
});

describe('ToolCallView — glob tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a glob tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-glob-1',
                toolName: 'glob',
                args: { pattern: '**/*.ts', path: '/project' },
                status: 'completed',
                result: '/project/src/index.ts\n/project/src/utils.ts',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Glob Matches');
        expect(popover!.textContent).toContain('2 files');
    });

    it('does not show popover for glob tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-glob-2',
                toolName: 'glob',
                args: { pattern: '**/*.ts' },
                status: 'completed',
                result: '',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });
});

describe('ToolCallView — grep tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a grep tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-grep-1',
                toolName: 'grep',
                args: { pattern: 'doThing' },
                status: 'completed',
                result: 'src/foo.ts:12:export function doThing() {\nsrc/bar.ts:45:    doThing();',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Grep Matches');
        expect(popover!.textContent).toContain('2 matches in 2 files');
    });

    it('does not show popover for grep tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-grep-2',
                toolName: 'grep',
                args: { pattern: 'nonexistent' },
                status: 'completed',
                result: '',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });
});

describe('ToolCallView — create tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on a create tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-create-1',
                toolName: 'create',
                args: { path: '/project/src/new-file.ts', file_text: 'export const x = 1;' },
                status: 'completed',
                result: 'File created successfully',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Created File');
    });

    it('renders create preview with file content in popover', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-create-2',
                toolName: 'create',
                args: { path: '/project/src/utils.ts', file_text: 'export function hello() {}' },
                status: 'completed',
                result: 'File created',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('export function hello() {}');
    });

    it('does not show popover for create tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-create-3',
                toolName: 'create',
                args: { path: '/project/src/new-file.ts', file_text: 'content' },
                status: 'completed',
                result: '',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('shows "No preview available" when file_text is missing', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-create-4',
                toolName: 'create',
                args: { path: '/project/src/binary.bin' },
                status: 'completed',
                result: 'File created',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const createEl = document.querySelector('[data-testid="popover-create"]');
        expect(createEl).toBeTruthy();
        expect(createEl!.textContent).toContain('No preview available');
    });
});

describe('ToolCallView — edit tool hover popover', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows popover after 300ms hover on an edit tool call header', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-1',
                toolName: 'edit',
                args: { path: '/project/src/utils.ts', old_str: 'const a = 1;', new_str: 'const b = 2;' },
                status: 'completed',
                result: 'File updated',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const popover = document.querySelector('[data-testid="tool-result-popover"]');
        expect(popover).toBeTruthy();
        expect(popover!.textContent).toContain('Edit Preview');
    });

    it('renders diff preview with added and removed lines', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-2',
                toolName: 'edit',
                args: { path: '/project/src/index.ts', old_str: 'const x = 1;', new_str: 'const x = 2;' },
                status: 'completed',
                result: 'File updated',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        const removedLines = editEl!.querySelectorAll('.diff-line-removed');
        const addedLines = editEl!.querySelectorAll('.diff-line-added');
        expect(removedLines.length).toBeGreaterThan(0);
        expect(addedLines.length).toBeGreaterThan(0);
        expect(removedLines[0].textContent).toContain('const x = 1;');
        expect(addedLines[0].textContent).toContain('const x = 2;');
    });

    it('shows file path in the popover', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-3',
                toolName: 'edit',
                args: { path: '/project/src/config.ts', old_str: 'a', new_str: 'b' },
                status: 'completed',
                result: 'File updated',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        expect(editEl!.textContent).toContain('config.ts');
    });

    it('does not show popover for edit tool call with empty result', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-4',
                toolName: 'edit',
                args: { path: '/project/src/foo.ts', old_str: 'a', new_str: 'b' },
                status: 'completed',
                result: '',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(500); });

        expect(document.querySelector('[data-testid="tool-result-popover"]')).toBeNull();
    });

    it('shows "No preview available" when old_str and new_str are both missing', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-5',
                toolName: 'edit',
                args: { path: '/project/src/foo.ts' },
                status: 'completed',
                result: 'File updated',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        expect(editEl!.textContent).toContain('No preview available');
    });

    it('handles multi-line diffs in the popover', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-6',
                toolName: 'edit',
                args: {
                    path: '/project/src/handler.ts',
                    old_str: 'if (type !== \'chat\') continue;\nreturn result;',
                    new_str: 'if (type !== \'chat\' && type !== \'readonly\') continue;\nreturn result;',
                },
                status: 'completed',
                result: 'File updated with changes.',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        // Context line should be present (shared line)
        const contextLines = editEl!.querySelectorAll('.diff-line-context');
        expect(contextLines.length).toBeGreaterThan(0);
        expect(contextLines[0].textContent).toContain('return result;');
    });

    it('supports old_string/new_string alternate arg names', () => {
        const { container } = render(
            <ToolCallView toolCall={{
                id: 'tc-edit-7',
                toolName: 'edit',
                args: { path: '/project/foo.ts', old_string: 'x', new_string: 'y' },
                status: 'completed',
                result: 'File updated',
            }} />
        );

        const header = container.querySelector('.tool-call-header')!;
        fireEvent.mouseEnter(header);
        act(() => { vi.advanceTimersByTime(300); });

        const editEl = document.querySelector('[data-testid="popover-edit"]');
        expect(editEl).toBeTruthy();
        const removedLines = editEl!.querySelectorAll('.diff-line-removed');
        const addedLines = editEl!.querySelectorAll('.diff-line-added');
        expect(removedLines.length).toBeGreaterThan(0);
        expect(addedLines.length).toBeGreaterThan(0);
    });
});
